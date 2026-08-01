[CmdletBinding()]
param(
    [switch]$AllowDirty,
    [switch]$SkipTests,
    [switch]$SkipBuild,
    [switch]$SkipTagAvailability
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter()]
        [string[]]$ArgumentList = @()
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath 执行失败，退出码：$LASTEXITCODE"
    }
}

Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.git')) {
        throw '当前目录不是 Git 仓库。'
    }

    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
        throw "发布必须从 main 分支执行；当前分支：$branch"
    }

    $remoteUrl = (& git remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0 -or $remoteUrl -notmatch 'github\.com[/:]1dlbbbdbd1/he-research-reader(?:\.git)?$') {
        throw "origin 不是预期仓库：$remoteUrl"
    }

    $dirtyPaths = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw '无法读取 Git 工作树状态。'
    }
    if ($dirtyPaths.Count -gt 0 -and -not $AllowDirty) {
        throw "工作树不干净，共 $($dirtyPaths.Count) 项变化。先确认并提交本次版本范围，再执行发布预检。"
    }
    if ($dirtyPaths.Count -gt 0) {
        Write-Warning "当前使用 -AllowDirty，仅验证工具链；这不代表可以发布。"
    }

    $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -notmatch '^\d+\.\d+\.\d+$') {
        throw "package.json 版本不是三段式版本号：$version"
    }
    $tag = "v$version"

    $changelog = Get-Content -LiteralPath 'CHANGELOG.md' -Raw -Encoding UTF8
    if ($changelog -notmatch "(?m)^##\s+$([regex]::Escape($version))\s*$") {
        throw "CHANGELOG.md 没有版本 $version 的独立标题。"
    }

    if (-not $SkipTagAvailability) {
        $existingTag = ((@(& git tag --list $tag)) -join "`n").Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "无法检查本地标签 $tag。"
        }
        if ($existingTag) {
            throw "标签 $tag 已存在。请先更新 package.json 和 CHANGELOG.md 到新的补丁版本。"
        }
    }

    $trackedPaths = @(& git ls-files)
    if ($LASTEXITCODE -ne 0) {
        throw '无法读取 Git 跟踪文件。'
    }
    $forbiddenPaths = @($trackedPaths | Where-Object {
        $_ -match '(^|/)(node_modules|dist|release|release-[^/]+|\.runtime|\.tools|\.npm-cache)/' -or
        $_ -match '(^|/)\.env($|\.)' -or
        $_ -match '(^|/)config\.local\.'
    })
    if ($forbiddenPaths.Count -gt 0) {
        throw "发现不应进入 Git 的路径：$($forbiddenPaths -join ', ')"
    }

    $secretMatches = @(& git grep -I -l -E 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' -- 2>$null)
    $grepExitCode = $LASTEXITCODE
    if ($grepExitCode -gt 1) {
        throw "凭据扫描执行失败，退出码：$grepExitCode"
    }
    if ($secretMatches.Count -gt 0) {
        throw "发现疑似 GitHub token，文件：$($secretMatches -join ', ')"
    }

    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path 'scripts\build-windows.ps1'),
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    if ($parseErrors.Count -gt 0) {
        throw "Windows 打包脚本语法错误：$($parseErrors[0].Message)"
    }

    $workflow = Get-Content -LiteralPath '.github\workflows\release-windows.yml' -Raw -Encoding UTF8
    if ($workflow -notmatch '(?m)^\s*workflow_dispatch:\s*$') {
        throw '发布工作流缺少打标签前的手动试跑入口。'
    }
    if ($workflow -notmatch "startsWith\(github\.ref,\s*'refs/tags/v'\)") {
        throw '发布工作流没有把真正发布限制在版本标签。'
    }

    $electronExecutable = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path -LiteralPath $electronExecutable)) {
        throw '本地 Electron 运行时缺失；先执行 npm install。'
    }

    if (-not $SkipTests) {
        Invoke-Checked -FilePath 'npm.cmd' -ArgumentList @('test')
    }
    if (-not $SkipBuild) {
        Invoke-Checked -FilePath 'npm.cmd' -ArgumentList @('run', 'build')
    }

    Write-Host ''
    Write-Host "本地发布预检通过：$tag" -ForegroundColor Green
    Write-Host '下一步不能直接推标签：先提交并推送 main，再手动运行 Release Windows，远端试跑成功后才推标签。'
}
finally {
    Pop-Location
}
