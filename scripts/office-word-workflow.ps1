param(
  [Parameter(Mandatory=$true)][ValidateSet('inspect','format','qa')][string]$Operation,
  [Parameter(Mandatory=$true)][string]$PayloadBase64
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64)) | ConvertFrom-Json

function FullPath([object]$Value) { [IO.Path]::GetFullPath([string]$Value) }
function Sha256([string]$FilePath) { (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant() }
function Cm([double]$Value) { $Value * 28.3464567 }
function Read-Property([object]$Object, [string]$Name, [object]$Fallback) {
  if ($null -ne $Object -and $Object.PSObject.Properties.Name -contains $Name -and $null -ne $Object.$Name) { return $Object.$Name }
  return $Fallback
}
function Release-Com([object]$Value) { if ($Value) { try { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) | Out-Null } catch {} } }

$source = FullPath $payload.path
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Word source file does not exist.' }
if ([IO.Path]::GetExtension($source).ToLowerInvariant() -ne '.docx') { throw 'Word formatting currently accepts .docx files only.' }
$sourceHashBefore = Sha256 $source
$app = $null
$document = $null
$workingCopyPath = [IO.Path]::Combine([IO.Path]::GetTempPath(), "hs-word-$([guid]::NewGuid().ToString('N')).docx")
$workingCopyHash = $null

