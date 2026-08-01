[CmdletBinding()]
param(
    [string]$RuntimeRoot,
    [ValidateSet('BAAI/bge-small-zh-v1.5')]
    [string]$Model = 'BAAI/bge-small-zh-v1.5'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $RuntimeRoot = Join-Path $projectRoot '.runtime\embedding'
}

$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
$toolsRoot = Join-Path $RuntimeRoot 'tools'
$pythonRoot = Join-Path $RuntimeRoot 'python'
$cacheRoot = Join-Path $RuntimeRoot 'cache'
$modelRoot = Join-Path $RuntimeRoot 'models'
$environmentRoot = Join-Path $RuntimeRoot 'fastembed\.venv'
$manifestPath = Join-Path $RuntimeRoot 'embedding-manifest.json'
$uvExecutable = Join-Path $toolsRoot 'uv.exe'
$pythonExecutable = Join-Path $environmentRoot 'Scripts\python.exe'
$bridgeScript = Join-Path $PSScriptRoot 'embedding-bridge.py'
$runtimeParent = Split-Path -Parent $RuntimeRoot

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $toolsRoot, $pythonRoot, $cacheRoot, $modelRoot | Out-Null
if (-not (Test-Path -LiteralPath $bridgeScript)) {
    throw "安装包中缺少语义检索桥接脚本：$bridgeScript"
}

$sharedUvCandidates = @(
    $uvExecutable
    (Join-Path $runtimeParent 'tools\uv.exe')
    (Join-Path $runtimeParent 'translation-runtime\tools\uv.exe')
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
    Write-Host '正在创建 FastEmbed 独立环境…'
    & $uvExecutable venv --python 3.12 $environmentRoot
}

Write-Host '正在安装 FastEmbed 0.8.0（Apache-2.0）…'
& $uvExecutable pip install --python $pythonExecutable --upgrade 'fastembed==0.8.0'

$env:FASTEMBED_CACHE_PATH = $modelRoot
$env:READER_EMBEDDING_MANIFEST = $manifestPath
$env:HF_HOME = Join-Path $cacheRoot 'huggingface'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

Write-Host "正在下载并核验本地嵌入模型 $Model（MIT）…"
& $pythonExecutable $bridgeScript prepare --model $Model
if ($LASTEXITCODE -ne 0) {
    throw "本地语义模型准备失败，退出码：$LASTEXITCODE"
}

Write-Host "本地语义检索组件已就绪：$Model"
