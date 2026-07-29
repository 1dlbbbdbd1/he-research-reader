# 稳定发布清单

目标：把“本地开发完成”和“远端正式发布”分成两个关卡。任何版本都先在 GitHub 的干净 Windows 环境试跑成功，再创建版本标签。这样标签不会成为第一次发现环境问题的地方。

## 一、先分清两类失败

- **推送失败**：Git 仓库、远端地址、作者身份、认证或工作树范围有问题。源码通常还没有到 GitHub。
- **自动发布失败**：源码和标签已经到 GitHub，但测试、Electron 运行时、Windows 打包或 Release 上传失败。

GitHub 的失败邮件只对应某一次运行。修复后的新运行成功，不会撤回旧邮件；判断当前状态必须看最新运行和 Release 页面。

## 二、固定发布顺序

1. 完成功能并确认哪些文件属于本次版本，不把并行开发中的文件混进提交。
2. 更新 `package.json` 版本、`CHANGELOG.md` 和 README 当前进度。
3. 执行本地预检：

   ```powershell
   pwsh -NoLogo -NoProfile -File scripts/release-preflight.ps1
   ```

4. 只提交已确认范围，推送 `main`，确认远端提交和本地提交一致。
5. 在 GitHub 手动运行一次 `Release Windows`，目标选择 `main`。这次只测试、打包和生成校验文件，不发布 Release。
6. 等待上述远端试跑成功。失败时只修复 `main`，不要创建或移动版本标签。
7. 远端试跑成功后，才创建与 `package.json` 一致的标签并推送：

   ```powershell
   git tag -a v0.2.0 -m 'release: v0.2.0'
   git push origin v0.2.0
   ```

8. 等待标签工作流成功，最后核对 Release 中恰好包含安装版、便携版和 `SHA256SUMS.txt`。

## 三、硬性规则

- 不在第一次远端打包前推版本标签。
- 不对混杂工作树执行 `git add -A`。
- 不把 token 写进命令历史、远端 URL、Git 配置或仓库文件。
- 不因为本机构建成功就宣称远端构建成功。
- 不强制移动已经推送的发布标签；修复后使用新的补丁版本。
- 不把 `release*`、运行时、依赖、缓存和项目内工具提交到 Git。
- 失败后先读具体步骤日志，只修复有证据指向的问题。

## 四、当前项目已经消除的首轮问题

- 仓库、`main`、远端地址和仓库级 `noreply` 作者身份已经建立。
- 项目内 GitHub CLI 已隔离并被 `.gitignore` 排除。
- Windows 工作流会显式补齐 Electron 运行时。
- electron-builder 已禁止根据标签隐式发布，Release 只由工作流最后一步创建。
- `workflow_dispatch` 可在打标签前完成远端干净环境试跑。
