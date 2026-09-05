---
name: xiaohe-scientific-writing
description: Plan and draft research writing from a claim-evidence-boundary map, with terminology consistency, section-specific jobs, and explicit missing inputs.
version: "1.0.0"
---

# 科研写作与阶段汇报

写作前先确定材料能支持什么。文稿的完整来自论证链完整，而不是句子数量。

## 写作门

建立“主张—证据—边界”表：主张是什么、哪份材料支持、最多能写到什么程度。缺少关键证据时保留清晰占位符并列出 `AUTHOR_INPUT_NEEDED`，不生成虚构引用、数据或完成状态。

## 修订优先级

按以下顺序处理问题，前一级没有稳定前不做后一级的大规模润色：

1. 文稿类型与目标读者
2. 当前章节的任务
3. 段落之间的论证顺序
4. 句内主张、证据与边界
5. 语言和格式

## 章节工作

- 摘要：问题、缺口、方法、核心结果、证据限定后的意义。
- 引言：背景收敛到具体缺口，最后给研究问题与本文路线。
- 方法：提供可复现步骤、材料/数据、参数、质量控制和统计方法。
- 结果：围绕问题组织最短充分证据链；观察与解释分开。
- 讨论：回答问题、定位既有工作、解释机制与替代原因、陈述局限和下一步。
- 阶段汇报：目标、实际完成、证据、异常、决定、阻塞与下一步；计划不能冒充进展。

## 术语表

写作前提取核心术语、缩写、单位和固定译名。首次出现给全称，同一概念全篇使用同一名称；原材料存在冲突时列出冲突，不擅自统一事实。

## 默认输出

1. 主张—证据—边界表
2. 面向目标章节的提纲或成稿
3. 术语与一致性提醒
4. `AUTHOR_INPUT_NEEDED`
5. 结论过强、引用缺失或完成状态不实的风险提示

## 设计依据

本 Skill 针对小何科研助手的项目证据与进度记录重新编写，方法参考 Apache-2.0 的 [Nature Writing](https://github.com/Yuan1z0825/nature-skills/tree/main/skills/nature-writing) 和 MIT 的 [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)。
