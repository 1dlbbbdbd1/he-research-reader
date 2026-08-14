const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

test('常用工作流按项目历史使用次数和最近时间排序', async () => {
  const { rankFrequentWorkflows } = await import('../src/workflow-history.mjs')
  const workflows = [
    { id: 'literature-search', featured: true },
    { id: 'literature-summary', featured: true },
    { id: 'experiment-method-summary', featured: true },
    { id: 'skill-teaching', featured: true },
  ]
  const packs = [{ id: 'systematic-review' }]
  const ranked = rankFrequentWorkflows([
    { conversationWorkflowId: 'literature-search', updatedAt: '2026-08-01T00:00:00.000Z' },
    { conversationWorkflowId: 'literature-search', updatedAt: '2026-08-02T00:00:00.000Z' },
    { capabilityPackId: 'systematic-review', updatedAt: '2026-08-03T00:00:00.000Z' },
    { conversationWorkflowId: 'literature-summary', updatedAt: '2026-08-04T00:00:00.000Z' },
    { conversationWorkflowId: 'removed-workflow', updatedAt: '2026-08-05T00:00:00.000Z' },
  ], workflows, packs, 4)

  assert.deepEqual(ranked.map(item => [item.kind, item.id, item.useCount]), [
    ['workflow', 'literature-search', 2],
    ['workflow', 'literature-summary', 1],
    ['capability', 'systematic-review', 1],
    ['workflow', 'experiment-method-summary', 0],
  ])
})
const { WorkspaceService } = require('../electron/workspace-service.cjs')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')
const { WorkbenchService } = require('../electron/workbench/workbench-service.cjs')

function withWorkbench(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workbench-'))
  const workspace = new WorkspaceService({ registryPath: path.join(root, 'app-data', 'workspaces.json') })
  const vault = workspace.create(root, 'Workbench 测试项目')
  const policy = new PolicyEngine()
  const fetchImpl = options.fetchImpl || (async () => ({ ok: true, headers: { get: () => 'text/plain' }, text: async () => 'ok', json: async () => ({ message: { items: [] } }), url: 'https://example.com/' }))
  const wordWorkflowScriptPath = options.wordReady ? path.join(root, 'word-workflow.ps1') : undefined
  if (wordWorkflowScriptPath) fs.writeFileSync(wordWorkflowScriptPath, '# test availability only')
  const tools = new ToolRegistry({ policyEngine: policy, fetchImpl, desktopAdapter: { listWindows: async () => [], captureWindow: async () => ({}) }, officeScriptPath: path.join(root, 'office.ps1'), wordWorkflowScriptPath, wordProbe: () => options.wordReady === true, workspaceService: workspace, translationAdapter: options.translationAdapter, translationDocumentAdapter: options.translationDocumentAdapter, imageAdapter: options.imageAdapter, analysisScriptPath: options.analysisScriptPath, researchPython: options.researchPython })
  const settings = { loadModelRoleConfig: role => ({ role, providerId: 'test', model: 'test-model' }) }
  const llm = options.llm || { complete: async input => ({ content: `role:${input.role}`, providerId: 'test', model: 'test-model', latencyMs: 1, usage: { totalTokens: 2 } }) }
  const service = new WorkbenchService({ workspaceService: workspace, toolRegistry: tools, policyEngine: policy, llmService: llm, settingsStore: settings })
  return Promise.resolve().then(() => run({ root, vault, workspace, service, policy, tools })).finally(() => { workspace.close(); fs.rmSync(root, { recursive: true, force: true }) })
}

test('schema v19 注册 Research Vault，并把能力状态与真实合同和工具预检绑定', () => withWorkbench(({ workspace, service }) => {
  assert.equal(workspace.inspectSchema().schemaVersion, 19)
  const dashboard = service.getDashboard()
  assert.equal(dashboard.project.kind, 'research')
  assert.equal(service.listCapabilityPacks().length, 10)
  assert.equal(service.listCapabilityPacks().filter(pack => pack.maturity === 'trial').length, 5)
  assert.equal(service.listCapabilityPacks().find(pack => pack.id === 'research-reference-check').preflight.ready, true)
  assert.equal(service.listCapabilityPacks().find(pack => pack.id === 'research-document-formatting').maturity, 'missing_tools')
  const enabled = service.setCapabilityPack({ id: 'research-reference-check', enabled: true })
  assert.ok(enabled.project.capabilityPacks.includes('research-reference-check'))
  service.setCapabilityPack({ id: 'research-reference-check', enabled: false })
  const directRun = service.createRun({ objective: '直接从对话使用引用核验', capabilityPack: 'research-reference-check', capabilityInput: { pastedText: 'A reference. 2024.' } })
  assert.equal(directRun.capabilityPackId, 'research-reference-check')
}))

test('项目内容浏览只读当前项目，并可预览常见文本文件', () => withWorkbench(({ vault, service }) => {
  const notePath = path.join(vault.path, 'notes', 'preview.md')
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, '# 项目预览\n只读内容', 'utf8')
  const listing = service.listProjectFiles({ maximumDepth: 3 })
  assert.ok(listing.entries.some(entry => entry.relativePath === path.join('notes', 'preview.md')))
  const preview = service.previewProjectFile({ relativePath: path.join('notes', 'preview.md') })
  assert.equal(preview.previewable, true)
  assert.match(preview.content, /项目预览/)
  assert.throws(() => service.previewProjectFile({ relativePath: path.join('..', 'outside.txt') }), /超出了当前项目/)
}))

