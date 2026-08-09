const assert = require('node:assert/strict')
const test = require('node:test')

test('双栏重排后的 Markdown 按阅读顺序分段且能够无损重建', async () => {
  const { repairAcademicMarkdownReadingOrder } = await import('../src/academic-markdown-skill.mjs')
  const { reconstructBilingualSource, segmentBilingualMarkdown } = await import('../src/bilingual-reading.mjs')
  const source = 'Paper title\n\nLeft top.\n\nRight top.\n\nLeft bottom.\n\nRight bottom.'
  const layout = [
    { id: 'title', text: 'Paper title', pageNumber: 1, bbox: [0.1, 0.03, 0.9, 0.08] },
    { id: 'lt', text: 'Left top.', pageNumber: 1, bbox: [0.08, 0.12, 0.45, 0.24] },
    { id: 'lb', text: 'Left bottom.', pageNumber: 1, bbox: [0.08, 0.3, 0.45, 0.42] },
    { id: 'rt', text: 'Right top.', pageNumber: 1, bbox: [0.55, 0.12, 0.92, 0.24] },
    { id: 'rb', text: 'Right bottom.', pageNumber: 1, bbox: [0.55, 0.3, 0.92, 0.42] },
  ]
  const repaired = repairAcademicMarkdownReadingOrder(source, layout)
  const segments = segmentBilingualMarkdown(repaired.markdown)
  assert.equal(reconstructBilingualSource(segments), repaired.markdown)
  assert.deepEqual(segments.filter(item => item.translatable).map(item => item.source), [
    'Paper title', 'Left top.', 'Left bottom.', 'Right top.', 'Right bottom.',
  ])
})

test('GFM 表格可翻译，但公式、代码、图片与纯结构保持原样并跳过翻译', async () => {
  const { buildBilingualReadingPairs, reconstructBilingualSource, segmentBilingualMarkdown } = await import('../src/bilingual-reading.mjs')
  const markdown = [
    '# Results', '',
    '| Method | Error |',
    '| :--- | ---: |',
    '| Proposed | 0.12 |', '',
    '$$', 'E = mc^2', '$$', '',
    '```python', 'print("do not translate")', '```', '',
    '![trajectory](./figures/trajectory.png)', '',
    '---', '',
    'The controller converged with $K_p=2$ and `safe_mode=True`.',
  ].join('\n')
  const segments = segmentBilingualMarkdown(markdown)
  assert.equal(reconstructBilingualSource(segments), markdown)
  assert.equal(segments.find(item => item.kind === 'table').status, 'pending')
  for (const kind of ['math', 'code', 'image', 'structure']) {
    const segment = segments.find(item => item.kind === kind)
    assert.ok(segment, `missing ${kind}`)
    assert.equal(segment.translatable, false)
    assert.equal(segment.status, 'skipped')
  }
  const pairs = buildBilingualReadingPairs(segments)
  assert.deepEqual(pairs.map(pair => pair.sourceMarkdown), segments.map(segment => segment.source))
})

test('内容哈希、段落 id 与文档指纹在相同输入下稳定，缓存可按哈希复用', async () => {
  const { createBilingualReadingDocument, segmentBilingualMarkdown } = await import('../src/bilingual-reading.mjs')
  const markdown = '# Abstract\n\nThis paper presents a robot controller.'
  const first = createBilingualReadingDocument(markdown)
  const second = createBilingualReadingDocument(markdown.replace(/\n/g, '\r\n'))
  assert.equal(first.sourceFingerprint, second.sourceFingerprint)
  assert.deepEqual(first.segments.map(item => item.id), second.segments.map(item => item.id))
  const paragraph = first.segments.find(item => item.kind === 'paragraph')
  const cached = segmentBilingualMarkdown(`Preface.\n\n${paragraph.source}`, {
    cachedSegments: [{ contentHash: paragraph.contentHash, translation: '本文提出了一种机器人控制器。' }],
  })
  const reused = cached.find(item => item.contentHash === paragraph.contentHash)
  assert.equal(reused.status, 'translated')
  assert.equal(reused.translation, '本文提出了一种机器人控制器。')
})

