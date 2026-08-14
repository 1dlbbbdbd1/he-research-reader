param([Parameter(Mandatory=$true)][string]$PayloadBase64)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json
function FullPath([object]$Value) { [IO.Path]::GetFullPath([string]$Value) }
function Sha256([string]$FilePath) { (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant() }
function Release-Com([object]$Value) { if ($Value) { try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) | Out-Null } catch {} } }

$docxPath = FullPath $payload.docxPath
$pdfPath = FullPath $payload.pdfPath
if ([IO.Path]::GetExtension($docxPath).ToLowerInvariant() -ne '.docx') { throw 'Translation Word output must use .docx.' }
if ([IO.Path]::GetExtension($pdfPath).ToLowerInvariant() -ne '.pdf') { throw 'Translation PDF output must use .pdf.' }
if ((Test-Path -LiteralPath $docxPath) -or (Test-Path -LiteralPath $pdfPath)) { throw 'Translation output already exists.' }
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($docxPath)) -Force | Out-Null
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($pdfPath)) -Force | Out-Null
$app = $null
$document = $null
try {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $app.DisplayAlerts = 0
  try { $app.AutomationSecurity = 3 } catch {}
  $document = $app.Documents.Add()
  $normal = $document.Styles.Item(-1)
  try {
    $normal.Font.Name = 'Times New Roman'
    $normal.Font.NameFarEast = '宋体'
    $normal.Font.Size = 11
    $normal.ParagraphFormat.LineSpacingRule = 1
    $normal.ParagraphFormat.SpaceAfter = 6
  } finally { Release-Com $normal }

  $inFence = $false
  foreach ($line in ([string]$payload.content -replace "`r`n?", "`n" -split "`n")) {
    if ($line -match '^```') { $inFence = -not $inFence; continue }
    $range = $document.Content
    try {
      $range.Collapse(0)
      $clean = $line
      $style = $null
      if (-not $inFence -and $line -match '^(#{1,3})\s+(.+)$') {
        $level = $matches[1].Length
        $clean = $matches[2]
        $style = -1 - $level
      } elseif (-not $inFence -and $line -match '^>\s?(.*)$') {
        $clean = $matches[1]
      } elseif (-not $inFence -and $line -match '^[-*]\s+(.+)$') {
        $clean = "• $($matches[1])"
      }
      $range.InsertAfter(($clean -replace '\*\*|__|`', '') + "`r")
      if ($style) {
        $paragraph = $document.Paragraphs.Item($document.Paragraphs.Count)
        try { $paragraph.Range.Style = $style } finally { Release-Com $paragraph }
      }
    } finally { Release-Com $range }
  }
  foreach ($section in @($document.Sections)) {
    try {
      $section.PageSetup.TopMargin = 72
      $section.PageSetup.BottomMargin = 72
      $section.PageSetup.LeftMargin = 78
      $section.PageSetup.RightMargin = 78
      $footer = $section.Footers.Item(1)
      try { if ($footer.PageNumbers.Count -eq 0) { $footer.PageNumbers.Add(2, $true) | Out-Null } } finally { Release-Com $footer }
    } finally { Release-Com $section }
  }
  $document.Repaginate()
  $pageCount = [int]$document.ComputeStatistics(2)
  $paragraphCount = [int]$document.Paragraphs.Count
  if ($pageCount -lt 1 -or $paragraphCount -lt 1) { throw 'Translation document has no renderable pages.' }
  $document.SaveAs2($docxPath, 16)
  $document.ExportAsFixedFormat($pdfPath, 17, $false, 0, 0, 1, $pageCount, 0, $true, $true, 1, $true, $true, $false)
  $document.Close($false)
  Release-Com $document
  $document = $null
  if (-not (Test-Path -LiteralPath $docxPath -PathType Leaf) -or -not (Test-Path -LiteralPath $pdfPath -PathType Leaf)) { throw 'Word did not create both translation outputs.' }
  $pdfBytes = [IO.File]::ReadAllBytes($pdfPath)
  if ($pdfBytes.Length -lt 1000 -or [Text.Encoding]::ASCII.GetString($pdfBytes, 0, [Math]::Min(5, $pdfBytes.Length)) -ne '%PDF-') { throw 'Rendered translation PDF is invalid.' }
  [pscustomobject]@{
    docxPath = $docxPath
    docxSha256 = Sha256 $docxPath
    pdfPath = $pdfPath
    pdfSha256 = Sha256 $pdfPath
    pdfByteLength = $pdfBytes.Length
    pageCount = $pageCount
    paragraphCount = $paragraphCount
    renderedBy = 'Microsoft Word ExportAsFixedFormat'
    repaginated = $true
    passed = $true
    anomalies = @()
  } | ConvertTo-Json -Depth 6 -Compress
} finally {
  if ($document) { try { $document.Close($false) } catch {}; Release-Com $document }
  if ($app) { try { $app.Quit() } catch {}; Release-Com $app }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
