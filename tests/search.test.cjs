const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadSearchModule() {
  const sourcePath = path.join(__dirname, '..', 'src', 'local-search.mjs')
  return import(pathToFileURL(sourcePath).href)
}

test('local search finds titles, parsed text, MinerU markdown and user annotations', async () => {
  const { searchLocalLibrary } = await loadSearchModule()
  const sources = [{
    id: 'paper-1',
    name: 'Adaptive impedance control.pdf',
    extractedText: 'The controller improves robustness under uncertain stiffness.',
    mineruMarkdown: '## Method\nForce feedback is used during compliant assembly.',
  }]
  const annotations = [{
    id: 'note-1',
    sourceId: 'paper-1',
    text: '可用于试验方法部分',
    note: '需要复现刚度扰动设置',
    category: '方法',
    page: 'p. 7 · Fig. 5',
  }]

  assert.equal(searchLocalLibrary(sources, annotations, 'impedance')[0].origin, 'title')
  assert.equal(searchLocalLibrary(sources, annotations, 'robustness')[0].origin, 'document')
  assert.equal(searchLocalLibrary(sources, annotations, 'force feedback')[0].origin, 'mineru')
  const note = searchLocalLibrary(sources, annotations, '复现 刚度')[0]
  assert.equal(note.origin, 'annotation')
  assert.equal(note.pageNumber, 7)
})

test('local search is Unicode normalized, requires every term, and limits results', async () => {
  const { searchLocalLibrary, searchTerms } = await loadSearchModule()
  assert.deepEqual(searchTerms('  ＡI   方法 AI  '), ['ai', '方法'])
  const sources = Array.from({ length: 8 }, (_, index) => ({
    id: `paper-${index}`,
    name: `Paper ${index}`,
    extractedText: index % 2 === 0 ? 'adaptive control method' : 'adaptive observation',
  }))
  const results = searchLocalLibrary(sources, [], 'adaptive method', 2)
  assert.equal(results.length, 2)
  assert.ok(results.every(result => result.origin === 'document'))
})

test('page location parser does not invent invalid page numbers', async () => {
  const { pageNumberFromLocation } = await loadSearchModule()
  assert.equal(pageNumberFromLocation('page 12 · table 2'), 12)
  assert.equal(pageNumberFromLocation('p. 3'), 3)
  assert.equal(pageNumberFromLocation('legacy location'), undefined)
  assert.equal(pageNumberFromLocation('p. 0'), undefined)
})
