# Research Agent Runtime

## 不是聊天记录

Research Agent 的运行状态保存在 Research Vault，而不是 React 组件内存：

- `agent_memory_items`：研究方向、术语、阅读/实验历史和偏好；AI 写入先是待确认草稿。
- `agent_sessions` / `agent_turns`：会话与只追加消息。
- `agent_plans` / `agent_plan_steps`：目标、顺序、工具输入、状态、输出与错误。
- `agent_tool_events`：proposed、confirmed、started、completed、failed 等只追加审计事件。

Research Vault 会把已保存记忆和计划审计投影到 `notes/agent-memory.generated.md` 与 `reports/agent-plans.generated.md`。

## Planner 与 Tools

Planner 先执行本地只读检索，再把可能改变研究库的动作留在待确认状态。当前工具：

| 工具 | 边界 |
| --- | --- |
| `searchPaper` | 只读检索当前研究库题录 |
| `readPaper` | 只读读取已登记原文或派生 Markdown |
| `queryKnowledgeGraph` | 只读查询已确认关系 |
| `extractEvidence` | 写入证据卡，必须逐项确认 |
| `createTask` | 写入正式科研任务，必须逐项确认 |
| `updateExperiment` | 更新实验 Run，必须逐项确认 |
| `generateReport` | 保存报告草稿，必须逐项确认 |

确认检查同时存在于 UI 和 Main 进程执行层。绕过 UI 直接调用未确认的写入步骤也会失败。

## Memory 使用纪律

- 只有 `confirmed` 记忆会进入模型上下文。
- 记忆只帮助理解术语、研究方向和工作偏好，不能作为论文或实验结论证据。
- 阅读与实验的正式事实继续来自可追溯数据库记录；Memory 不复制或取代正式记录。
- 任何回答仍必须引用本轮检索得到的 Evidence ID。
