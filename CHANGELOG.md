# 版本记录

本文件只记录已经形成可安装或可携带交付物的里程碑版本。开发中的普通提交不单独发布 Release。

## 0.1.0

- 建立 Electron Windows 桌面客户端、研究库与 SQLite 数据底座。
- 支持 PDF 阅读、文字层、批注锚点、阅读状态和本地精确检索。
- 支持 EndNote XML、RIS、BibTeX 导入与旧数据幂等迁移。
- 接入本地 MinerU 解析和 Argos 英译中。
- 支持多文献复查、引用回跳、Markdown/Word 导出。
- 提供 x64 Windows 安装版和免安装便携版。

已知限制：

- Windows 产物尚未代码签名，首次运行可能出现 SmartScreen 提示。
- PDF.js 主包仍有体积警告，后续需要继续拆分加载。
- MinerU 图片、布局与完整产物目录的版本化仍待接入。
