const assert = require('node:assert/strict')
const test = require('node:test')

test('复查 AI 请求明确带碎片 ID、来源类型与页码', async () => {
  const { buildReviewAIRequest } = await import('../src/review-ai.mjs')
  const request = buildReviewAIRequest([{
    id: 'f1',
    origin: 'source_evidence',
    kind: 'quote',
    itemTitle: 'Paper One',
    anchor: { pageNumber: 3 },
    content: 'Evidence',
  }])
  assert.match(request.system, /每条结论必须引用/)
  const payload = JSON.parse(request.user)
  assert.deepEqual(payload.fragments[0], {
    id: 'f1',
    origin: 'source_evidence',
    kind: 'quote',
    itemTitle: 'Paper One',
    pageNumber: 3,
    content: 'Evidence',
  })
})

test('AI 整理只接受白名单碎片引用，无引用结论不会进入文档', async () => {
  const { parseReviewAISections } = await import('../src/review-ai.mjs')
  const sections = parseReviewAISections(`\`\`\`json
[
  {"content":"有证据结论","citationFragmentIds":["f1","unknown","f1"]},
  {"content":"无证据推断","citationFragmentIds":[]}
]
\`\`\``, ['f1'])
  assert.deepEqual(sections, [{ content: '有证据结论', citationFragmentIds: ['f1'] }])
  assert.throws(() => parseReviewAISections('not json', ['f1']), /JSON 数组/)
})
