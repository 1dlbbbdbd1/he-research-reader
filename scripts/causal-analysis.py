import argparse
import base64
import csv
import hashlib
import json
import math
import platform
import sys

import numpy as np

PREFIX = "READER_CAUSAL_RESULT:"


def numeric_rows(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError("CSV 没有数据行。")
    return rows


def values(rows, name):
    try:
        result = np.asarray([float(row[name]) for row in rows], dtype=float)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"列 {name} 必须存在且全部为数值。") from exc
    if not np.all(np.isfinite(result)):
        raise ValueError(f"列 {name} 包含非有限值。")
    return result


def ols(y, x):
    beta, _, rank, _ = np.linalg.lstsq(x, y, rcond=None)
    if rank < x.shape[1]:
        raise ValueError("模型矩阵不满秩，无法识别所选效应。")
    residual = y - x @ beta
    dof = max(1, len(y) - x.shape[1])
    sigma2 = float(residual @ residual / dof)
    covariance = sigma2 * np.linalg.pinv(x.T @ x)
    se = np.sqrt(np.maximum(0.0, np.diag(covariance)))
    return beta, se, residual


def controls(rows, names):
    columns = [values(rows, name) for name in names]
    return np.column_stack(columns) if columns else np.empty((len(rows), 0))


def did(rows, design):
    y = values(rows, design["outcome"])
    treated = values(rows, design["treated"])
    post = values(rows, design["post"])
    time = values(rows, design["time"])
    cov = controls(rows, design.get("covariates", []))
    interaction = treated * post
    x = np.column_stack([np.ones(len(rows)), treated, post, interaction, cov])
    beta, se, _ = ols(y, x)
    pre = post == 0
    pre_times = np.unique(time[pre])
    if len(pre_times) < 2:
        raise ValueError("DID 平行趋势检查至少需要两个处理前时期。")
    pre_x = np.column_stack([np.ones(int(pre.sum())), time[pre], treated[pre], time[pre] * treated[pre]])
    pre_beta, pre_se, _ = ols(y[pre], pre_x)
    scale = float(np.std(y[pre])) or 1.0
    threshold = float(design.get("parallelTrendThreshold", 0.1))
    normalized_slope = abs(float(pre_beta[3])) / scale
    passed = normalized_slope <= threshold
    return {
        "estimate": {"name": "DID interaction", "value": float(beta[3]), "standardError": float(se[3]), "n": len(rows)},
        "diagnostics": {"parallelTrends": {"passed": passed, "prePeriods": int(len(pre_times)), "slopeDifference": float(pre_beta[3]), "standardError": float(pre_se[3]), "normalizedAbsoluteSlope": normalized_slope, "threshold": threshold}},
        "assumptions": ["无处理前预期效应", "组间趋势在无处理时保持平行", "样本构成和测量口径可比"],
        "reliable": passed,
    }


def rdd_estimate(rows, design, bandwidth):
    running = values(rows, design["running"])
    y = values(rows, design["outcome"])
    centered = running - float(design["cutoff"])
    keep = np.abs(centered) <= bandwidth
    if int(keep.sum()) < 20 or len(np.unique((centered[keep] >= 0).astype(int))) < 2:
        raise ValueError(f"RDD 带宽 {bandwidth} 内两侧观测不足。")
    side = (centered[keep] >= 0).astype(float)
    cov = controls(rows, design.get("covariates", []))[keep]
    x = np.column_stack([np.ones(int(keep.sum())), side, centered[keep], side * centered[keep], cov])
    beta, se, _ = ols(y[keep], x)
    return {"bandwidth": bandwidth, "estimate": float(beta[1]), "standardError": float(se[1]), "n": int(keep.sum())}


def rdd(rows, design):
    bandwidth = float(design["bandwidth"])
    main = rdd_estimate(rows, design, bandwidth)
    sensitivity = [rdd_estimate(rows, design, bandwidth * factor) for factor in (0.5, 1.0, 1.5)]
    signs = [math.copysign(1, item["estimate"]) if item["estimate"] else 0 for item in sensitivity]
    passed = len(set(signs)) == 1
    return {"estimate": {"name": "RDD cutoff jump", "value": main["estimate"], "standardError": main["standardError"], "n": main["n"]}, "diagnostics": {"bandwidthSensitivity": {"passed": passed, "estimates": sensitivity}}, "assumptions": ["阈值附近个体不能精确操纵运行变量", "除处理外的潜在结果在阈值处连续", "带宽与函数形式合理"], "reliable": passed}


