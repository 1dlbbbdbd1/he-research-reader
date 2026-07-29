[CmdletBinding()]
param(
    [string]$RuntimeRoot,
    [ValidatePattern('^[a-z]{2,3}$')]
    [string]$FromCode = 'en',
    [ValidatePattern('^[a-z]{2,3}$')]
    [string]$ToCode = 'zh'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $RuntimeRoot = Join-Path $projectRoot '.runtime\translation'
}

$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
$toolsRoot = Join-Path $RuntimeRoot 'tools'
$pythonRoot = Join-Path $RuntimeRoot 'python'
$cacheRoot = Join-Path $RuntimeRoot 'cache'
$profileRoot = Join-Path $RuntimeRoot 'profile'
$packagesRoot = Join-Path $RuntimeRoot 'packages'
$dataRoot = Join-Path $RuntimeRoot 'data'
$configRoot = Join-Path $RuntimeRoot 'config'
$environmentRoot = Join-Path $RuntimeRoot 'argos\.venv'
$uvExecutable = Join-Path $toolsRoot 'uv.exe'
$pythonExecutable = Join-Path $environmentRoot 'Scripts\python.exe'
$bridgeScript = Join-Path $PSScriptRoot 'argos-bridge.py'
$runtimeParent = Split-Path -Parent $RuntimeRoot

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $toolsRoot, $pythonRoot, $cacheRoot, $profileRoot, $packagesRoot, $dataRoot, $configRoot | Out-Null

if (-not (Test-Path -LiteralPath $bridgeScript)) {
    throw "安装包中缺少 Argos 桥接脚本：$bridgeScript"
}

$sharedUvCandidates = @(
    $uvExecutable
    (Join-Path $runtimeParent 'tools\uv.exe')
    (Join-Path $runtimeParent 'mineru-runtime\tools\uv.exe')
)
$sharedUv = $sharedUvCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($sharedUv) {
    $uvExecutable = [System.IO.Path]::GetFullPath($sharedUv)
    Write-Host "正在复用已有 uv 工具：$uvExecutable"
}

if (-not (Test-Path -LiteralPath $uvExecutable)) {
    Write-Host '正在安装项目专用 uv 工具…'
    $env:UV_UNMANAGED_INSTALL = $toolsRoot
    $env:UV_NO_MODIFY_PATH = '1'
    $installer = Invoke-RestMethod 'https://astral.sh/uv/0.11.32/install.ps1'
    Invoke-Expression $installer
}

$env:UV_PYTHON_INSTALL_DIR = $pythonRoot
$env:UV_CACHE_DIR = $cacheRoot
$env:UV_PYTHON_INSTALL_REGISTRY = '0'
$env:UV_NO_MODIFY_PATH = '1'

Write-Host '正在准备独立 Python 3.12 运行时…'
& $uvExecutable python install 3.12 --install-dir $pythonRoot --no-bin --no-registry

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    Write-Host '正在创建 Argos Translate 独立环境…'
    & $uvExecutable venv --python 3.12 $environmentRoot
}

Write-Host '正在安装 Argos Translate 1.11.0…'
& $uvExecutable pip install --python $pythonExecutable --upgrade 'argostranslate==1.11.0'

$env:ARGOS_PACKAGES_DIR = $packagesRoot
$env:XDG_DATA_HOME = $dataRoot
$env:XDG_CONFIG_HOME = $configRoot
$env:XDG_CACHE_HOME = $cacheRoot
$env:LOCALAPPDATA = Join-Path $profileRoot 'LocalAppData'
$env:APPDATA = Join-Path $profileRoot 'AppData'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA, $env:APPDATA | Out-Null

Write-Host "正在从 Argos 官方索引安装 $FromCode → $ToCode 本地语言模型…"
& $pythonExecutable $bridgeScript install --from-code $FromCode --to-code $ToCode
if ($LASTEXITCODE -ne 0) {
    throw "Argos Translate 语言模型安装失败，退出码：$LASTEXITCODE"
}

Write-Host "本地翻译已就绪：$FromCode → $ToCode"
