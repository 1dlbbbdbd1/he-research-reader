# H’s 科研助手

H’s 科研助手是一款面向个人研究者的 Windows 本地优先科研工作台。它把文献阅读、证据记录、研究任务、实验过程、复盘写作和成果导出放在同一个应用里，尽量减少在多个软件之间来回切换。

当前版本：**1.0.0**

## v1.0 长期重构进度

H’s Research Assistant v1.0 长期重构已经完成。重构不会删除或替换现有 `library.sqlite` 与研究原文件；所有新结构都提供幂等迁移、来源追踪、回滚信息和桌面回归证据。

- [x] Phase 0：架构、数据、桌面安全与迁移风险审计
- [x] Phase 1：核心领域契约、多供应商 LLM Provider、主进程凭据隔离、普通用户 AI 接入页
- [x] Phase 2：Research Vault v2 用户可读目录与可重建投影
- [x] Phase 3：持久化 Agent Memory、Planner、Tools 与逐项确认
- [x] Phase 4：类型化 Research Knowledge Graph、Evidence Card、关系证据与人工复核工作区
- [x] Phase 5：统一 Today、Paper Intelligence、Figure Explorer 与可持久化明暗主题 UI
- [x] Phase 6：统一 GB/T、APA、IEEE、BibTeX 引用，Word/LaTeX/PDF 写作路线与可信内置插件生命周期
- [x] Phase 7：旧数据迁移、升级前哈希快照、回滚脚本、幂等与兼容性验收
- [x] Phase 8：单元、集成、UI、桌面、安装/卸载完整交付验收

架构边界和迁移纪律见 [`docs/architecture/v1-core-contracts.md`](docs/architecture/v1-core-contracts.md)。该清单只在对应阶段已有运行实现与测试证据后勾选。

23 章目标与实现、数据边界、测试证据的逐项对应见 [`docs/acceptance/v1.0.md`](docs/acceptance/v1.0.md)。

Agent 的持久化状态、七个工具和逐项确认边界见 [`docs/architecture/v1-agent-runtime.md`](docs/architecture/v1-agent-runtime.md)。

知识图谱节点/关系、Evidence Card 原文不可变边界和人工复核规则见 [`docs/architecture/v1-knowledge-graph.md`](docs/architecture/v1-knowledge-graph.md)。Phase 4 已通过 3 项知识图谱服务测试、40 项研究库迁移/持久化测试和生产构建；图谱及证据卡已进入主导航，不是仅存在于数据库中的静态能力。

Phase 5 已把 Paper Intelligence Panel 扩为核心贡献、方法、实验、优点、局限、我的观点和相关论文线索；Figure Explorer 会从 MinerU 原始 Markdown 自动索引 Figure、Table、Algorithm，并用版面锚点跳回 PDF。Light/Dark Theme 作为本机设置加密配置旁的独立 UI 选项持久化，最低辅助字号门禁为 13px。相关 10 项定向测试与生产构建通过；完整桌面视觉回归仍在 Phase 8 总门禁执行。

Phase 6 继续复用同一个 Citation Database：引用检查器可切换 GB/T 7714—2015、APA 7th、IEEE、BibTeX；Word 仍是主路线，LaTeX 高级路线会导出 `source.md`、`main.tex`、`references.bib`，检测到 Tectonic 时再生成 PDF，缺少编译器时明确交付可编辑包而不假装成功。设置页新增六个可安装/卸载的可信内置插件，能力调用同时经过安装状态与 capability 门。接口说明见 [`plugins/README.md`](plugins/README.md) 和 [`docs/architecture/v1-writing-and-plugins.md`](docs/architecture/v1-writing-and-plugins.md)。

Phase 7 在所有旧 schema 原位升级前创建以“旧版本、目标版本、数据库哈希”命名的幂等快照；升级完成必须通过目标版本、SQLite `quick_check` 与 `foreign_key_check` 才更新研究库清单。设置页显示快照校验状态；带路径边界、占用检查、SHA-256 和二次救援副本的 PowerShell 回滚流程见 [`docs/migration/v1-rollback.md`](docs/migration/v1-rollback.md)。v1–v17 → v18 迁移和重复打开均已进入 43 项迁移/研究库测试。

Phase 8 已完成 211 项测试、生产构建、生产依赖 0 漏洞审计和隔离 Electron smoke；桌面验收覆盖 1024×768、1600×900 真实窗口，以及 2K/4K Chromium 精确 CSS 尺寸，均无全局横向溢出。v1.0.0 安装版与便携版已生成；安装版完成全新安装、内置 Argos/回滚资源核对、安装目录成品 smoke、正常退出与卸载，应用目录、进程、卸载项和快捷方式均无残留。

## 1.0.0 更新

- Research Vault v2、schema v18、升级前哈希快照与显式回滚流程。
- 多供应商 LLM Provider、普通用户 AI 接入向导、持久化 Agent Memory/Planner/Tools。
- 类型化科研知识图谱、Evidence Card、Paper Intelligence 与 Figure Explorer。
- 统一引用数据库、Word 主路线、LaTeX/PDF 高级路线和六个可信内置插件。
- Today Research Dashboard、Light/Dark Theme，以及从 1024×768 到 4K 的桌面布局验收。

## 0.3.1 更新

