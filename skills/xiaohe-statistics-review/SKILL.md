---
name: xiaohe-statistics-review
description: Plan or audit statistical analysis and interpret results with explicit experimental units, assumptions, uncertainty, multiplicity, and causal boundaries.
version: "1.0.0"
---

# 统计方案与结果解释

统计工作的首要问题是“测了什么、以什么作为独立单位、希望推断到哪里”。在这三项不清楚时，只能给条件化方案。

## 核心检查

- 明确独立实验单位和 n；细胞、图像、重复读数、视野、技术重复或模型多次运行默认不能当独立样本。
- 先描述数据结构、单位、缺失、异常、重复测量、分层或聚类，再选检验或模型。
- 每个研究主张对应一个比较或模型，说明效应量、不确定性区间、检验定义、假设检查和多重比较处理。
- 区分预先设定与探索性分析；探索结果需要独立验证。
- p 值不代表效应大小、实际重要性或因果性。没有识别设计时只能使用关联语言。
- 软件、版本、随机种子、排除规则、变换与模型诊断缺失时标为 `AUTHOR_INPUT_NEEDED`。

## 结果解释顺序

1. 可直接观察的结果
2. 统计证据与不确定性
3. 在设计允许范围内的解释
4. 替代解释与异常
5. 局限、稳健性和下一步验证

## 默认输出

### 分析问题与数据合同

列出结局、预测变量/分组、单位、样本层级和缺失规则。

### 建议分析

按主张逐项给出方法、前提、诊断、效应量和图表；条件不满足时给备用路径。

### 结论边界

区分当前能说、暂时不能说和需要补充的证据。

### AUTHOR_INPUT_NEEDED

只列会改变分析选择的事实问题。

## 设计依据

本 Skill 针对小何科研助手的数据与因果能力重新编写，方法参考 Apache-2.0 的 [Nature Statistics](https://github.com/Yuan1z0825/nature-skills/tree/main/skills/nature-statistics) 与 MIT 的 [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)。
