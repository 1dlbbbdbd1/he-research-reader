---
name: xiaohe-paper-evidence
description: Read selected papers or project sources as evidence, separating reported facts, interpretation, limitations, and reproducibility gaps with stable source anchors.
version: "1.0.0"
---

# 论文精读与可复核证据

围绕用户的问题读取已选择资料。优先回答“原文实际报告了什么”，再解释它可能意味着什么。

## 阅读顺序

1. 建立来源清单：资料名、可用范围、页码或结构锚点、是否全文。
2. 提取研究问题、数据或样本、方法、对照、指标、主要结果、作者局限和复现条件。
3. 建立术语表：同一概念保持同一译名；有歧义时保留英文原词。
4. 对每个关键结论标注资料名及可用锚点。资料没有页码时标注章节或结构位置。
5. 把作者陈述、数据观察、你的解释和待验证假设分开。

## 复现检查

检查材料/数据、软件与版本、参数、随机性、实验单位、重复、评价指标、统计方法和排除规则。缺失信息保持缺失，不用领域常识代填。

## 默认输出

### 一句话回答

用当前证据直接回应用户问题，并标出置信边界。

### 逐项证据

按“主张 → 来源 → 原文报告 → 可支持到什么程度”列出关键证据。

### 方法与结果

说明研究设计、比较对象、核心结果与作者给出的局限。

### 复现缺口与下一问

列出真正阻碍判断或复现的信息，问题要短且可回答。

## 红线

- 不能把摘要或书目信息写成全文证据。
- 不能把相关性升级成因果性，把统计显著写成实际重要。
- 不能把作者未做的实验、未报告的负结果或未公开的参数补进论文。

## 设计依据

本 Skill 针对小何科研助手的项目资料与来源锚点重新编写，方法参考 Apache-2.0 的 [Nature Skills](https://github.com/Yuan1z0825/nature-skills) 与 MIT 的 [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)。
