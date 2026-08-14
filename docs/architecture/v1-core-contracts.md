# 小何的科研助手 v1.0 核心契约

## 决策

- 继续使用现有 `library.sqlite`，通过可回滚迁移扩展，不另建会与旧数据分叉的新数据库。
- 采用渐进式领域重构：现有功能继续运行，新能力先通过 `src/core/application` 的端口接入，再逐页替换巨型 Renderer 和 Workspace Service 中的直接编排。
- UI 只能调用受限的 Preload API；数据库、系统凭据、文件系统和模型网络请求只存在于 Main/Infrastructure 边界。
- AI 只能生成待确认建议。证据、结论、实验结论、任务状态、知识图谱关系和正式报告仍需用户确认。
- 原文件留在原位置或按用户明确选择复制；任何索引和派生稿必须记录路径、SHA-256 和来源锚点。

## 领域边界

| 领域 | 负责 | 不负责 |
| --- | --- | --- |
| Paper | 题录、作者、阅读状态、来源登记 | 文件移动、AI 总结 |
| Evidence | 原文锚点、我的理解、事实/推断/假设、人工复核 | 无来源结论 |
| Experiment | 实验定义、Run、参数、环境、结果、产物 | 替用户确认结论 |
| Task | Inbox/Today/Waiting/Next/Completed/Dropped 与来源关联 | 擅自执行外部行动 |
| Knowledge | 类型化节点、关系、证据链、人工确认 | 用相似度冒充事实关系 |
| Citation | 统一题录与 GB/T、APA、IEEE、BibTeX 格式化 | 猜测缺失元数据 |
| Research | 研究方向、术语、偏好、想法 | 把聊天记录当正式记录 |

## 基础设施端口

`src/core/application/ports.ts` 是领域层与 SQLite、文件系统、LLM、Embedding、PDF 和插件之间的稳定边界。现有 IPC 会按阶段迁移到这些端口，避免一次性重写造成数据回退。

## LLM Provider Layer

当前 Main 进程实现三类协议：

- OpenAI 兼容：DeepSeek、硅基流动、OpenAI、百炼、Kimi、自定义服务。
- Anthropic Messages：Claude。
- Gemini `generateContent`：Gemini。

API Key 按“服务商 + Base URL”分槽，由 Electron `safeStorage` 加密。Renderer 只得到 `hasCredential`，所有正式补全与连接测试都由 Main 发起。

## 迁移纪律

1. 每次数据库升级先快照元数据并在同一事务内迁移。
2. 迁移脚本必须幂等，重复启动不得生成重复实体或覆盖人工修改。
3. 派生 Markdown、知识图谱投影和用户可读文件均可由 SQLite 主记录重建。
4. 失败时保留旧 Schema、原文件和迁移日志；不得用删除旧库作为恢复手段。