test('项目内容可在抽屉中安全预览图片与 PDF 数据', () => withWorkbench(({ vault, service }) => {
  const imagePath = path.join(vault.path, 'figure.png')
  const pdfPath = path.join(vault.path, 'paper.pdf')
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'))
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n% preview test', 'utf8'))
  const image = service.previewProjectFile({ relativePath: 'figure.png' })
  const pdf = service.previewProjectFile({ relativePath: 'paper.pdf' })
  assert.equal(image.kind, 'image')
  assert.match(image.content, /^data:image\/png;base64,/)
  assert.equal(pdf.kind, 'pdf')
  assert.match(pdf.content, /^data:application\/pdf;base64,/)
}))

test('对话中的常见科研辅助生成真实固定步骤，而不是提示词标签', () => withWorkbench(({ workspace, service }) => {
  const workflows = service.listConversationWorkflows()
  assert.equal(workflows.length, 12)
  for (const id of ['literature-search', 'literature-summary', 'method-summary', 'skill-teaching', 'research-question', 'experiment-design', 'multi-paper-comparison', 'reproducibility-check', 'data-analysis-plan', 'paper-outline', 'research-progress-report', 'result-interpretation']) assert.ok(workflows.some(item => item.id === id))
  assert.equal(workflows.filter(item => item.featured).length, 4)
  assert.ok(workflows.every(item => item.available))

  const search = service.createRun({ objective: '柔顺装配中的阻抗控制', conversationWorkflowId: 'literature-search' })
  assert.equal(search.conversationWorkflowId, 'literature-search')
  assert.deepEqual(search.steps.map(step => step.toolName || step.kind), ['project.inspect', 'web.fetch', 'model', 'verify'])
  assert.deepEqual(search.preflight.permissionRequirements.domains, ['api.crossref.org'])
  assert.match(search.steps[1].input.url, /^https:\/\/api\.crossref\.org\/works\?/)

  assert.throws(() => service.createRun({ objective: '总结方法差异', conversationWorkflowId: 'literature-summary' }), /至少 1 份项目资料/)
  const timestamp = new Date().toISOString()
  workspace.database.prepare(`
    INSERT INTO sources(id, project_id, name, kind, status, pages, content_sha256, extracted_text, source_metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, 'PDF', '已解析', 3, ?, ?, '{}', ?, ?)
  `).run('workflow-source-1', workspace.getCurrent().projectId, '方法论文.pdf', 'workflow-source-hash', '实验方法与结果正文', timestamp, timestamp)
  const summary = service.createRun({ objective: '比较实验方法', conversationWorkflowId: 'literature-summary', conversationWorkflowInput: { sourceIds: ['workflow-source-1'] } })
  assert.equal(summary.steps.find(step => step.toolName === 'research.source.read').input.sourceId, 'workflow-source-1')
  assert.equal(summary.steps.at(-2).title, '形成文献分析总结')
  assert.throws(() => service.createRun({ objective: '比较两篇论文', conversationWorkflowId: 'multi-paper-comparison', conversationWorkflowInput: { sourceIds: ['workflow-source-1'] } }), /至少 2 份/)
}))

test('文献检索固定工作流按授权范围真实调用检索工具并完成模型整理', () => {
  let requestedUrl = ''
  const fetchImpl = async url => {
    requestedUrl = String(url)
    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ message: { items: [{ DOI: '10.1000/test', title: ['Compliant assembly'] }] } }), url: requestedUrl }
  }
  return withWorkbench(async ({ vault, service }) => {
    const run = service.createRun({ objective: '柔顺装配阻抗控制', conversationWorkflowId: 'literature-search' })
    service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], domains: ['api.crossref.org'] } })
    const completed = await service.executeUntilBlocked(run.id)
    assert.equal(completed.status, 'completed')
    assert.match(requestedUrl, /api\.crossref\.org\/works/)
    assert.equal(completed.steps.find(step => step.toolName === 'web.fetch').status, 'completed')
    assert.equal(completed.steps.find(step => step.title === '整理候选文献').output.content, 'role:executor')
  }, { fetchImpl })
})