def iv(rows, design):
    y = values(rows, design["outcome"]); treatment = values(rows, design["treatment"]); instrument = values(rows, design["instrument"]); cov = controls(rows, design.get("covariates", []))
    first_x = np.column_stack([np.ones(len(rows)), instrument, cov]); first_beta, first_se, _ = ols(treatment, first_x); f_stat = float((first_beta[1] / first_se[1]) ** 2) if first_se[1] > 0 else float("inf")
    predicted = first_x @ first_beta; second_x = np.column_stack([np.ones(len(rows)), predicted, cov]); second_beta, second_se, _ = ols(y, second_x); passed = f_stat >= float(design.get("weakInstrumentFThreshold", 10))
    return {"estimate": {"name": "IV / 2SLS treatment effect", "value": float(second_beta[1]), "standardError": float(second_se[1]), "n": len(rows)}, "diagnostics": {"weakInstrument": {"passed": passed, "firstStageF": f_stat, "threshold": float(design.get("weakInstrumentFThreshold", 10))}}, "assumptions": ["工具变量与处理显著相关", "工具变量只通过处理影响结果", "工具变量与未观测混杂独立"], "reliable": passed}


def sigmoid(value):
    return 1.0 / (1.0 + np.exp(-np.clip(value, -30, 30)))


def psm(rows, design):
    treatment = values(rows, design["treatment"]); y = values(rows, design["outcome"]); names = design.get("covariates", [])
    if not names:
        raise ValueError("PSM 至少需要一个处理前协变量。")
    raw = controls(rows, names); means = raw.mean(axis=0); scales = raw.std(axis=0); scales[scales == 0] = 1; z = (raw - means) / scales; x = np.column_stack([np.ones(len(rows)), z]); beta = np.zeros(x.shape[1])
    for _ in range(3000):
        probability = sigmoid(x @ beta); gradient = x.T @ (probability - treatment) / len(rows); beta -= 0.08 * gradient
        if float(np.max(np.abs(gradient))) < 1e-7: break
    score = sigmoid(x @ beta); treated_ids = np.where(treatment == 1)[0]; control_ids = np.where(treatment == 0)[0]
    if len(treated_ids) < 5 or len(control_ids) < 5: raise ValueError("PSM 处理组和对照组都至少需要 5 个样本。")
    lower = max(float(score[treated_ids].min()), float(score[control_ids].min())); upper = min(float(score[treated_ids].max()), float(score[control_ids].max())); common = treated_ids[(score[treated_ids] >= lower) & (score[treated_ids] <= upper)]
    pairs = [(idx, int(control_ids[np.argmin(np.abs(score[control_ids] - score[idx]))])) for idx in common]
    if len(pairs) < 5: raise ValueError("PSM 共同支持区内匹配样本不足。")
    att = float(np.mean([y[a] - y[b] for a, b in pairs])); matched_t = np.asarray([a for a, _ in pairs]); matched_c = np.asarray([b for _, b in pairs])
    pre = []; post = []
    for col in range(raw.shape[1]):
        pooled = math.sqrt((float(np.var(raw[treated_ids, col])) + float(np.var(raw[control_ids, col]))) / 2) or 1.0
        pre.append(float((raw[treated_ids, col].mean() - raw[control_ids, col].mean()) / pooled)); post.append(float((raw[matched_t, col].mean() - raw[matched_c, col].mean()) / pooled))
    threshold = float(design.get("balanceThreshold", 0.1)); passed = max(abs(value) for value in post) <= threshold and len(common) / len(treated_ids) >= 0.8
    return {"estimate": {"name": "PSM ATT", "value": att, "standardError": None, "n": len(pairs) * 2}, "diagnostics": {"matchingBalance": {"passed": passed, "covariates": names, "smdBefore": pre, "smdAfter": post, "threshold": threshold, "commonSupportTreatedShare": len(common) / len(treated_ids)}}, "assumptions": ["给定协变量后不存在未观测混杂", "倾向得分存在共同支持", "协变量均在处理前测量"], "reliable": passed}


