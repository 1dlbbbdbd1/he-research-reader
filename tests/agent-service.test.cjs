const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { ResearchAgentService } = require('../electron/agent/agent-service.cjs')
const { WorkspaceService } = require('../electron/workspace-service.cjs')

function withAgent(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-agent-service-'))
  const workspace = new WorkspaceService({ registryPath: path.join(root, 'app-data', 'workspaces.json') })
  const vault = workspace.create(root, 'Agent 测试研究库')
  const agent = new ResearchAgentService({ workspaceService: workspace })
  try { return run({ root, vault, workspace, agent }) } finally {
    workspace.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('Agent 暴露目标要求的七个受控工具及确认边界', () => withAgent(({ agent }) => {
  const tools = agent.listTools()
  assert.deepEqual(tools.map(tool => tool.name), ['searchPaper', 'readPaper', 'extractEvidence', 'queryKnowledgeGraph', 'createTask', 'updateExperiment', 'generateReport'])
  assert.deepEqual(tools.filter(tool => tool.requiresConfirmation).map(tool => tool.name), ['extractEvidence', 'createTask', 'updateExperiment', 'generateReport'])
  assert.ok(tools.filter(tool => !tool.requiresConfirmation).every(tool => tool.readOnly))
}))

test('Agent Memory 区分 AI 建议与人工确认并在重开后保留', () => withAgent(({ vault, workspace, agent }) => {
  const suggested = agent.saveMemory({ kind: 'preferred_term', content: '柔顺装配', createdBy: 'ai', sourceType: 'agent', importance: 4 })
  assert.equal(suggested.reviewState, 'draft')
  const confirmed = agent.reviewMemory({ id: suggested.id, decision: 'confirm' })
  assert.equal(confirmed.reviewState, 'confirmed')
  agent.saveMemory({ kind: 'research_direction', content: '机器人柔顺装配控制', createdBy: 'user', importance: 5 })
  workspace.close()
  workspace.open(vault.path)
  const restored = new ResearchAgentService({ workspaceService: workspace }).listMemory()
  assert.equal(restored.length, 2)
  assert.equal(restored.find(item => item.id === suggested.id).reviewState, 'confirmed')
  assert.ok(restored.some(item => item.content === '机器人柔顺装配控制'))
  workspace.rebuildVaultProjections()
  assert.match(fs.readFileSync(path.join(vault.path, 'notes', 'agent-memory.generated.md'), 'utf8'), /机器人柔顺装配控制/)
}))

test('Planner 持久化步骤，自动执行只读工具并阻止未确认写入', () => withAgent(({ workspace, agent }) => {
  const plan = agent.proposePlan({ objective: '比较柔顺装配论文并形成下一步' })
  assert.equal(plan.status, 'draft')
  assert.deepEqual(plan.steps.map(step => step.toolName), ['searchPaper', 'queryKnowledgeGraph', 'createTask'])
  const createStep = plan.steps.find(step => step.toolName === 'createTask')
  assert.equal(createStep.requiresConfirmation, true)
  assert.throws(() => agent.executeStep({ stepId: createStep.id }), /必须先由用户逐项确认/)

  const firstRun = agent.executePlan({ planId: plan.id })
  assert.equal(firstRun.results.length, 2)
  assert.deepEqual(firstRun.waitingForConfirmation, [createStep.id])
  assert.equal(workspace.listResearchTasks().tasks.length, 0)

  agent.reviewStep({ stepId: createStep.id, decision: 'confirm' })
  const completed = agent.executePlan({ planId: plan.id })
  assert.equal(completed.plan.status, 'completed')
  assert.equal(workspace.listResearchTasks().tasks.length, 1)
  assert.match(workspace.listResearchTasks().tasks[0].title, /核对：比较柔顺装配论文/)
  const events = workspace.database.prepare('SELECT * FROM agent_tool_events WHERE plan_id = ? ORDER BY created_at, rowid').all(plan.id)
  assert.ok(events.some(event => event.event_type === 'confirmed' && event.actor === 'user'))
  assert.ok(events.some(event => event.event_type === 'completed' && event.tool_name === 'createTask'))
  assert.throws(() => workspace.database.prepare("UPDATE agent_tool_events SET actor = 'ai' WHERE id = ?").run(events[0].id), /append-only/)
  workspace.rebuildVaultProjections()
  assert.match(fs.readFileSync(path.join(workspace.getCurrent().path, 'reports', 'agent-plans.generated.md'), 'utf8'), /比较柔顺装配论文并形成下一步/)
}))

test('extractEvidence 只有确认后才写入带来源锚点的原文证据', () => withAgent(({ workspace, agent }) => {
  const now = new Date().toISOString()
  workspace.database.prepare(`
    INSERT INTO sources(id, project_id, name, kind, status, pages, content_sha256, extracted_text, source_metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, 'PDF', '已解析', 8, ?, ?, '{}', ?, ?)
  `).run('source-agent-1', workspace.getCurrent().projectId, '装配论文.pdf', 'source-hash', '论文正文', now, now)
  const plan = agent.proposePlan({
    objective: '固定刚度扰动证据',
    scope: { sourceId: 'source-agent-1', quote: '刚度扰动使成功率下降 10%。', pageNumber: 6, understanding: '需要复现实验核对。' },
  })
  const evidenceStep = plan.steps.find(step => step.toolName === 'extractEvidence')
  assert.ok(evidenceStep)
  assert.equal(workspace.database.prepare("SELECT COUNT(*) AS count FROM note_fragments WHERE origin = 'source_evidence'").get().count, 0)
  agent.executePlan({ planId: plan.id })
  assert.equal(workspace.database.prepare("SELECT COUNT(*) AS count FROM note_fragments WHERE origin = 'source_evidence'").get().count, 0)
  agent.reviewStep({ stepId: evidenceStep.id, decision: 'confirm' })
  const result = agent.executeStep({ stepId: evidenceStep.id })
  const fragment = workspace.database.prepare('SELECT * FROM note_fragments WHERE id = ?').get(result.output.fragmentId)
  assert.equal(fragment.content, '刚度扰动使成功率下降 10%。')
  assert.equal(fragment.source_id, 'source-agent-1')
  assert.equal(JSON.parse(fragment.anchor_json).pageNumber, 6)
}))