test('任务可归入当前项目对话且不能绑定其他项目的对话 ID', () => withWorkbench(({ workspace, service }) => {
  const now = new Date().toISOString()
  const sessionId = 'session-workbench-link'
  workspace.database.prepare('INSERT INTO agent_sessions(id, project_id, title, status, scope_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sessionId, workspace.getCurrent().projectId, '文献检索对话', 'active', '{}', now, now)
  const run = service.createRun({ objective: '检索柔顺装配文献', sessionId })
  assert.equal(run.sessionId, sessionId)
  assert.throws(() => service.createRun({ objective: '绑定错误会话', sessionId: 'missing-session' }), /不属于当前项目/)
}))

test('Word 能力只有在脚本和本机 Word 均可用时才通过预检', () => withWorkbench(({ service }) => {
  const word = service.listCapabilityPacks().find(pack => pack.id === 'research-document-formatting')
  assert.equal(word.preflight.ready, true)
  assert.equal(word.maturity, 'trial')
  assert.deepEqual(word.preflight.permissionRequirements.applications, ['word'])
}, { wordReady: true }))

test('Run 必须先授权，步骤完成后留下检查点和只追加事件', () => withWorkbench(async ({ vault, workspace, service }) => {
  const run = service.createRun({ objective: '检查项目并给出工程分析', acceptance: ['项目结构已读取'], taskType: 'engineering' })
  assert.equal(run.status, 'awaiting_authorization')
  await assert.rejects(() => service.executeNext(run.id), /运行状态/)
  const authorized = service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], domains: ['example.com'], commands: [process.execPath], applications: ['vscode'], allowScreenshots: false } })
  assert.equal(authorized.status, 'running')
  const afterInspect = await service.executeNext(run.id)
  assert.equal(afterInspect.steps[0].status, 'completed')
  assert.ok(workspace.database.prepare('SELECT COUNT(*) count FROM agent_checkpoints WHERE run_id = ?').get(run.id).count >= 2)
  const event = workspace.database.prepare('SELECT * FROM agent_events WHERE run_id = ? LIMIT 1').get(run.id)
  assert.throws(() => workspace.database.prepare("UPDATE agent_events SET actor = 'agent' WHERE id = ?").run(event.id), /append-only/)
}))

test('重启恢复会暂停运行并使旧授权过期', () => withWorkbench(({ vault, workspace, service, policy, tools }) => {
  const run = service.createRun({ objective: '恢复测试' })
  service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
  const recovered = new WorkbenchService({ workspaceService: workspace, toolRegistry: tools, policyEngine: policy, llmService: { complete: async () => ({}) }, settingsStore: { loadModelRoleConfig: () => ({}) } })
  assert.equal(recovered.recoverInterruptedRuns(), 1)
  const restored = recovered.getRun(run.id)
  assert.equal(restored.status, 'paused')
  assert.equal(restored.permission, undefined)
}))

test('验收不完整时不能假装完成', () => withWorkbench(async ({ vault, service }) => {
  const run = service.createRun({ objective: '需要两项证据', acceptance: ['步骤结束', '存在正式证据'] })
  service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
  const checked = await service.verifyRun(run.id)
  assert.equal(checked.status, 'waiting_human')
  assert.equal(checked.latestEvaluation.status, 'failed')
}))

test('人工高风险步骤批准一次后可以完成而不会重复确认', () => withWorkbench(async ({ vault, service }) => {
  const run = service.createRun({ objective: '打开授权应用', taskType: 'desktop' })
  service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], applications: ['vscode'] } })
  await service.executeNext(run.id)
  const waiting = await service.executeNext(run.id)
  assert.equal(waiting.status, 'waiting_human')
  const decision = waiting.decisions.find(item => item.status === 'pending')
  const resumed = service.resolveDecision({ decisionId: decision.id, approved: true })
  assert.equal(resumed.status, 'running')
  const completedHumanStep = await service.executeNext(run.id)
  assert.equal(completedHumanStep.steps.find(step => step.kind === 'human').status, 'completed')
  assert.equal(completedHumanStep.decisions.filter(item => item.status === 'pending').length, 0)
}))

test('Planner 的结构化工具计划经过白名单校验后插入验收步骤之前', () => {
  let outputPath = ''
  const llm = { complete: async () => ({ content: JSON.stringify({ summary: '生成新版本报告', steps: [{ kind: 'tool', toolName: 'file.writeVersioned', title: '保存分析报告', rationale: '形成可验收产物', input: { path: outputPath, content: '# report' } }] }), providerId: 'test', model: 'planner', usage: { totalTokens: 8 } }) }
  return withWorkbench(async ({ vault, service }) => {
    outputPath = path.join(vault.path, 'reports', 'analysis.md')
    const run = service.createRun({ objective: '分析项目并生成报告', taskType: 'engineering', acceptance: ['已生成报告'] })
    service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    await service.executeNext(run.id)
    const planned = await service.executeNext(run.id)
    const reportStep = planned.steps.find(step => step.toolName === 'file.writeVersioned')
    const verifyStep = planned.steps.find(step => step.kind === 'verify')
    assert.ok(reportStep)
    assert.ok(reportStep.position < verifyStep.position)
    const executed = await service.executeNext(run.id)
    assert.equal(executed.steps.find(step => step.id === reportStep.id).status, 'completed')
    assert.equal(fs.readFileSync(outputPath, 'utf8'), '# report')
  }, { llm })
})

test('工具首次失败后创建新计划版本并用第二种方案继续', () => {
  let vaultRoot = ''; let calls = 0
  const llm = { complete: async () => {
    calls += 1
    const content = calls === 1
      ? JSON.stringify({ summary: '先检查另一个目录', steps: [{ kind: 'tool', toolName: 'project.inspect', title: '检查候选目录', input: { root: path.join(os.tmpdir(), 'not-authorized-workbench-root') } }] })
      : JSON.stringify({ strategy: '回到已经授权的项目根目录', replacement: { kind: 'tool', toolName: 'project.inspect', title: '检查授权项目目录', input: { root: vaultRoot } } })
    return { content, providerId: 'test', model: 'planner', usage: { totalTokens: 8 } }
  } }
  return withWorkbench(async ({ vault, service }) => {
    vaultRoot = vault.path
    const run = service.createRun({ objective: '失败后换一种目录检查方案', taskType: 'engineering' })
    service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    await service.executeNext(run.id)
    await service.executeNext(run.id)
    const replanned = await service.executeNext(run.id)
    assert.equal(replanned.status, 'running')
    assert.equal(replanned.planVersion, 2)
    const revised = replanned.steps.find(step => step.title === '检查授权项目目录')
    assert.ok(revised)
    assert.equal(revised.attemptCount, 1)
    const completed = await service.executeNext(run.id)
    assert.equal(completed.steps.find(step => step.id === revised.id).status, 'completed')
  }, { llm })
})

