const assert = require('node:assert/strict')
const test = require('node:test')

test('单篇阅读卡请求严格区分论文证据和用户内容', async () => {
  const { buildPaperReadingCardRequest } = await import('../src/paper-reading-card.mjs')
  const request = buildPaperReadingCardRequest({
    paper: { title: 'Compliant assembly' },
    contexts: [
      { contextId: 'C1', origin: 'document', label: 'MinerU 段落', content: 'The method uses force feedback.' },
      { contextId: 'C2', origin: 'user', label: '用户笔记', content: '考虑复现实验。' },
    ],
  })
  assert.match(request.system, /不能混写/)
  assert.match(request.system, /每个区块必须引用/)
  assert.deepEqual(request.contexts.map(context => context.contextId), ['C1', 'C2'])
  assert.match(request.user, /核心贡献/)
  assert.match(request.user, /实验设计与数据/)
  assert.match(request.user, /相关论文线索/)
})

test('阅读卡解析丢弃未知区块、重复区块和无白名单引用内容', async () => {
  const { parsePaperReadingCardAnswer } = await import('../src/paper-reading-card.mjs')
  const result = parsePaperReadingCardAnswer(JSON.stringify({
    sections: [
      { key: 'method', content: '采用力反馈。', citationIds: ['C1', 'UNKNOWN'] },
      { key: 'method', content: '重复方法。', citationIds: ['C1'] },
      { key: 'findings', content: '不能把用户笔记当论文结论。', citationIds: ['C2'] },
      { key: 'findings', content: '没有依据。', citationIds: [] },
      { key: 'invented', content: '未知区块。', citationIds: ['C1'] },
      { key: 'user_notes', content: '用户准备复现。', citationIds: ['C2'] },
    ],
  }), [{ contextId: 'C1', origin: 'document' }, { contextId: 'C2', origin: 'user' }])
  assert.deepEqual(result, [
    { key: 'method', title: '研究对象与方法', content: '采用力反馈。', citationIds: ['C1'] },
    { key: 'user_notes', title: '我的观点、批注与疑问', content: '用户准备复现。', citationIds: ['C2'] },
  ])
  assert.throws(
    () => parsePaperReadingCardAnswer('{"sections":[{"key":"method","content":"x","citationIds":["bad"]}]}', [{ contextId: 'C1', origin: 'document' }]),
    /没有任何可验证引用/,
  )
})
