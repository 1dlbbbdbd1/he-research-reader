const assert = require('node:assert/strict')
const test = require('node:test')

test('PDF 页内搜索按页返回次数和上下文，并支持取消', async () => {
  const { searchPdfDocument } = await import('../src/pdf-navigation.mjs')
  const pages = [
    ['Adaptive impedance control improves robustness.', 'No second hit.'],
    ['This page is unrelated.'],
    ['Impedance is adapted online; impedance remains stable.'],
  ]
  const document = {
    numPages: pages.length,
    async getPage(pageNumber) {
      return { async getTextContent() { return { items: pages[pageNumber - 1].map(str => ({ str })) } } }
    },
  }
  const progress = []
  const results = await searchPdfDocument(document, 'IMPEDANCE', { onProgress: value => progress.push(value) })
  assert.deepEqual(results.map(result => [result.pageNumber, result.matchCount]), [[1, 1], [3, 2]])
  assert.match(results[0].excerpt, /impedance/i)
  assert.equal(progress.at(-1).pageNumber, 3)

  let calls = 0
  const canceled = await searchPdfDocument(document, 'page', { isCancelled: () => ++calls > 1 })
  assert.deepEqual(canceled, [])
})

test('PDF 目录解析层级、命名目的地和页引用', async () => {
  const { loadPdfOutline } = await import('../src/pdf-navigation.mjs')
  const reference = { num: 9, gen: 0 }
  const document = {
    async getOutline() {
      return [{
        title: '  Introduction  ',
        dest: 'intro',
        items: [{ title: 'Method', dest: [reference] }],
      }, { title: 'Broken destination', dest: 'missing' }]
    },
    async getDestination(name) {
      if (name === 'intro') return [2]
      throw new Error('missing')
    },
    async getPageIndex(value) {
      assert.equal(value, reference)
      return 6
    },
  }
  assert.deepEqual(await loadPdfOutline(document), [
    { id: 'outline-1', title: 'Introduction', depth: 0, pageNumber: 3 },
    { id: 'outline-2', title: 'Method', depth: 1, pageNumber: 7 },
    { id: 'outline-3', title: 'Broken destination', depth: 0, pageNumber: undefined },
  ])
})

test('每篇资料的阅读模式和缩放设置会校验范围', async () => {
  const { normalizeReaderSourceState, restoredReaderPage } = await import('../src/pdf-navigation.mjs')
  assert.deepEqual(normalizeReaderSourceState({ viewMode: 'parallel', zoom: 9 }), { viewMode: 'parallel', zoom: 3 })
  assert.deepEqual(normalizeReaderSourceState({ viewMode: 'bilingual', zoom: 1.15 }), { viewMode: 'bilingual', zoom: 1.15 })
  assert.deepEqual(normalizeReaderSourceState({ viewMode: 'markdown', zoom: .1 }, false), { viewMode: 'original', zoom: .5 })
  assert.deepEqual(normalizeReaderSourceState({ viewMode: 'unknown', zoom: 'bad' }), { viewMode: 'original', zoom: 1 })
  assert.equal(restoredReaderPage(17, 12), 12)
  assert.equal(restoredReaderPage(0, 12), 1)
  assert.equal(restoredReaderPage('7', 12), 7)
})