test('Verifier 只有引用真实运行证据 ID 才能通过验收', () => {
  const llm = { complete: async input => {
    if (input.role !== 'verifier') return { content: JSON.stringify({ summary: '无需追加工具', steps: [] }), providerId: 'test', model: 'planner' }
    const evidence = JSON.parse(input.messages[1].content.split('运行证据元数据：')[1])
    return { content: JSON.stringify({ summary: '项目检查步骤可证明验收条件', criteria: [{ label: '项目已检查', passed: true, evidence: [{ type: evidence[0].type, id: evidence[0].id }] }] }), providerId: 'test', model: 'verifier' }
  } }
  return withWorkbench(async ({ vault, service }) => {
    const run = service.createRun({ objective: '检查项目', taskType: 'engineering', acceptance: ['项目已检查'] })
    service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    await service.executeNext(run.id)
    await service.executeNext(run.id)
    const completed = await service.executeNext(run.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.latestEvaluation.status, 'passed')
    assert.equal(completed.latestEvaluation.criteria[0].evidence.length, 1)
  }, { llm })
})

test('连续运行循环会执行到完成或需要人工处理时停止', () => withWorkbench(async ({ vault, service }) => {
  const run = service.createRun({ objective: '完成一个无额外验收条件的工程观察', taskType: 'engineering' })
  service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
  const completed = await service.executeUntilBlocked(run.id)
  assert.equal(completed.status, 'completed')
  assert.ok(completed.steps.every(step => step.status === 'completed'))
}))

test('引用核验使用固定工作流、外部发送二次确认、可编辑结果版本和新文件导出', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'reference-check.json'), 'utf8'))
  const fetchImpl = async urlValue => {
    const url = String(urlValue)
    assert.match(url, /^https:\/\/api\.crossref\.org\/works/)
    return {
      ok: true,
      json: async () => ({ message: fixture.crossrefResponse.message }),
    }
  }
  return withWorkbench(async ({ vault, service }) => {
    service.setCapabilityPack({ id: 'research-reference-check', enabled: true })
    const outputPath = path.join(vault.path, 'exports', 'citation-report.md')
    const run = service.createRun({
      objective: '核验粘贴文本中的参考文献',
      capabilityPack: 'research-reference-check',
      capabilityInput: { pastedText: fixture.input.pastedText, outputPath },
    })
    assert.deepEqual(run.steps.map(step => step.input._workflowStepId).filter(Boolean), ['read-source', 'extract-citations', 'approve-crossref', 'verify-crossref', 'draft-report', 'review-report', 'export-report', 'verify-capability'])
    assert.equal(run.steps.some(step => step.kind === 'model'), false)
    assert.throws(() => service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } }), /api\.crossref\.org/)
    service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], domains: ['api.crossref.org'] } })
    await service.executeNext(run.id)
    await service.executeNext(run.id)
    const extracted = await service.executeNext(run.id)
    assert.equal(extracted.steps.find(step => step.input._workflowStepId === 'extract-citations').output.count, fixture.expected.referenceCount)
    let waiting = await service.executeNext(run.id)
    service.resolveDecision({ decisionId: waiting.decisions.find(decision => decision.status === 'pending').id, approved: true })
    await service.executeNext(run.id)
    waiting = await service.executeNext(run.id)
    assert.match(waiting.decisions.find(decision => decision.status === 'pending').prompt, /api\.crossref\.org/)
    service.resolveDecision({ decisionId: waiting.decisions.find(decision => decision.status === 'pending').id, approved: true })
    const verified = await service.executeNext(run.id)
    assert.equal(verified.steps.find(step => step.input._workflowStepId === 'verify-crossref').output.summary.confirmed, 1)
    const drafted = await service.executeNext(run.id)
    assert.equal(drafted.results.length, 1)
    assert.match(drafted.results[0].content, /确认存在：1/)
    const edited = service.saveResult({ runId: run.id, resultId: drafted.results[0].id, content: `${drafted.results[0].content}\n人工备注：已复核。`, reviewState: 'confirmed' })
    assert.equal(edited.results[0].version, 2)
    assert.equal(edited.results[0].reviewState, 'confirmed')
    waiting = await service.executeNext(run.id)
    service.resolveDecision({ decisionId: waiting.decisions.find(decision => decision.status === 'pending').id, approved: true })
    await service.executeNext(run.id)
    const exported = await service.executeNext(run.id)
    assert.equal(fs.existsSync(outputPath), true)
    assert.match(fs.readFileSync(outputPath, 'utf8'), /人工备注：已复核/)
    const completed = await service.executeNext(run.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.artifacts.filter(artifact => artifact.kind === 'report').length, 2)
  }, { fetchImpl })
})

