[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VaultPath,
  [Parameter(Mandatory = $true)][string]$BackupId,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $Force) {
  throw '恢复会替换当前 library.sqlite。确认已退出小何的科研助手后，用 -Force 再执行一次。'
}
if ($BackupId -notmatch '^v\d+-to-v\d+-[a-f0-9]{12}$') {
  throw 'BackupId 格式无效。'
}

$resolvedVault = (Resolve-Path -LiteralPath $VaultPath).Path
$backupRoot = Join-Path $resolvedVault '.reader-cache\migration-backups'
$backupDirectory = Join-Path $backupRoot $BackupId
$resolvedBackup = (Resolve-Path -LiteralPath $backupDirectory).Path
$backupPrefix = [IO.Path]::GetFullPath($backupRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not ($resolvedBackup + [IO.Path]::DirectorySeparatorChar).StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw '备份目录越出当前研究库，已停止。'
}

$metadataPath = Join-Path $resolvedBackup 'migration-backup.json'
$backupDatabase = Join-Path $resolvedBackup 'library.sqlite'
$backupVault = Join-Path $resolvedBackup 'vault.json'
$currentDatabase = Join-Path $resolvedVault 'library.sqlite'
$currentVault = Join-Path $resolvedVault 'vault.json'
foreach ($required in @($metadataPath, $backupDatabase, $backupVault, $currentDatabase, $currentVault)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "缺少恢复所需文件：$required" }
}

$metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupDatabase).Hash.ToLowerInvariant()
if ($actualHash -ne [string]$metadata.databaseSha256) { throw '备份数据库 SHA-256 校验失败，禁止恢复。' }

try {
  $lock = [IO.File]::Open($currentDatabase, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $lock.Dispose()
} catch {
  throw '当前数据库仍被占用。请完全退出小何的科研助手后重试。'
}

$rescueRoot = Join-Path $resolvedVault '.reader-cache\rollback-rescue'
$rescueDirectory = Join-Path $rescueRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $rescueDirectory -Force | Out-Null
Copy-Item -LiteralPath $currentDatabase -Destination (Join-Path $rescueDirectory 'library.sqlite')
Copy-Item -LiteralPath $currentVault -Destination (Join-Path $rescueDirectory 'vault.json')

$databaseTemporary = Join-Path $resolvedVault 'library.sqlite.restore.tmp'
$vaultTemporary = Join-Path $resolvedVault 'vault.json.restore.tmp'
Copy-Item -LiteralPath $backupDatabase -Destination $databaseTemporary
Copy-Item -LiteralPath $backupVault -Destination $vaultTemporary
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $databaseTemporary).Hash.ToLowerInvariant() -ne $actualHash) {
  Remove-Item -LiteralPath $databaseTemporary -Force
  Remove-Item -LiteralPath $vaultTemporary -Force
  throw '恢复临时文件校验失败，当前研究库未改变。'
}
Move-Item -LiteralPath $databaseTemporary -Destination $currentDatabase -Force
Move-Item -LiteralPath $vaultTemporary -Destination $currentVault -Force

Write-Host "已恢复 $BackupId。恢复前数据库保存在：$rescueDirectory"
