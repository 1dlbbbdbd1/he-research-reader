# H’s 科研助手 1.0.0

H’s 科研助手 1.0 是面向个人研究者的本地优先 AI Native Research OS。它把论文、证据、实验、任务、Agent 记忆、知识关系与科研写作放进同一个可迁移 Research Vault。

## 本版亮点

- **Research Vault v2**：研究数据保存在用户选择的目录；原文件与 MinerU 原始 Markdown 不覆盖，用户可读投影可重建。
- **长期 Research Agent**：持久化 Memory、Planner 和七个工具；只读步骤可运行，写入研究库必须逐项确认。
- **Evidence First**：Evidence Card、类型化知识图谱和论文论断均保留来源；AI 建议在人工确认前不是正式记录。
- **科研阅读升级**：Paper Intelligence Panel、Figure/Table/Algorithm Explorer、结构化稿、版面对照与中英对照均可回到 PDF。
- **实验与任务闭环**：里程碑、Run、环境、参数、数据、结果、产物、结论和研究任务可以互相关联并回到来源。
- **写作与引用**：同一题录输出 GB/T 7714—2015、APA 7、IEEE、BibTeX；支持 Word，以及可选的 Markdown → LaTeX → PDF 高级路线。
- **插件与主题**：六个可信内置插件可安装/卸载；支持 Light/Dark Theme。
- **安全迁移**：旧 schema 升级前自动保存 SHA-256 快照，迁移后校验 SQLite；仓库提供显式回滚脚本和说明。

## 下载

不知道选哪个时，长期使用请选择**安装版**；只是临时试用或没有安装权限，再选择**便携版**。

| 下载文件 | 适合谁 | 说明 |
| --- | --- | --- |
| `HsResearchAssistant-Setup-1.0.0-x64.exe` | **推荐**：日常长期使用 | 可选择安装位置，创建桌面和开始菜单快捷方式，并提供卸载程序；内含可选的本地英译中组件。 |
| `HsResearchAssistant-Portable-1.0.0-x64.exe` | 临时试用，或没有软件安装权限 | 无需安装；不创建快捷方式和卸载入口。本地翻译运行时可在应用内另行安装。 |
| `SHA256SUMS.txt` | 核对下载完整性 | 保存两个程序文件的 SHA-256 校验值。 |

> 便携版只是免安装。应用设置、最近打开记录、本地组件和加密后的 API Key 仍保存在当前 Windows 用户的 AppData；研究库始终位于用户选择的文件夹。卸载或删除程序不会删除研究库。

当前版本仅提供 Windows x64，尚未进行商业代码签名，首次运行可能出现 SmartScreen 提示。请只从本仓库的正式 Release 页面下载。