def projected_weights(matrix, target):
    weights = np.ones(matrix.shape[1]) / matrix.shape[1]
    scale = float(np.linalg.norm(matrix, 2) ** 2) or 1.0
    for _ in range(10000):
        gradient = 2 * matrix.T @ (matrix @ weights - target) / len(target); next_weights = np.maximum(0.0, weights - gradient / scale); total = float(next_weights.sum()); next_weights = next_weights / total if total else np.ones_like(weights) / len(weights)
        if float(np.max(np.abs(next_weights - weights))) < 1e-10: weights = next_weights; break
        weights = next_weights
    return weights


def scm(rows, design):
    unit = design["unit"]; time_name = design["time"]; outcome = design["outcome"]; treated_unit = str(design["treatedUnit"]); intervention = float(design["interventionTime"])
    units = sorted(set(str(row[unit]) for row in rows)); times = sorted(set(float(row[time_name]) for row in rows)); donors = [value for value in units if value != treated_unit]
    if treated_unit not in units or len(donors) < 2: raise ValueError("SCM 需要一个处理单元和至少两个供体单元。")
    lookup = {(str(row[unit]), float(row[time_name])): float(row[outcome]) for row in rows}; pre_times = [value for value in times if value < intervention]; post_times = [value for value in times if value >= intervention]
    if len(pre_times) < 3 or not post_times: raise ValueError("SCM 至少需要三个处理前时期和一个处理后时期。")
    try: target_pre = np.asarray([lookup[(treated_unit, value)] for value in pre_times]); donor_pre = np.asarray([[lookup[(donor, value)] for donor in donors] for value in pre_times]); target_post = np.asarray([lookup[(treated_unit, value)] for value in post_times]); donor_post = np.asarray([[lookup[(donor, value)] for donor in donors] for value in post_times])
    except KeyError as exc: raise ValueError("SCM 面板数据必须覆盖处理单元和全部供体的所有时期。") from exc
    weights = projected_weights(donor_pre, target_pre); synthetic_pre = donor_pre @ weights; synthetic_post = donor_post @ weights; pre_rmspe = float(np.sqrt(np.mean((target_pre - synthetic_pre) ** 2))); effects = target_post - synthetic_post; scale = float(np.std(target_pre)) or 1.0; passed = pre_rmspe / scale <= float(design.get("preRmspeThreshold", 0.25))
    placebo_cut = max(1, len(pre_times) - 1); placebo_effect = float(target_pre[-1] - synthetic_pre[-1])
    return {"estimate": {"name": "SCM average post-treatment gap", "value": float(np.mean(effects)), "standardError": None, "n": len(rows)}, "diagnostics": {"syntheticControl": {"passed": passed, "preRmspe": pre_rmspe, "normalizedPreRmspe": pre_rmspe / scale, "threshold": float(design.get("preRmspeThreshold", 0.25)), "donorWeights": dict(zip(donors, [float(value) for value in weights])), "postEffects": [float(value) for value in effects], "prePeriodPlaceboGap": placebo_effect, "placeboCutIndex": placebo_cut}}, "assumptions": ["供体池未受处理影响", "处理前拟合足以近似反事实路径", "不存在与处理同期的单元特异冲击"], "reliable": passed}


METHODS = {"DID": did, "RDD": rdd, "IV": iv, "PSM": psm, "SCM": scm}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload-base64", required=True)
    args = parser.parse_args()
    payload = json.loads(base64.b64decode(args.payload_base64).decode("utf-8"))
    path = payload["dataPath"]; method = str(payload["method"]).upper(); design = payload["design"]
    if method not in METHODS: raise ValueError("method 必须是 DID、RDD、IV、PSM 或 SCM。")
    rows = numeric_rows(path); result = METHODS[method](rows, design)
    with open(path, "rb") as handle: data_hash = hashlib.sha256(handle.read()).hexdigest()
    result.update({"method": method, "dataPath": path, "dataSha256": data_hash, "modelParameters": design, "runtime": {"python": sys.version, "executable": sys.executable, "platform": platform.platform(), "numpy": np.__version__}, "interpretationBoundary": "统计估计与方法假设必须分开解释；诊断未通过时不得表述为可靠因果结论。"})
    print(PREFIX + json.dumps(result, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print(PREFIX + json.dumps({"error": str(exc)}, ensure_ascii=True))
        sys.exit(2)
