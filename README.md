# 小何的科研阅读助手

> 产品主线：在一个界面里完成“导入 → 阅读 → 划词翻译/提问 → 保存笔记碎片 → 多文献复查 → 引用回跳 → Markdown/Word 导出”。这条闭环是不可退化的产品底座，不是功能上限；长期北极星是在同一阅读界面中长出一个本地优先、证据可追溯、行动需确认的科研 Agent。

## 1. 产品重新定义

这个项目不以“展示研究指标的工作台”为核心，也不重做完整 EndNote，而是解决一条完整、连续的科研工作流：

**读起来方便 → 记起来方便 → 自动整理但不替用户做判断 → 最后查找和复用方便。**

MVP 只验收这一条流程：

```text
导入一篇论文
  → 在同一界面阅读原文/对照/Markdown
  → 划词翻译或针对此处提问
  → 保存为可回到原页码的笔记碎片
  → 选中多篇论文和笔记
  → 一键生成结构化复查文档
  → 点击引用返回原论文页码
  → 导出 Markdown / Word
```

驾驶舱统计、复杂 Agent 编排、完整参考文献管理器、自动写整篇论文都不进入最初 MVP。当前 MVP 闭环已经完成首轮实现，后续进入“阅读体验补齐 → 研究记忆 → 证据检索 → 科研 Agent”的产品化阶段；任何新增能力仍必须回到同一个阅读工作面，不能把产品重新拆成互不相干的工具集合。

核心用户不是在这里看一个漂亮仪表盘，而是每天用它完成以下工作：

1. 打开一个研究仓库，快速找到今天要读的文献。
2. 在不被面板打扰的情况下阅读 PDF 原文、结构化 Markdown 或中英对照。
3. 鼠标选中文字后，就地翻译、提问、批注、引用或归入论文写作用途。
4. 退出阅读时，明确记录“读到了什么、有没有想法、是否与方向匹配、以后能用在哪里”。
5. 由 AI 基于原文、批注和阅读状态生成一份可审查的阅读卡，而不是凭空总结。
6. 日后按全文、作者、主题、批注、研究用途和阅读结论快速找回。

### 产品原则

- **阅读器优先**：任何功能都不能长期挤占正文或破坏阅读流。
- **本地优先**：原文、批注、标签、阅读状态、Markdown 和索引默认保存在本机。
- **原文是权威证据**：PDF/原文件永远是引用依据；Markdown、翻译和 AI 输出都是派生层。
- **每篇文献都是一个小项目**：不把一篇论文简化成资料库里的一行文件。
- **无想法也是有效结果**：读完没想法、没疑问、方向不匹配，都必须被记录，而不是被当作“空数据”。
- **AI 只整理、不替代判断**：AI 输出要带原文位置或批注来源，并允许逐条接受、修改或忽略。
- **显式联网**：本地、第三方云端和计费行为在触发前清楚标识。
- **视觉是横向质量门槛，不是替代路线**：字号、密度、配色和多比例适配覆盖每个阶段，但不能把桌面真实划词、`bbox` 对齐、安装包或阅读闭环等既定任务挤出开发顺序。

## 2. 当前实现事实盘点

### 已经真实可用

- 导入 PDF、DOCX、PPTX、XLSX/CSV、Markdown 和文本。
- 浏览器本地保存原文件，计算 SHA-256 内容哈希，并提取辅助文本。
- PDF 原页 Canvas + PDF.js 文字层、按需连续页渲染、按钮缩放、`Ctrl + 滚轮`缩放和当前页跟踪。
- 单界面阅读器已支持原文、结构化 Markdown、左右对照和沉浸模式；文献栏与笔记/AI 栏可独立收起。
- PDF/结构化文本选区旁会出现统一菜单，可翻译、解释、针对此处提问、添加到 Agent 对话或带入批注；添加到对话后选区会固定为带页码/锚点的对话证据，滚动页面不会丢失，并可随时移除。
- 本地批注记录，关联资料与用户填写的页码/位置。
- OpenAI 兼容 `/chat/completions` 服务设置。
- 手动触发的划词翻译、研究问答和 Crossref 检索。
- Electron 桌面入口、Windows 安装版和免安装便携版；普通使用者可直接双击启动，不需要 Node.js 或 npm。
- 项目独立的本地 MinerU 3.4.4、Python 3.12 运行环境、模型缓存、常驻本地 API 服务和 Electron 安全桥接。
- 本地 MinerU 已完成 PDF → Markdown 端到端冒烟验证；当前环境为 CPU `pipeline`，原文不会上传。
- 桌面版检测不到 MinerU 时会明确提示，只有用户点击“安装本地解析组件”后才下载；运行时和模型写入应用用户数据目录，不写入只读安装目录。
- MinerU Markdown 已使用安全的 React Markdown 阅读层渲染标题、段落、表格、列表、图片、代码块和 KaTeX 公式；顶部绑定当前论文的作者、年份、期刊、DOI 与关键词，并可随时切回原始 Markdown。
- 每次 MinerU 解析都会把完整输出目录、Markdown、图片和逐文件 SHA-256 清单保存到 `papers/<source-id>/derived/mineru/<revision>/`；重启后仍从研究库恢复，阅读器只通过受控接口加载 PNG/JPEG/GIF/WebP，不会因 Markdown 图片链接自动访问外网。
- 学术排版工作流默认只在本机修复标题语法和章节空行；可选 AI 只返回章节边界 JSON，无法替换正文。每次发送前会再次显示 Provider、模型与字符数，结果按原文指纹保存为派生布局。
- 研究 Agent 已进入阅读器右侧工作区，不再用中央弹窗遮住论文；可选择当前选区、当前页、本篇、多篇或整个研究库。选区和当前页直接使用带页码/锚点的阅读现场证据，本篇/多篇/全库复用现有 FTS5 + FastEmbed 混合检索；再把问题和有限证据片段发送给已配置模型。当前窗口支持连续追问，但历史对话只用于理解追问，不能充当证据；点击引用可回原页，无白名单引用的 AI 回答区块不会展示。
- 单篇结构化阅读卡已接入阅读侧栏：生成前显示 Provider、模型、材料数量和字符数；论文结论区只能引用论文/派生证据，“我的批注”只能引用用户笔记/阅读状态。结果先保存为 AI 草稿，用户采纳后才进入正式阅读卡，所有区块保留来源关系。
- 证据关系页已经把原文片段、用户批注、AI 阅读卡和复查结论组合成“证据脊柱”；关系来自 `fragment_relations` 与 `review_citations`，不会根据文本相似度暗猜支持/反驳。用户可从任一片段内联建立“支持、反驳、补充”关系并填写判断理由，也可采纳、拒绝或撤销建议；状态变化只追加审计事件，不覆盖原内容或删除历史。节点可回原文或复查文档。

### 仍需继续完善

- 研究库已经能创建、打开、显示最近项目并安全切换；选择普通文件夹时会先确认是否原地建库，再询问研究库名称，且不删除已有文件。归档、自动备份、跨库检索和仓库级 AI 策略尚未实现。
- `Project`、`Source`、`Annotation`、`BibliographicItem`、`NoteFragment` 和 `ReviewDocument` 已进入独立研究库 SQLite；旧 `Claim`、`Action` 仍是兼容层，尚未全部迁入正式模型。
- 旧 `localStorage/IndexedDB` 已有快照、幂等迁移和事务回滚，但还没有面向普通用户的迁移核对报告与旧存储清理向导。
- “小何的科研阅读助手”0.2.0 安装版和便携版已用正式 H 品牌资源重新生成；安装、内置 Argos 翻译、启动与卸载已在同一 Windows 用户上下文完成隔离回归。当前产物尚未代码签名，Windows 仍可能显示来源未知或 SmartScreen 提示。
- 新 PDF 批注会持久化页码、归一化矩形和原文引文，并可点击恢复高亮；旧批注只有页码字符串时仍按明确的兼容规则降级。
- 划词菜单已接入本地 Argos 英→中翻译和现有 OpenAI 兼容 Provider；本地 Ollama 推理 Provider 尚未接入。
- MinerU 原始 Markdown、图片与 AI 章节布局已经分层保存，旧布局会在原文指纹变化后自动失效；学术阅读层现为正文块保存稳定编号，Markdown 划词会记录块编号和版本指纹，PDF 引文只有在当前 Markdown 中唯一命中时才定位并高亮对应块。项目已按本机 MinerU 3.4.4 真实 `*_content_list.json` 接口读取 `text + page_idx + bbox`：`page_idx` 从 0 转为阅读页码，`bbox` 按 MinerU 源码定义的 0–1000 页面归一化坐标转为 PDF 比例矩形；重复、越界或无法唯一对应的框不会被采用。
- 当前研究库已使用 SQLite FTS5 `trigram` 统一本地索引题录、作者、DOI、解析正文、MinerU Markdown、原文证据、用户笔记、AI 内容、阅读状态、用途和复查文档；跨仓库搜索尚未实现。
- 阅读进度、相关性、有无想法、有无疑问、用途标签和阅读位置已独立保存并保留变更历史；单篇 AI 阅读卡草稿/采纳闭环已实现。本地语义检索已接入可追溯分块、SQLite 向量缓存、内容变化失效、精确/语义融合、设置页索引入口和研究 Agent；索引保留论文、来源、页码和锚点，模型未安装或索引失败时会明确退回精确检索。PaperQA2 式证据重排尚未接入。
- 多论文/批注选择、三类来源分离的复查文档、可追溯 AI 整理、Markdown/Word 导出和引用回跳已经完成首轮；论文选择卡会展示阅读状态、页数/百分比进度和批注数，论文与当前批注均可一键全选/清空。模板编辑、逐条采纳 AI 建议和结构化导出样式仍需继续完善。
- 阅读器、资料库、复查文档和设置中心已统一为桌面端视觉系统：界面常规说明不低于 12px，正文以 14px/20px 为基线，页面固定在窗口内并由各工作区独立滚动；900px 窄窗口折叠为 64px 图标栏，1024px 与 1600px 窗口保持不同信息密度而不把页面整体放大。界面可读性、密度、底色、强调色及 Markdown 阅读字号/行距/宽度可在本机设置中调整。

### 当前代码中的真实外部接口

| 接口 | 当前行为 | 数据是否离开本机 |
| --- | --- | --- |
| OpenAI 兼容 `/chat/completions` | 翻译、术语解释、研究问答、可选 Markdown 章节识别 | 是，只在用户点击并确认后发送；章节识别还要求开启整篇派生文本权限 |
| `api.crossref.org/works` | 检索公开文献元数据 | 查询词会发送 |
| 本地 `mineru-api` 随机回环端口 | Electron 启动本地解析服务并接收 Markdown/资源 | 否，只监听本机 |
| FastEmbed 0.8.0 + `BAAI/bge-small-zh-v1.5` | 可选本地语义检索；按研究库建立带来源、页码和锚点的 512 维向量缓存，并与 FTS5 精确结果融合 | 安装组件时下载开源模型；安装后索引和查询强制只读本机缓存 |
| PDF.js / Mammoth / JSZip | 浏览器内解析 PDF、DOCX、PPTX、XLSX | 否 |
| `docx` 9.7.1 | 在本机生成带来源标识和回跳链接的 Word 复查文档 | 否 |

### 指定开源项目的真实接口与复用边界

本轮只依据官方仓库 README 和实际代码路径，不根据产品截图臆造接口。

