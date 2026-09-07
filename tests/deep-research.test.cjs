const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DEEP_RESEARCH_ID, searchPlan, searchUrl, evidenceReport } = require('../electron/workbench/deep-research.cjs')
const { buildModelContext, relevantExcerpt } = require('../electron/workbench/model-context.cjs')
const { WorkspaceService } = require('../electron/workspace-service.cjs')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')
const { WorkbenchService } = require('../electron/workbench/workbench-service.cjs')

test('检索计划限制次数、去重且只构造允许的数据库请求', () => {
  assert.throws(() => searchPlan({ queries: [], reason: '空' }, { round: 1 }), /至少/)
  assert.throws(() => searchPlan({ queries: ['a', 'b', 'c'], reason: '多' }, { round: 2 }), /最多/)
  const plan = searchPlan({ queries: ['Robot', 'new evidence'], reason: '反例', steps: [{ toolName: 'command.run' }] }, { round: 2, previousQueries: ['robot'] })
  assert.deepEqual(plan.queries, ['new evidence']); assert.equal(plan.steps.length, 2)
  assert.ok(plan.steps.every(step => step.toolName === 'literature.search'))
  assert.throws(() => searchUrl('malicious', 'q'))
  const url = new URL(searchUrl('arxiv', 'robot (OR cat:)'))
  assert.equal(url.hostname, 'export.arxiv.org'); assert.equal(url.searchParams.get('max_results'), '10')
  assert.ok(!url.searchParams.get('search_query').includes('(OR'))
})

test('长文中段命中研究问题，同时保留字符位置和总预算', () => {
  const body = 'start '.repeat(2500) + 'Semantic exploration ablation success dropped to 41 percent. ' + 'ending '.repeat(2500)
  const result = buildModelContext({ project: {}, query: 'semantic exploration ablation', maximumChars: 5000, observations: [{ id: 'paper', output: { document: { text: body } } }] })
  assert.match(result.context.completedStepObservations[0].body, /success dropped to 41 percent/)
  assert.match(result.context.completedStepObservations[0].body, /原文字符/)
  assert.ok(result.serialized.length <= 5000)
  for (let budget = 180; budget < 1700; budget += 43) assert.ok(relevantExcerpt(body, budget, 'ablation').content.length <= budget)
})

test('伪造来源、错误摘录和空结果都不能通过出处核验', () => {
  const catalog = [{ id: 'doi:10.1/real', text: 'The experiment used five independent random seeds.', evidenceLevel: 'metadata' }]
  const session = { requests: [], candidateCount: 1, status: 'ok', errors: [] }
  const report = claims => evidenceReport({ claims, gaps: [], nextSteps: [] }, catalog, session, [])
  for (const claims of [[], [{ statement: 'ok', sourceId: 'fake', quote: catalog[0].text }], [{ statement: 'ok', sourceId: catalog[0].id, quote: 'There were twenty random seeds.' }]]) assert.equal(report(claims).data.evidenceAudit.passed, false)
  assert.equal(report([{ statement: '使用五个随机种子', sourceId: catalog[0].id, quote: catalog[0].text }]).data.evidenceAudit.passed, true)
})

async function runScenario({ badQuote = false, offline = false, transient = false, repairFix = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-research-'))
  const workspace = new WorkspaceService({ registryPath: path.join(root, 'registry.json') })
  const vault = workspace.create(root, '研究验收'); const policy = new PolicyEngine(); const calls = []; const requests = []
  const abstract = 'The experiment used five independent random seeds.'
  const tools = new ToolRegistry({ policyEngine: policy, workspaceService: workspace, fetchImpl: async url => {
    requests.push(String(url))
    if (offline || String(url).includes('export.arxiv.org')) throw new Error('simulated outage')
    return { ok: true, text: async () => JSON.stringify({ message: { items: [{ DOI: '10.1000/evidence', title: ['Evidence test'], abstract }] } }) }
  } })
  const llm = { complete: async input => {
    if (transient) { transient = false; throw new Error('temporary model failure') }
    calls.push(input)
    const value = input.role === 'planner'
      ? { queries: calls.length === 1 ? ['robot exploration'] : ['robot ablation'], reason: '寻找基线与反例' }
      : { claims: offline ? [] : [{ statement: '实验使用五个独立随机种子。', sourceId: 'doi:10.1000/evidence', quote: badQuote && !(repairFix && input.role === 'verifier') ? 'Completely invented experimental results.' : abstract, relation: 'background' }], gaps: ['尚需阅读全文'], nextSteps: ['核对实验表格'] }
    return { content: JSON.stringify(value), providerId: 'test', model: 'test' }
  } }
  const service = new WorkbenchService({ workspaceService: workspace, policyEngine: policy, toolRegistry: tools, llmService: llm, settingsStore: { loadModelRoleConfig: () => ({}) } })
  try {
    const created = service.createRun({ objective: '深度研究机器人探索消融证据', conversationWorkflowId: DEEP_RESEARCH_ID })
    service.authorizeRun({ runId: created.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], domains: ['api.crossref.org', 'export.arxiv.org'] } })
    const run = await service.executeUntilBlocked(created.id)
    assert.equal(calls.length, badQuote ? 4 : 3); assert.equal(requests.length, 4)
    assert.equal(run.results.length, 1)
    const report = run.results[0]
    assert.equal(report.data.searchSession.status, offline ? 'error' : 'partial')
    assert.equal(report.data.searchSession.candidateCount, offline ? 0 : 1)
    assert.equal(report.data.plans.length, 2)
    assert.equal(run.status, (badQuote && !repairFix) || offline ? 'waiting_human' : 'completed')
    if (badQuote) {
      assert.equal(report.version, 2)
      assert.equal(run.artifacts.filter(item => item.kind === 'report').length, 2)
      assert.ok(calls.at(-1).messages[1].content.includes('需要修正的报告'))
    }
    assert.ok(calls[1].messages[1].content.includes('simulated outage'))
    if (!badQuote && !offline) {
      assert.equal(report.data.claims[0].matched, true)
      const saved = service.saveResult({ runId: run.id, resultId: report.id, content: report.content + '\n修改内容', data: { evidenceAudit: { passed: true } } })
      assert.equal(saved.results[0].data.evidenceAudit.passed, false)
      assert.equal(saved.results[0].data.evidenceAudit.edited, true)
    }
    const before = requests.length
    await assert.rejects(tools.execute('literature.search', { provider: 'crossref', query: 'robot' }, { domains: [] }), /授权/)
    assert.equal(requests.length, before)
  } finally { workspace.close(); fs.rmSync(root, { recursive: true, force: true }) }
}

test('真实服务链运行两轮、保留部分失败和去重、编辑后撤销自动核验状态', () => runScenario())
test('真实服务链阻止错误摘录完成研究任务', () => runScenario({ badQuote: true }))
test('数据库全失败时保留可读报告与恢复入口', () => runScenario({ offline: true }))
test('模型暂时失败会在原步骤有限重试并完成', () => runScenario({ transient: true }))
test('引用自动修正保留初稿与修订版本，并重新核验', () => runScenario({ badQuote: true, repairFix: true }))
