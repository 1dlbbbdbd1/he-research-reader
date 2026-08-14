[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateRange(1, 100)]
    [int]$Keep = 3,

    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$resolvedProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$releaseDirectories = @(
    Get-ChildItem -LiteralPath $resolvedProjectRoot -Directory |
        Where-Object { $_.Name -match '^release(?:-.+)?$' } |
        Sort-Object -Property @(
            @{ Expression = 'LastWriteTime'; Descending = $true },
            @{ Expression = 'Name'; Descending = $true }
        )
)

$keptDirectories = @($releaseDirectories | Select-Object -First $Keep)
$expiredDirectories = @($releaseDirectories | Select-Object -Skip $Keep)

foreach ($directory in $keptDirectories) {
    Write-Output "保留 release：$($directory.Name)"
}

foreach ($directory in $expiredDirectories) {
    $resolvedDirectory = [System.IO.Path]::GetFullPath($directory.FullName).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $resolvedDirectory)).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    if (
        -not $resolvedParent.Equals($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $directory.Name -notmatch '^release(?:-.+)?$'
    ) {
        throw "拒绝清理项目根目录之外或名称不合法的路径：$resolvedDirectory"
    }

    if ($PSCmdlet.ShouldProcess($resolvedDirectory, '删除过期本地打包目录')) {
        Remove-Item -LiteralPath $resolvedDirectory -Recurse -Force
        Write-Output "已删除 release：$($directory.Name)"
    }
}

