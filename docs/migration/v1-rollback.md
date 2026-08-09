# v1.0 研究库迁移与回滚

## 自动保护

打开旧 schema 研究库时，应用先读取 `PRAGMA user_version`。只有版本低于当前版本才创建：

```text
.reader-cache/migration-backups/
  v<旧版本>-to-v<新版本>-<数据库哈希前12位>/
    library.sqlite
    vault.json
    migration-backup.json
```

相同旧数据库重复打开会复用同一份哈希备份。迁移完成后必须通过目标版本、SQLite `quick_check` 和 `foreign_key_check`，然后才更新 `vault.json`。备份列表会重新计算 SHA-256；被改动的备份在设置页显示“校验失败”。

## 回滚步骤

回滚只用于迁移故障排查或返回旧版应用。当前 v1.0 再次打开旧 schema 时仍会重新执行迁移。

1. 完全退出 H’s 科研助手。
2. 在设置 → Research Vault 记录要恢复的 BackupId。
3. 先运行不带 `-Force` 的命令确认目标；脚本会主动拒绝。
4. 确认后执行：

```powershell
pwsh -NoLogo -NoProfile -File .\scripts\restore-migration-backup.ps1 `
  -VaultPath 'E:\你的研究库' `
  -BackupId 'v17-to-v18-0123456789ab' `
  -Force
```

脚本验证路径边界、BackupId、数据库 SHA-256 和文件占用。覆盖前会把当前 `library.sqlite` 与 `vault.json` 保存到 `.reader-cache/rollback-rescue/<时间>/`。它不会移动或删除 `papers/`、`notes/`、`experiments/` 等用户文件。

## 不支持的操作

- 不要在应用运行时手动替换 SQLite；
- 不要把另一个研究库的备份复制进来；
- 不要删除原论文或用户 Markdown 来“配合”回滚；
- 不要把 `vault.json` 的版本号手工改大以跳过迁移。
