const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('科研 Agent 从自然问题中提取本地检索词并过滤常见空词', async () => {
  const { agentQueryTerms } = await import('../src/research-agent.mjs')
  const terms = agentQueryTerms('为什么接触刚度变化会影响装配成功率？')
  assert.ok(terms.includes('接触') || terms.includes('接触刚度'))
  assert.ok(terms.includes('刚度') || terms.includes('刚度变化'))
  assert.equal(terms.includes('为什么'), false)
})

test('科研 Agent 用上一轮具体问题补足指代型追问，但不把历史当证据', async () => {
  const { agentRetrievalQuestion, buildResearchAgentRequest } = await import('../src/research-agent.mjs')
  const retrieval = agentRetrievalQuestion('那它有哪些局限？', ['这些论文使用了哪些刚度扰动评价指标？'])
  assert.match(retrieval, /刚度扰动评价指标/)
  assert.match(retrieval, /那它有哪些局限/)

  const request = buildResearchAgentRequest({
    question: '那它有哪些局限？',
    scopeLabel: '当前论文',
    evidence: [{ id: 'source:1', origin: 'source_evidence', title: '论文 A', excerpt: '固定参数基线在刚度变化时性能下降。' }],
    history: [{ role: 'user', content: '上一轮问题' }, { role: 'assistant', content: '上一轮回答' }],
  })
  const payload = JSON.parse(request.user)
  assert.equal(payload.history.length, 2)
  assert.match(request.system, /会话历史只用于理解追问，不能作为证据/)
})

test('科研 Agent 把当前选区或当前页作为可回跳的直接证据', async () => {
  const { readerContextEvidence } = await import('../src/research-agent.mjs')
  const context = {
    sourceId: 'source-1',
    sourceName: 'paper.pdf',
    itemId: 'item-1',
    paperTitle: '论文 A',
    pageNumber: 7,
    pageText: '第七页的完整原文。',
    selection: {
      text: '选中的原文证据。',
      anchor: { type: 'pdf', state: 'resolved', pageNumber: 7, rects: [{ x: .1, y: .2, width: .3, height: .04 }] },
    },
  }
  const selected = readerContextEvidence(context, 'selection')
  assert.equal(selected[0].originLabel, '当前选区')
  assert.equal(selected[0].excerpt, '选中的原文证据。')
  assert.equal(selected[0].anchor.pageNumber, 7)

  const page = readerContextEvidence(context, 'page')
  assert.equal(page[0].originLabel, '当前页原文')
  assert.equal(page[0].pageNumber, 7)
  assert.equal(page[0].anchor.state, 'resolved')
})

test('科研 Agent 优先排序带页码的原文证据和用户笔记', async () => {
  const { mergeAgentSearchResponses } = await import('../src/research-agent.mjs')
  const merged = mergeAgentSearchResponses([
    { results: [
      { id: 'doc', origin: 'document', title: 'A', excerpt: '接触刚度变化' },
      { id: 'evidence', origin: 'source_evidence', title: 'A', excerpt: '接触刚度变化', pageNumber: 4 },
      { id: 'note', origin: 'user', title: 'A', excerpt: '接触刚度变化', pageNumber: 4 },
    ] },
  ], ['刚度'])
  assert.deepEqual(merged.map(result => result.id), ['evidence', 'note', 'doc'])
})

test('科研 Agent 丢弃无引用和未知引用的 AI 结论', async () => {
  const { parseResearchAgentAnswer } = await import('../src/research-agent.mjs')
  const sections = parseResearchAgentAnswer(JSON.stringify({
    sections: [
      { content: '有证据的结论', citationIds: ['E1'] },
      { content: '没有证据的结论', citationIds: [] },
      { content: '伪造引用', citationIds: ['E999'] },
    ],
  }), [{ evidenceId: 'E1' }])
  assert.deepEqual(sections, [{ content: '有证据的结论', citationIds: ['E1'] }])
  assert.throws(
    () => parseResearchAgentAnswer('{"sections":[{"content":"无依据","citationIds":[]}]}', [{ evidenceId: 'E1' }]),
    /没有任何可验证引用/,
  )
})

test('科研 Agent 只保留带白名单证据的受控行动建议', async () => {
  const { parseResearchAgentActions } = await import('../src/research-agent.mjs')
  const actions = parseResearchAgentActions(JSON.stringify({
    sections: [{ content: '有证据结论', citationIds: ['E1'] }],
    actions: [
      { actionType: 'verify', title: '核对试验工况', rationale: '速度范围可能不同。', citationIds: ['E1'] },
      { actionType: 'delete', title: '删除论文', rationale: '不允许的动作。', citationIds: ['E1'] },
      { actionType: 'read', title: '凭空阅读', rationale: '没有证据。', citationIds: [] },
      { actionType: 'compare', title: '伪造引用', rationale: '引用不存在。', citationIds: ['E99'] },
    ],
  }), [{ evidenceId: 'E1' }])
  assert.deepEqual(actions, [{
    actionType: 'verify',
    title: '核对试验工况',
    rationale: '速度范围可能不同。',
    citationIds: ['E1'],
  }])
})

test('桌面桥接只暴露受控行动包创建、审批和完成接口', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  for (const channel of ['action-pack:create', 'action-pack:list', 'action-pack:get', 'action-pack:review-item', 'action-pack:complete-item']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  }
  for (const method of ['createActionPack', 'listActionPacks', 'getActionPack', 'reviewActionItem', 'completeActionItem']) {
    assert.match(preload, new RegExp(method))
  }
})