2026-08-09 发布的 0.3.1 修复真实长论文阅读链路、本地翻译模型权限和全局可读性：版面对照重构为可拖动、可单侧专注的“证据双页台”，目录默认收起；中英对照按当前版本化整理稿顺序翻译；Argos/Stanza 权限异常会自动修复。课题驾驶舱和复盘写作的空状态也已重新排版，不再用固定高度制造大块留白或长短不一的空框。173 项测试、生产构建、生产依赖审计和全程 110% 大字的 1024×768/1600×900 隔离桌面验收均已通过。

## 下载与安装

请前往 [GitHub Releases](https://github.com/1dlbbbdbd1/he-research-reader/releases/latest) 下载 Windows x64 版本。不知道选哪个时，长期使用请选择**安装版**；只是临时试用或没有安装权限，再选择**便携版**。

| 下载文件 | 适合谁 | 安装与本地翻译 |
| --- | --- | --- |
| `HsResearchAssistant-Setup-1.0.0-x64.exe` | **推荐**：日常长期使用 | 可选择安装位置，创建桌面和开始菜单快捷方式，并提供卸载程序。安装包内含可选的 Argos 英文 → 中文本地翻译组件；组件安装后约占 1 GB。 |
| `HsResearchAssistant-Portable-1.0.0-x64.exe` | 临时试用，或没有软件安装权限 | 无需安装，双击即可运行；不创建快捷方式和卸载入口。未内置 Argos，本地翻译首次安装时需要联网下载运行时和语言模型。 |
| `SHA256SUMS.txt` | 需要核对下载完整性 | 保存两个程序文件的 SHA-256 校验值。 |

> **便携版只是“免安装”，不是“所有数据都跟着 exe 走”。** 两个版本都会把软件设置、最近打开记录、本地组件和加密后的 API Key 保存在当前 Windows 用户的 AppData 中；研究库则始终保存在创建时由你选择的文件夹。把便携版复制到另一台电脑时，这些 AppData 数据不会自动随行。卸载安装版或删除便携版 exe 都不会删除研究库。

当前两个版本都不会自动更新，需要从 Release 页面手动下载新版。升级前建议备份整个研究库目录。

当前安装包尚未进行商业代码签名，Windows 首次运行时可能显示 SmartScreen 提示。请只从本仓库的正式 Release 页面下载。

## 主要功能

- **今日科研**：恢复上次阅读位置、当前实验、阻塞问题和下一步工作。
- **统一研究任务**：集中管理收件箱、今日、等待、以后、完成、放弃和推迟任务，并能返回任务来源。
- **文献与题录**：导入 PDF、常用办公文档，以及 RIS、BibTeX、EndNote XML 题录；支持 GB/T 7714—2015 引用复制。
- **证据化阅读**：保留原 PDF、MinerU 原始 Markdown 和可重建结构化阅读稿，支持批注、页码回跳、版本与恢复。
- **中英对照**：支持本地 Argos 翻译和用户主动配置的云端 AI 翻译；云端发送前会显示范围、服务商、模型和字符数。
- **科研过程管理**：记录课题、里程碑、Run、原始产物、研究报告和论文论断，不用虚假的百分比代替真实进度。
- **复盘与导出**：生成带来源区分的复查文档、周报和阶段复盘，并导出 Markdown 或 Word。
- **受控科研 Agent**：AI 可以检索、整理和提出行动建议；正式记录和行动仍需要你确认。

## 第一次使用

1. 启动应用，创建一个新的研究库，或打开已有研究库。
2. 在首次设置中填写你的 OpenAI 兼容服务地址、模型名称和 API 密钥。
3. 导入论文或题录，从“资料库”进入阅读。
4. 使用“今日科研”记录下一步、问题和当前现场，之后重新打开软件即可继续。

建议定期备份你选择的整个研究库目录。研究库内包含 SQLite 数据库、论文副本、解析产物和导出文件。

## 本地与隐私边界

- 正式研究记录保存在你选择的本地研究库中。
- API 密钥由 Electron 使用系统能力加密保存，不写入研究库、导出文件或源码。
- 只有在你主动触发 AI 或确认云端翻译时，相关文本才会发送到你配置的服务商。
- 本地 Argos 翻译不上传论文内容，也不消耗 API Token。
- 软件登记实验文件或目录时只保存路径、元数据和校验值，不会擅自移动或删除原始研究数据。
- Zotero 兼容目前通过 RIS、BibTeX、EndNote XML 和显式元数据适配完成，不会直接修改 Zotero 数据库。

## 0.3.1 更新摘要

- 修复本地 Argos/Stanza 模型文件权限错误。
- 新增可拖动、可单侧专注的版面对照“证据双页台”。
- 中英对照按当前整理稿顺序翻译，长文可持续滚动并支持异常恢复。
- 全局采用最小 13px 语义字号，110% 大字模式不再挤压标题和表单。
- 空里程碑、空正式记录和报告生成区改为内容收敛布局，不再出现大面积空框。

完整版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 问题反馈

- 推荐：在 [GitHub Issues](https://github.com/1dlbbbdbd1/he-research-reader/issues/new/choose) 提交问题，便于附上版本、截图和复现步骤。
- 邮件：`hzh1144@163.com`

反馈前请移除论文原文、API 密钥、私人路径和其他敏感信息。

## 当前限制

- 目前只提供 Windows x64 版本。
- 安装包未代码签名，可能触发 SmartScreen。
- PDF.js、React Markdown 与 KaTeX 仍使阅读主包较大，后续会继续按阅读模式拆分加载。
- AI 输出可能出错；重要结论应回到原文、页码、实验记录和原始产物核对。
