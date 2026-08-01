from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
from pathlib import Path
from typing import Any

RESULT_PREFIX = "READER_EMBEDDING_RESULT:"
DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
ALLOWED_MODELS = {DEFAULT_MODEL}
MAX_TEXTS = 128
MAX_CHARACTERS = 8_000


def emit(payload: dict[str, Any]) -> None:
    print(f"{RESULT_PREFIX}{json.dumps(payload, ensure_ascii=False)}", flush=True)


def runtime_paths() -> tuple[Path, Path]:
    cache_root = Path(os.environ["FASTEMBED_CACHE_PATH"]).resolve()
    manifest_path = Path(os.environ["READER_EMBEDDING_MANIFEST"]).resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    return cache_root, manifest_path


def checked_model(value: str) -> str:
    model_name = (value or DEFAULT_MODEL).strip()
    if model_name not in ALLOWED_MODELS:
        raise ValueError("不支持的本地嵌入模型。")
    return model_name


def load_manifest(manifest_path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(manifest_path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def status(model_name: str) -> dict[str, Any]:
    cache_root, manifest_path = runtime_paths()
    manifest = load_manifest(manifest_path)
    available = bool(
        manifest
        and manifest.get("model") == model_name
        and manifest.get("dimension") == 512
        and any(cache_root.iterdir())
    )
    return {
        "available": available,
        "provider": "fastembed-local",
        "model": model_name,
        "dimension": manifest.get("dimension") if available else None,
        "fastembedVersion": importlib.metadata.version("fastembed"),
        "libraryLicense": "Apache-2.0",
        "modelLicense": "MIT",
        "localOnly": True,
    }


def create_model(model_name: str, cache_root: Path, local_files_only: bool):
    from fastembed import TextEmbedding

    return TextEmbedding(
        model_name=model_name,
        cache_dir=str(cache_root),
        local_files_only=local_files_only,
    )


def normalized_vector(vector: Any) -> list[float]:
    import numpy as np

    values = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(values))
    if not norm:
        raise RuntimeError("嵌入模型返回了零向量。")
    return (values / norm).astype(np.float32).tolist()


def prepare(model_name: str) -> dict[str, Any]:
    cache_root, manifest_path = runtime_paths()
    model = create_model(model_name, cache_root, local_files_only=False)
    vector = normalized_vector(next(iter(model.embed(["科研阅读本地语义检索"], batch_size=1))))
    manifest = {
        "model": model_name,
        "dimension": len(vector),
        "fastembedVersion": importlib.metadata.version("fastembed"),
        "libraryLicense": "Apache-2.0",
        "modelLicense": "MIT",
    }
    if manifest["dimension"] != 512:
        raise RuntimeError(f"嵌入维度异常：{manifest['dimension']}")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return status(model_name)


def read_request() -> tuple[list[str], str]:
    request = json.loads(sys.stdin.read() or "{}")
    raw_texts = request.get("texts")
    kind = request.get("kind", "passage")
    if kind not in {"passage", "query"}:
        raise ValueError("嵌入类型只能是 passage 或 query。")
    if not isinstance(raw_texts, list) or not raw_texts or len(raw_texts) > MAX_TEXTS:
        raise ValueError(f"单次嵌入必须包含 1–{MAX_TEXTS} 条文本。")
    texts = []
    for value in raw_texts:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("嵌入文本不能为空。")
        text = value.strip()
        if len(text) > MAX_CHARACTERS:
            raise ValueError(f"单条嵌入文本不能超过 {MAX_CHARACTERS} 个字符。")
        texts.append(text)
    return texts, kind


def embed(model_name: str) -> dict[str, Any]:
    cache_root, manifest_path = runtime_paths()
    manifest = load_manifest(manifest_path)
    if not manifest or manifest.get("model") != model_name:
        raise RuntimeError("本地语义模型尚未安装。")
    texts, kind = read_request()
    model = create_model(model_name, cache_root, local_files_only=True)
    iterator = model.query_embed(texts) if kind == "query" else model.embed(texts)
    vectors = [normalized_vector(vector) for vector in iterator]
    if len(vectors) != len(texts) or any(len(vector) != 512 for vector in vectors):
        raise RuntimeError("本地嵌入结果数量或维度异常。")
    return {
        "provider": "fastembed-local",
        "model": model_name,
        "dimension": 512,
        "kind": kind,
        "vectors": vectors,
        "localOnly": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("status", "prepare", "embed"))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()
    try:
        model_name = checked_model(args.model)
        if args.command == "status":
            result = status(model_name)
        elif args.command == "prepare":
            result = prepare(model_name)
        else:
            result = embed(model_name)
        emit({"ok": True, "result": result})
        return 0
    except Exception as error:
        emit({"ok": False, "error": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
