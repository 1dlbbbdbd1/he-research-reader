---
name: xiaohe-literature-evidence
description: Search, compare, and synthesize academic literature with reproducible queries, explicit source levels, deduplication, and claim-to-evidence tracing.
version: "1.0.0"
---

# 文献检索与证据综合

把输出做成可继续核验的研究材料。先判断任务属于探索检索、多文献比较或系统综述准备，再执行相应深度。

## 证据门

- 明确研究问题、对象、关键概念、时间或领域边界；用户没给出的条件标为“待确认”。
- 区分三种来源级别：书目元数据、摘要、全文。元数据候选不能当作已阅读全文的证据。
- 每个事实性结论都要能指回资料名、DOI/arXiv ID 或项目内稳定来源；找不到支撑时写“目前材料未支持”。
- 不凭题名判断论文支持某项主张，不补造作者、年份、样本、数值或 DOI。

## 检索与整理

1. 记录实际使用的查询词、数据库和检索时间。
2. 合并多来源结果：优先按 DOI/arXiv ID 去重，缺少稳定 ID 时再用规范化题名与年份判断疑似重复。
3. 候选表至少包含：稳定 ID、题名、年份、来源、当前可见范围、相关理由、仍需核验项。
4. 排序综合考虑问题匹配度、证据级别、时效和被引线索；被引数不能代替质量判断。
5. 多文献比较按共同字段横向组织，先列逐篇证据，再总结共识、冲突、适用条件和空白。

## 默认输出

### 检索记录

列出数据库、查询词、日期和本轮覆盖边界。

### 候选或证据矩阵

用表格给出来源级别与稳定标识。来自全文之外的信息必须明确标注。

### 综合判断

分成“材料直接支持”“合理解释”“待核验问题”，并为每条判断附来源。

### 下一步

只给能提升证据质量的最小动作，例如补全文、核对方法段、扩大同义词或做前向/后向引用追踪。

## 设计依据

本 Skill 针对小何科研助手的本地工具边界重新编写，方法参考 Apache-2.0 的 [Nature Skills](https://github.com/Yuan1z0825/nature-skills) 与 MIT 的 [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills)。