| 项目 | 已核实、值得学习的边界 | 对本项目的处理 | 许可证 |
| --- | --- | --- | --- |
| [llm-for-zotero](https://github.com/yilewang/llm-for-zotero) | 当前/多篇论文、选区、截图、笔记等上下文被组装为一次对话上下文；选区定位包含附件、页码和解析结果。真实类型见 [`contextPanel/types.ts`](https://github.com/yilewang/llm-for-zotero/blob/main/src/modules/contextPanel/types.ts) 与 [`turnContextEnvelope.ts`](https://github.com/yilewang/llm-for-zotero/blob/main/src/agent/context/turnContextEnvelope.ts)。 | 学习“上下文信封”和可回跳引用；不复制插件代码。 | AGPL-3.0-or-later |
| [zotero-better-notes](https://github.com/windingwind/zotero-better-notes) | 官方 API 明确拆分 `sync`、`convert`、`template`、`$export`、`$import`、`editor`、`note`、`relation`；含 Markdown 同步、模板、批注转换及 DOCX/PDF/MD 导出。真实入口见 [`src/api.ts`](https://github.com/windingwind/zotero-better-notes/blob/master/src/api.ts)。 | 学习笔记模板、关系和导出边界；先自建兼容接口，不复制实现。 | AGPL-3.0-or-later |
| [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) / [AIdea](https://github.com/Visterainer/aidea-zotero) | 官方功能包含 PDF 选区弹窗翻译、写回批注/笔记，以及选区、截图、本文上下文的解释与提问。 | 学习统一划词菜单和本地/云端 Provider 切换；不复制插件代码。 | AGPL-3.0 / AGPL-3.0-or-later |
| [Open Paper](https://github.com/khoj-ai/openpaper) | 论文与 AI 并排、选区高亮/评论/发给 AI、带出处回答、项目内多论文分析；客户端论文页真实入口见 [`paper/[id]/page.tsx`](https://github.com/khoj-ai/openpaper/blob/main/client/src/app/%28paper%29/paper/%28protected%29/%5Bid%5D/page.tsx)。 | 学习“列表 + PDF + 笔记/AI”单界面和引用回跳；不复制代码。 | AGPL-3.0 |
| [Open Notebook](https://github.com/lfnovo/open-notebook) | Notebook、Source、Note 分层，支持全文/向量搜索、上下文聊天和内容转换；架构见 [`architecture.md`](https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/architecture.md)。 | MIT 许可下优先评估搜索、内容生成和领域模块的直接复用，但仍要先做适配层与依赖审计。 | MIT |
| [PaperQA2](https://github.com/Future-House/paper-qa) | `Docs` 明确维护文档、文本块和向量索引；回答流程对候选证据排序后再生成答案，真实入口见 [`src/paperqa/docs.py`](https://github.com/Future-House/paper-qa/blob/main/src/paperqa/docs.py)。 | Apache-2.0 下优先评估为跨论文证据检索引擎；不把它直接耦合进 UI/存储模型。 | Apache-2.0 |

许可证决策：

- AGPL 项目当前只研究交互、数据流和模块边界；不复制源代码，也不把它们作为闭源桌面应用的直接依赖。
- MIT / Apache-2.0 项目可以进入“可复用候选”，但复用前仍检查依赖树、NOTICE、模型许可证和分发方式。
- 所有外部模块都通过本项目自己的 Provider/Adapter 接口接入，未来替换实现不迁移用户数据。
- Open Notebook/PaperQA2 都不整体嵌入 Electron；优先评估小模块或可选本地 sidecar，避免把 MVP 拖进 SurrealDB、Postgres、S3、Celery 等部署栈。

## 2.1 UPDF 竞品复核与路线修订（2026-08-01）

这次不把 UPDF 当作“再参考一个界面”，而是把它当作成熟 PDF 产品的体验下限和长期竞争基准。以下判断只依据 UPDF 官方网站、官方功能页和官方产品动态，不根据宣传截图暗猜；官方宣称的性能数字不作为本项目验收依据：

| 能力层 | UPDF 官方已明确提供 | 对本项目的结论 |
| --- | --- | --- |
| 阅读与批注 | Windows 端多种页面模式、缩放，高亮/下划线/删除线/便签/文本/绘图/形状等批注，并能导出注释 | 这是必须追平的阅读器下限，不能再把“能选择文字并保存一条备注”当作完成 |
| 阅读中 AI | 选中文字出现浮动 AI 工具；侧栏可做 PDF 问答、总结、解释、翻译、截图问答；支持全文、逐页和双栏对照翻译 | “PDF + 右栏聊天”已经是公共能力，不再作为核心差异化 |
| 多文档与知识库 | 项目聊天可批量上传文件、`@` 指定某份 PDF；官方页面还宣传文件夹、知识库、多层标签和版本管理 | 我们必须把 `Project / BibliographicItem / NoteFragment` 做成真实研究上下文，而不是只把若干全文拼进提示词 |
| 图谱 | 单篇 PDF 可生成层级思维导图；论文搜索可按引用关系与内容相似性生成文献网络，并显示高引论文、发展脉络和后续研究 | 不能只做一张装饰性脑图；要区分“引用图、证据图、想法图”，每条边都能说明关系类型并回到来源 |
| Agent | UPDF V2.5 已把 Copilot、语义搜索、自动书签、页面整理和编辑工具包装为多个 Agent；其中 Copilot 的官方边界仍是自然语言导航到工具，最终操作由用户完成 | “有多个 Agent 按钮”不是壁垒；科研 Agent 必须理解持续研究目标、已有阅读进度和证据缺口，并产生可审查的研究行动 |
| 隐私与本地 | UPDF 表示普通 PDF 工具可离线；其隐私政策同时明确 AI 会处理用户上传的 PDF 和对话文本 | 本项目继续坚持本地 MinerU、FTS、Argos 和显式 Provider；任何云端发送都显示文件、选区与服务方 |

官方核查入口：

- [UPDF Windows 阅读与批注](https://www.updf.cn/updf-for-win/) 与 [PDF 注释用户指南](https://www.updf.cn/annotate-pdf/)。
- [UPDF AI 功能](https://www.updf.cn/pdf-ai/)、[多 PDF 项目聊天](https://www.updf.cn/updf-ai-user-guide/chat-with-pdf/) 和 [选区总结/思维导图](https://www.updf.cn/updf-ai-user-guide/summarize-pdf/)。
- [AI 语义搜索](https://www.updf.cn/updf-ai-user-guide/semantic-search/)、[AI 自动书签](https://www.updf.cn/updf-ai/ai-bookmark-agent/) 与 [UPDF Copilot](https://www.updf.cn/updf-ai/updf-copilot-agent/)。
- [论文搜索与文献图谱](https://www.updf.cn/news/literature-mapping-tool/)、[UPDF V2.5 Agent 说明](https://www.updf.cn/news/updf-2-5-is-released/)、[知识库/深度研究功能概览](https://www.updf.cn/brand/) 与 [UPDF 隐私政策](https://www.updf.cn/privacy-policy/)。

### 产品经理结论：借工作流，不追功能数量

UPDF 证明了“阅读器 + 侧栏 AI + 多文件项目 + 语义搜索 + 图谱”已经成为成熟文档产品的公共能力。它解决的是广义 PDF 处理；本项目只做科研场景，并把优势压在 UPDF 不容易做到的长期研究记忆与证据治理上。

从 UPDF 借鉴：

- 阅读时随时唤起侧栏，不离开当前页；选区、当前页、当前论文和项目是连续上下文，不是四个分散入口。
- 搜索结果必须能直接定位内容并继续操作，而不是只返回一排相似度数字。
- 长文结构、书签、摘要、对照翻译和图谱都服务于“更快理解与回到原处”。
- 能力采用统一入口和工具注册方式逐步增加，外观可以有 Obsidian 插件化后的扩展感，但普通用户不需要理解插件、模型或 RAG 术语。

明确不借：

- 不追水印、签名、表单、发票、贴纸、批量转换等通用 PDF 编辑器功能。
- 不把十多个按钮命名成十多个 Agent，也不让每个 Agent 各自保存一套上下文。
- 不先做云端账号和全平台同步；本地研究库可复制、可备份、可审计优先。
- 不把 AI 生成的思维导图当成知识本体；没有来源、关系类型和人工确认的边不进入正式研究记录。

### 科研 Agent 的正式定义

这里的 Agent 不是聊天框，也不是“帮用户找到某个按钮”。它必须同时拥有六部分：

1. **目标**：知道当前研究问题、主题和本次任务，而不只看到最后一句提问。
2. **研究记忆**：读取论文状态、原文证据、用户批注、阅读卡、复查文档与历史决定。
3. **检索**：先在本地用精确检索与语义检索找候选，再按来源质量、页码锚点和用户选择排序。
4. **工具**：统一调用“检索证据、打开原文、比较论文、整理笔记、生成复查、更新阅读状态”等受控能力。
5. **证据约束**：论文事实必须引用原文；用户想法必须标为用户笔记；AI 推断必须单独标识，不能混写。
6. **行动权限**：只读检索可直接执行；生成草稿可以直接进行；修改正式记录、联网检索、导出或批量操作必须先确认。

Agent 的一次可审查运行应展示：`目标 → 使用范围 → 检索词/过滤条件 → 候选证据 → 工具调用 → 草稿结果 → 待确认写入`。用户可以展开细节，但默认界面只显示当前结论、引用和下一步建议。

### 一个平台外壳，三类图谱

- **引用图**回答“谁引用谁、哪些工作相似、研究如何演进”，主要依赖 DOI/题录与公开学术元数据；这是后期论文发现能力。
- **证据图**回答“哪段原文支持或反驳哪个结论”，节点复用 `Source / NoteFragment / EvidenceClaim / ReviewDocument`；这是近期 Agent 的事实底座。
- **想法图**回答“我的疑问、假设、用途和论文之间有什么关系”，用户笔记是权威，AI 只提出待确认关系。

三类图可以在一个画布切换或叠加，但数据、边类型和可信度必须分开。近期先做证据图，不先做依赖外部数据库的引用发现图。

### 修订后的产品定位

**不是“另一个全能 PDF 编辑器”，而是“以证据为核心、从阅读现场长出来的本地优先科研 Agent”。**

必须追平：

- 顺滑的连续阅读、缩放、目录、页缩略图、页内搜索、位置恢复。
- 直接在原文上高亮、写批注、编辑/删除/撤销、颜色和类型管理、批注导出。
- 选区/当前页/当前论文/多论文四档 AI 上下文，以及随时可唤起的侧栏对话。
- 原文/对照/结构化版本之间稳定切换。

明确不做：

- PDF 水印、签名、表单、发票、贴纸、批量格式转换等通用办公工具。
- 为了宣传“十几个 Agent”而拆出一堆无状态按钮。
- 只有 AI 生成节点、不能回到证据的装饰性思维导图。
- 未经确认自动上传论文、改写用户笔记、删除资料或发布结论。

真正差异化：

- 每篇论文都有阅读进度、相关性、想法/疑问、用途、批注、派生文档和历史。
- 用户笔记、原文证据、AI 整理永不混写；任何结论都能回到论文、附件、页码和原文选区。
- 图谱分为三层：外部元数据形成的**引用图**、原文与结论形成的**证据图**、用户笔记与研究问题形成的**想法图**。
- Agent 不只回答问题，还能基于研究目标提出“找什么、读什么、缺什么证据、下一步复查什么”，但所有写入和外部动作都先由用户确认。

## 3. 最终产品信息架构

产品默认不是在“资料库页、阅读页、AI 页、笔记页”之间来回跳，而是一个可伸缩的三栏工作面：

```text
┌──────────────────┬──────────────────────────────────┬────────────────────┐
│ 文献/复查材料     │ PDF 原文 / 对照 / Markdown        │ 笔记碎片 / AI / 复查 │
│ 280–320px         │ 阅读主区域，始终获得最大剩余空间   │ 320–380px，可收起    │
├──────────────────┼──────────────────────────────────┼────────────────────┤
│ 多选论文与筛选     │ 划词菜单贴近选区，引用锚点可见      │ 三类内容永不混色混写   │
└──────────────────┴──────────────────────────────────┴────────────────────┘
```

- 单击文献只替换中央阅读内容，右栏自动切到该文献笔记，不跳转整页。
- 多选文献或笔记后，右栏出现“生成复查文档”；生成后复查文档接管中央主区，左栏继续选材料，右栏显示证据溯源，仍不跳出这个界面。
- 点击复查文档的引用，中央阅读器打开对应原文页并短暂定位高亮。
- 进入沉浸模式时左栏收起，右栏按需浮出；阅读器不是被两个常驻侧栏夹住。

```text
研究仓库（Workspace）
├─ 收件箱：刚导入、尚未归类的资料
├─ 文献库：筛选、分组、标签、阅读状态
├─ 阅读队列：待读、略读、精读、回看
├─ 研究主题：研究问题、专题与文献集合
├─ 写作用途：背景、现状、方法、实验、讨论等
└─ 全局检索：原文、Markdown、批注、阅读卡和 AI 整理结果

单篇文献项目（Paper Project）
├─ 原始文件：PDF / DOCX / 网页快照
├─ 结构化版本：Markdown + LaTeX 公式 + 图片
├─ 元数据：标题、作者、年份、DOI、来源、关键词
├─ 阅读状态：进度、相关性、阅读结果
├─ 批注与高亮：原文锚点、颜色、类型、用户笔记
├─ 阅读卡：核心问题、方法、结论、局限、可复用位置
├─ 对话：针对本文或选区的问答，保留引用位置
└─ 历史：解析版本、人工修改和 AI 建议记录
```

### 研究仓库与项目切换

借鉴 Obsidian 的 Vault 和 EndNote Library，但不照搬其界面：

- 首次启动显示“打开已有仓库 / 新建仓库 / 迁移当前 MVP 数据”。
- 左上角项目名点击后弹出仓库切换器，支持最近使用、搜索、新建、打开文件夹、归档。
- 一个仓库对应一个明确的本地目录，可整体复制、备份或移动。
- 不同仓库有独立文献、标签、AI 设置策略和索引，绝不混在一组 `localStorage` 数据里。
- 一篇文献可属于多个“研究主题集合”，但原始文件只保存一份，避免重复占空间。

建议目录结构：

```text
My Research Vault/
├─ vault.json
├─ library.sqlite
├─ papers/
│  └─ <paper-id>/
│     ├─ source.pdf
│     ├─ metadata.json
│     ├─ paper.md
│     ├─ annotations.json
│     ├─ reading-note.md
│     ├─ ai-summary.md
│     ├─ assets/
│     └─ history/
├─ exports/
└─ .reader-cache/
```

`library.sqlite` 用于快速索引；`papers/<paper-id>/` 中保留人能直接查看和备份的文件。缓存可以重建，原文和用户记录不可以悄悄覆盖。

## 4. 阅读器：第一优先级

### 四种阅读模式

| 模式 | 用途 | 默认行为 |
| --- | --- | --- |
| 原文 | 精确核对版式、图表、公式和页码 | PDF 为引用权威 |
| 对照 | 英文原文与中文翻译逐段对应 | 段落联动滚动，可隐藏任一列 |
| 净化阅读 | 阅读 MinerU/本地解析后的 Markdown | 适合连续阅读、公式和代码 |
| 沉浸 | 最大化正文 | 收起项目导航和批注栏，仅保留极简工具条 |

模式切换不会生成重复批注。批注统一指向原文证据锚点，并在原文、对照和 Markdown 视图中映射显示。

### 阅读布局

- 默认收起全局侧栏，顶部只保留返回、标题、阅读进度和视图切换。
- 正文优先占据窗口宽度；右侧批注栏默认可折叠，拖动改变宽度。
- PDF 支持连续滚动、单页、双页、适合宽度、适合页面和缩放记忆。
- 记录每篇文献上次页码、滚动位置、缩放和阅读模式。
- 目录、缩略图、搜索结果采用临时抽屉，不长期占位。
- 支持键盘翻页、缩放、聚焦搜索、快速批注和退出沉浸模式。
- 正文阅读字号独立于界面字号，可选小/中/大，不强迫用户去系统设置。

P0 导航与恢复接口决定：

- PDF 目录、缩略图和页内搜索结果属于可重建的运行时视图，不写入核心业务表；目录来自 PDF.js `getOutline()`，搜索逐页读取本地文字层，均不联网。
- `bibliographic_reading_states.last_page / total_pages` 继续保存论文级阅读进度；重新打开论文时恢复到最后页，而不是先显示第 1 页再覆盖记录。
- 视图模式和 PDF 缩放保存在该 `Source` 的 `source_metadata_json.readerState` 中。它们是阅读偏好，不新增核心模型，也不与论文事实或用户笔记混写。
- `Ctrl + F` 只搜索当前 PDF 并打开左侧搜索抽屉；全研究库搜索仍由资料库入口负责，两个范围在界面上明确区分。

批注完整生命周期已经采用追加修订而不是覆盖：原文摘录和历史用户笔记保持不可修改；编辑备注会创建新的 `NoteFragment` 并用 `supersedes_id` 指向旧版本，`Annotation.current_note_fragment_id` 只标记当前展示版本；删除批注只归档，提示条可立即撤销恢复。归档批注默认退出论文计数、检索、阅读卡和新复查材料，但已有复查文档中的历史引用不会被破坏。

### 鼠标划词后的就地菜单

选区完成后，在选区附近显示紧凑浮动菜单：

```text
翻译 | 针对此处提问 | 高亮 | 写批注 | 摘录 | 归入用途 | ⋯
```

- **翻译**：结果就地展开，保留原文，不强制跳到侧栏。
- **针对此处提问**：问题自动携带选区、页码和上下文窗口；回答必须引用原文位置。
- **高亮**：一键保存，颜色代表用户含义而不是装饰。
- **写批注**：选区已自动填入，只需写自己的想法。
- **摘录**：进入阅读卡，可选择“核心结论、方法、数据、局限、定义”等类型。
- **归入用途**：直接标记可用于“国内外研究现状、试验方法”等写作位置。

点击页面空白或按 `Esc` 收起菜单，不遮挡下一段正文。

### 可恢复的批注锚点

每条批注至少保存：

- `paperId`、文档版本哈希和视图来源。
- PDF 页码、矩形坐标；如果存在文字层，同时保存文字范围。
- 原文摘录、前后文片段，用于文件更新后的重新定位。
- Markdown 块 ID、标题路径和字符偏移。
- 用户批注、类型、颜色、创建时间和修改时间。

这样即使重新生成 Markdown，也能先按原文、上下文和位置尝试恢复，而不是让批注全部失联。

定位优先级固定为：`sourceId + 文档哈希 + page + rects` 精确定位，`quote + prefix/suffix` 用于校验和降级恢复。只按一句引文搜索会受到 OCR、换行和连字符影响，不能作为唯一回跳机制。

## 5. 每篇文献的“小项目”状态模型

阅读进度、阅读结论和研究用途必须分开记录，不能挤成一个标签。

### 阅读进度

- 只看标题
- 已看摘要
- 快速浏览
- 正在精读
- 已读完
- 需要回看

### 相关性与阅读结论

- 很相关，进入核心文献
- 部分相关，可作补充
- 方向不匹配
- 只看题目后暂存
- 读完但没有新想法
- 读完且没有疑问
- 方法值得复现
- 结论需要核验
- 质量或证据不足

“读完但没有新想法”和“读完且没有疑问”可以同时成立；它们是明确结论，不等于漏填。

### 研究/写作用途

预置但允许仓库自定义：

- 研究背景
- 国内研究现状
- 国外研究现状
- 理论依据
- 核心概念或定义
- 研究空白
- 研究假设
- 技术路线
- 试验方法
- 数据集或样本设计
- 评价指标
- 对照方案
- 结果解释
- 讨论与局限
- 未来工作
- 可复现实验
- 暂不使用

一篇论文可以有多个用途；摘录也可以单独指定用途，例如整篇用于“国外研究现状”，其中一张表用于“评价指标”。

### 退出阅读时的轻量收尾

关闭或切换文献时，只在状态缺失时出现不打断阅读的底部收尾条：

1. 读到哪里：系统自动记录。
2. 当前结论：相关 / 待定 / 不匹配。
3. 有无想法：有批注 / 无新想法 / 尚未判断。
4. 可用于哪里：可多选，也可跳过。
5. 是否生成阅读卡：本地整理 / AI 整理 / 暂不生成。

## 6. AI 整理与阅读卡

AI 的核心任务不是聊天，而是把阅读过程中已经产生的证据和想法整理成可复用结构。

### 阅读卡内容

- 文献解决的问题。
- 研究对象、方法、数据和评价指标。
- 主要结论及对应原文位置。
- 作者明确写出的局限。
- 用户自己的高亮、批注和疑问。
- 与当前研究主题的关系。
- 可用于论文的哪些部分。
- 阅读结论：保留、核心、复现、待核验或不匹配。
- 未解决的问题和下一步行动。

### AI 约束

- 优先使用本文 Markdown、选区和批注，不默认上传整份 PDF。
- 每条结论附页码、段落或批注来源；找不到来源就标为“推断/待核验”。
- AI 建议写入草稿区，用户接受后才进入正式阅读卡。
- 用户原始批注不可被 AI 改写覆盖。
- 没有批注时也能生成“阅读状态卡”，但必须明确“本次没有用户批注”，不能伪造心得。

实现决策：阅读卡不新增第四个核心模型。原文/派生段落、用户笔记、用户阅读状态和 AI 阅读卡区块都复用 `NoteFragment`，通过 `origin`、`ai_provenance_json` 与 `fragment_relations(derived_from)` 区分来源和追溯关系。AI 首次写入状态固定为 `draft`；用户采纳只把对应 AI 片段标为 `accepted`，不更新或覆盖 `source_evidence`、`user` 片段。

## 7. 查找与复用

### 第一层：完全本地、无需 AI

- **当前已实现**：每个研究库独立使用 SQLite FTS5 `trigram` 索引；数据变化由触发器标记索引失效，仅在需要时本地重建。
- **当前已实现**：标题、作者、DOI、期刊、摘要、浏览器解析文本、MinerU Markdown、原文证据、用户笔记、AI 内容和复查文档的多关键词检索。
- **当前已实现**：阅读阶段、相关性、有无想法/疑问、研究用途、有无批注和内容来源的组合筛选。
- **当前已实现**：命中类型、上下文片段与关键词高亮；论文/碎片命中回到原论文页码与矩形锚点，复查命中打开对应复查文档。
- 中文一至二字查询会走受控的本地包含匹配，三字及以上先走 `trigram` 候选再逐词核对，避免 FTS 查询语法被用户输入改变。
- 新 PDF 批注和复查引用已按 `sourceId + fragmentId + page + rects` 回跳；Markdown 块级回跳已使用稳定块编号、版本指纹和唯一原文匹配，MinerU 页块还能提供原 PDF 页码与归一化矩形。旧批注或重复文本无法确认位置时仍明确降级，不编造页码或高亮框。

### 第二层：可选语义检索

- 本地嵌入模型：不消耗第三方 Token，但需要下载模型并占用计算资源。
- 云端嵌入模型：质量和速度可更高，但需明确计费与发送范围。
- 语义结果不能替代关键词结果；用户始终可以选择“只做本地精确搜索”。
- 当前本地候选已按真实接口验证为 FastEmbed `0.8.0`（Apache-2.0）+ `BAAI/bge-small-zh-v1.5`（MIT，512 维，官方模型表约 90 MB）。`scripts/setup-embedding.ps1` 只在主动运行时下载独立 Python、依赖和模型；`embedding-bridge.py` 的日常 `status/embed` 强制使用本机缓存，限制单批 128 条、单条 8000 字符。
- 真实离线冒烟中，“降低装配接触力峰值”对相关阻抗控制证据的余弦相似度为 `0.780968`，对无关农业文本为 `0.343380`。这只验收了嵌入引擎，不代表研究库混合检索已经接通。
- 正式接入顺序固定为：按 `Source/NoteFragment/ReviewDocument` 生成带来源锚点的不可变分块 → 以内容哈希缓存向量 → FTS 与向量并行召回 → 用可解释融合分数排序 → 仍按原文证据/用户笔记/AI 内容标识展示。不能把整篇 PDF 直接截断成一个向量，也不能让语义分数覆盖证据来源优先级。

### 复用出口

- 导出单篇阅读卡为 Markdown。
- 按“国内外研究现状 / 方法 / 实验”等用途导出摘录集合。
- 导出带页码和 DOI 的引用草稿。
- 后续可接 BibTeX/RIS/Zotero/EndNote 交换格式；不在第一阶段自创封闭格式。

## 8. 翻译是否必须消耗第三方 Token

**不必须。当前桌面版已接入 Argos 英文 → 中文本地翻译，默认不消耗第三方 Token。**

| 翻译后端 | 第三方 Token | 隐私 | 适合场景 |
| --- | --- | --- | --- |
| Argos Translate 本地组件（已实现） | 不需要 | 文本不离开本机 | 快速直译、断网阅读 |
| Ollama 本地模型 | 不需要 | 文本不离开本机 | 需要术语解释、上下文理解 |
| OpenAI 兼容云端模型 | 通常需要 | 选区发送到服务商 | 追求更高质量或本机性能不足 |

当前实现：

- 设置页默认选择“本地 Argos（推荐，不消耗 Token）”，用户也可明确改为已配置的 AI 服务。
- 用户第一次点击划词“翻译”时，如果组件不存在，会显示安装按钮；只有用户点击后才联网下载，不在后台静默安装。
- 桌面主进程调用 Argos，Renderer 不能直接启动 Python；选区通过进程标准输入传递，不进入命令行参数。
- 运行时、缓存、配置和模型全部隔离在项目 `.runtime/translation/` 或正式版应用用户数据目录，不修改系统 Python。
- 当前固定验证组合为 Argos Translate `1.11.0` + 英→中模型 `1.9`。
- 本机首次安装的逻辑文件总量约 `1.78 GiB`，主要来自 NLP/推理依赖；界面安装前提示预留约 2 GB。其他机器可能略有差异。
- 英→中模型包自己的 README 明确标注其上游 OPUS 模型为 `CC-BY 4.0`；Argos 程序库本身为 MIT/CC0，二者许可证不能混为一谈。
- 安装后实测句子可在断开第三方 AI 配置的情况下完成翻译；不需要 API 密钥或 Token。
- 本地模型缺失或翻译失败时明确报错，不偷偷切换到云端。
- “解释”和“针对此处提问”仍使用用户明确配置的 AI Provider；纯翻译与推理问答是两条独立路线。

参考实现：

- [Argos Translate 官方仓库](https://github.com/argosopentech/argos-translate) 提供 Python API、命令行和 `.argosmodel` 语言包。
- [Argos Translate 官方 CLI 文档](https://argos-translate.readthedocs.io/en/latest/source/cli.html) 说明语言包的更新、安装与离线调用。
- [Ollama Windows 与本地 API](https://docs.ollama.com/windows) 可在本机 `localhost` 提供模型服务。

## 9. MinerU 当前到底是本地还是云端

**当前主代码已经改为本地 MinerU，文件不再上传 MinerU 云端。**

MinerU 官方同时支持本地 CLI、API 和 WebUI；本地命令可直接输入 PDF 并输出 Markdown，也支持 CPU `pipeline` 模式，只是速度和复杂版面效果取决于硬件。参考：

- [MinerU Quick Start](https://opendatalab.github.io/MinerU/quick_start/)
- [MinerU CLI Tools](https://opendatalab.github.io/MinerU/usage/cli_tools/)

已经实现：

1. `scripts/setup-mineru.ps1` 在开发环境的 `.runtime/` 或正式版应用用户数据目录中安装独立 Python、MinerU 和模型缓存，不修改系统 Python。
2. Electron 通过 `preload` 白名单 IPC 调用本地服务，Renderer 不直接启动进程。
3. `mineru-api` 以随机 `localhost` 端口常驻，避免每篇论文重复加载模型。
4. 解析任务、Markdown 和资源保存在应用本地任务目录；原 PDF 始终保留。
5. 已用两页测试 PDF 完成端到端冒烟验证，输出含 Markdown 和页级内容；当前为 CPU `pipeline`。
6. 缺少运行环境时，桌面界面提供用户主动触发的一键安装和进度反馈；不会在后台静默下载，也不会上传论文。

继续扩展但不重复造轮子：

- 把 MinerU 输出接入 `Source` 版本和每篇文献的 `assets/`，而不是长期塞进 `localStorage`。
- 保存解析器版本、后端、原文件哈希、输出哈希，以及 MinerU 的 page/block/layout 映射；当前已接入 legacy `content_list` 页块与归一化框，span 级映射留到确有阅读需求时再扩展。只存 `.md` 会丢失引用回跳所需的位置证据。
- 中央阅读器支持 PDF / MinerU Markdown / 对照模式共用同一批注与引用锚点；Markdown 批注在能唯一对应 MinerU 页块时，也可在原 PDF 显示同一位置高亮。
- 后续评估 GPU 加速、模型按需下载和任务队列；云端解析不进入本轮 MVP，未来若加入必须是用户显式选择的独立 Provider。

## 10. 桌面客户端与启动方式

### 决策：做 Windows 桌面客户端，不把双击 `index.html` 作为正式交付

双击单个 `index.html` 看似简单，但对本项目并不合适：

- 浏览器 `file://` 环境对模块、Worker、跨文件读取和安全权限有约束。
- 无法可靠管理仓库目录、文件监听、SQLite、本地解析进程和备份。
- 不能提供稳定的文件关联、开始菜单、最近仓库和自动迁移体验。

项目已经沿用现有 React + Electron 完成 0.2.0 Windows 候选交付：

- 安装版：`.reader-cache/release-0.2.0-final-local/XiaoHeResearchReader-Setup-0.2.0-x64.exe`；安装时可选择是否安装离线 Argos 翻译模块。
- 免安装便携版：`.reader-cache/release-0.2.0-final-local/XiaoHeResearchReader-Portable-0.2.0-x64.exe`。
- 安装版配置开始菜单和桌面快捷方式；便携版无需安装。
- Electron `preload` 只暴露研究库、检索、阅读状态、复查导出、MinerU 和翻译等白名单接口。
- 本地 MinerU 正式版运行时放在可写的应用用户数据目录。
- 解包版、便携构建内容和真实安装版均已完成启动验证；安装版卸载后安装目录、注册项和快捷方式均为零残留。

2026-08-02 最终本地候选产物校验：

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `.reader-cache/release-0.2.0-final-local/XiaoHeResearchReader-Setup-0.2.0-x64.exe` | 430,164,736 字节 | `4D55D5581F8CBAA9CF5282A4A92ED37CFFC845D4A8437342E64FDECE202E62AE` |
| `.reader-cache/release-0.2.0-final-local/XiaoHeResearchReader-Portable-0.2.0-x64.exe` | 104,479,429 字节 | `F2CDF143A3AD6A7CB3A9DB777E7A1B482D833CCA2B03BF189290265BB98AB9EF` |

仍需补齐：

- Windows 代码签名。
- 双击 PDF 或仓库文件关联打开。
- 自动备份、崩溃恢复报告和仓库归档/迁移向导。
- 旧版本覆盖升级回归；全新安装、内置翻译、启动和卸载已完成。

开发者可用 `npm run pack:win` 或 `npm run dist:win` 重建产物；脚本自动使用项目内 npm/electron-builder 缓存，避免依赖全局缓存状态。最终用户不需要执行这些命令。

### Codex 并行桌面测试防崩规则

2026-08-01 已确认此前弹窗不是 React 业务异常：Electron 的 GPU 子进程在 Codex 受管 Windows 会话中以 `0xC0000135` 退出，Chromium 重试后主动触发 `0x80000003` 致命断点；单独关闭硬件加速仍会启动软件 GPU 子进程，不能解决。随后还确认同一嵌套沙箱会阻止 Renderer 子进程启动。

- Codex 的无界面启动验收统一执行 `npm run smoke:desktop`，不再用 `Stop-Process` / `taskkill` 作为正常收尾。为兼容旧测试习惯，开发主进程也会通过 `CODEX_THREAD_ID` 自动识别 Codex 受管会话，因此偶尔直接执行 `npm run desktop` 也不会再走会崩溃的 GPU/Renderer 子进程沙箱。
- 需要真实窗口交互时执行 `npm run desktop:test`；每次运行会创建 `.reader-cache/desktop-<mode>-<唯一编号>/user-data`，并行任务不会共享正式研究库、Chromium 缓存或单实例锁。
- 只有专用隔离测试入口或带 `CODEX_THREAD_ID` 的受管开发会话会启用 Electron 官方限定为测试用途的 Chromium `no-sandbox` 兼容开关，并同时把软件 GPU 留在主进程；普通 PowerShell 开发会话、安装版和便携版均不进入该分支。Codex 直接启动时按任务号使用 `.reader-cache/codex-<thread-id>/user-data`，不同并行任务不共享状态。
- 无界面冒烟加载真实 `dist/index.html`，核对页面标题后由应用执行 `app.quit()`；退出前等待本地 MinerU 服务停止和 SQLite 研究库关闭。Renderer 启动失败、加载失败或 15 秒超时也会输出失败标记并自行退出。
- 测试缓存已加入 `.gitignore`，不会混入提交。若 `dist/index.html` 不存在，先执行 `npm run build`，脚本会明确报缺失文件而不是暗中重建或启动半成品。

本轮验收已完成一次独立冒烟、两份同时启动的并行冒烟，以及一次模拟旧习惯的 Codex 直接启动：均加载标题“小何的科研阅读助手”、没有 `GPU process exited unexpectedly` / `GPU process isn't usable`，且进程全部退出；三个由测试运行器管理的实例退出码均为 0。

当产品逻辑稳定后，再评估是否值得迁移到 Tauri；当前立即迁移只会增加重写成本，不能直接改善阅读体验。

## 11. Codex 桌面端风格的视觉基线

这里参考的是 Codex 默认界面的**克制、清晰和工具按需出现**，不是复制品牌皮肤。

### 颜色

| 用途 | 建议 |
| --- | --- |
| 应用背景 | 中性浅灰 `#F7F7F6` |
| 主内容面 | `#FFFFFF` |
| 次级面/悬停 | `#F1F1EF` |
| 主文字 | `#20201F` |
| 次文字 | `#6F6F6B` |
| 弱文字 | `#92928D` |
| 边框 | `rgba(31, 31, 29, 0.10)` |
| 聚焦/选中 | 低饱和绿色或系统强调色，只用于状态和主操作 |
| PDF 画布 | `#ECECEA`，与白色纸张形成柔和对比 |

大面积深绿色侧栏和荧光色品牌块取消。颜色只承担层级、状态和反馈，不承担“看起来像科研软件”的装饰任务。

### 字体与字号

- 界面字体：`Segoe UI Variable`、`Microsoft YaHei UI`、系统无衬线回退。
- 普通界面正文：14px / 20px。
- 次级说明：12–13px；常规可见文字不再使用 8–11px 微型字号。
- 导航与按钮：13px，常规字重 500。
- 页面标题：20–24px，不使用夸张大标题。
- 阅读正文：默认 17px / 1.75；用户可调 15、17、19、21px。
- PDF 原文不强行改字号，通过缩放与适合宽度保证可读性。
- 仅元数据、键盘提示和极短标签使用等宽字体。

### 尺寸与排版

- 顶栏高度：52px。
- 全局侧栏：默认 232px；窗口低于 920px 时折叠为 64px 图标栏。
- 文献列表栏：280–320px，可隐藏。
- 阅读批注栏：320–380px，可拖动、可隐藏。
- 按钮高度：常规 32px，紧凑 28px。
- 输入框高度：32–36px。
- 圆角：6–8px；卡片不再层层套 12px 大圆角。
- 页面间距以 4px 为基准，常用 8/12/16/24px。
- 阴影只用于浮动菜单、对话框和纸张，不给普通卡片普遍加阴影。

### 自适应与桌面感

- 应用外壳固定占满当前窗口，禁止用页面整体纵向增长来换取大字号；资料库、复查选择区、文档区、设置内容和阅读画布分别承担自己的滚动。
- 1320px、1080px、920px 是信息重新编排点：依次收紧面板、隐藏低优先级表格列、再折叠全局侧栏，而不是等比缩小文字。
- “界面可读性”只提供标准、稍大、较大三档，并把旧版可能保存的 90% 缩放钳制到 100%，避免桌面端出现难以阅读的微缩界面。
- 字体只使用本机的 `Segoe UI Variable`、`Microsoft YaHei UI` 和系统回退，不再从 Google Fonts 请求外部字体。

### 核心界面排版

```text
常规资料库
┌────────────┬────────────────────────────────────────────┐
│ 仓库/导航   │ 搜索、筛选、文献列表                        │
└────────────┴────────────────────────────────────────────┘

沉浸阅读
┌─────────────────────────────────────────────────────────┐
│ 返回  标题          原文｜对照｜MD    进度  视图  批注   │
├───────────────────────────────────────┬─────────────────┤
│                                       │ 可折叠批注/问答   │
│              阅读正文                 │                 │
│                                       │                 │
└───────────────────────────────────────┴─────────────────┘
```

阅读器进入沉浸模式后，全局侧栏完全隐藏；用户需要工具时再通过顶部按钮、快捷键或划词菜单唤出。

## 12. 已确认并落地的数据模型

确认前的代码只有写死项目名、全局 `Source / Annotation / Claim / Action / AISettings` 和五组 `ra.*` 本地数据。现在已新增正式 `Project / BibliographicItem / NoteFragment / ReviewDocument` 数据底座，并通过迁移保留旧数据；`ActionPack` 已进入 schema v7 的待确认行动、证据快照和追加审计底座，`EvidenceClaim / AIProvider` 仍只有旧概念，后续落地时同样不能假装接口已经存在。

### 12.1 `BibliographicItem`：逻辑文献记录

`BibliographicItem` 负责“这篇文献是什么”，`Source` 负责“有哪些原文件和派生版本”。一篇文献可以关联 PDF 原文、MinerU Markdown、图片资源等多个 `Source`。

```ts
interface BibliographicItem {
  id: string
  projectId: string
  itemType: string
  title: string
  authors: PersonName[]
  issued?: string
  containerTitle?: string
  volume?: string
  issue?: string
  pages?: string
  abstract?: string
  language?: string
  keywords: string[]
  identifiers: Record<string, string[]>
  needsMetadataReview: boolean
  importProvenance: {
    format: 'endnote-xml' | 'ris' | 'bibtex' | 'legacy' | 'manual'
    importBatchId: string
    sourceFileName?: string
    sourceFileSha256?: string
    recordOrdinal: number
    rawRecordId?: string
    rawRecordIdField?: string
    rawPayload: string
    rawFields: Record<string, string[]>
    parserName: string
    parserVersion: string
    importedAt: string
  }
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

interface BibliographicAttachment {
  id: string
  itemId: string
  sourceId?: string
  role: 'primary' | 'supplement' | 'snapshot' | 'other'
  pathOriginal: string
  pathResolved?: string
  existsState: 'unknown' | 'found' | 'missing' | 'denied'
  contentSha256?: string
}
```

硬约束：

- 原始记录编号同时保留“值”和“来自哪个字段”；没有编号就保持为空，不能编造。
- 附件原路径永远写入 `pathOriginal`；解析后的绝对路径只能另存为 `pathResolved`。
- 完整原始记录和未知字段必须保留，避免导入适配器把信息吃掉。

### 12.2 `NoteFragment`：最小可复用笔记单元

它不是另一个大笔记页，而是划词后生成的原文摘录、用户想法、翻译、问题或 AI 回答。`Annotation` 只负责阅读器里的选区/高亮位置，笔记正文由 `NoteFragment` 承担。

```ts
interface NoteFragment {
  id: string
  projectId: string
  bibliographicItemId?: string
  sourceId?: string
  annotationId?: string
  origin: 'source_evidence' | 'user' | 'ai'
  kind:
    | 'quote' | 'note' | 'translation'
    | 'question' | 'answer' | 'summary' | 'figure_caption'
  content: string
  contentSha256: string
  language?: string
  purposeTags: string[]
  anchor: {
    type: 'pdf' | 'markdown' | 'text' | 'legacy'
    state: 'resolved' | 'unresolved'
    pageNumber?: number
    rects?: Array<{ x: number; y: number; width: number; height: number }>
    quote?: { exact: string; prefix?: string; suffix?: string }
    markdownBlockId?: string
    sourceContentSha256?: string
    legacyLocatorText?: string
  }
  aiProvenance?: {
    providerId: string
    model: string
    promptHash: string
    runId: string
    inputFragmentIds: string[]
    generatedAt: string
  }
  supersedesId?: string
  createdAt: string
  createdBy: 'user' | 'ai' | 'system'
}
```

硬约束：

- `origin` 创建后不可修改；AI 只能新增 `origin='ai'` 的内容。
- AI 不允许更新或删除 `origin='user'` 和 `origin='source_evidence'`。
- 用户编辑采用新修订并用 `supersedesId` 连接，旧笔记保留。
- 翻译、回答、总结通过 `derived_from` 关系指向输入碎片，不把多个来源压成一个不可追溯字符串。
- 原文证据必须关联 `sourceId`；定位失败时明确标成 `unresolved`，不能伪造页码。

### 12.3 `ReviewDocument`：多文献结构化复查文档

```ts
interface ReviewDocument {
  id: string
  projectId: string
  title: string
  templateId?: string
  templateVersion?: string
  status: 'draft' | 'reviewed' | 'exported'
  selectedItemIds: string[]
  selectedFragmentIds: string[]
  generationRunId?: string
  createdAt: string
  updatedAt: string
}

interface ReviewBlock {
  id: string
  documentId: string
  position: number
  blockType: 'heading' | 'source_evidence' | 'user_note' | 'ai_organization'
  content: string
  contentSha256: string
  sourceFragmentId?: string
  unsupported?: boolean
}

interface ReviewCitation {
  id: string
  blockId: string
  itemId: string
  sourceId: string
  fragmentId?: string
  pageNumber?: number
  anchor?: NoteFragment['anchor']
  quotedTextSha256?: string
  label: string
}
```

硬约束：

- 原文证据、用户笔记、AI 整理是三种独立 `ReviewBlock`，界面和导出都显示来源标识。
- 视觉固定为原文证据蓝色标识、用户笔记中性灰白、AI 整理低饱和紫色；颜色只是辅助，文字标签必须始终存在。
- AI 只能增改 `ai_organization`；不能覆盖证据块或用户笔记块。
- AI 结论至少有一条引用；没有来源只能显示为“无证据推断”，默认不进入正式导出。
- 点击引用使用本项目内部定位协议打开 `sourceId + pageNumber + anchor`；Markdown/Word 导出同时保留人可读页码和稳定回跳链接。
- 每次 Markdown/DOCX 导出记录文档修订、文件哈希和时间，导出文件不能反向覆盖原文档。

### 12.4 与现有概念的关系

```text
Project（仓库隔离边界）
└─ BibliographicItem（逻辑文献）
   ├─ Source（PDF、MinerU Markdown、图片等物理/派生资源）
   │  └─ Annotation（页面上的高亮与锚点）
   │     └─ NoteFragment（摘录、用户笔记、翻译、问答）
   ├─ EvidenceClaim ← NoteFragment 的 supports/refutes/mentions 证据关系
   └─ ReviewDocument
      ├─ ReviewBlock
      └─ ReviewCitation → Source / NoteFragment / 原页码
```

被笔记或引用使用的文献、来源和批注只能归档，不能硬删除。`ActionPack` 用于复查后续行动，`AIProvider` 只保存模型配置与系统凭据引用；它们不会代替上述三个核心模型。

### 12.5 证据关系是事实投影与审计关系，不是第四个核心模型

当前没有新增 `EvidenceGraph` 表，也没有借机伪造尚未确认的 `EvidenceClaim` 模型。桌面主进程每次从现有事实表生成 `EvidenceGraphView`：

- `NoteFragment(source_evidence)` 是原文证据节点，保留 `sourceId + pageNumber + anchor`。
- `NoteFragment(user)` 是用户判断节点；`comments_on` 关系始终标为用户建立。
- `NoteFragment(ai)` 是阅读卡节点；`ai_provenance.status` 区分 AI 草稿和用户已采纳内容。
- `ReviewBlock(ai_organization)` 是复查结论节点；`ReviewCitation` 只表示“引用依据”，不能自动升级为“支持”。
- `fragment_relations` 中已经明确保存的 `supports / refutes / mentions / derived_from / comments_on` 才能显示对应关系；没有来源的 AI 复查块进入“待核验”，不能伪装成结论。
- 用户只能人工建立 `supports / refutes / mentions`，必须填写至少 4 个字符的理由；`comments_on / derived_from / cites` 由批注、阅读卡和复查工作流维护，证据页不能伪造来源链。
- `fragment_relations.created_by / status / rationale / reviewed_at` 保存当前可用状态；`fragment_relation_events` 只追加创建、建议、确认、拒绝与重开事件。撤销关系会保留关系行和历史，仅从当前证据投影隐藏。

界面按“原文证据 → 用户判断 → AI 与复查”三层排列。900/1024px 使用紧凑成对关系，宽窗口恢复三泳道；节点详情始终显示内容来源、可信状态、位置和回跳动作。超过 1200 个片段时明确提示缩小到单篇论文或某份复查文档，不静默假装展示了完整研究库。

### 12.6 ActionPack 是待确认建议，不是自动执行器

schema v7 已把旧的前端临时 `Action` 替换为研究库内的 `ActionPack`：

- Agent 只能提出 `read / compare / verify / experiment / review / note` 六类建议；每条建议必须引用当前研究库中经过校验的论文、资料、笔记片段或复查区块。
- 新建议状态固定为 `proposed`。用户逐条确认后才成为 `confirmed`；确认仍不会自动联网、修改笔记、删除资料或执行实验。
- “拒绝建议”和“标记完成”是不同事件；只有已确认行动才能标记完成。
- 标题、理由和证据快照不可覆盖；审批、重开、完成与行动包状态变化写入只追加的 `action_pack_events`。
- 视觉使用纵向研究任务单和编号脊柱，重点展示行动理由、证据入口和人工裁决，不新增驾驶舱卡片墙。

## 13. 第一阶段导入适配器

第一阶段只支持 EndNote XML、RIS、BibTeX，不实现完整 EndNote。

```ts
interface BibliographyImportAdapter {
  readonly format: 'endnote-xml' | 'ris' | 'bibtex'
  detect(input: ImportFile): Promise<DetectionResult>
  parse(input: ImportFile): Promise<ImportRecord[]>
}

interface ImportRecord {
  ordinal: number
  normalized: Partial<BibliographicItem>
  rawRecordId?: string
  rawRecordIdField?: string
  rawPayload: string
  rawFields: Record<string, string[]>
  attachments: Array<{ pathOriginal: string; role?: string }>
  warnings: ImportWarning[]
}
```

实现纪律：

- Adapter 只输出“标准化字段 + 原始字段”，不直接写数据库。
- EndNote XML 的原始记录编号、RIS 的候选编号字段、BibTeX citation key 都原样保存；具体优先级必须由官方规范和测试夹具确认后实现。
- 相对附件路径只以导入文件所在目录尝试解析；不存在或无权限时仍导入题录并标记 `missing/denied`。
- RIS 重复字段、多作者、续行、未知标签；BibTeX 转义和多附件；EndNote XML 无编号和多附件都要有测试夹具。
- 解析器候选优先选宽松许可证的成熟库；选型前核查许可证和真实 API，不自行手写半套格式解析器。

当前实现：

- RIS 与 BibTeX 的语义解析使用 `@citation-js/core`、`@citation-js/plugin-ris`、`@citation-js/plugin-bibtex` 0.8.2；三者均为 MIT。
- EndNote XML 的 XML 语法、属性、重复节点和格式化文字解析使用 `fast-xml-parser` 5.10.1（MIT）。
- Markdown 阅读层复用 [`react-markdown`](https://github.com/remarkjs/react-markdown)、`remark-gfm`、[`remark-math`](https://github.com/remarkjs/remark-math)、`rehype-katex` 与 KaTeX；这些模块使用 MIT 许可证。`react-markdown` 默认不使用 `dangerouslySetInnerHTML`，当前实现同时跳过原始 HTML。
- Citation.js 只负责成熟的格式语义转换；Adapter 另行保留精确 `rawPayload`、原始字段数组、记录序号和编号来源字段，避免 CSL 标准化吞掉未知字段。
- RIS 已测试重复作者、摘要续行、未知标签、`ID` 原编号和 `L1` 附件；BibTeX 已测试 citation key、嵌套花括号、未知字段和原始 `file` 值；EndNote XML 已测试 `rec-number`、多段格式化标题、未知节点和 `internal-pdf://`。
- 桌面端“导入题录”通过主进程文件选择器读取文件。相对附件只相对导入文件目录解析；`internal-pdf://` 和网络 URL 不猜真实路径。
- 可读 PDF 附件会复制到当前研究库并建立 `Source`；缺失、拒绝访问或无法解析的附件仍保存 `pathOriginal` 和明确状态。
- 同一格式、同一源文件 SHA-256 重复导入时返回原批次，不重复创建题录。

## 14. 现有数据迁移与回滚

迁移按“先快照、再复制、双读核对、最后切换”执行：

1. 分别发现浏览器 `http://localhost` 与 Electron `file://` origin；两者的 `localStorage/IndexedDB` 不能假定是同一份。
2. 原样快照 `ra.sources / ra.claims / ra.annotations / ra.actions / ra.ai-settings`，枚举 IndexedDB 文件并记录 SHA-256；旧数据不删除。
3. 建立 `migration_runs` 和 `migration_map`。同一来源快照重复迁移时使用确定性 ID 和幂等写入，行数不能增加。
4. 创建一个迁移仓库；旧 `Source` 原样迁入。PDF/明确文献来源建立待核对的 `BibliographicItem`，其他办公文件暂不冒充论文。
5. 旧批注的摘录 `text` 迁为 `source_evidence`，用户备注 `note` 迁为 `user`，两者用 `comments-on` 关系连接；旧 `page` 无法验证时只保留为 `legacyLocatorText`。
6. 旧 `Claim` 保留为待核验证据的 `EvidenceClaim`，不能按文件名模糊匹配后伪造引用。旧 `Action` 可进入“旧版行动”包。
7. `AISettings` 的地址、模型和策略迁为 `AIProvider`；明文密钥必须进入操作系统凭据库，SQLite 只保存 `credentialRef`。
8. 迁移后核对实体数量、文件/Markdown 哈希、外键、来源分类和引用回跳。失败时事务回滚；新文件进入隔离区，不删除旧数据。
9. 验收一个版本周期后才允许用户主动清理旧存储；回滚只切换数据指针。

迁移验收公式：

```text
NoteFragment 数
  = 非空旧 annotation.text 数
  + 非空旧 annotation.note 数

同一快照迁移两次后：
  表行数不变
  业务内容哈希不变
  原附件 SHA-256 不变
```

## 15. 技术结构与接口边界

为了避免继续把所有逻辑堆在 `src/main.tsx`，下一版先建立以下边界：

```ts
interface VaultRepository {
  create(input: CreateVaultInput): Promise<Vault>
  open(path: string): Promise<Vault>
  listRecent(): Promise<VaultSummary[]>
  close(): Promise<void>
}

interface PaperRepository {
  import(vaultId: string, files: string[]): Promise<Paper[]>
  get(paperId: string): Promise<PaperProject>
  updateReadingState(paperId: string, patch: ReadingStatePatch): Promise<void>
  search(query: SearchQuery): Promise<SearchResult[]>
}

interface ParseProvider {
  kind: 'pdfjs-local' | 'mineru-local'
  parse(input: ParseInput): Promise<ParseResult>
}

interface TranslationProvider {
  kind: 'argos-local' | 'ollama-local' | 'openai-compatible'
  translate(input: TranslationInput): Promise<TranslationResult>
}

interface AnnotationRepository {
  create(input: AnchoredAnnotationInput): Promise<Annotation>
  update(id: string, patch: AnnotationPatch): Promise<Annotation>
  relocate(documentVersion: string): Promise<RelocationReport>
}

interface EvidenceEngine {
  index(input: EvidenceIndexInput): Promise<IndexReceipt>
  retrieve(input: EvidenceQuery): Promise<RankedEvidence[]>
  answer(input: EvidenceAnswerInput): Promise<TraceableAnswer>
}

interface EmbeddingProvider {
  kind: 'fastembed-local' | 'openai-compatible'
  status(): Promise<EmbeddingStatus>
  embed(input: EmbeddingBatch): Promise<EmbeddingBatchResult>
}

interface ResearchAgentTool {
  name: 'search_evidence' | 'open_source' | 'compare_papers' | 'organize_notes' | 'draft_review' | 'update_reading_state'
  risk: 'read_only' | 'draft_write' | 'formal_write' | 'network'
  invoke(input: unknown): Promise<unknown>
}

interface ResearchAgentCoordinator {
  inspect(input: AgentContextEnvelope): Promise<AgentInspection>
  propose(input: AgentInspection): Promise<AgentPlan>
  runApprovedStep(input: ApprovedAgentStep): Promise<AgentStepReceipt>
}
```

以上 `ResearchAgentTool / ResearchAgentCoordinator` 是计划中的内部边界，不是已经实现的公开接口，也不新增核心业务模型。近期继续复用 `Project / Source / Annotation / EvidenceClaim / ActionPack / AIProvider / BibliographicItem / NoteFragment / ReviewDocument`；如果以后需要持久化 Agent 会话、工具调用与审批日志，必须先单独设计迁移并让用户确认，不能把运行日志塞进用户笔记。

安全边界：

- Renderer 不直接获得 Node.js 和任意文件系统权限。
- Electron `preload` 只暴露白名单 IPC。
- 云端 Provider 调用前显示发送范围和服务名。
- API 密钥存入系统凭据存储，不再放在普通 `localStorage`。
- 解析、翻译、AI 总结可以独立替换，避免把产品绑死在某家服务。
- PaperQA2 若进入产品，只实现 `EvidenceEngine` 的一个锁定版本适配器；`ReviewDocument` 不直接依赖其内部类型。

## 16. 实施路线与验收标准

### 检查点 0：模型确认（已完成）

- 完成指定开源项目官方接口、模块边界和许可证核查。
- 确认 `BibliographicItem / NoteFragment / ReviewDocument` 与迁移方案。
- 确认后才创建数据库表、TypeScript 类型和导入 Adapter。

验收：用户确认三个模型的职责、不可覆盖规则和迁移方式；README 与实际代码事实一致。

### 纵向切片 1：能装、能导、能打开

- Electron + SQLite + 仓库目录，创建/打开/切换仓库。
- EndNote XML、RIS、BibTeX 导入 Adapter；保留原始编号、原记录和附件原路径。
- Windows 安装版和便携版，普通用户不需要 Node.js 或 npm。
- 迁移当前 `localStorage/IndexedDB`，可核对、可回滚。

验收：在两个仓库各导入一篇论文，重启和切换后不串库；缺失附件能报告而不丢题录。

### 纵向切片 2：在一个界面读和记

- 三栏单界面、Codex 风格视觉变量、左/右栏可折叠。
- PDF 文字层、连续滚动、目录、搜索、缩放和位置恢复。
- 原文 / MinerU Markdown / 对照 / 沉浸模式。
- 统一划词菜单：翻译、解释、提问、高亮、保存笔记。
- `Annotation + NoteFragment` 可靠锚点和来源关系。

验收：任意选一段原文，三次操作内完成翻译或提问并保存；重开后点击碎片能回到同一页和选区。

### 纵向切片 3：多篇复查与可追溯生成

- 文献和碎片多选，按模板生成 `ReviewDocument`。
- 原文证据、用户笔记、AI 整理使用独立区块和视觉标识。
- AI 输出逐条引用证据；无来源推断不能伪装成结论。
- 点击引用回到中央阅读器页码和选区。
- Markdown / DOCX 导出，保存修订与文件哈希。

验收：选中至少两篇论文和三条笔记，一键生成复查文档；逐条引用可回跳；导出后用户原笔记逐字不变。

### 纵向切片 4：查找、状态和本地能力扩展

- 标题/作者/全文/笔记本地检索，搜索结果回跳。
- 阅读进度、相关性、无想法/无疑问、研究用途标签。
- MinerU 产物版本化、GPU/任务队列优化。
- 扩展 Argos 语言对并评估 Ollama 本地解释；Open Notebook/PaperQA2 通过适配层评估搜索和跨论文证据排序。

验收：断网仍能读、记、精确搜索、查看 MinerU 结果；可按阅读状态和用途找回并跳到证据。

### UPDF 基准后的修订路线

| 阶段 | 目标 | 关键验收 |
| --- | --- | --- |
| P0 阅读器下限 | 把阅读、批注、来源定位做好，不让 AI 掩盖基础体验 | 连续阅读、目录/缩略图/页内搜索、位置恢复稳定；批注可编辑、归档、撤销、分类和导出；继续补齐原文/对照/Markdown 间的块级定位映射 |
| P1 研究库与记忆 | 从“文件列表”升级为论文项目、阅读队列与可靠长期记忆 | 100 篇文献仍可按状态、进度、批注数、用途、主题和淘汰结论筛选；项目间不串数据；原文和用户记录可核对备份 |
| P2 本地混合检索 | 给 Agent 建立真正的研究库检索层，而不是继续扩充关键词 | 本地精确结果永远保留；可选本地嵌入显式安装，断网可索引/查询；混合结果显示命中来源、页码和检索方式并能回跳 |
| P3 研究上下文侧栏 | 把现有问答升级为阅读现场中的持续会话与证据工作区 | 支持选区、当前页、本文、多篇和全库五档范围；回答句子带可点击引用；切换论文后保留任务但不误用旧上下文 |
| P4 证据图与跨论文比较 | 先连接“原文—批注—结论—复查”，再谈大型文献图谱 | 点任意证据边能回到原文；支持/反驳/补充/待核验分开；AI 建议边与人工确认边视觉分离 |
| P5 可审查科研 Agent | 围绕持续研究目标编排受控工具，而不是堆 Agent 按钮 | 能发现证据缺口、提出阅读队列、比较论文、整理笔记和起草复查；每步显示输入、工具、来源、风险与待确认写入 |
| P6 论文发现与引用图 | 接入公开论文检索、引用关系、相似论文和研究脉络 | 从种子论文/问题得到候选文献、筛选理由与引用关系；外部元数据与本库事实分离，下载和入库需确认 |
| P7 深度研究 | 在已有研究记忆上形成结构化综述和持续跟踪 | 输出证据矩阵、争议点、空白和带页码草稿；新论文到来后只增量更新受影响结论，不用无来源内容填充 |

侧栏 Agent 的统一上下文信封固定为：

```text
研究目标
  + 当前项目/主题
  + 当前论文与阅读状态
  + 当前页或选区
  + 用户批注和问题
  + 检索到的候选证据
  + 允许调用的工具与隐私范围
```

先只保留一个侧栏 Agent 外壳和六类工具：`检索证据 / 打开原文 / 比较论文 / 整理笔记 / 生成复查 / 更新阅读状态`。内部可以逐步增加能力，但界面不堆十几个角色按钮。

近期开发顺序固定为：

1. **P0 缺口收尾（桌面阅读现场已验收）**：目录、缩略图、页内搜索、位置/模式恢复，以及批注编辑、归档、撤销和 Markdown 导出已完成；Markdown 唯一引文命中及 MinerU `content_list` 页块/矩形映射已接入。真实桌面鼠标拖选、统一菜单、添加到对话、保存批注、`bbox` 高亮和重启恢复均已通过隔离测试库验收。
2. **P2 本地混合检索（代码闭环已完成）**：显式安装的 FastEmbed、本地可追溯分块、schema v5 向量缓存、内容变化失效、精确/语义融合、设置页重建入口和 Agent 调用均已接入；下一步只做大库性能和真实桌面交互验收。
3. **P3 侧栏上下文（首轮代码闭环已完成）**：Agent 已进入阅读右栏，支持选区、当前页、本篇、多篇和全库五档范围，证据可回跳且不关闭任务；当前窗口多轮追问已实现，跨重启持久化要等 Agent 会话模型及迁移方案确认后再做，不在此轮暗增数据模型。
4. **P4 证据图最小版（代码闭环已完成）**：事实投影、用户/AI 关系分流、无来源待核验、单篇/复查范围筛选、节点详情、原文/复查回跳，以及人工 `supports/refutes/mentions` 的内联建立、理由、采纳、拒绝、撤销和追加审计均已接入；下一步只做真实非空桌面交互验收与跨论文比较视图，仍不抓取外部论文网络。
5. **P5 受控行动（基础代码已接入）**：schema v7、白名单行动类型、证据快照、逐项确认/拒绝/完成、追加审计和行动建议页已接入；真实桌面划词/`bbox`、新版安装包、内置翻译与全新安装/卸载均已验收。下一步回到 Agent 的跨论文证据排序和持续研究任务，不扩张成通用项目驾驶舱。

这五步完成前，不开发通用插件市场、云同步、自动写整篇论文或外部 2 亿级论文图谱。扩展能力先通过内部 Adapter/Tool Registry 接入；只有当第三方开发者或多种可替换实现真实出现后，才把它升级为用户可见的插件系统。

## 17. 当前进度

| 工作 | 状态 |
| --- | --- |
| 仓库、接口、启动方式和外部服务事实盘点 | 已完成 |
| 当前界面和阅读器实测 | 已完成 |
| 产品主线改为“一个界面完成科研阅读闭环” | 已完成 |
| 六类指定开源项目官方仓库、真实模块和许可证核查 | 已完成并写入复用矩阵 |
| `BibliographicItem / NoteFragment / ReviewDocument` 设计 | **用户已确认；TypeScript 类型、SQLite 基础表与版本迁移已落地** |
| EndNote XML / RIS / BibTeX Adapter 规则 | **首轮已实现并接入桌面导入；保留原编号、完整原记录、未知字段与附件原路径** |
| 旧数据幂等迁移与回滚方案 | **首轮已实现：快照指纹、迁移批次、映射表、事务回滚和重复迁移幂等** |
| 桌面视觉系统、字号层级与多比例布局规范 | **第二轮已落地：改为浅色中性桌面外壳，弱化通用 AI 发光图标，用证据脊线、问题卡和引用片区建立层级；12px 常规说明、14px 正文基线，1024/1280/1600px 分档重排并使用工作区内部滚动** |
| 多仓库数据底座与切换 | **首轮已实现：创建/打开/最近列表/切换、独立 SQLite 与论文目录，切库前强制落盘** |
| Windows 安装版/便携版 | **“小何的科研阅读助手”0.2.0 已用正式 H Logo 重建；解包版与安装版均正常启动，全新安装、内置 Argos 翻译和卸载零残留已回归。仍待代码签名、旧版覆盖升级与 GitHub 正式发布** |
| 可折叠三栏、沉浸、原文/Markdown/对照阅读器 | **首轮已实现并完成浏览器视觉验收** |
| PDF 文字层与按需连续页渲染 | **已实现；真实两页 PDF 的文字层已验证** |
| PDF 目录、缩略图、页内搜索与阅读现场恢复 | **已实现：目录和缩略图本地按需生成，`Ctrl + F` 只搜索当前 PDF；搜索结果可回页，重开论文可恢复页码、视图模式和缩放；真实两页 PDF 已完成浏览器验收** |
| 划词浮动菜单与运行时页码/矩形锚点 | **已实现并持久化到 Annotation/NoteFragment anchor** |
| 本地 MinerU 安装、Electron 桥接、常驻服务、端到端冒烟 | **已完成（CPU pipeline）** |
| MinerU 产物迁入 Paper/Source 版本目录 | **已实现：完整输出、Markdown、图片、文件哈希清单按解析版本保存；重启恢复与路径越界拒绝已有自动化测试** |
| Markdown 学术阅读层与受限 AI 重排 | **已实现：React Markdown + GFM + KaTeX；题录元数据卡、原始/学术视图切换、本地规则排版；AI 只能保存章节边界，不能回写正文** |
| PDF / Markdown 保守块级定位 | **首轮已实现：Markdown 块具有稳定编号和版本指纹；划词锚点记录块编号；PDF 引文仅在 Markdown 唯一命中时回跳并突出对应块，重复/缺失命中明确拒绝猜测；本机 MinerU 3.4.4 的 `content_list.text/page_idx/bbox` 已接入页块、页码与归一化矩形映射** |
| Argos 英→中本地翻译、显式安装、Provider 切换与端到端冒烟 | **已完成；无第三方 Token，模型 CC-BY-4.0** |
| 安装器可选本地翻译模块 | **已实现并生成 407.8 MiB 离线安装包；安装页可选择约 1.0 GB 的 Argos 模块，不选时保留应用内安装和 API 配置入口** |
| 单篇阅读状态、相关性、想法/疑问与研究用途 | **已实现；各维度独立保存，阅读位置自动记录，变化写入历史事件** |
| 项目内论文管理与当前状态视图 | **已实现：资料库以论文项目为主列表，集中显示阅读阶段、页码/百分比、批注数、相关性、研究用途、附件与 MinerU 状态；未绑定题录的普通资料单独保留** |
| 从原文新建研究批注与来源信息 | **已实现：按钮进入原文取证模式，选完自动打开批注；笔记关联论文、附件、页码/位置和原文矩形锚点** |
| 批注编辑、归档、撤销与导出 | **已实现：编辑生成 `supersedes_id` 修订链且原文不变；归档退出当前计数/检索/阅读卡/新复查，提示条可撤销；本篇批注可导出带原文、页码回跳、指纹与修订数的 Markdown** |
| 多文献复查文档、引用回跳、Markdown/Word 导出 | **首轮已实现；三类内容分离、AI 引用白名单、无证据内容不导出、外部链接可唤起桌面端并恢复页码/高亮** |
| 复查材料选择体验 | **已实现：论文显示阅读状态、页数/百分比进度、批注数；论文和当前批注支持全选/清空；兼容两种历史附件绑定方式** |
| 阅读器常用桌面操作 | **已实现：正文区域 `Ctrl + 滚轮` 50%–300% 缩放；Windows 原生 File/Edit/View/Window 菜单栏已移除** |
| 普通文件夹原地建库 | **已实现：先确认、再命名；保留文件夹已有内容并拒绝覆盖冲突数据库** |
| 标题/正文/MinerU Markdown/批注本地精确检索 | **已实现；命中上下文、高亮和打开/页码目标已接入** |
| 作者/DOI/状态/用途/来源统一检索与组合筛选 | **已实现；SQLite FTS5 本地索引、中文短词回退、论文页码/锚点与复查文档回跳均已接入** |
| 研究库 RAG Agent 第一阶段 | **已实现：阅读右侧工作区、选区/当前页/本篇/多篇/全库五档范围、划词“添加到对话”、FTS5 + 本地语义混合检索、阅读现场直接证据、证据排序、片段级 Provider 调用、引用白名单与页码/原文回跳；加入对话的选区不会随滚动丢失且可移除，当前窗口支持多轮追问，旧回答保留自己的证据快照；未配置 AI 时仍可只看本地证据，跨重启会话持久化尚未设计** |
| 单篇结构化阅读卡 | **已实现：题录、阅读状态、原文证据、用户笔记和可选派生正文形成白名单上下文；AI 草稿按区块保存为 NoteFragment，引用关系可追溯，用户显式采纳且不覆盖原笔记** |
| 证据关系最小版 | **已实现：复用 `fragment_relations / review_citations` 生成证据脊柱；区分原文、用户、AI 草稿、已采纳 AI、复查结论和无来源待核验，支持整库/单篇/复查范围、来源回跳，以及人工支持/反驳/补充关系的理由、采纳、拒绝和撤销；新增的 `fragment_relation_events` 只是追加审计表，不是核心业务模型** |
| 待确认 ActionPack | **基础代码已实现：Agent 只保留带白名单引用的六类行动建议；研究库保存不可覆盖的建议、证据快照和审批事件；用户可确认、拒绝、重新确认和标记完成，任何确认都不会触发自动外部操作** |
| 设置中心与安全持久化 | **已实现：AI/翻译与界面/阅读双页签；界面可读性、密度、底色、强调色、Markdown 字号/行距/宽度可调；API 密钥使用 Electron 系统加密，无法加密时拒绝明文保存** |
| 跨论文语义检索与证据排序 | **本地混合检索已完成；PaperQA2 式候选证据重排、跨库检索和大库性能优化待实现** |
| 可选本地嵌入基础设施 | **隔离安装、固定许可证/模型、离线状态检查、可追溯分块、schema v5 向量缓存、混合排序、Agent/设置页入口和真实研究库冒烟已完成** |
| GitHub 远端与版本发布 | **已配置：私有仓库 `1dlbbbdbd1/he-research-reader`；里程碑标签自动构建 Windows 安装版、便携版和 SHA-256 校验文件** |

### 数据底座当前实现

- Electron 43.2.0 自带 Node 24.18.0，已实测 `node:sqlite.DatabaseSync` 可用；没有新增需要编译的 SQLite 原生依赖。
- 每个研究库固定包含 `vault.json`、`library.sqlite`、`papers/`、`exports/` 与 `.reader-cache/`。
- `library.sqlite` 当前 schema 版本为 7，包含题录、附件、来源、批注、笔记碎片、带创建者/状态/理由的碎片关系、不可覆盖的关系审计事件、待确认行动包/行动项/证据快照/审批事件、批注事件/导出记录、阅读状态与变更事件、复查文档、区块、引用、迁移记录、FTS5 本地检索索引和研究库语义向量缓存；已发布的 v1–v6 库会按版本在独立事务中升级。
- `search_index_state` 记录索引是否过期；题录、来源、批注、碎片、阅读状态和复查区块变化会由数据库触发器标记为待重建，避免渲染界面维护第二套事实数据。
- `semantic_index_state` 保存语义模型、维度、精确索引版本和分块数量；研究库变化后旧向量立即标记失效，向量生成期间若内容再次变化则拒绝提交，不能把旧证据混入新检索。
- 数据库触发器强制 `NoteFragment.origin` 不可修改，并拒绝更新/删除原文证据和用户笔记；编辑必须新增修订。
- 复查文档把原文证据、用户笔记和 AI 整理保存为不同区块；AI 引用只能指向本次选中的片段，无引用内容标为不受支持且默认不导出。
- Markdown/Word 导出记录文档修订哈希、文件 SHA-256 和导出时间；`research-reader://` 引用经过协议、来源和片段归属校验后才回到原论文。
- 桌面端导入文件时，原文件写入 `papers/<source-id>/original/`，数据库只保存研究库相对路径和校验哈希；重新打开研究库时可从库内原文件恢复阅读。
- Renderer 只通过白名单 IPC 创建、打开、切换和读写研究库，不获得任意 Node.js 或文件系统权限。
- MinerU 解析结果由主进程直接迁入论文派生版本目录；Renderer 不能指定任意本地产物路径，只能按资料编号读取当前版本中限额、白名单格式的图片资源。
- 旧 `localStorage` 迁移会跳过示例资料，把 PDF 建为待核对题录，把摘录与用户备注拆成两种碎片；相同快照重复执行不会增加行数。
- 旧 IndexedDB 原文件存在时会先复制进当前研究库；如果原文件已经丢失，题录和笔记仍可迁入，但附件保持不可假装为已找到的状态。

最近一次验证：

- `npm test`：90 项测试全部通过；新增覆盖划词选区固定到 Agent 对话且可移除、Renderer 显式内容安全策略、Windows 发布工作流的新产物名称与标题，以及 schema v7 从已发布 v1 的事务升级、带引用行动建议解析、ActionPack 建立、证据归属校验、内容不可覆盖、受限桌面 IPC 和 Windows 隔离测试分支；证据关系、本地语义检索、MinerU 映射、批注生命周期、PDF 导航与阅读现场恢复等既有能力继续通过。
- `npm run build`：TypeScript 与 Vite 生产构建通过；PDF.js、React Markdown 与 KaTeX 进入主阅读包后仍有大于 500 kB 的代码分包警告，后续需要按阅读模式动态加载。
- 浏览器本地生产预览已实际验证阅读侧栏切换：Agent 为右栏内嵌工作区，没有 `.modal-backdrop`；当前页按钮会切换为“当前页 · 第 1 页”并保持激活，证明阅读现场上下文已进入侧栏。1024×768、1280×720、1600×900 三档均无全局横向溢出；窄栏下快捷问题自动改为纵向排列。
- 新桌面视觉系统已在 900×700、1024×768 和 1600×900 三档生产预览中检查：应用外壳始终等于窗口且无全局横向溢出；900px 时侧栏收为 64px 图标栏，1024px 时资料库/复查/设置保持可读并由内部区域滚动，1600px 时恢复完整导航和更宽阅读工作区。复查与设置页的可见常规文字均不低于 12px；当前视觉与正式 H 品牌已进入 0.2.0 新安装包。
- 证据关系页的 SQLite 服务测试覆盖用户 `comments_on`、AI 阅读卡 `derived_from`、采纳状态、复查 `cites`、人工 `supports` 的建立/撤销/重开、追加审计、无来源节点和错误输入拒绝。既有证据脊柱在 900×700、1024×768、1600×900 三档无全局溢出且可见文字不低于 12px；本轮内联关系区在 1280×720 生产预览中外壳与主区均无横向溢出、最小可见字号 12px、控制台 0 条警告或错误。浏览器临时库只完成空状态和禁写降级视觉验收，非空关系与写入生命周期由真实数据库测试证明，没有冒充完整桌面鼠标交互验收。
- HTML 入口已补齐标准文档声明、中文语言、UTF-8、viewport 与显式 Content Security Policy；脚本禁止 `unsafe-eval`，对象嵌入和表单提交被禁用，用户主动配置的 HTTP/HTTPS Provider 连接仍可用。Electron 冒烟中原安全警告已消失。
- 新论文项目管理页、资料库筛选条、复查选择器与建库弹窗已通过 TypeScript、服务层与生产构建验证；新版桌面窗口的空库布局已实际打开检查，筛选条、状态摘要和空状态未出现遮挡。当前开发运行时没有最近研究库记录，尚未用真实 38 篇论文完成非空列表视觉验收，因此没有把这一项冒充为通过。
- 阅读器导航已用真实两页 PDF 验证：两页文字层与缩略图均正常；搜索 `Traceability` 命中第 2 页并能回跳；切换到 Markdown、设为 110% 后返回资料库再重开，模式和缩放均恢复。浏览器控制台无错误。
- `npm run smoke:desktop:seed` 会在项目 `.reader-cache/desktop-smoke-<timestamp>/` 建立独立用户数据和独立研究库，并导入真实两页 PDF 与既有 MinerU 产物，不读取或改写用户正式研究库。本轮真实桌面验收已完成：鼠标选中第 1 页 `Hypothesis...` 后菜单显示翻译/解释/提问/添加到对话/保存笔记；加入 Agent 后显示当前选区、第 1 页和可移除的原文证据。第二次选中 `Evidence status...` 并保存，弹窗显示论文、原附件、第 1 页和已保存锚点；重启后资料库仍显示精读中、1/2 页、1 条批注，重新打开原文高亮仍存在。数据库读回 `pageNumber=1`、1 个归一化矩形和完全一致的原文引文。
- `npm run smoke:translation`：Argos 1.11.0 + 英→中模型 1.9 完成真实本地翻译，识别模型许可证 `CC-BY-4.0`。
- `npm run smoke:embedding`：在临时研究库中真实建立 6 个可追溯分块的 schema v5 向量索引；强制离线查询把装配证据 `0.680135` 排在无关农业文本 `0.351769` 前，批注第 3 页与原文矩形保留，FTS5/语义重复证据融合为同一结果；FastEmbed 为 Apache-2.0，模型为 MIT。
- `npm run pack:win`：使用项目内缓存完成 x64 Windows 解包版构建。
- `scripts/build-windows.ps1 -Target Dist -OutputDirectory .reader-cache/release-0.2.0-final-local`：0.2.0 安装版和便携版均从当前源码重新生成，安装器包含可选 Argos 本地翻译组件。
- 打包后的 `app.asar` 已读回核对：产品名“小何的科研阅读助手”、版本 0.2.0、显式 CSP、“添加到对话”和固定选区证据均在包内；Windows 可执行文件元数据与 H 图标资源一致。
- 当前安装版 430,164,736 字节，SHA-256 `4D55D5581F8CBAA9CF5282A4A92ED37CFFC845D4A8437342E64FDECE202E62AE`；便携版 104,479,429 字节，SHA-256 `F2CDF143A3AD6A7CB3A9DB777E7A1B482D833CCA2B03BF189290265BB98AB9EF`。
- 同一 Windows 用户 `hdiam\\11443` 下已完成安装 → Argos 英译中 → 启动 → 正常退出 → 卸载：译文为“证据状况需要固定参数基线。”，卸载后安装目录不存在，残留文件/字节、注册项、桌面快捷方式和开始菜单快捷方式均为 0。
- 两个 0.2.0 候选产物均经 `Get-AuthenticodeSignature` 确认为 `NotSigned`，没有把 electron-builder 的工具签名步骤误报为正式代码签名。
- 打包后的 `setup-argos.ps1 / argos-bridge.py` 已针对现有隔离运行时复查，能识别 Argos 1.11.0、英→中模型 1.9 和 `CC-BY-4.0`。
- `ResearchReader-Portable-0.1.0-x64.exe`：实际启动后标题为“科研阅读闭环”的主窗口正常响应；验证结束后本次启动的相关进程已全部退出。
- `npm audit --omit=dev --cache .npm-cache`：正式运行依赖报告 0 个已知漏洞；完整开发工具链的上游告警不进入正式运行依赖。
- 浏览器真实页面：两页 PDF 文字内容可被辅助树读取；原文、Markdown、对照、沉浸以及左右栏开关已逐项操作验证；设置页默认选中“本地 Argos（推荐，不消耗 Token）”；资料库中输入 `impedance` 得到唯一标题命中、关键词高亮，点击后进入对应阅读器。

## 18. 已做出的产品决策

1. 不扩展与闭环无关的驾驶舱；默认进入上次阅读位置或阅读队列。
2. 不交付“只能 npm 启动”的产品；采用 Electron 安装版和便携版。
3. 不把单个 `index.html` 作为正式桌面方案。
4. 不默认要求第三方翻译 Token；提供本地翻译路线。
5. MinerU 采用项目独立的本地运行环境，继续扩展其解析产物和阅读器集成；本轮不依赖云端。
6. Markdown + LaTeX 足以作为主要结构化阅读格式，但原 PDF 始终保留。
7. 每篇文献是独立小项目，拥有自己的状态、批注、用途、阅读卡和历史。
8. 唯一 MVP 是导入、阅读、划词、碎片、多文献复查、引用回跳和 MD/Word 导出。
9. UI 参考 Codex 默认界面的中性、紧凑和克制，但针对长文阅读提高正文字号与行距。
10. AGPL 项目只研究交互与架构；MIT/Apache-2.0 模块优先进入复用候选，但都必须经过适配层。
11. 新增三个核心模型前必须先由用户确认；AI 永不覆盖用户笔记。
12. 三个核心模型已于本轮得到用户确认；从 SQLite schema v1 开始，后续修改必须走版本迁移，不能静默改表。

## 19. 远端仓库与版本发布

- 远端仓库：`https://github.com/1dlbbbdbd1/he-research-reader`，默认保持私有。
- 开发提交持续推送到 `main`；只有形成可供普通用户安装或携带运行的里程碑才创建版本标签和 GitHub Release。
- 版本号使用 `v<主版本>.<次版本>.<修订号>`，并与 `package.json` 中的版本保持一致。
- 推送 `v*` 标签后，GitHub Actions 会在 Windows 环境重新安装依赖、运行测试、构建安装版与便携版，并生成 `SHA256SUMS.txt`。
- token 只从 Codex 的本机 config 读取并作为进程内认证信息使用；config、`.env`、本地工具、运行时、依赖缓存和构建产物都不进入 Git 历史。
- 每次发布前必须同步本 README 的“当前进度”、更新 `CHANGELOG.md`，并确认 `npm test`、`npm run build` 通过。

### 稳定发布顺序

以后不再把版本标签当作第一次远端测试。固定执行：

1. 运行 `scripts/release-preflight.ps1` 完成本地凭据、Git 范围、版本、测试和构建检查。
2. 只推送已确认的 `main` 提交。
3. 手动运行一次 `Release Windows`，在 GitHub 的干净 Windows 环境完成试打包；此时不创建 Release。
4. 远端试跑成功后才推送 `v*` 标签，由同一工作流创建正式 Release。

完整清单、失败分类和禁止事项见 `RELEASE_CHECKLIST.md`。如果远端失败，只根据失败步骤日志修复 `main`，不强制移动已经推送的标签。

首个里程碑 `v0.1.0` 已发布：`https://github.com/1dlbbbdbd1/he-research-reader/releases/tag/v0.1.0`。后续发布步骤：

```powershell
npm test
npm run build
git tag -a v0.2.0 -m 'release: v0.2.0'
git push origin main
git push origin v0.2.0
```

---

当前 0.2.0 本地候选可双击以下任一产物；GitHub Release 只有在远端干净 Windows 试跑成功后才创建：

- `.reader-cache/release-0.2.0-final-local/XiaoHeResearchReader-Setup-0.2.0-x64.exe`：安装版，可选择离线翻译组件。
- `.reader-cache/release-0.2.0-final-local/XiaoHeResearchReader-Portable-0.2.0-x64.exe`：免安装便携版。

开发者仍可使用：

```powershell
Set-Location 'path\to\he-research-reader'
npm run dist:win
npm run desktop
```

需要避免覆盖旧产物时：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\build-windows.ps1 -Target Dist -OutputDirectory release-current
```

这些命令不是最终用户交付方式。当前产物尚未代码签名，Windows 可能显示来源未知或 SmartScreen 提示。

## 20. 品牌与 Logo 状态（2026-08-01）

- 本轮先核对了产品定位、现有界面与应用入口；通用 `GraduationCap` 已从侧栏移除，网页页签、Electron 窗口和 Windows 打包配置均已接入正式品牌图标。
- 产品正式名称已确认并写入源码：**小何的科研阅读助手**。为保留研究库与旧引用兼容性，内部 `appId` 和 `research-reader://` 协议暂不改名。
- 用户重新开启 Logo 探索，并明确认可“深海军蓝大写 `H` + 紫色轨道 + 单个圆形节点”的整体配色与元素；后续不得切回绿色、齿轮堆砌、书本或通用 AI 星芒路线。
- 已以 `uppercase-h-orbit-design-02-bearing.png` 为方向重绘确定性矢量母版，正式资源位于 `brand/`：彩色/纯色/单色 SVG、带底板应用图标、16–512 px 两套 PNG 和包含 7 档尺寸的 Windows ICO。生成式探索稿只保留为过程记录，不再作为应用资源。
- `npm test`：90 项全部通过；`npm run build` 通过，仍只有既有的大分包提示。真实本地生产预览中，常规侧栏和 900×700 的 64px 折叠侧栏均已检查，Logo 在窄栏显示约 32.4px、无横向溢出，控制台 0 条警告或错误。
- 新 Logo 已进入 0.2.0 安装版、便携版、应用窗口、侧栏和网页页签；包内资源与可执行文件元数据已读回确认。
