const { pathToFileURL } = require('node:url')
const path = require('node:path')

let bilingualModulePromise
function bilingualModule() {
  if (!bilingualModulePromise) bilingualModulePromise = import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'bilingual-reading.mjs')).href)
  return bilingualModulePromise
}
function clean(value) { return String(value ?? '').replace(/\r\n?/g, '\n').trim() }
function protectedTokens(value) {
  return [...new Set([
    ...(String(value || '').match(/\b10\.\d{4,9}\/[\w.()/:;-]+/gi) || []),
    ...(String(value || '').match(/\[(?:\d+\s*[-,;]?\s*)+\]/g) || []),
    ...(String(value || '').match(/`[^`]+`|\$[^$]+\$/g) || []),
  ])]
}
function sourceAnchors(blocks = []) {
  return blocks.map((block, index) => ({
    blockId: block.id, index, kind: block.kind, headingLevel: block.headingLevel,
    pageNumbers: [...new Set((block.sourceSlices || []).map(slice => Number(slice.pageNumber)).filter(Number.isFinite))],
    sourceSlices: block.sourceSlices || [], originalBlockIds: block.originalBlockIds || [], content: String(block.content || ''),
  }))
}

async function prepareStructuredReading(workspace, input = {}) {
  const sourceId = clean(input.sourceId)
  if (!sourceId) throw new Error('请选择已解析的论文。')
  let structured = workspace.getStructuredReading({ sourceId })
  if (!structured.currentVersion || structured.stale) structured = workspace.generateStructuredReading({ sourceId, createdBy: 'rules' })
  if (!structured.currentVersion) throw new Error('当前论文没有可用的结构化阅读稿。')
  const module = await bilingualModule(); const version = structured.currentVersion
  const markdown = module.structuredBlocksToBilingualMarkdown(version.blocks)
  if (!markdown.trim()) throw new Error('结构化阅读稿没有可处理的正文块。')
  const anchors = sourceAnchors(version.blocks)
  const report = `# 结构化论文精读现场\n\n- 来源 ID：${sourceId}\n- 整理稿版本：v${version.versionNumber}\n- 结构块：${version.blocks.length}\n- 原文锚点：${anchors.filter(anchor => anchor.sourceSlices.length).length}\n- 质量提示：${version.qualityIssues.length}\n\n> 后续中英对照严格按此版本顺序处理，不直接翻译 MinerU 原始 Markdown。\n`
  return { sourceId, documentId: structured.documentId, versionId: version.id, versionNumber: version.versionNumber, createdBy: version.createdBy, blocks: version.blocks, toc: version.toc, qualityIssues: version.qualityIssues, diagnostics: version.diagnostics, anchors, markdown, sourceFingerprint: version.sourceFingerprint, result: { type: 'structured_reading_snapshot', label: '结构化论文精读现场', content: report, data: { sourceId, versionId: version.id, versionNumber: version.versionNumber, anchors, qualityIssues: version.qualityIssues }, sourceLinks: anchors.map(anchor => ({ kind: 'source_block', sourceId, blockId: anchor.blockId, pageNumbers: anchor.pageNumbers })), reviewState: 'draft' } }
}

async function prepareTranslationSegments(workspace, input = {}) {
  const sourceId = clean(input.sourceId); const markdown = String(input.markdown || '')
  const module = await bilingualModule(); const base = module.createBilingualReadingDocument(markdown, { maxSegmentCharacters: input.maxSegmentCharacters })
  const query = base.segments.filter(segment => segment.translatable).map(segment => ({ segmentId: segment.id, sourceHash: segment.contentHash }))
  const cached = query.length ? workspace.getReadingTranslationSegments({ sourceId, segments: query }).segments : []
  const cachedSegments = cached.map(record => ({ id: record.segmentId, contentHash: record.baseSourceHash || record.sourceHash, baseSourceHash: record.baseSourceHash || record.sourceHash, sourceHash: record.sourceHash, sourceText: record.sourceText, translation: record.translatedText || '', status: record.status, error: record.error, attempts: record.attempts || 0, locked: Boolean(record.locked), provider: record.provider, model: record.model }))
  const document = module.createBilingualReadingDocument(markdown, { maxSegmentCharacters: input.maxSegmentCharacters, cachedSegments })
  const glossary = workspace.listReadingTranslationTerms({ sourceId })
  return { sourceId, sourceFingerprint: document.sourceFingerprint, sourceMarkdown: document.sourceMarkdown, segments: document.segments, glossary, summary: { total: document.segments.length, translatable: document.segments.filter(item => item.translatable).length, restored: document.segments.filter(item => item.status === 'translated').length, failed: document.segments.filter(item => item.status === 'failed').length } }
}

async function translateSegments(workspace, adapter, input = {}) {
  if (!adapter?.translate) throw new Error('翻译执行器没有接入。')
  const sourceId = clean(input.sourceId); const from = clean(input.from || 'en'); const to = clean(input.to || 'zh')
  const provider = clean(input.provider || 'local'); const glossary = Array.isArray(input.glossary) ? input.glossary : []
  const limit = Math.min(1000, Math.max(1, Number(input.maxSegments) || 1000)); const segments = Array.isArray(input.segments) ? input.segments.map(item => ({ ...item })) : []
  let processed = 0
  for (const segment of segments) {
    if (!segment.translatable || segment.locked || segment.status === 'translated' || processed >= limit) continue
    processed += 1; const attempts = Number(segment.attempts || 0) + 1
    try {
      const translated = clean(await adapter.translate({ text: segment.translationSource, from, to, provider, glossary }))
      if (!translated) throw new Error('翻译执行器没有返回译文。')
      const missing = protectedTokens(segment.translationSource).filter(token => !translated.includes(token))
      if (missing.length) throw new Error(`译文丢失不可翻译标记：${missing.join('、')}`)
      segment.translation = translated; segment.status = 'translated'; segment.attempts = attempts; segment.provider = provider; segment.model = adapter.model?.(provider); segment.error = undefined
      workspace.saveReadingTranslationSegment({ sourceId, segmentId: segment.id, sourceHash: segment.translationSourceHash, baseSourceHash: segment.contentHash, sourceText: segment.translationSource, translatedText: translated, provider, model: segment.model || provider, status: 'translated', attempts, locked: Boolean(segment.locked), sourceLanguage: from, targetLanguage: to })
    } catch (error) {
      segment.status = 'failed'; segment.attempts = attempts; segment.provider = provider; segment.error = error instanceof Error ? error.message : '翻译失败'
      workspace.saveReadingTranslationSegment({ sourceId, segmentId: segment.id, sourceHash: segment.translationSourceHash, baseSourceHash: segment.contentHash, sourceText: segment.translationSource, provider, model: segment.model || provider, status: 'failed', error: segment.error, attempts, locked: false, sourceLanguage: from, targetLanguage: to })
    }
  }
  const summary = { total: segments.length, translated: segments.filter(item => item.status === 'translated').length, failed: segments.filter(item => item.status === 'failed').length, pending: segments.filter(item => item.translatable && item.status === 'pending').length, skipped: segments.filter(item => item.status === 'skipped').length, processed }
  return { sourceId, segments, summary, complete: summary.failed === 0 && summary.pending === 0 }
}

async function renderBilingualResult(input = {}) {
  const module = await bilingualModule(); const sourceId = clean(input.sourceId); const segments = Array.isArray(input.segments) ? input.segments : []; const anchors = Array.isArray(input.anchors) ? input.anchors : []
  const pairs = module.buildBilingualReadingPairs(segments).filter(pair => pair.kind !== 'whitespace')
  const anchorFor = pair => anchors.find(anchor => clean(anchor.content) && (clean(anchor.content).includes(clean(pair.sourceMarkdown)) || clean(pair.sourceMarkdown).includes(clean(anchor.content))))
  const mappings = pairs.map(pair => { const anchor = anchorFor(pair); return { segmentId: pair.segmentId, blockId: anchor?.blockId, pageNumbers: anchor?.pageNumbers || [], status: pair.status, sourceMarkdown: pair.sourceMarkdown, translatedMarkdown: pair.translatedMarkdown, error: pair.error } })
  const body = mappings.map(item => `### ${item.segmentId}${item.pageNumbers.length ? ` · PDF 第 ${item.pageNumbers.join('、')} 页` : ''}\n\n**原文**\n\n${item.sourceMarkdown}\n\n**译文**\n\n${item.translatedMarkdown || (item.error ? `> 翻译失败：${item.error}` : '> 待翻译')}\n`).join('\n')
  const summary = { total: mappings.length, translated: mappings.filter(item => item.status === 'translated').length, failed: mappings.filter(item => item.status === 'failed').length, pending: mappings.filter(item => item.status === 'pending').length, mappedToSource: mappings.filter(item => item.blockId).length }
  const markdown = `# 论文中英对照稿\n\n- 来源 ID：${sourceId}\n- 段落：${summary.total}\n- 已翻译：${summary.translated}\n- 失败：${summary.failed}\n- 待翻译：${summary.pending}\n- 可回到结构块：${summary.mappedToSource}\n\n> 原文顺序来自当前结构化阅读稿；单段失败不会删除其他段落或原文。\n\n${body}`
  return { mappings, summary, markdown, result: { type: clean(input.resultType || 'bilingual_reading'), label: input.resultType === 'academic_translation' ? '学术论文双语译稿' : '证据化论文中英对照稿', content: markdown, data: { sourceId, mappings, summary, glossary: input.glossary || [] }, sourceLinks: mappings.filter(item => item.blockId).map(item => ({ kind: 'source_block', sourceId, blockId: item.blockId, pageNumbers: item.pageNumbers })), reviewState: 'draft' } }
}

async function qaBilingualResult(input = {}) {
  const module = await bilingualModule(); const segments = Array.isArray(input.segments) ? input.segments : []; const sourceMarkdown = String(input.sourceMarkdown || '')
  const reconstructed = module.reconstructBilingualSource(segments); const sourcePreserved = reconstructed === sourceMarkdown
  const failures = segments.filter(item => item.status === 'failed').map(item => ({ segmentId: item.id, error: item.error }))
  const pending = segments.filter(item => item.translatable && item.status === 'pending').map(item => item.id)
  const missingProtected = segments.filter(item => item.status === 'translated').flatMap(item => protectedTokens(item.translationSource).filter(token => !String(item.translation).includes(token)).map(token => ({ segmentId: item.id, token })))
  const passed = sourcePreserved && !missingProtected.length && (!input.requireComplete || (!failures.length && !pending.length))
  if (!passed && input.requireComplete) throw new Error(`双语稿 QA 未通过：原文完整=${sourcePreserved}，失败=${failures.length}，待翻译=${pending.length}，保护标记丢失=${missingProtected.length}。`)
  const qa = { passed, sourcePreserved, failures, pending, missingProtected, checkedAt: new Date().toISOString() }
  const markdown = `# 双语稿 QA\n\n- 原文可无损重建：${sourcePreserved ? '是' : '否'}\n- 翻译失败：${failures.length}\n- 待翻译：${pending.length}\n- DOI/公式/引用标记丢失：${missingProtected.length}\n- 结论：${passed ? '通过' : '未通过'}\n`
  return { qa, result: { type: 'bilingual_translation_qa', label: '双语稿 QA', content: markdown, data: qa, reviewState: 'draft' } }
}

module.exports = { prepareStructuredReading, prepareTranslationSegments, protectedTokens, qaBilingualResult, renderBilingualResult, translateSegments }
