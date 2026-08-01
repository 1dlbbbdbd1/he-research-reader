const assert = require('node:assert/strict')
const test = require('node:test')

test('Markdown 块保持稳定编号并只继承明确写出的页码', async () => {
  const { markdownReadingBlocks } = await import('../src/markdown-anchor.mjs')
  const result = markdownReadingBlocks('# Page 2\n\nUnique evidence.\n\n## Method\n\nMethod details.')
  assert.deepEqual(result.blocks.map(block => [block.id, block.pageNumber]), [
    ['block-0001', 2],
    ['block-0002', 2],
    ['block-0003', 2],
    ['block-0004', 2],
  ])
  assert.equal(markdownReadingBlocks('Abstract\n\nNo page marker.').blocks[0].pageNumber, undefined)
})

test('原文引文只有在 Markdown 中唯一命中时才建立块级映射', async () => {
  const { locateQuoteInMarkdown } = await import('../src/markdown-anchor.mjs')
  const markdown = '# Page 1\n\nRepeated sentence.\n\n# Page 2\n\nUnique traceable evidence.\n\nRepeated sentence.'
  assert.deepEqual(locateQuoteInMarkdown(markdown, 'Unique   traceable evidence.'), {
    state: 'resolved',
    markdownBlockId: 'block-0004',
    pageNumber: 2,
    matchCount: 1,
  })
  assert.deepEqual(locateQuoteInMarkdown(markdown, 'Repeated sentence.'), {
    state: 'unresolved',
    reason: 'ambiguous',
    matchCount: 2,
  })
  assert.deepEqual(locateQuoteInMarkdown(markdown, 'Invented evidence.'), {
    state: 'unresolved',
    reason: 'not-found',
    matchCount: 0,
  })
})

test('Markdown 划词锚点记录块编号，只有显式页码时才附带 PDF 页', async () => {
  const { markdownSelectionAnchor } = await import('../src/markdown-anchor.mjs')
  assert.deepEqual(
    markdownSelectionAnchor('# Page 7\n\nSelected method.', 'block-0002', 'Selected method.'),
    {
      type: 'markdown',
      state: 'resolved',
      markdownBlockId: 'block-0002',
      pageNumber: 7,
      quote: { exact: 'Selected method.' },
    },
  )
  assert.equal(
    markdownSelectionAnchor('Selected method.', 'block-0001', 'missing').state,
    'unresolved',
  )
})

test('真实 MinerU content_list 的文字和 page_idx 可保守映射 Markdown 块', async () => {
  const { markdownReadingBlocks, locateQuoteInMarkdown, markdownSelectionAnchor } = await import('../src/markdown-anchor.mjs')
  const markdown = '## Research Workbench PDF Render Check\n\nHypothesis: online identification reduces peak contact force.\n\n## Page 2: Traceability'
  const layout = [
    { id: 'mineru-content-000001', type: 'text', text: 'Research Workbench PDF Render Check', pageNumber: 1, bbox: [0.09, 0.104, 0.689, 0.129] },
    { id: 'mineru-content-000002', type: 'text', text: 'Hypothesis: online identification reduces peak contact force.', pageNumber: 1, bbox: [0.1, 0.2, 0.8, 0.3] },
    { id: 'mineru-content-000003', type: 'text', text: 'Page 2: Traceability', pageNumber: 2 },
  ]
  assert.deepEqual(markdownReadingBlocks(markdown, layout).blocks.map(block => block.pageNumber), [1, 1, 2])
  assert.deepEqual(locateQuoteInMarkdown(markdown, 'Hypothesis: online identification reduces peak contact force.', layout).rects, [
    { x: 0.1, y: 0.2, width: 0.7000000000000001, height: 0.09999999999999998 },
  ])
  assert.deepEqual(
    markdownSelectionAnchor(markdown, 'block-0002', 'Hypothesis: online identification reduces peak contact force.', layout).rects,
    [{ x: 0.1, y: 0.2, width: 0.7000000000000001, height: 0.09999999999999998 }],
  )
  assert.equal(locateQuoteInMarkdown(markdown, 'Page 2: Traceability', layout).pageNumber, 2)
})
