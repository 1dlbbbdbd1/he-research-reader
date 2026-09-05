# 科研流程审查与 1.4.0 改进记录

## 需求与接口

本轮审查覆盖立项、文献检索与分析、综述、研究思路、实验整理和导师式指导。沿用项目制对话与 Research Vault，数据结构保持 schema v19。

执行接口为 `conversation-workflows.cjs → WorkbenchService.createRun → ToolRegistry → agent_artifacts`。实验草稿经 `saveResult` 确认后调用 `WorkspaceService.saveResearchRecord`。模型上下文读取本次已完成步骤、同一会话最近 12 轮、当前项目已确认记忆和最近 6 项最新版本已确认成果。

| 科研环节 | 审查发现与当前实现 | 使用入口 |
| --- | --- | --- |
| 立项 | 增加问题边界、资源、导师要求、检索计划、基线与阶段证据；不确定条件保留待确认 | 立项 |
| 检索 | Crossref 与 arXiv 实际返回形成确定性候选数据，保留查询、时间、标识和解析错误 | 查文献 |
| 阅读与比较 | 每份已选资料进入模型上下文，长文按预算保留首尾并标注覆盖范围，结果保存来源链接 | 文献分析总结、证据对比 |
| 综述 | 复用协议、去重、两阶段筛选、证据矩阵、PRISMA 和引用映射检查 | 工作流库 → 系统文献综述 |
| 思路 | 候选思路关联证据、机制假设、反例、成本条件与最小验证；记录未采用理由 | 找思路 |
| 实验设计 | 复用变量、对照、实验单位、步骤、停止条件和数据合同方法 | 设计实验 |
| 实验整理 | 粘贴或导入多个文本、日志、Markdown、CSV、JSON、TSV；保留原文，生成可编辑草稿，确认后生成独立实验记录 | 整理记录 |
| 导师反馈 | 根据同项目已确认成果及本次资料，检查主张、证据、替代解释、可行性，按影响给出动作 | 导师审查 |
| 持续积累 | 同会话延续、已确认记忆和成果接入；结果最新版被拒绝或归档后，旧确认版不会重新进入上下文 | 项目对话、项目记忆、任务结果 |

## 成熟 Skills 的借鉴

本轮重新查看了下列上游文件，按本项目接口编写两个本地方法文件，采用 skill-creator 的精简、按任务加载原则。

- [Nature Skills 实验日志](https://github.com/Yuan1z0825/nature-skills/blob/main/skills/nature-experiment-log/SKILL.md)：借鉴原始材料与整理记录分层、缺失字段询问、来源关联。本项目使用现有实验记录与成果版本保存。
- [Scientific Agent Skills 科研构思](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-brainstorming/SKILL.md)：借鉴区分想法、证据和决定，保留反例及未采用方向，定义最小验证。
- [Scientific Agent Skills 批判性思考](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-critical-thinking/SKILL.md)：借鉴按对结论的影响排序问题，检查混杂、方法和证据，给出具体修改建议。
- [Nature Skills 论文卡](https://github.com/Yuan1z0825/nature-skills/blob/main/skills/nature-paper-card/SKILL.md)：用于对照论文方法、实验与主张的证据关系。

本地新增 `xiaohe-research-cycle` 和 `xiaohe-experiment-intake`；已有 5 个科研 Skills 继续使用。上游方法指导经过本项目重新编写，外部工具需通过本机工具接口接入。

## 原文与确认规则

用户粘贴的输入保存在运行创建记录中。整理结果另存版本。确认时使用运行中保存的原文、所选来源和实际读取的来源链接，客户端不能更换这些原始字段。

同一已确认内容重复确认保持幂等。修改后再次确认生成新实验记录，旧记录保留。实验记录时间线显示整理登记时间；实验实际发生时间以正文资料为准。实验保存与成果确认在同一事务中执行，失败时一起回滚。跨项目的运行读取和保存均检查项目归属。

## 验收范围

本轮以隔离数据库、模拟模型响应和真实 Electron 界面检查代码路径。内容验收会获得已授权的来源摘要与草稿；生成完成和实验结论成立分别表述。自动验收不替代研究者核对。

长资料通过有限上下文提供首尾摘要；中间段需要针对性再读。当前散乱材料入口接收文本和已解析资料，图片与音频需先提供文字描述或转录。检索每个来源本轮最多 10 条，系统综述仍通过所选项目资料或题录输入执行；全面检索、真实模型科研质量与真实设备实验需要相应的独立证据。

本轮 267 项测试、生产构建、源码与目录版 Electron 验收通过。新增界面在 1024×768、1600×900、2560×1440、3840×2160 下检查输入、按钮、字号和溢出，并逐档查看截图。实现提交为 `81512c1`。Windows 安装版与便携版已生成，验收数据与校验值记录在 `docs/acceptance/research-cycle-1.4.0*.json`，入口同步到 README。
