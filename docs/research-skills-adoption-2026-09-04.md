# 科研 Skills 选型与 Agent 改造记录

日期：2026-09-04

## 1. 用户目标

把“小何的科研助手”推进为可扩展的科研 Agent：用户直接描述任务，系统选择成熟科研方法，读取授权资料，调用真实工具，并交付可编辑、可核验的研究产物。

## 2. 目标项目核对

本轮主参照是 [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills)。项目由上海交通大学博士生袁一哲发起，公开仓库按独立目录提供约 20 个科研 Skills，覆盖检索、阅读、引用、统计、写作、评审回复、图表与演示等任务。

[NatureSkills 科研 Agent](https://natureskills.cn/agent) 是同一平台中的登录后研究空间。公开页面显示项目与任务侧栏、统一输入区和任务卡；[用户协议](https://natureskills.cn/legal/terms) 说明 Agent 使用独立积分计量。它与 GitHub 上的 Skills 集群共同构成“技能供给 + Agent 执行”的产品链路。

## 3. 高星项目现场快照

星标与许可证为 2026-09-04 的 GitHub 公开快照，数字会继续变化。

| 项目 | 星标 | 许可证 | 本轮结论 |
| --- | ---: | --- | --- |
| [Academic Research Skills](https://github.com/Imbad0202/academic-research-skills) | 46,156 | CC BY-NC 4.0 | 工作流完整，非商业限制不适合直接随应用打包；用于产品覆盖面对照。 |
| [Scientific Agent Skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 42,490 | MIT | 165 个 Skills，数据库与专业工具覆盖广；本轮吸收多来源检索、可复现记录和按需加载思想。 |
| [Nature Skills](https://github.com/Yuan1z0825/nature-skills) | 39,114 | Apache-2.0 | 约 20 个高频科研 Skills，边界清楚、渐进披露成熟；作为当前方法层主参照。 |
| [AI Research SKILLs](https://github.com/Orchestra-Research/AI-Research-SKILLs) | 12,296 | MIT | 覆盖面广，适合作为后续专业能力目录；当前按依赖逐项接入。 |
| [DeepMind Science Skills](https://github.com/google-deepmind/science-skills) | 2,831 | Apache-2.0 | 适合作为科学工具调用与验证设计对照；当前未复制代码。 |

## 4. 首批五个本地适配 Skills

外部 Skills 可能需要 Python、R、Node.js、浏览器、机构访问、外部 API 和密钥。当前应用已经有本地项目、任务授权、来源阅读、Crossref、结果版本与人工确认，因此先把最常用的方法接到现有工具上：

| 本地 Skill | 当前覆盖 |
| --- | --- |
| xiaohe-literature-evidence | 检索记录、来源级别、去重、候选矩阵、主张到证据 |
| xiaohe-paper-evidence | 论文精读、事实与解释分层、来源锚点、复现缺口 |
| xiaohe-research-design | 可证伪问题、实验单位、变量与对照、最小试验、安全边界 |
| xiaohe-statistics-review | n 与重复、效应量、不确定性、假设与诊断、因果边界 |
| xiaohe-scientific-writing | 主张—证据—边界、章节任务、术语表、缺失作者输入 |

这些文件针对小何现有接口重新编写，保留上游链接作为设计依据，没有直接复制整个外部仓库。

## 5. 运行链路

用户任务通过手动选择或本地规则绑定 Skill，随后依次经过项目范围检查、任务授权、按需读取 SKILL.md、规划与工具步骤、Skill 方法整理、可编辑成果版本和人工确认。

关键变化：

1. electron/workbench/skill-library.cjs 安全读取标准 Skill，限制目录名、路径和文件大小。
2. 12 个对话工作流都声明 skillId；界面展示方法名称与版本。
3. 自由科研任务自动选择方法，并增加 executor 步骤交付完整正文。
4. executor 正文进入 agent_artifacts 的结果版本。
5. 文献检索覆盖 Crossref 正式书目和 arXiv 预印本，模型按稳定 ID 去重并明确证据层级。
6. skills 目录已进入 Electron 打包清单。

## 6. 当前验证

- npm run test:workbench：32/32 通过。
- npm test：253/253 通过。
- npm run build：TypeScript 与 Vite 生产构建通过。
- npm run smoke:desktop：隔离桌面 smoke 通过；工作流库、资料选择、项目记忆、滚动与 1024/1600/2K/4K 布局通过。
- Crossref 和 arXiv 公共端点已分别完成联网可达性检查。

这些证据确认源码执行链和生产编译。真实用户模型、长任务、打包成品和安装流程继续使用独立发布验收。

## 7. 后续接入原则

- 优先接入能复用现有受控工具、许可证允许分发、能留下核验产物的 Skill。
- 外部 Skill 的脚本、依赖、域名和密钥逐项预检。
- 项目资料默认留在本地；发送给模型或外部服务的内容继续经过任务授权。
- 每次新增 Skill 至少验证触发、输入、工具依赖、结果版本、失败提示和打包存在性。