test('证据化精读与学术翻译复用结构化阅读顺序、逐段缓存和原文锚点', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'paper-reading.json'), 'utf8'))
  const translationAdapter = { availability: () => ({ available: true }), model: () => 'fixture-local', translate: async ({ text }) => `译文：${text}` }
  const translationDocumentAdapter = { export: async ({ content, docxPath, pdfPath }) => {
    const crypto = require('node:crypto'); fs.mkdirSync(path.dirname(docxPath), { recursive: true }); fs.mkdirSync(path.dirname(pdfPath), { recursive: true })
    fs.writeFileSync(docxPath, `DOCX:${content}`); fs.writeFileSync(pdfPath, `%PDF-1.7\n${content}`)
    return { docxPath, pdfPath, docxSha256: crypto.createHash('sha256').update(fs.readFileSync(docxPath)).digest('hex'), pdfSha256: crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex'), pdfByteLength: fs.statSync(pdfPath).size, pageCount: 2, paragraphCount: 8, renderedBy: 'fixture Word renderer', repaginated: true, passed: true, anomalies: [] }
  } }
  return withWorkbench(async ({ vault, workspace, service }) => {
    const current = workspace.getCurrent(); const timestamp = new Date().toISOString()
    workspace.database.prepare(`INSERT INTO sources(id, project_id, name, kind, version, status, derived_markdown, source_metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, 'PDF', 1, '已解析', ?, '{}', ?, ?)`).run(fixture.sourceId, current.projectId, 'structured-paper-fixture.pdf', fixture.markdown, timestamp, timestamp)
    for (const capabilityPack of ['research-paper-reading', 'research-academic-translation']) service.setCapabilityPack({ id: capabilityPack, enabled: true })
    assert.equal(service.listCapabilityPacks().find(pack => pack.id === 'research-paper-reading').preflight.ready, true)
    assert.equal(service.listCapabilityPacks().find(pack => pack.id === 'research-academic-translation').preflight.ready, true)

    async function finish(capabilityPack, outputName) {
      let run = service.createRun({ objective: `执行 ${capabilityPack} 固定工作流`, capabilityPack, capabilityInput: { sourceId: fixture.sourceId, outputPath: path.join(vault.path, 'exports', outputName), maxSegments: 1000 } })
      assert.equal(run.steps.some(step => step.kind === 'model'), false)
      run = service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], applications: capabilityPack === 'research-academic-translation' ? ['word'] : [] } })
      for (let guard = 0; guard < 30 && run.status !== 'completed'; guard += 1) {
        if (run.status === 'waiting_human') run = service.resolveDecision({ decisionId: run.decisions.find(decision => decision.status === 'pending').id, approved: true })
        else if (run.status === 'running') run = await service.executeNext(run.id)
        else break
      }
      return run
    }

    const reading = await finish('research-paper-reading', 'paper-reading.md')
    assert.equal(reading.status, 'completed')
    const readingQa = reading.steps.find(step => step.input._workflowStepId === 'qa-reading').output.qa
    assert.equal(readingQa.sourcePreserved, fixture.expected.sourcePreserved)
    const readingResult = reading.results.find(result => result.type === 'bilingual_reading')
    assert.ok(readingResult.data.summary.translated >= fixture.expected.minimumTranslatedSegments)
    assert.match(readingResult.content, new RegExp(fixture.expected.protectedDoi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(readingResult.content, /PDF 第|可回到结构块/)

    const translation = await finish('research-academic-translation', 'academic-translation.md')
    assert.equal(translation.status, 'completed')
    assert.equal(translation.steps.find(step => step.input._workflowStepId === 'qa-translation').output.qa.passed, true)
    assert.equal(translation.steps.find(step => step.input._workflowStepId === 'export-translation-documents').output.pageCount, 2)
    assert.equal(fs.existsSync(path.join(vault.path, 'exports', 'academic-translation.md')), true)
    assert.equal(fs.existsSync(path.join(vault.path, 'exports', 'academic-translation.docx')), true)
    assert.equal(fs.existsSync(path.join(vault.path, 'exports', 'academic-translation.pdf')), true)
    const cached = workspace.database.prepare('SELECT COUNT(*) count FROM reading_translation_segments WHERE source_id = ?').get(fixture.sourceId).count
    assert.ok(cached >= fixture.expected.minimumTranslatedSegments)
  }, { translationAdapter, translationDocumentAdapter })
})

