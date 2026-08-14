param([Parameter(Mandatory=$true)][string]$PayloadBase64)
$ErrorActionPreference = 'Stop'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json
$source = [IO.Path]::GetFullPath([string]$payload.source)
$output = [IO.Path]::GetFullPath([string]$payload.output)
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Office source file does not exist.' }
if (Test-Path -LiteralPath $output) { throw 'Office output already exists.' }
$parent = [IO.Path]::GetDirectoryName($output)
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$app = $null
$document = $null
try {
  switch ([string]$payload.application) {
    'word' { $app = New-Object -ComObject Word.Application; $document = $app.Documents.Open($source, $false, $true); $document.SaveAs2($output) }
    'excel' { $app = New-Object -ComObject Excel.Application; $document = $app.Workbooks.Open($source, 0, $true); $document.SaveAs($output) }
    'powerpoint' { $app = New-Object -ComObject PowerPoint.Application; $document = $app.Presentations.Open($source, $true, $false, $false); $document.SaveCopyAs($output) }
    default { throw 'Unsupported Office application.' }
  }
  [pscustomobject]@{ path = $output; created = (Test-Path -LiteralPath $output) } | ConvertTo-Json -Compress
} finally {
  if ($document) { try { $document.Close() } catch {} ; [Runtime.InteropServices.Marshal]::ReleaseComObject($document) | Out-Null }
  if ($app) { try { $app.Quit() } catch {} ; [Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
