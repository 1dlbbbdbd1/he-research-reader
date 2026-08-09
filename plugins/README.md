# H’s 科研助手插件接口 v1

每个内置插件位于 `plugins/<id>/plugin.json`。当前版本只加载随正式应用发布的 `trust: built-in` manifest，不动态执行用户下载的 JavaScript；这样可以提供安装/卸载生命周期，又不会把研究库、API Key 或本地文件暴露给未经审计的代码。

manifest 必须声明：`id`、`name`、`version`、`category`、`interfaceVersion: 1`、`trust: built-in`、`adapter`、`capabilities`、`permissions` 和 `defaultInstalled`。

安装表示在本机状态文件中启用可信适配器；卸载表示禁用。删除状态文件会恢复 manifest 的默认安装集合。所有能力调用前必须同时检查“已安装”和 capability；权限只能来自 v1 白名单。

第三方插件包、脚本入口、远程代码下载和任意 Node 执行不属于 v1 接口。未来若开放第三方插件，必须先增加签名、权限授权、沙箱和升级/回滚协议，不能复用当前内置插件信任标记绕过审核。