test('审稿回复固定工作流逐条保留原文，并阻止无证据的已经修改声明', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'reviewer-response.json'), 'utf8'))
  return withWorkbench(async ({ vault, workspace, service, tools }) => {
    const currentProject = workspace.getCurrent(); const timestamp = new Date().toISOString()
    const insert = workspace.database.prepare(`INSERT INTO sources(id, project_id, name, kind, version, status, derived_markdown, source_metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, 'Markdown', 1, '已解析', ?, '{}', ?, ?)`)
    for (const source of fixture.sources) insert.run(source.id, currentProject.projectId, source.name, source.text, timestamp, timestamp)
    service.setCapabilityPack({ id: 'research-reviewer-response', enabled: true })
    const outputPath = path.join(vault.path, 'exports', 'response-letter.md')
    let current = service.createRun({ objective: '逐条分析审稿意见并导出回复信', capabilityPack: 'research-reviewer-response', capabilityInput: { comments: fixture.comments, handlingPlans: fixture.handlingPlans, evidenceLinks: fixture.evidenceLinks, outputPath } })
    assert.equal(current.steps.some(step => step.kind === 'model'), false)
    assert.deepEqual(current.steps.map(step => step.input._workflowStepId).filter(Boolean), ['import-review-comments', 'confirm-review-comments', 'plan-review-responses', 'confirm-response-plan', 'link-response-evidence', 'draft-response-letter', 'confirm-response-letter', 'validate-response-letter', 'export-response-letter', 'verify-capability'])
    current = service.authorizeRun({ runId: current.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    for (let guard = 0; guard < 30 && current.status !== 'completed'; guard += 1) {
      if (current.status === 'waiting_human') {
        const draft = current.results.find(result => result.type === 'review_response_letter')
        if (draft && draft.reviewState !== 'confirmed') current = service.saveResult({ runId: current.id, resultId: draft.id, content: `${draft.content}\n\nSincerely,\nThe Authors`, reviewState: 'confirmed' })
        current = service.resolveDecision({ decisionId: current.decisions.find(decision => decision.status === 'pending').id, approved: true })
      } else current = await service.executeNext(current.id)
    }
    assert.equal(current.status, 'completed', JSON.stringify({ status: current.status, steps: current.steps.map(step => ({ id: step.input._workflowStepId, status: step.status, error: step.error })), decisions: current.decisions }))
    const comments = current.steps.find(step => step.input._workflowStepId === 'import-review-comments').output.comments
    const qa = current.steps.find(step => step.input._workflowStepId === 'validate-response-letter').output.qa
    assert.equal(comments.length, fixture.expected.commentCount)
    assert.ok(comments.every(comment => comment.reviewer && comment.number && comment.original && comment.type && comment.severity && comment.requiredEvidence.length))
    assert.equal(qa.evidenceLinkCount, fixture.expected.evidenceLinkCount)
    assert.equal(qa.completedModificationCount, fixture.expected.completedModificationCount)
    assert.equal(fs.existsSync(outputPath), true)
    assert.match(fs.readFileSync(outputPath, 'utf8'), /Sincerely/)
    await assert.rejects(() => tools.execute('reviewer.draftLetter', { records: [{ ...comments[0], status: 'already_modified', strategy: '已完成', targetLocations: ['Methods'], evidenceLinks: [] }] }), /没有修改稿位置证据/)
  })
})

test('路线图先编辑结构化图数据，再检查并导出 Draw.io、SVG 和 JSON', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'roadmap.json'), 'utf8'))
  return withWorkbench(async ({ vault, service }) => {
    service.setCapabilityPack({ id: 'research-roadmap', enabled: true })
    const paths = { dataPath: path.join(vault.path, 'exports', 'roadmap.json'), drawioPath: path.join(vault.path, 'exports', 'roadmap.drawio'), svgPath: path.join(vault.path, 'exports', 'roadmap.svg') }
    let current = service.createRun({ objective: '生成可追溯研究路线图', capabilityPack: 'research-roadmap', capabilityInput: { ...fixture.input, ...paths } })
    current = service.authorizeRun({ runId: current.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    for (let guard = 0; guard < 35 && current.status !== 'completed'; guard += 1) {
      if (current.status === 'waiting_human') {
        const dataResult = current.results.find(result => result.type === 'roadmap_data')
        if (dataResult && dataResult.reviewState !== 'confirmed') current = service.saveResult({ runId: current.id, resultId: dataResult.id, content: dataResult.content.replace('训练模型', fixture.expected.editedLabel), reviewState: 'confirmed' })
        current = service.resolveDecision({ decisionId: current.decisions.find(decision => decision.status === 'pending').id, approved: true })
      } else current = await service.executeNext(current.id)
    }
    assert.equal(current.status, 'completed')
    const qa = current.steps.find(step => step.input._workflowStepId === 'qa-roadmap').output.qa
    assert.equal(qa.nodeCount, fixture.expected.nodeCount)
    assert.equal(qa.edgeCount, fixture.expected.edgeCount)
    assert.equal(qa.cycleDetected, false)
    assert.equal(qa.orphanNodes.length, 0)
    assert.match(fs.readFileSync(paths.dataPath, 'utf8'), new RegExp(fixture.expected.editedLabel))
    assert.match(fs.readFileSync(paths.drawioPath, 'utf8'), /<mxfile/)
    assert.match(fs.readFileSync(paths.svgPath, 'utf8'), new RegExp(fixture.expected.editedLabel))
  })
})

