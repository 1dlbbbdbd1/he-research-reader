# v1 Research Knowledge Graph 与 Evidence Card

## 目标

Research Knowledge Graph 连接当前研究库中的论文、作者、概念、方法、实验、数据集、代码、想法、论断和证据。图谱只提供可追溯的研究导航，不把 AI 生成内容伪装成已确认事实。

Evidence Card 保存四层信息：原文证据片段、用户或 AI 的理解片段、页码/图表等位置锚点、标签与关联实验。原文片段与 SHA-256 不可被卡片编辑覆盖；修改理解时创建新的 `note_fragments` 版本，并用 `supersedes_id` 串联历史。

## 审核边界

- 从题录、原文证据、实验和产物构建的系统节点可直接确认，并保留 `bootstrapped` 审计事件。
- AI 新建的节点状态必须为 `draft`，用户确认或拒绝后才改变审核状态。
- AI 或用户提议的关系先进入 `draft`；没有至少一条属于当前研究库的证据引用时，数据库与服务层都拒绝确认。
- `knowledge_graph_events` 与 `evidence_card_events` 只追加，不允许更新或删除。
- Evidence Card 的 AI 理解必须记录供应商、模型和生成来源，并保持草稿；用户理解可立即确认为用户记录。
- 所有节点、关系、证据引用和实验关联都按当前 `project_id` 校验，跨研究库 ID 会被拒绝。

## 持久化模型

Schema v18 新增：

- `evidence_cards` / `evidence_card_events`
- `knowledge_nodes` / `knowledge_edges` / `knowledge_graph_events`

图谱构建使用稳定的领域实体 ID 与唯一约束，重复执行只补缺失对象。研究库从 schema v17 升级到 v18 的迁移为事务操作；重复打开不会重复写入迁移记录。

## 桌面交互

主导航的“知识图谱”工作区提供：

- 按节点类型筛选的交互图；
- 节点来源、状态和直接关系检查器；
- AI 节点和关系的人工审核队列；
- 缺少证据时禁用关系确认并解释原因；
- Evidence Card 原文、理解、位置和标签的可见编辑；
- 返回原文与理解版本追加。

Renderer 只通过 preload 暴露的窄 IPC 接口访问服务，不直接打开 SQLite。

## 当前验证

- `node --test tests/knowledge-graph-service.test.cjs`：3 项通过。
- `node --test tests/workspace.test.cjs`：40 项通过，含 v17 → v18 原位迁移与幂等重开。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
