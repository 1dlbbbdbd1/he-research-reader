[CmdletBinding()]
param(
    [ValidateSet('Pack', 'Dist')]
    [string]$Target = 'Dist',

    [string]$OutputDirectory = 'release'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime'
$builderCache = Join-Path $runtimeRoot 'electron-builder-cache'
$npmCache = Join-Path $runtimeRoot 'npm-cache'
$builderExecutable = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'
$cleanupScript = Join-Path $PSScriptRoot 'cleanup-release-directories.ps1'
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot)
$resolvedOutputDirectory = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
}
else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
}
$projectPrefix = $resolvedProjectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutputDirectory.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '构建输出目录必须位于项目目录内部。'
}
$outputOption = "--config.directories.output=$resolvedOutputDirectory"

New-Item -ItemType Directory -Force -Path $builderCache, $npmCache | Out-Null

$env:ELECTRON_BUILDER_CACHE = $builderCache
$env:npm_config_cache = $npmCache
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Push-Location $projectRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "前端构建失败，退出码：$LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $builderExecutable)) {
        throw '没有找到项目内 electron-builder，请先在项目目录执行 npm install。'
    }

    if ($Target -eq 'Pack') {
        & $builderExecutable --win dir --x64 --publish never $outputOption
    }
    else {
        & $builderExecutable --win nsis portable --x64 --publish never $outputOption
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Windows 桌面版打包失败，退出码：$LASTEXITCODE"
    }

    & $cleanupScript -ProjectRoot $projectRoot -Keep 3
}
finally {
    Pop-Location
}