test('专利草案只使用技术报告中的事实，权利要求保留映射并明确法律事项未完成', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'patent-draft.json'), 'utf8'))
  return withWorkbench(async ({ vault, workspace, service, tools }) => {
    const currentProject = workspace.getCurrent(); const timestamp = new Date().toISOString()
    workspace.database.prepare(`INSERT INTO sources(id, project_id, name, kind, version, status, derived_markdown, source_metadata_json, created_at, updated_at)
      VALUES (?, ?, 'technical-report.md', 'Markdown', 1, '已解析', ?, '{}', ?, ?)`).run(fixture.sourceId, currentProject.projectId, fixture.report, timestamp, timestamp)
    service.setCapabilityPack({ id: 'research-patent-draft', enabled: true })
    const outputPath = path.join(vault.path, 'exports', 'patent-draft.md')
    let current = service.createRun({ objective: '生成有来源映射的专利辅助草案', capabilityPack: 'research-patent-draft', capabilityInput: { sourceId: fixture.sourceId, title: fixture.title, terms: fixture.terms, outputPath } })
    current = service.authorizeRun({ runId: current.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    for (let guard = 0; guard < 30 && current.status !== 'completed'; guard += 1) {
      if (current.status === 'waiting_human') {
        const draft = current.results.find(result => result.type === 'patent_draft')
        if (draft && draft.reviewState !== 'confirmed') current = service.saveResult({ runId: current.id, resultId: draft.id, content: `${draft.content}\n\n人工备注：仅作为草案继续复核。`, reviewState: 'confirmed' })
        current = service.resolveDecision({ decisionId: current.decisions.find(decision => decision.status === 'pending').id, approved: true })
      } else current = await service.executeNext(current.id)
    }
    assert.equal(current.status, 'completed')
    const draft = current.results.find(result => result.type === 'patent_draft')
    const qa = current.steps.find(step => step.input._workflowStepId === 'validate-patent-draft').output.qa
    assert.ok(draft.data.claims.length >= fixture.expected.minimumClaims)
    assert.equal(qa.noveltySearchStatus, fixture.expected.noveltyStatus)
    assert.equal(qa.unsupportedClaimCount, fixture.expected.unsupportedClaims)
    assert.match(draft.content, /不是法律意见/)
    assert.match(draft.content, /新颖性检索未完成/)
    assert.ok(draft.data.claims.every(claim => claim.sourceFactIds.length > 0))
    assert.match(fs.readFileSync(outputPath, 'utf8'), /人工备注/)
    await assert.rejects(() => tools.execute('patent.extractFacts', { sourceId: fixture.sourceId, technicalFacts: { technicalProblem: [{ text: '虚构问题', sourceQuote: '报告中不存在的句子' }] } }), /找不到/)
  })
})

test('科研图表保持原始数据只读，编辑规格后真实生成 SVG、PNG、JPG 和 QA', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'research-figure.json'), 'utf8'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  return withWorkbench(async ({ vault, service }) => {
    const rawDataPath = path.join(vault.path, 'raw', 'figure.csv'); fs.mkdirSync(path.dirname(rawDataPath), { recursive: true }); fs.writeFileSync(rawDataPath, fixture.csv)
    const rawHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(rawDataPath)).digest('hex')
    service.setCapabilityPack({ id: 'research-paper-figure', enabled: true })
    const paths = { cleanedDataPath: path.join(vault.path, 'exports', 'cleaned.csv'), sourcePath: path.join(vault.path, 'exports', 'figure.json'), svgPath: path.join(vault.path, 'exports', 'figure.svg'), pngPath: path.join(vault.path, 'exports', 'figure.png'), jpgPath: path.join(vault.path, 'exports', 'figure.jpg') }
    let current = service.createRun({ objective: '生成可重复的双面板科研图', capabilityPack: 'research-paper-figure', capabilityInput: { rawDataPath, dataContract: fixture.dataContract, figureSpec: fixture.figureSpec, ...paths } })
    current = service.authorizeRun({ runId: current.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    for (let guard = 0; guard < 40 && current.status !== 'completed'; guard += 1) {
      if (current.status === 'waiting_human') {
        const spec = current.results.find(result => result.type === 'figure_spec')
        if (spec && spec.reviewState !== 'confirmed') current = service.saveResult({ runId: current.id, resultId: spec.id, content: spec.content.replace('Response over time', fixture.expected.editedTitle), reviewState: 'confirmed' })
        current = service.resolveDecision({ decisionId: current.decisions.find(decision => decision.status === 'pending').id, approved: true })
      } else current = await service.executeNext(current.id)
    }
    assert.equal(current.status, 'completed')
    const qa = current.steps.find(step => step.input._workflowStepId === 'qa-figure').output.qa
    assert.equal(qa.panelCount, fixture.expected.panelCount)
    assert.equal(qa.rawUnchanged, true)
    assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(rawDataPath)).digest('hex'), rawHash)
    assert.match(fs.readFileSync(paths.svgPath, 'utf8'), new RegExp(fixture.expected.editedTitle))
    assert.equal(fs.readFileSync(paths.pngPath).equals(png), true)
    assert.equal(fs.readFileSync(paths.jpgPath).equals(jpg), true)
    assert.equal(fs.readFileSync(paths.cleanedDataPath, 'utf8').trim().split(/\r?\n/).length - 1, fixture.expected.rowCount)
  }, { imageAdapter: { svgToPng: async () => png, svgToJpeg: async () => jpg } })
})

