const assert = require('node:assert/strict')
const test = require('node:test')
const { buildStructuredReadingDraft, validateManualAdjustment } = require('../electron/structured-reading.cjs')

const realLikeMarkdown = [
  'Abstract',
  '',
  'First complete sentence.\nSecond glued paragraph starts here.',
  '',
  'Left top paragraph.',
  '',
  'Right top paragraph.',
  '',
  'Left bottom paragraph.',
  '',
  'Right bottom continues',
  '',
  'across the next page.',
  '',
  '![Force curve](images/force.png)',
  '',
  'Fig. 2: Force curve under contact.',
  '',
  '| Case | Value |\n| --- | --- |\n| A | 0.8 |',
  '',
  '$$\nF = kx\n$$',
  '',
  '```python\nprint("raw")\n```',
].join('\n')

const layout = [
  { id: 'abstract', text: 'Abstract', pageNumber: 1, bbox: [0.08, 0.05, 0.92, 0.09] },
  { id: 'lt', text: 'Left top paragraph.', pageNumber: 1, bbox: [0.08, 0.2, 0.45, 0.28] },
  { id: 'lb', text: 'Left bottom paragraph.', pageNumber: 1, bbox: [0.08, 0.34, 0.45, 0.45] },
  { id: 'rb', text: 'Right bottom continues', pageNumber: 1, bbox: [0.55, 0.34, 0.92, 0.92] },
  { id: 'rt', text: 'Right top paragraph.', pageNumber: 1, bbox: [0.55, 0.2, 0.92, 0.28] },
  { id: 'continued', text: 'across the next page.', pageNumber: 2, bbox: [0.08, 0.06, 0.92, 0.12] },
  { id: 'figure', text: 'Force curve', pageNumber: 2, bbox: [0.1, 0.2, 0.9, 0.5] },
  { id: 'caption', text: 'Fig. 2: Force curve under contact.', pageNumber: 2, bbox: [0.1, 0.52, 0.9, 0.57] },
]

test('结构化阅读稿修复段落、双栏、跨页与图注关系，同时保留安全块', () => {
  const result = buildStructuredReadingDraft({ markdown: realLikeMarkdown, layoutBlocks: layout, sourceVersion: 3 })
  assert.equal(result.sourceVersion, 3)
  assert.ok(result.changeSummary.paragraphsSplit >= 1)
  assert.ok(result.changeSummary.reorderedBlocks >= 2)
  assert.equal(result.changeSummary.crossPageMerges, 1)
  assert.equal(result.changeSummary.figuresLinked, 1)
  assert.ok(result.blocks.some(block => block.kind === 'table' && block.content.includes('| A | 0.8 |')))
  assert.ok(result.blocks.some(block => block.kind === 'formula' && block.content.includes('F = kx')))
  assert.ok(result.blocks.some(block => block.kind === 'code' && block.content.includes('print("raw")')))
  const merged = result.blocks.find(block => block.transformation === 'cross-page-merge')
  assert.deepEqual(merged.pageRange, [1, 2])
  assert.equal(merged.originalBlockIds.length, 2)
  assert.ok(result.blocks.every(block => block.contentFingerprint && block.sourceVersion === 3 && block.originalBlockIds.length))
  const caption = result.blocks.find(block => block.kind === 'figure_caption')
  assert.equal(caption.relation.type, 'caption-of')
})

test('AI 章节边界只增加结构，不替换正文', () => {
  const result = buildStructuredReadingDraft({
    markdown: 'First paragraph.\n\nSecond paragraph.',
    boundaries: [{ beforeBlockId: 'block-0002', section: '方法' }],
    createdBy: 'ai',
    model: 'test-model',
  })
  assert.equal(result.blocks[1].inferredHeading, '方法')
  assert.equal(result.blocks[1].content, 'Second paragraph.')
  assert.equal(result.createdBy, 'ai')
  assert.equal(result.model, 'test-model')
})

test('疑似乱码、损坏公式与不确定顺序只提示，不暗猜修复', () => {
  const result = buildStructuredReadingDraft({
    markdown: 'Damaged � text with $ formula.\n\nKnown paragraph.',
    layoutBlocks: [{ id: 'unknown', text: 'Different content', pageNumber: 7, bbox: [0.1, 0.1, 0.4, 0.2] }],
  })
  assert.deepEqual(new Set(result.qualityIssues.map(issue => issue.code)), new Set([
    'suspected-garbled-text', 'possibly-damaged-formula', 'uncertain-reading-order',
  ]))
})

test('手动调整可改变顺序和标题，但不能删除、重复或编造结构块', () => {
  const version = buildStructuredReadingDraft({ markdown: 'One.\n\nTwo.\n\nThree.' })
  const ids = version.blocks.map(block => block.id)
  const adjusted = validateManualAdjustment(version, {
    orderedBlockIds: [ids[1], ids[0], ids[2]],
    headingLevels: { [ids[1]]: 2 },
  })
  assert.deepEqual(adjusted.blocks.map(block => block.id), [ids[1], ids[0], ids[2]])
  assert.equal(adjusted.blocks[0].headingLevel, 2)
  assert.equal(adjusted.blocks[0].content, 'Two.')
  assert.throws(() => validateManualAdjustment(version, { orderedBlockIds: ids.slice(1) }), /必须保留全部结构块/)
  assert.throws(() => validateManualAdjustment(version, { orderedBlockIds: [ids[0], ids[0], ids[2]] }), /必须保留全部结构块/)
})

test('长文版面匹配保持全部结构块与确定顺序', () => {
  const markdownBlocks = Array.from({ length: 360 }, (_, index) => `Evidence paragraph ${index + 1} remains traceable.`)
  const layoutBlocks = markdownBlocks.map((text, index) => ({
    id: `layout-${index + 1}`,
    text,
    pageNumber: Math.floor(index / 6) + 1,
    bbox: [0.08, 0.08 + index % 6 * 0.12, 0.92, 0.16 + index % 6 * 0.12],
  }))
  const result = buildStructuredReadingDraft({ markdown: markdownBlocks.join('\n\n'), layoutBlocks })
  assert.equal(result.blocks.length, 360)
  assert.equal(result.blocks[0].pageNumber, 1)
  assert.equal(result.blocks.at(-1).pageNumber, 60)
  assert.equal(result.blocks.at(-1).content, 'Evidence paragraph 360 remains traceable.')
})