test('长正文被保守拆分且默认批次很小，不会把整篇文献一次发送', async () => {
  const { BILINGUAL_READING_DEFAULTS, segmentBilingualMarkdown, selectBilingualTranslationBatch } = await import('../src/bilingual-reading.mjs')
  const longParagraph = Array.from({ length: 80 }, (_, index) => `Sentence ${index + 1} describes the experiment.`).join(' ')
  const segments = segmentBilingualMarkdown(longParagraph, { maxSegmentCharacters: 420 })
  const prose = segments.filter(item => item.translatable)
  assert.ok(prose.length > 1)
  assert.ok(prose.every(item => item.source.length <= 420))
  const batch = selectBilingualTranslationBatch(segments)
  assert.ok(batch.length <= BILINGUAL_READING_DEFAULTS.batchSize)
  assert.ok(batch.reduce((sum, item) => sum + item.source.length, 0) <= BILINGUAL_READING_DEFAULTS.batchCharacters)
})

test('失败段落可重试，达到次数上限后不再选择，pending 优先', async () => {
  const {
    markBilingualBatchTranslating,
    retryFailedBilingualSegments,
    segmentBilingualMarkdown,
    selectBilingualTranslationBatch,
    updateBilingualSegment,
  } = await import('../src/bilingual-reading.mjs')
  let segments = segmentBilingualMarkdown('First experiment.\n\nSecond experiment.\n\nThird experiment.')
  const first = segments.find(item => item.translatable)
  segments = markBilingualBatchTranslating(segments, [first])
  segments = updateBilingualSegment(segments, first.id, { status: 'failed', error: 'provider unavailable' })
  let batch = selectBilingualTranslationBatch(segments, { limit: 3, maxAttempts: 3 })
  assert.equal(batch[0].status, 'pending')
  assert.ok(batch.some(item => item.id === first.id))
  segments = retryFailedBilingualSegments(segments, { maxAttempts: 3 })
  assert.equal(segments.find(item => item.id === first.id).status, 'pending')
  segments = updateBilingualSegment(segments, first.id, { status: 'failed', error: 'again', attempts: 3 })
  batch = selectBilingualTranslationBatch(segments, { limit: 10, maxAttempts: 3 })
  assert.ok(!batch.some(item => item.id === first.id))
})

test('翻译状态更新不可覆盖原文，空译文不能伪装为成功', async () => {
  const { segmentBilingualMarkdown, updateBilingualSegment } = await import('../src/bilingual-reading.mjs')
  const segments = segmentBilingualMarkdown('A reproducible experiment.')
  const original = segments[0]
  const next = updateBilingualSegment(segments, original.id, { status: 'translated', translation: '' })
  assert.equal(next[0].source, original.source)
  assert.equal(next[0].status, 'failed')
  assert.throws(() => updateBilingualSegment(next, 'missing', { status: 'failed' }), /未知的对照翻译段落/)
})

test('跨页选区会按阅读顺序智能合并换行和断词，并保留页码范围', async () => {
  const { prepareTranslationSelection } = await import('../src/bilingual-reading.mjs')
  const prepared = prepareTranslationSelection('The control-\nler remains stable.\nA second sentence.\n\nNew paragraph.', 4, 5)
  assert.equal(prepared.mergedText, 'The controller remains stable. A second sentence.\n\nNew paragraph.')
  assert.equal(prepared.crossesPages, true)
  assert.equal(prepared.startPageNumber, 4)
  assert.equal(prepared.endPageNumber, 5)
  assert.equal(prepared.characterCount, prepared.mergedText.length)
})

test('修改错误提取文本只改变翻译指纹，不覆盖权威原文；锁定后必须先解锁', async () => {
  const { segmentBilingualMarkdown, updateBilingualSegment } = await import('../src/bilingual-reading.mjs')
  const original = 'The controIler is stable.\nAcross a wrapped line.'
  let segments = segmentBilingualMarkdown(original)
  const segment = segments.find(item => item.translatable)
  assert.equal(segment.source, original)
  assert.equal(segment.translationSource, 'The controIler is stable. Across a wrapped line.')
  segments = updateBilingualSegment(segments, segment.id, { translationSource: 'The controller is stable. Across a wrapped line.' })
  assert.equal(segments[0].source, original)
  assert.notEqual(segments[0].translationSourceHash, segment.translationSourceHash)
  segments = updateBilingualSegment(segments, segment.id, { status: 'translated', translation: '控制器保持稳定。', locked: true, provider: 'local' })
  assert.throws(() => updateBilingualSegment(segments, segment.id, { status: 'pending' }), /已锁定/)
  segments = updateBilingualSegment(segments, segment.id, { locked: false, unlock: true })
  assert.equal(segments[0].locked, false)
})