test('DID 在确认的 Python 环境真实运行，保存代码版本和对应平行趋势诊断', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'causal-did.json'), 'utf8'))
  const pythonPath = process.env.READER_RESEARCH_PYTHON || path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')
  const analysisScriptPath = path.join(__dirname, '..', 'scripts', 'causal-analysis.py')
  return withWorkbench(async ({ vault, service }) => {
    assert.equal(fs.existsSync(pythonPath), true)
    const dataPath = path.join(vault.path, 'raw', 'did.csv'); fs.mkdirSync(path.dirname(dataPath), { recursive: true }); fs.writeFileSync(dataPath, fixture.csv)
    service.setCapabilityPack({ id: 'research-causal-inference', enabled: true })
    const paths = { codePath: path.join(vault.path, 'exports', 'did.py'), resultPath: path.join(vault.path, 'exports', 'did.json'), reportPath: path.join(vault.path, 'exports', 'did-report.md') }
    let current = service.createRun({ objective: '按研究设计运行 DID', capabilityPack: 'research-causal-inference', capabilityInput: { dataPath, method: fixture.method, design: fixture.design, assumptions: fixture.assumptions, pythonPath, ...paths } })
    assert.deepEqual(current.preflight.permissionRequirements.commands, ['python.exe'])
    current = service.authorizeRun({ runId: current.id, scope: { readRoots: [vault.path, path.dirname(pythonPath)], writeRoots: [vault.path], commands: [pythonPath] } })
    for (let guard = 0; guard < 30 && current.status !== 'completed'; guard += 1) {
      if (current.status === 'waiting_human') {
        const analysis = current.results.find(result => result.type === 'causal_analysis')
        if (analysis && analysis.reviewState !== 'confirmed') current = service.saveResult({ runId: current.id, resultId: analysis.id, content: `${analysis.content}\n\n研究者解释：本合成样本仅用于验证执行链。`, reviewState: 'confirmed' })
        current = service.resolveDecision({ decisionId: current.decisions.find(decision => decision.status === 'pending').id, approved: true })
      } else current = await service.executeNext(current.id)
    }
    assert.equal(current.status, 'completed')
    const runOutput = current.steps.find(step => step.input._workflowStepId === 'run-causal-python').output.analysis
    const qa = current.steps.find(step => step.input._workflowStepId === 'qa-causal-result').output.qa
    assert.ok(Math.abs(runOutput.estimate.value - fixture.expected.estimate) < 1e-9)
    assert.equal(runOutput.diagnostics[fixture.expected.diagnostic].passed, fixture.expected.reliable)
    assert.equal(qa.runtimeRecorded, true)
    assert.match(fs.readFileSync(paths.codePath, 'utf8'), /def did/)
    assert.equal(JSON.parse(fs.readFileSync(paths.resultPath, 'utf8')).dataSha256, runOutput.dataSha256)
    assert.match(fs.readFileSync(paths.reportPath, 'utf8'), /统计结果[\s\S]*方法假设[\s\S]*研究者解释边界/)
  }, { analysisScriptPath, researchPython: pythonPath })
})

test('系统综述固定工作流完成联合去重、两阶段筛选、证据矩阵、PRISMA 和版本化导出', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'systematic-review.json'), 'utf8'))
  return withWorkbench(async ({ vault, service }) => {
    service.setCapabilityPack({ id: 'research-literature-review', enabled: true })
    const outputPath = path.join(vault.path, 'exports', 'systematic-review.md')
    let current = service.createRun({ objective: '完成合成记录的系统文献综述', capabilityPack: 'research-literature-review', capabilityInput: { ...fixture.input, outputPath } })
    assert.equal(current.steps.some(step => step.kind === 'model'), false)
    assert.deepEqual(current.steps.map(step => step.input._workflowStepId).filter(Boolean), ['review-protocol', 'confirm-protocol', 'import-records', 'deduplicate-records', 'screen-title-abstract', 'confirm-title-abstract', 'screen-fulltext', 'confirm-fulltext', 'build-matrix', 'build-prisma', 'draft-review', 'confirm-review', 'validate-review', 'export-review', 'verify-capability'])
    current = service.authorizeRun({ runId: current.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
    for (let guard = 0; guard < 40 && current.status !== 'completed'; guard += 1) {
      if (current.status === 'waiting_human') {
        const pending = current.decisions.find(decision => decision.status === 'pending')
        assert.ok(pending)
        const draft = current.results.find(result => result.type === 'systematic_review')
        if (draft && draft.reviewState !== 'confirmed') current = service.saveResult({ runId: current.id, resultId: draft.id, content: `${draft.content}\n\n人工综合结论：[${draft.data.matrix[0].recordId}] 支持可追溯工作流。`, reviewState: 'confirmed' })
        current = service.resolveDecision({ decisionId: pending.id, approved: true })
      } else current = await service.executeNext(current.id)
    }
    assert.equal(current.status, 'completed')
    const dedupe = current.steps.find(step => step.input._workflowStepId === 'deduplicate-records').output
    const prisma = current.steps.find(step => step.input._workflowStepId === 'build-prisma').output.prisma
    assert.equal(dedupe.importedCount, fixture.expected.imported)
    assert.equal(dedupe.duplicateCount, fixture.expected.duplicates)
    assert.equal(prisma.titleAbstractExcluded, fixture.expected.titleExcluded)
    assert.equal(prisma.fullTextExcluded, fixture.expected.fullTextExcluded)
    assert.equal(prisma.included, fixture.expected.included)
    assert.equal(fs.existsSync(outputPath), true)
    assert.match(fs.readFileSync(outputPath, 'utf8'), /人工综合结论/)
    assert.ok(current.results.some(result => result.type === 'systematic_review_protocol'))
    assert.ok(current.results.some(result => result.type === 'systematic_review_evidence_matrix'))
    assert.ok(current.results.some(result => result.type === 'systematic_review_traceability_qa'))
    assert.equal(current.results.find(result => result.type === 'systematic_review').reviewState, 'confirmed')
  })
})