try {
  # Word never receives the user's original path. Every operation starts from an
  # exact temporary byte copy, so a COM quirk or add-in cannot mutate the source.
  Copy-Item -LiteralPath $source -Destination $workingCopyPath -Force
  $workingCopyHash = Sha256 $workingCopyPath
  if ($workingCopyHash -ne $sourceHashBefore) { throw 'Temporary Word working copy does not match the source.' }
  $app = New-Object -ComObject Word.Application
  $app.Visible = $false
  $app.DisplayAlerts = 0
  try { $app.AutomationSecurity = 3 } catch {}
  $document = $app.Documents.Open($workingCopyPath, $false, ($Operation -ne 'format'), $false, '', '', $true, '', '', 0, 0, $false, $true, 0, $true)

  if ($Operation -eq 'inspect') {
    $document.Repaginate()
    $headings = @()
    for ($index = 1; $index -le $document.Paragraphs.Count; $index++) {
      $paragraph = $document.Paragraphs.Item($index)
      try {
        $level = [int]$paragraph.OutlineLevel
        if ($level -ge 1 -and $level -le 9) {
          $headings += [pscustomobject]@{ paragraph = $index; level = $level; text = ([string]$paragraph.Range.Text).Trim() }
        }
      } finally { Release-Com $paragraph }
    }
    $sections = @()
    for ($index = 1; $index -le $document.Sections.Count; $index++) {
      $section = $document.Sections.Item($index)
      try {
        $setup = $section.PageSetup
        try {
          $sections += [pscustomobject]@{
            index = $index
            topMarginPt = [math]::Round([double]$setup.TopMargin, 2)
            bottomMarginPt = [math]::Round([double]$setup.BottomMargin, 2)
            leftMarginPt = [math]::Round([double]$setup.LeftMargin, 2)
            rightMarginPt = [math]::Round([double]$setup.RightMargin, 2)
            pageWidthPt = [math]::Round([double]$setup.PageWidth, 2)
            pageHeightPt = [math]::Round([double]$setup.PageHeight, 2)
          }
        } finally { Release-Com $setup }
      } finally { Release-Com $section }
    }
    [pscustomobject]@{
      operation = 'inspect'
      path = $source
      sourceSha256 = $sourceHashBefore
      startedFromCopy = $true
      originalOpenedByWord = $false
      workingCopySha256 = $workingCopyHash
      workingCopyHashMatches = ($workingCopyHash -eq $sourceHashBefore)
      openedReadOnly = [bool]$document.ReadOnly
      pageCount = [int]$document.ComputeStatistics(2)
      wordCount = [int]$document.ComputeStatistics(0)
      characterCount = [int]$document.ComputeStatistics(3)
      paragraphCount = [int]$document.Paragraphs.Count
      tableCount = [int]$document.Tables.Count
      inlineShapeCount = [int]$document.InlineShapes.Count
      floatingShapeCount = [int]$document.Shapes.Count
      equationCount = [int]$document.OMaths.Count
      fieldCount = [int]$document.Fields.Count
      sectionCount = [int]$document.Sections.Count
      tocCount = [int]$document.TablesOfContents.Count
      headingCount = $headings.Count
      headings = $headings | Select-Object -First 200
      sections = $sections
    } | ConvertTo-Json -Depth 8 -Compress
    return
  }

  if ($Operation -eq 'format') {
    $output = FullPath $payload.outputPath
    if (Test-Path -LiteralPath $output) { throw 'Word output already exists.' }
    $parent = [IO.Path]::GetDirectoryName($output)
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $template = Read-Property $payload 'template' ([pscustomobject]@{})
    $changes = [Collections.Generic.List[string]]::new()
    $normalFontLatin = [string](Read-Property $template 'bodyFontLatin' 'Times New Roman')
    $normalFontEastAsia = [string](Read-Property $template 'bodyFontEastAsia' '宋体')
    $normalSize = [double](Read-Property $template 'bodyFontSizePt' 12)
    $lineSpacing = [double](Read-Property $template 'lineSpacing' 1.5)
    $firstLineChars = [double](Read-Property $template 'firstLineChars' 2)
    $margins = Read-Property $template 'marginsCm' ([pscustomobject]@{ top = 2.54; bottom = 2.54; left = 3.18; right = 3.18 })

    $document.SaveAs2($output, 16)
    $changes.Add("从原件的临时字节副本创建新版文档：$output（Word 未打开原件）")

    $normal = $document.Styles.Item(-1)
    try {
      $normal.Font.Name = $normalFontLatin
      $normal.Font.NameFarEast = $normalFontEastAsia
      $normal.Font.Size = $normalSize
      $normal.ParagraphFormat.LineSpacingRule = 5
      $normal.ParagraphFormat.LineSpacing = $normalSize * $lineSpacing
      $normal.ParagraphFormat.FirstLineIndent = $normalSize * $firstLineChars
      $normal.ParagraphFormat.SpaceAfter = 0
      $changes.Add("正文：$normalFontEastAsia / $normalFontLatin，$normalSize pt，$lineSpacing 倍行距，首行缩进 $firstLineChars 字符")
    } finally { Release-Com $normal }

    $headingDefaults = @(
      [pscustomobject]@{ level = 1; size = 16; eastAsia = '黑体'; latin = 'Arial'; before = 18; after = 12 },
      [pscustomobject]@{ level = 2; size = 14; eastAsia = '黑体'; latin = 'Arial'; before = 14; after = 8 },
      [pscustomobject]@{ level = 3; size = 12; eastAsia = '黑体'; latin = 'Arial'; before = 10; after = 6 }
    )
    $configuredHeadings = Read-Property $template 'headings' $headingDefaults
    foreach ($heading in $configuredHeadings) {
      $level = [int](Read-Property $heading 'level' 1)
      if ($level -lt 1 -or $level -gt 9) { continue }
      $style = $document.Styles.Item(-1 - $level)
      try {
        $style.Font.Name = [string](Read-Property $heading 'latin' 'Arial')
        $style.Font.NameFarEast = [string](Read-Property $heading 'eastAsia' '黑体')
        $style.Font.Size = [double](Read-Property $heading 'size' ([math]::Max(12, 17 - $level)))
        $style.Font.Bold = -1
        $style.ParagraphFormat.FirstLineIndent = 0
        $style.ParagraphFormat.SpaceBefore = [double](Read-Property $heading 'before' 12)
        $style.ParagraphFormat.SpaceAfter = [double](Read-Property $heading 'after' 6)
      } finally { Release-Com $style }
    }
    $changes.Add('标题：按模板更新 Heading 1–3 或用户提供的标题级别')

    for ($index = 1; $index -le $document.Sections.Count; $index++) {
      $section = $document.Sections.Item($index)
      try {
        $setup = $section.PageSetup
        try {
          $setup.TopMargin = Cm ([double](Read-Property $margins 'top' 2.54))
          $setup.BottomMargin = Cm ([double](Read-Property $margins 'bottom' 2.54))
          $setup.LeftMargin = Cm ([double](Read-Property $margins 'left' 3.18))
          $setup.RightMargin = Cm ([double](Read-Property $margins 'right' 3.18))
        } finally { Release-Com $setup }
      } finally { Release-Com $section }
    }
    $changes.Add('页面：按模板统一所有节的页边距')

    if ([bool](Read-Property $template 'pageNumbers' $true)) {
      for ($index = 1; $index -le $document.Sections.Count; $index++) {
        $section = $document.Sections.Item($index)
        try {
          $footer = $section.Footers.Item(1)
          try { if ($footer.PageNumbers.Count -eq 0) { $footer.PageNumbers.Add(2, $true) | Out-Null } } finally { Release-Com $footer }
        } finally { Release-Com $section }
      }
      $changes.Add('页脚：补充居中页码（已有页码时不重复添加）')
    }
    foreach ($toc in @($document.TablesOfContents)) { try { $toc.Update() | Out-Null } finally { Release-Com $toc } }
    foreach ($field in @($document.Fields)) { try { $field.Update() | Out-Null } finally { Release-Com $field } }
    $document.Repaginate()
    $document.Save()
    $pageCount = [int]$document.ComputeStatistics(2)
    $document.Close($false)
    Release-Com $document
    $document = $null
    $outputHash = Sha256 $output
    $sourceHashAfter = Sha256 $source
    if ($sourceHashAfter -ne $sourceHashBefore) { throw 'Original Word file hash changed; formatting result rejected.' }
    [pscustomobject]@{
      operation = 'format'
      path = $output
      sha256 = $outputHash
      sourcePath = $source
      sourceSha256Before = $sourceHashBefore
      sourceSha256After = $sourceHashAfter
      originalUnchanged = $true
      startedFromCopy = $true
      originalOpenedByWord = $false
      workingCopySha256 = $workingCopyHash
      workingCopyHashMatches = ($workingCopyHash -eq $sourceHashBefore)
      pageCount = $pageCount
      changes = $changes
      template = $template
    } | ConvertTo-Json -Depth 10 -Compress
    return
  }

  if ($Operation -eq 'qa') {
    $document.Repaginate()
    $anomalies = [Collections.Generic.List[object]]::new()
    if ($document.ComputeStatistics(2) -lt 1) { $anomalies.Add([pscustomobject]@{ severity = 'error'; code = 'no-pages'; message = '文档没有可渲染页面。' }) }
    if ($document.Range().Text.Trim().Length -eq 0) { $anomalies.Add([pscustomobject]@{ severity = 'error'; code = 'empty-document'; message = '文档正文为空。' }) }
    for ($index = 1; $index -le $document.Fields.Count; $index++) {
      $field = $document.Fields.Item($index)
      try {
        $resultText = ([string]$field.Result.Text).Trim()
        if ($resultText -match 'Error!|错误!|未找到引用源') { $anomalies.Add([pscustomobject]@{ severity = 'warning'; code = 'field-error'; message = "域 $index 显示错误：$resultText" }) }
      } finally { Release-Com $field }
    }
    for ($index = 1; $index -le $document.Tables.Count; $index++) {
      $table = $document.Tables.Item($index)
      try {
        if ($table.Rows.Count -gt 60) { $anomalies.Add([pscustomobject]@{ severity = 'info'; code = 'long-table'; message = "表格 $index 有 $($table.Rows.Count) 行，请人工检查跨页表头。" }) }
      } finally { Release-Com $table }
    }
    $sourceHashAfter = Sha256 $source
    if ($sourceHashAfter -ne $sourceHashBefore) { throw 'Word QA changed the inspected file.' }
    [pscustomobject]@{
      operation = 'qa'
      path = $source
      sha256 = $sourceHashBefore
      startedFromCopy = $true
      originalOpenedByWord = $false
      workingCopySha256 = $workingCopyHash
      workingCopyHashMatches = ($workingCopyHash -eq $sourceHashBefore)
      openedReadOnly = [bool]$document.ReadOnly
      repaginated = $true
      pageCount = [int]$document.ComputeStatistics(2)
      paragraphCount = [int]$document.Paragraphs.Count
      tableCount = [int]$document.Tables.Count
      fieldCount = [int]$document.Fields.Count
      anomalyCount = $anomalies.Count
      anomalies = $anomalies
      passed = -not ($anomalies | Where-Object severity -eq 'error')
    } | ConvertTo-Json -Depth 8 -Compress
  }
} finally {
  if ($document) { try { $document.Close($false) } catch {} ; Release-Com $document }
  if ($app) { try { $app.Quit() } catch {} ; Release-Com $app }
  if ($workingCopyPath -and (Test-Path -LiteralPath $workingCopyPath)) { Remove-Item -LiteralPath $workingCopyPath -Force -ErrorAction SilentlyContinue }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
