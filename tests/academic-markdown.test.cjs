const assert = require('node:assert/strict')
const test = require('node:test')

test('规则排版只修复论文标题层级和空行，不改写正文句子', async () => {
  const { normalizeAcademicMarkdown } = await import('../src/academic-markdown-skill.mjs')
  const source = 'Abstract\nThis paper proposes a controller.\n\n2 Methods\nForce feedback is preserved.\n\nReferences\n[1] Example.'
  const result = normalizeAcademicMarkdown(source)
  assert.match(result, /^## Abstract/m)
  assert.match(result, /^## 2 Methods/m)
  assert.match(result, /^## References/m)
  assert.match(result, /This paper proposes a controller\./)
  assert.match(result, /Force feedback is preserved\./)
  assert.match(result, /\[1\] Example\./)
})

test('AI 只能返回原顺序章节边界，不能替换正文或编造块', async () => {
  const {
    buildAcademicMarkdown,
    parseAcademicMarkdownBoundaries,
    splitAcademicMarkdownBlocks,
  } = await import('../src/academic-markdown-skill.mjs')
  const source = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
  const { blocks } = splitAcademicMarkdownBlocks(source)
  const boundaries = parseAcademicMarkdownBoundaries(JSON.stringify({
    boundaries: [
      { beforeBlockId: blocks[0].id, section: '摘要' },
      { beforeBlockId: blocks[1].id, section: '方法' },
    ],
  }), source)
  const result = buildAcademicMarkdown(source, boundaries)
  assert.match(result, /^## 摘要\n\nFirst paragraph\./)
  assert.match(result, /## 方法\n\nSecond paragraph\./)
  assert.match(result, /Third paragraph\.$/)
  assert.throws(
    () => parseAcademicMarkdownBoundaries(JSON.stringify({
      boundaries: [{ beforeBlockId: 'block-9999', section: '结果' }],
    }), source),
    /未知、重复、乱序或不允许/,
  )
})

test('Markdown 变化后旧的 AI 章节布局自动失效', async () => {
  const {
    ACADEMIC_MARKDOWN_SKILL,
    academicMarkdownFingerprint,
    validAcademicMarkdownLayout,
  } = await import('../src/academic-markdown-skill.mjs')
  const source = 'Original paragraph.'
  const layout = {
    version: ACADEMIC_MARKDOWN_SKILL.version,
    sourceFingerprint: academicMarkdownFingerprint(source),
    boundaries: [],
  }
  assert.equal(validAcademicMarkdownLayout(layout, source), true)
  assert.equal(validAcademicMarkdownLayout(layout, `${source}\nChanged.`), false)
})

test('双栏页按左栏再右栏自动重排，原文与稳定块编号不被覆盖', async () => {
  const { repairAcademicMarkdownReadingOrder } = await import('../src/academic-markdown-skill.mjs')
  const source = 'Paper title\n\nLeft top.\n\nRight top.\n\nLeft bottom.\n\nRight bottom.\n\nReferences'
  const layout = [
    { id: 'title', text: 'Paper title', pageNumber: 1, bbox: [0.1, 0.03, 0.9, 0.08] },
    { id: 'lt', text: 'Left top.', pageNumber: 1, bbox: [0.08, 0.12, 0.45, 0.24] },
    { id: 'lb', text: 'Left bottom.', pageNumber: 1, bbox: [0.08, 0.3, 0.45, 0.42] },
    { id: 'rt', text: 'Right top.', pageNumber: 1, bbox: [0.55, 0.12, 0.92, 0.24] },
    { id: 'rb', text: 'Right bottom.', pageNumber: 1, bbox: [0.55, 0.3, 0.92, 0.42] },
    { id: 'refs', text: 'References', pageNumber: 1, bbox: [0.1, 0.78, 0.9, 0.84] },
  ]
  const result = repairAcademicMarkdownReadingOrder(source, layout)
  assert.equal(source, 'Paper title\n\nLeft top.\n\nRight top.\n\nLeft bottom.\n\nRight bottom.\n\nReferences')
  assert.equal(result.sourceMarkdown, source)
  assert.equal(result.changed, true)
  assert.deepEqual(result.blocks.map(block => [block.id, block.content]), [
    ['block-0001', 'Paper title'],
    ['block-0002', 'Left top.'],
    ['block-0004', 'Left bottom.'],
    ['block-0003', 'Right top.'],
    ['block-0005', 'Right bottom.'],
    ['block-0006', '## References'],
  ])
  assert.equal(result.diagnostics[0].layout, 'two-column')
  assert.equal(result.diagnostics[0].reordered, true)
  assert.ok(result.diagnostics[0].confidence >= .7)
  assert.equal(result.diagnostics[0].matchCoverage, 1)
})

test('单栏或证据不足时保持原顺序并输出保守诊断', async () => {
  const { repairAcademicMarkdownReadingOrder } = await import('../src/academic-markdown-skill.mjs')
  const source = 'First full paragraph.\n\nSecond full paragraph.'
  const single = repairAcademicMarkdownReadingOrder(source, [
    { id: 'one', text: 'First full paragraph.', pageNumber: 2, bbox: [0.08, 0.1, 0.92, 0.2] },
    { id: 'two', text: 'Second full paragraph.', pageNumber: 2, bbox: [0.08, 0.3, 0.92, 0.4] },
  ])
  assert.equal(single.changed, false)
  assert.equal(single.markdown, source)
  assert.equal(single.diagnostics[0].layout, 'single-column')

  const uncertain = repairAcademicMarkdownReadingOrder(source, [
    { id: 'one', text: 'First full paragraph.', pageNumber: 2, bbox: [0.08, 0.1, 0.45, 0.2] },
  ])
  assert.equal(uncertain.changed, false)
  assert.equal(uncertain.diagnostics[0].layout, 'uncertain')
})

test('即使一页没有匹配到 Markdown 块也返回覆盖率为零的诊断', async () => {
  const { repairAcademicMarkdownReadingOrder } = await import('../src/academic-markdown-skill.mjs')
  const result = repairAcademicMarkdownReadingOrder('Known paragraph.', [
    { id: 'unknown', text: 'Different layout text.', pageNumber: 9, bbox: [0.1, 0.1, 0.9, 0.2] },
  ])
  assert.equal(result.changed, false)
  assert.equal(result.diagnostics[0].pageNumber, 9)
  assert.equal(result.diagnostics[0].matchedBlockCount, 0)
  assert.equal(result.diagnostics[0].matchCoverage, 0)
})

test('派生修复完整保留传入原文，包括 CRLF 换行', async () => {
  const { repairAcademicMarkdownReadingOrder } = await import('../src/academic-markdown-skill.mjs')
  const source = 'First paragraph.\r\n\r\nSecond paragraph.'
  const result = repairAcademicMarkdownReadingOrder(source, [])
  assert.equal(result.sourceMarkdown, source)
  assert.equal(result.changed, false)
})

test('只重排可唯一匹配的块，未匹配内容保留原槽位', async () => {
  const { repairAcademicMarkdownReadingOrder } = await import('../src/academic-markdown-skill.mjs')
  const source = 'Left top.\n\nUnmatched note.\n\nRight top.\n\nLeft bottom.\n\nRight bottom.'
  const layout = [
    { id: 'lt', text: 'Left top.', pageNumber: 3, bbox: [0.08, 0.1, 0.45, 0.2] },
    { id: 'lb', text: 'Left bottom.', pageNumber: 3, bbox: [0.08, 0.3, 0.45, 0.4] },
    { id: 'rt', text: 'Right top.', pageNumber: 3, bbox: [0.55, 0.1, 0.92, 0.2] },
    { id: 'rb', text: 'Right bottom.', pageNumber: 3, bbox: [0.55, 0.3, 0.92, 0.4] },
  ]
  const result = repairAcademicMarkdownReadingOrder(source, layout)
  assert.deepEqual(result.blocks.map(block => block.content), [
    'Left top.', 'Unmatched note.', 'Left bottom.', 'Right top.', 'Right bottom.',
  ])
  assert.equal(result.blocks[1].id, 'block-0002')
})
