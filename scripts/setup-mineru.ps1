[CmdletBinding()]
param(
    [string]$RuntimeRoot
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $RuntimeRoot = Join-Path $projectRoot '.runtime'
}
$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
$toolsRoot = Join-Path $runtimeRoot 'tools'
$pythonRoot = Join-Path $runtimeRoot 'python'
$cacheRoot = Join-Path $runtimeRoot 'cache'
$modelRoot = Join-Path $runtimeRoot 'models'
$environmentRoot = Join-Path $runtimeRoot 'mineru\.venv'
$uvExecutable = Join-Path $toolsRoot 'uv.exe'
$mineruExecutable = Join-Path $environmentRoot 'Scripts\mineru.exe'

New-Item -ItemType Directory -Force -Path $runtimeRoot, $toolsRoot, $pythonRoot, $cacheRoot, $modelRoot | Out-Null

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
$env:HF_HOME = Join-Path $modelRoot 'huggingface'
$env:MODELSCOPE_CACHE = Join-Path $modelRoot 'modelscope'
$env:MODELSCOPE_HOME = Join-Path $modelRoot 'modelscope-sdk'
$env:MINERU_TOOLS_CONFIG_JSON = Join-Path $runtimeRoot 'mineru.json'

Write-Host '正在准备独立 Python 3.12 运行时…'
& $uvExecutable python install 3.12 --install-dir $pythonRoot --no-bin --no-registry

if (-not (Test-Path -LiteralPath (Join-Path $environmentRoot 'Scripts\python.exe'))) {
    Write-Host '正在创建 MinerU 独立环境…'
    & $uvExecutable venv --python 3.12 $environmentRoot
}

Write-Host '正在安装 MinerU pipeline 本地解析组件…'
# MinerU 3.4.4 的 pipeline OCR 路径会导入 six，但当前 extra 未声明该依赖。
& $uvExecutable pip install --python (Join-Path $environmentRoot 'Scripts\python.exe') --upgrade 'mineru[pipeline]' 'six>=1.17,<2'

if (-not (Test-Path -LiteralPath $mineruExecutable)) {
    throw "MinerU 安装结束，但没有找到可执行文件：$mineruExecutable"
}

Write-Host '正在验证 MinerU…'
& $mineruExecutable --version
Write-Host "本地 MinerU 已就绪：$mineruExecutable"
