const assert = require('node:assert/strict')
const test = require('node:test')

test('论文项目同时识别题录到附件和附件到题录的两种绑定', async () => {
  const { buildPaperLibraryRows } = await import('../src/library-papers.mjs')
  const items = [
    { id: 'paper-a', sourceId: 'source-a', annotationCount: 7 },
    { id: 'paper-b', annotationCount: 1 },
  ]
  const sources = [
    { id: 'source-a' },
    { id: 'source-b', bibliographicItemId: 'paper-b' },
  ]
  const annotations = [
    { sourceId: 'source-a' },
    { bibliographicItemId: 'paper-a' },
    { sourceId: 'source-b' },
  ]
  const rows = buildPaperLibraryRows(items, sources, annotations)
  assert.equal(rows[0].source.id, 'source-a')
  assert.equal(rows[0].annotationCount, 2)
  assert.equal(rows[1].source.id, 'source-b')
  assert.equal(rows[1].annotationCount, 1)
})

test('普通资料不会被论文项目列表吞掉', async () => {
  const { unboundLibrarySources } = await import('../src/library-papers.mjs')
  const items = [{ id: 'paper-a', sourceId: 'source-a' }, { id: 'paper-b' }]
  const sources = [
    { id: 'source-a' },
    { id: 'source-b', bibliographicItemId: 'paper-b' },
    { id: 'source-notes' },
  ]
  assert.deepEqual(unboundLibrarySources(items, sources).map(source => source.id), ['source-notes'])
})

test('资料库摘要区分未读、阅读中、读完和方向不匹配', async () => {
  const { paperLibrarySummary, readingProgressPercent } = await import('../src/library-papers.mjs')
  const rows = [
    { item: { readingState: { readingStatus: 'unread', relevance: 'undecided' } }, annotationCount: 0 },
    { item: { readingState: { readingStatus: 'reading', relevance: 'core' } }, annotationCount: 3 },
    { item: { readingState: { readingStatus: 'finished', relevance: 'mismatched' } }, annotationCount: 1 },
  ]
  assert.deepEqual(paperLibrarySummary(rows), {
    total: 3,
    unread: 1,
    inProgress: 1,
    finished: 1,
    mismatched: 1,
    annotationTotal: 4,
  })
  assert.equal(readingProgressPercent({ lastPage: 7, totalPages: 20 }), 35)
  assert.equal(readingProgressPercent({ readingStatus: 'finished' }), 100)
})
