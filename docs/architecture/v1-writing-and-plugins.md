# v1 写作、引用与插件边界

## 单一 Citation Database

题录仍以 `bibliographic_items` 为唯一正式数据源，不为每种引用格式复制一份元数据。主进程 `CitationFormatter` 接受同一题录并输出：

- GB/T 7714—2015；
- APA 7th；
- IEEE；
- BibTeX。

每个格式都返回 `missingFields` 与 `incomplete`，缺失作者、出版项或年份时降级输出，不补造字段。独立引用没有真实顺序时不生成 `[1]`；IEEE/GB/T 只有调用者提供正式序号时才加序号。

## 写作路线

Word 是普通用户主路线：复查文档继续生成真实 `.docx`，包含来源区块、可回跳证据链接和统一参考文献。

LaTeX 是可选高级路线：

```text
review document
  -> source.md
  -> main.tex + references.bib
  -> main.pdf (only when Tectonic is available and compilation succeeds)
```

导出目录带时间戳，不覆盖旧导出。`export-manifest.json` 记录文件、来源方向和编译结果。没有 Tectonic 时保留三份可编辑源文件，并明确返回未编译原因。

## 插件接口 v1

插件目录固定为：

```text
plugins/
  zotero/
  arxiv/
  github/
  latex/
  translation/
  llm/
```

`plugin.json` 声明接口版本、可信级别、适配器、capability 与权限。v1 只接受 `trust: built-in`，不会动态 `require` 下载脚本。安装/卸载仅改变本机启用状态；LLM、翻译、Zotero 与 LaTeX IPC 在执行前检查插件已安装且声明对应 capability。

这一边界故意不声称已经支持任意第三方插件。第三方包未来必须另行设计签名、沙箱、显式权限、升级和回滚，不能借用 `built-in` 绕过审核。

## 验证

- 引用格式化：10 项测试；
- 插件 manifest、安装/卸载、能力门：3 项测试；
- Markdown/LaTeX/PDF 降级链：3 项测试；
- 研究库 Word、LaTeX 包与统一引用集成：包含在 40 项研究库测试中；
- TypeScript 与 Vite 生产构建通过。
