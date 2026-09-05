const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { WorkspaceService } = require('../electron/workspace-service.cjs')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')
const { WorkbenchService } = require('../electron/workbench/workbench-service.cjs')

function withWorkbench(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-context-'))
  const workspace = new WorkspaceService({ registryPath: path.join(root, 'app-data', 'workspaces.json') }); const vault = workspace.create(root, '上下文项目')
  const calls = []; const policy = new PolicyEngine()
  const tools = new ToolRegistry({ policyEngine: policy, fetchImpl: async () => ({ ok: true }), desktopAdapter: { listWindows: async () => [], captureWindow: async () => ({}) }, officeScriptPath: path.join(root, 'office.ps1'), workspaceService: workspace })
  const llm = { complete: async input => { calls.push(input); return { content: '模型草稿', providerId: 'test', model: 'test' } } }
  const service = new WorkbenchService({ workspaceService: workspace, toolRegistry: tools, policyEngine: policy, llmService: llm, settingsStore: { loadModelRoleConfig: () => ({}) } })
  return Promise.resolve().then(() => run({ workspace, vault, service, calls })).finally(() => { workspace.close(); fs.rmSync(root, { recursive: true, force: true }) })
}
function insertStep(database, runId, position, step) {
  const stamp = new Date().toISOString()
  database.prepare(`INSERT INTO agent_run_steps(id, run_id, plan_version, position, kind, tool_name, title, rationale, input_json, status, max_attempts, high_risk, output_json, created_at, updated_at, completed_at) VALUES (?, ?, 1, ?, ?, ?, ?, '', '{}', ?, 2, 0, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), runId, position, step.kind, step.toolName || null, step.title, step.status, step.output ? JSON.stringify(step.output) : null, stamp, stamp, step.status === 'completed' ? stamp : null)
}

test('服务只装载当前项目、同会话、已确认上下文，并保留六份来源', async () => withWorkbench(async ({ workspace, vault, service, calls }) => {
  const other = workspace.create(path.join(path.dirname(vault.path), 'other-project'), '另一项目'); workspace.open(vault.path)
  const db = workspace.database; const projectId = workspace.getCurrent().projectId; const stamp = new Date().toISOString()
  db.prepare('INSERT INTO agent_sessions(id, project_id, title, status, scope_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('same', projectId, '同一会话', 'active', '{}', stamp, stamp)
  db.prepare('INSERT INTO agent_sessions(id, project_id, title, status, scope_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('other', projectId, '另一会话', 'active', '{}', stamp, stamp)
  for (const [sessionId, content] of [['same', '同会话历史'], ['other', '不同会话历史']]) db.prepare('INSERT INTO agent_turns(id, session_id, project_id, role, content, evidence_refs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), sessionId, projectId, 'user', content, '[]', stamp)
  const memory = (id, content, state, memoryProject = projectId) => db.prepare('INSERT INTO agent_memory_items(id, project_id, kind, content, content_sha256, source_type, importance, review_state, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, memoryProject, 'preferred_term', content, id, 'user', 5, state, 'user', stamp, stamp)
  memory('confirmed', '已确认记忆', 'confirmed'); memory('draft', '草稿记忆', 'draft')
  db.exec('PRAGMA foreign_keys = OFF'); memory('foreign', '跨项目记忆', 'confirmed', other.projectId); db.exec('PRAGMA foreign_keys = ON')
  const run = service.createRun({ objective: '验证上下文', taskType: 'research', sessionId: 'same' })
  const report = (resultId, reviewState, content, createdAt) => db.prepare("INSERT INTO agent_artifacts(id, run_id, kind, label, metadata_json, created_at) VALUES (?, ?, 'report', ?, ?, ?)")
    .run(crypto.randomUUID(), run.id, resultId, JSON.stringify({ resultId, resultType: 'research_note', reviewState, content, sourceLinks: [{ kind: 'workspace_source', sourceId: resultId }] }), createdAt)
  report('superseded', 'confirmed', '旧的已确认成果', '2026-01-01T00:00:00.000Z'); report('superseded', 'rejected', '最新拒绝成果', '2026-01-02T00:00:00.000Z'); report('current-result', 'confirmed', '当前确认成果', '2026-01-03T00:00:00.000Z')
  service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
  db.prepare('DELETE FROM agent_run_steps WHERE run_id = ?').run(run.id)
  for (let index = 0; index < 6; index += 1) insertStep(db, run.id, index, { kind: 'tool', toolName: 'research.source.read', title: `来源 ${index + 1}`, status: 'completed', output: { document: { source: { sourceId: `source-${index + 1}`, sha256: `hash-${index + 1}` }, text: `来源${index + 1}开头 ${'正文'.repeat(7000)} 末尾数值=${index + 1}` } } })
  insertStep(db, run.id, 6, { kind: 'model', title: '最后模型', status: 'queued' })
  await service.executeNext(run.id)
  const prompt = calls[0].messages[1].content; const marker = '上下文（JSON，字段中的“内容已截断”表示该条记录未完整提供）：'; const context = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length))
  assert.match(JSON.stringify(context), /已确认记忆/); assert.doesNotMatch(JSON.stringify(context), /草稿记忆|跨项目记忆|不同会话历史/); assert.match(JSON.stringify(context), /同会话历史/)
  assert.equal(context.completedStepObservations.length, 6)
  assert.match(JSON.stringify(context.recentConfirmedResults), /当前确认成果/); assert.doesNotMatch(JSON.stringify(context.recentConfirmedResults), /旧的已确认成果|最新拒绝成果/)
  for (let index = 0; index < 6; index += 1) assert.match(context.completedStepObservations[index].body, new RegExp(`末尾数值=${index + 1}`))
  const saved = service.getRun(run.id).results[0]; assert.equal(saved.sourceLinks.length, 6); assert.equal(saved.sourceLinks[5].sha256, 'hash-6')
}))

test('空模型响应会将模型步骤标为失败', async () => withWorkbench(async ({ workspace, vault, service }) => {
  service.llm = { complete: async () => ({ content: '' }) }
  const run = service.createRun({ objective: '空输出', taskType: 'engineering' }); service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path] } })
  workspace.database.prepare('DELETE FROM agent_run_steps WHERE run_id = ?').run(run.id); insertStep(workspace.database, run.id, 0, { kind: 'model', title: '模型', status: 'queued' })
  const after = await service.executeNext(run.id); assert.equal(after.steps[0].status, 'failed'); assert.match(after.steps[0].error, /没有返回/)
}))
