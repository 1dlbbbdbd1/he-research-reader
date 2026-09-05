const assert = require('node:assert/strict')
const test = require('node:test')
const { parseLiteratureSearch } = require('../electron/workbench/literature-search-data.cjs')

test('Crossref 与 arXiv 真实响应会规范化为可追溯候选', () => {
  const search = parseLiteratureSearch([
    { completedAt: '2026-09-05T00:00:00Z', input: { url: 'https://api.crossref.org/works?query.bibliographic=robot&rows=10' }, output: { text: JSON.stringify({ message: { items: [{ DOI: '10.1000/Robot', title: [' Robot Study '], published: { 'date-parts': [[2024]] }, URL: 'https://doi.org/10.1000/Robot', abstract: '<jats:p>Abstract text</jats:p>' }] } }) } },
    { completedAt: '2026-09-05T00:00:01Z', input: { url: 'https://export.arxiv.org/api/query?search_query=all:robot&start=0&max_results=10' }, output: { text: '<feed><entry><id>http://arxiv.org/abs/2401.12345v2</id><title> Preprint Robot </title><summary>Preprint abstract</summary><published>2024-01-02T00:00:00Z</published></entry></feed>' } },
  ], { objective: 'robot' })
  assert.equal(search.status, 'ok'); assert.equal(search.candidateCount, 2); assert.equal(search.candidates[0].doi, '10.1000/robot'); assert.equal(search.candidates[1].arxivId, '2401.12345v2'); assert.equal(search.requests[0].scope.rows, '10')
})

test('无效响应保留明确解析错误，不伪装成无结果', () => {
  const search = parseLiteratureSearch([{ input: { url: 'https://api.crossref.org/works?rows=10' }, output: { text: '{not json' } }])
  assert.equal(search.status, 'error'); assert.equal(search.candidateCount, 0); assert.equal(search.errors.length, 1)
})

test('错误页面、截断响应与旧格式 arXiv 编号保持可识别', () => {
  for (const [url, text] of [['https://api.crossref.org/works', '{}'], ['https://export.arxiv.org/api/query', '<html>unavailable</html>']]) {
    assert.equal(parseLiteratureSearch([{ input: { url }, output: { text } }]).status, 'error')
  }
  assert.equal(parseLiteratureSearch([{ input: { url: 'https://api.crossref.org/works' }, output: { truncated: true, text: '{"message":{"items":[]}}' } }]).status, 'error')
  const result = parseLiteratureSearch([{ input: { url: 'https://export.arxiv.org/api/query' }, output: { text: '<feed><entry><id>http://arxiv.org/abs/cs/9901001v1</id><title>Old format</title></entry></feed>' } }])
  assert.equal(result.candidates[0].arxivId, 'cs/9901001v1')
})
