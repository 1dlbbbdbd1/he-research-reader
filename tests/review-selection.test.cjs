const assert = require('node:assert/strict')
const test = require('node:test')

test('复查批注可通过 Source 绑定或 BibliographicItem.sourceId 找回论文', async () => {
  const { reviewAnnotationsForItems } = await import('../src/review-selection.mjs')
  const items = [
    { id: 'paper-a', sourceId: 'source-a' },
    { id: 'paper-b', sourceId: 'source-b' },
  ]
  const sources = [
    { id: 'source-a' },
    { id: 'source-b', bibliographicItemId: 'paper-b' },
  ]
  const annotations = [
    { id: 'note-a', sourceId: 'source-a' },
    { id: 'note-b', sourceId: 'source-b' },
    { id: 'note-c', sourceId: 'source-c' },
  ]
  assert.deepEqual(
    reviewAnnotationsForItems(annotations, sources, items, ['paper-a', 'paper-b']).map(note => note.id),
    ['note-a', 'note-b'],
  )
})

test('复查阅读进度同时显示页数和百分比', async () => {
  const { readingProgressLabel } = await import('../src/review-selection.mjs')
  assert.equal(readingProgressLabel({ lastPage: 7, totalPages: 20 }), '7/20 页 · 35%')
  assert.equal(readingProgressLabel({ readingStatus: 'finished' }), '已标记读完')
  assert.equal(readingProgressLabel({}), '进度未记录')
})
