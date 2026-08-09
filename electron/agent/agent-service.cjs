const crypto = require('node:crypto')

const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({ name: 'searchPaper', label: '检索论文', description: '在当前 Research Vault 的题录、摘要和关键词中检索。', readOnly: true, requiresConfirmation: false }),
  Object.freeze({ name: 'readPaper', label: '读取论文', description: '读取当前研究库已登记的论文正文或 MinerU 派生 Markdown。', readOnly: true, requiresConfirmation: false }),
  Object.freeze({ name: 'extractEvidence', label: '提取证据', description: '把指定原文和页码锚点保存为证据卡。', readOnly: false, requiresConfirmation: true }),
  Object.freeze({ name: 'queryKnowledgeGraph', label: '查询知识关系', description: '查询当前已确认的证据关系和知识图谱。', readOnly: true, requiresConfirmation: false }),
  Object.freeze({ name: 'createTask', label: '创建科研任务', description: '创建带来源说明的正式科研任务。', readOnly: false, requiresConfirmation: true }),
  Object.freeze({ name: 'updateExperiment', label: '更新实验', description: '更新当前研究库中的实验 Run。', readOnly: false, requiresConfirmation: true }),
  Object.freeze({ name: 'generateReport', label: '生成报告草稿', description: '保存可继续编辑的周报、组会或阶段复盘草稿。', readOnly: false, requiresConfirmation: true }),
])
const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, tool]))
const MEMORY_KINDS = new Set(['research_direction', 'preferred_term', 'reading_history', 'experiment_history', 'preference'])

function timestamp() { return new Date().toISOString() }
function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex') }
function text(value, label, maximum, required = true) {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label}必须是文本。`)
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符。`)
  return normalized
}
function object(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`)
  return value
}
function array(value, label, maximum = 100) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表。`)
  if (value.length > maximum) throw new Error(`${label}不能超过 ${maximum} 项。`)
  return value
}
function parseJson(value, fallback) { try { return JSON.parse(value) } catch { return fallback } }

function memoryView(row) {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    sourceType: row.source_type,
    sourceId: row.source_id ?? undefined,
    importance: row.importance,
    reviewState: row.review_state,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at ?? undefined,
  }
}

function stepView(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    position: row.position,
    toolName: row.tool_name,
    title: row.title,
    rationale: row.rationale,
    input: parseJson(row.input_json, {}),
    status: row.status,
    requiresConfirmation: Boolean(row.requires_confirmation),
    output: row.output_json ? parseJson(row.output_json, {}) : undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  }
}

class ResearchAgentService {
  constructor({ workspaceService }) {
    if (!workspaceService) throw new Error('ResearchAgentService 需要研究库服务。')
    this.workspace = workspaceService
  }

  #context() {
    const current = this.workspace.getCurrent()
    if (!current || !this.workspace.database) throw new Error('请先创建或打开研究库。')
    return { current, database: this.workspace.database }
  }

  listTools() { return TOOL_DEFINITIONS.map(tool => ({ ...tool })) }

  listMemory() {
    const { current, database } = this.#context()
    return database.prepare(`
      SELECT * FROM agent_memory_items WHERE project_id = ? AND review_state != 'archived'
      ORDER BY CASE review_state WHEN 'draft' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, importance DESC, updated_at DESC
    `).all(current.projectId).map(memoryView)
  }

  saveMemory(input = {}) {
    const { current, database } = this.#context()
    const kind = text(input.kind, '记忆类型', 40)
    if (!MEMORY_KINDS.has(kind)) throw new Error('记忆类型无效。')
    const content = text(input.content, '记忆内容', 4000)
    const sourceType = ['user', 'project', 'paper', 'run', 'agent'].includes(input.sourceType) ? input.sourceType : 'user'
    const sourceId = input.sourceId === undefined ? undefined : text(input.sourceId, '记忆来源 ID', 160, false) || undefined
    const importance = Math.min(5, Math.max(1, Math.round(Number(input.importance) || 3)))
    const createdBy = input.createdBy === 'ai' ? 'ai' : input.createdBy === 'system' ? 'system' : 'user'
    const reviewState = createdBy === 'ai' ? 'draft' : 'confirmed'
    const contentHash = sha256(content)
    const existing = database.prepare('SELECT * FROM agent_memory_items WHERE project_id = ? AND kind = ? AND content_sha256 = ?').get(current.projectId, kind, contentHash)
    const now = timestamp()
    if (existing) {
      database.prepare(`
        UPDATE agent_memory_items SET source_type = ?, source_id = ?, importance = ?, review_state = ?, updated_at = ?, reviewed_at = ?
        WHERE id = ? AND project_id = ?
      `).run(sourceType, sourceId || null, importance, reviewState, now, reviewState === 'confirmed' ? now : null, existing.id, current.projectId)
      return memoryView(database.prepare('SELECT * FROM agent_memory_items WHERE id = ?').get(existing.id))
    }
    const id = crypto.randomUUID()
    database.prepare(`
      INSERT INTO agent_memory_items(
        id, project_id, kind, content, content_sha256, source_type, source_id,
        importance, review_state, created_by, created_at, updated_at, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, current.projectId, kind, content, contentHash, sourceType, sourceId || null, importance, reviewState, createdBy, now, now, reviewState === 'confirmed' ? now : null)
    return memoryView(database.prepare('SELECT * FROM agent_memory_items WHERE id = ?').get(id))
  }

  reviewMemory(input = {}) {
    const { current, database } = this.#context()
    const id = text(input.id, '记忆 ID', 160)
    const decision = input.decision === 'confirm' ? 'confirmed' : input.decision === 'reject' ? 'rejected' : input.decision === 'archive' ? 'archived' : ''
    if (!decision) throw new Error('记忆复核决定无效。')
    const row = database.prepare('SELECT * FROM agent_memory_items WHERE id = ? AND project_id = ?').get(id, current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条 Agent 记忆。')
    const now = timestamp()
    database.prepare('UPDATE agent_memory_items SET review_state = ?, updated_at = ?, reviewed_at = ? WHERE id = ? AND project_id = ?').run(decision, now, now, id, current.projectId)
    return memoryView(database.prepare('SELECT * FROM agent_memory_items WHERE id = ?').get(id))
  }

  createSession(input = {}) {
    const { current, database } = this.#context()
    const title = text(input.title || '研究 Agent 会话', '会话标题', 200)
    const scope = object(input.scope, '会话范围')
    const id = crypto.randomUUID()
    const now = timestamp()
    database.prepare('INSERT INTO agent_sessions(id, project_id, title, status, scope_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, current.projectId, title, 'active', JSON.stringify(scope), now, now)
    return { id, title, status: 'active', scope, createdAt: now, updatedAt: now }
  }

  appendTurn(input = {}) {
    const { current, database } = this.#context()
    const sessionId = text(input.sessionId, 'Agent 会话 ID', 160)
    const session = database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND project_id = ?').get(sessionId, current.projectId)
    if (!session) throw new Error('Agent 会话不存在或不属于当前研究库。')
    const role = ['user', 'assistant', 'tool'].includes(input.role) ? input.role : ''
    if (!role) throw new Error('Agent 消息角色无效。')
    const content = text(input.content, 'Agent 消息', 240000)
    const evidenceRefs = array(input.evidenceRefs, 'Agent 消息证据', 500)
    const id = crypto.randomUUID()
    const now = timestamp()
    database.prepare('INSERT INTO agent_turns(id, session_id, project_id, role, content, evidence_refs_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, current.projectId, role, content, JSON.stringify(evidenceRefs), now)
    database.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    return { id, sessionId, role, content, evidenceRefs, createdAt: now }
  }

  proposePlan(input = {}) {
    const { current, database } = this.#context()
    const objective = text(input.objective, 'Agent 目标', 4000)
    const scope = object(input.scope, 'Agent 计划范围')
    let sessionId = input.sessionId === undefined ? undefined : text(input.sessionId, 'Agent 会话 ID', 160)
    if (!sessionId) sessionId = this.createSession({ title: objective.slice(0, 80), scope }).id
    const session = database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND project_id = ?').get(sessionId, current.projectId)
    if (!session) throw new Error('Agent 会话不存在或不属于当前研究库。')
    const plannedSteps = [
      { toolName: 'searchPaper', title: '检索当前研究库论文', rationale: '先确认研究库中已有的题录与摘要，避免凭空回答。', input: { query: objective } },
      ...(scope.sourceId ? [{ toolName: 'readPaper', title: '读取指定论文证据', rationale: '从用户指定资料读取原文或派生 Markdown。', input: { sourceId: scope.sourceId } }] : []),
      { toolName: 'queryKnowledgeGraph', title: '查询已确认的知识关系', rationale: '复用多年积累的证据关系和知识图谱。', input: { query: objective } },
      ...(scope.sourceId && scope.quote ? [{ toolName: 'extractEvidence', title: '固定用户指定的原文证据', rationale: '将明确提供的原文与页码保存为可追溯证据。', input: { sourceId: scope.sourceId, quote: scope.quote, pageNumber: scope.pageNumber, understanding: scope.understanding || '' } }] : []),
      { toolName: 'createTask', title: '形成待执行的科研下一步', rationale: '把分析收敛为可追踪任务；写入前必须逐项确认。', input: { title: `核对：${objective.slice(0, 180)}`, detail: '由 Research Agent 计划生成，已由用户确认后写入。', status: 'inbox' } },
    ]
    if (plannedSteps.length > 12) throw new Error('单个 Agent 计划不能超过 12 步。')
    const planId = crypto.randomUUID()
    const now = timestamp()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('INSERT INTO agent_plans(id, session_id, project_id, objective, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(planId, sessionId, current.projectId, objective, 'draft', 'ai', now, now)
      plannedSteps.forEach((planned, position) => {
        const tool = TOOL_BY_NAME.get(planned.toolName)
        const stepId = crypto.randomUUID()
        database.prepare(`
          INSERT INTO agent_plan_steps(id, plan_id, project_id, position, tool_name, title, rationale, input_json, status, requires_confirmation, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
        `).run(stepId, planId, current.projectId, position, tool.name, planned.title, planned.rationale, JSON.stringify(planned.input), tool.requiresConfirmation ? 1 : 0, now, now)
        this.#event(database, { sessionId, planId, stepId, toolName: tool.name, eventType: 'proposed', actor: 'ai', snapshot: { title: planned.title, input: planned.input }, now, projectId: current.projectId })
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    this.appendTurn({ sessionId, role: 'user', content: objective })
    this.appendTurn({ sessionId, role: 'assistant', content: `已生成 ${plannedSteps.length} 步可审查计划；任何写入研究库的工具都需要逐项确认。` })
    return this.getPlan(planId)
  }

  #event(database, { projectId, sessionId, planId, stepId, toolName, eventType, actor, snapshot, now }) {
    database.prepare(`
      INSERT INTO agent_tool_events(id, project_id, session_id, plan_id, step_id, tool_name, event_type, actor, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), projectId, sessionId, planId, stepId, toolName, eventType, actor, JSON.stringify(snapshot || {}), now || timestamp())
  }

  getPlan(planIdValue) {
    const { current, database } = this.#context()
    const planId = text(planIdValue, 'Agent 计划 ID', 160)
    const plan = database.prepare('SELECT * FROM agent_plans WHERE id = ? AND project_id = ?').get(planId, current.projectId)
    if (!plan) throw new Error('Agent 计划不存在或不属于当前研究库。')
    const steps = database.prepare('SELECT * FROM agent_plan_steps WHERE plan_id = ? AND project_id = ? ORDER BY position').all(planId, current.projectId).map(stepView)
    return {
      id: plan.id,
      sessionId: plan.session_id,
      objective: plan.objective,
      status: plan.status,
      createdBy: plan.created_by,
      steps,
      createdAt: plan.created_at,
      updatedAt: plan.updated_at,
      confirmedAt: plan.confirmed_at ?? undefined,
      completedAt: plan.completed_at ?? undefined,
    }
  }

  reviewStep(input = {}) {
    const { current, database } = this.#context()
    const stepId = text(input.stepId, 'Agent 步骤 ID', 160)
    const decision = input.decision === 'confirm' ? 'confirmed' : input.decision === 'dismiss' ? 'dismissed' : ''
    if (!decision) throw new Error('Agent 步骤确认决定无效。')
    const row = database.prepare(`
      SELECT s.*, p.session_id FROM agent_plan_steps s JOIN agent_plans p ON p.id = s.plan_id
      WHERE s.id = ? AND s.project_id = ?
    `).get(stepId, current.projectId)
    if (!row) throw new Error('Agent 步骤不存在或不属于当前研究库。')
    if (row.status !== 'proposed') throw new Error('只有待确认步骤可以审查。')
    const now = timestamp()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('UPDATE agent_plan_steps SET status = ?, updated_at = ?, confirmed_at = ? WHERE id = ? AND project_id = ?').run(decision, now, decision === 'confirmed' ? now : null, stepId, current.projectId)
      this.#event(database, { projectId: current.projectId, sessionId: row.session_id, planId: row.plan_id, stepId, toolName: row.tool_name, eventType: decision === 'confirmed' ? 'confirmed' : 'dismissed', actor: 'user', snapshot: { decision }, now })
      database.prepare(`UPDATE agent_plans SET status = CASE WHEN status = 'draft' THEN 'confirmed' ELSE status END, updated_at = ?, confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?`).run(now, now, row.plan_id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.getPlan(row.plan_id)
  }

  executePlan(input = {}) {
    const plan = this.getPlan(input.planId)
    const results = []
    for (const step of plan.steps) {
      if (step.status === 'proposed' && step.requiresConfirmation) continue
      if (step.status === 'proposed' || step.status === 'confirmed') results.push(this.executeStep({ stepId: step.id }))
    }
    const refreshed = this.getPlan(plan.id)
    return { plan: refreshed, results, waitingForConfirmation: refreshed.steps.filter(step => step.requiresConfirmation && step.status === 'proposed').map(step => step.id) }
  }

  executeStep(input = {}) {
    const { current, database } = this.#context()
    const stepId = text(input.stepId, 'Agent 步骤 ID', 160)
    const row = database.prepare(`
      SELECT s.*, p.session_id FROM agent_plan_steps s JOIN agent_plans p ON p.id = s.plan_id
      WHERE s.id = ? AND s.project_id = ?
    `).get(stepId, current.projectId)
    if (!row) throw new Error('Agent 步骤不存在或不属于当前研究库。')
    const tool = TOOL_BY_NAME.get(row.tool_name)
    if (!tool) throw new Error('Agent 工具不存在。')
    if (tool.requiresConfirmation && row.status !== 'confirmed') throw new Error('这个写入步骤必须先由用户逐项确认。')
    if (!tool.requiresConfirmation && row.status !== 'proposed' && row.status !== 'confirmed') throw new Error('这个步骤当前不能执行。')
    const now = timestamp()
    database.prepare("UPDATE agent_plan_steps SET status = 'running', updated_at = ?, error = NULL WHERE id = ?").run(now, stepId)
    database.prepare("UPDATE agent_plans SET status = 'running', updated_at = ? WHERE id = ?").run(now, row.plan_id)
    this.#event(database, { projectId: current.projectId, sessionId: row.session_id, planId: row.plan_id, stepId, toolName: row.tool_name, eventType: 'started', actor: 'system', snapshot: {}, now })
    try {
      const output = this.#runTool(row.tool_name, parseJson(row.input_json, {}))
      const completedAt = timestamp()
      database.prepare("UPDATE agent_plan_steps SET status = 'completed', output_json = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(JSON.stringify(output ?? {}), completedAt, completedAt, stepId)
      this.#event(database, { projectId: current.projectId, sessionId: row.session_id, planId: row.plan_id, stepId, toolName: row.tool_name, eventType: 'completed', actor: 'system', snapshot: { output }, now: completedAt })
      this.appendTurn({ sessionId: row.session_id, role: 'tool', content: `${row.tool_name} 已完成。`, evidenceRefs: output?.evidenceRefs || [] })
      this.#finishPlanIfTerminal(row.plan_id)
      return { stepId, toolName: row.tool_name, output }
    } catch (error) {
      const failedAt = timestamp()
      const message = error instanceof Error ? error.message : 'Agent 工具执行失败。'
      database.prepare("UPDATE agent_plan_steps SET status = 'failed', error = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(message.slice(0, 1000), failedAt, failedAt, stepId)
      this.#event(database, { projectId: current.projectId, sessionId: row.session_id, planId: row.plan_id, stepId, toolName: row.tool_name, eventType: 'failed', actor: 'system', snapshot: { error: message.slice(0, 1000) }, now: failedAt })
      this.#finishPlanIfTerminal(row.plan_id)
      throw new Error(message)
    }
  }

  #finishPlanIfTerminal(planId) {
    const { database } = this.#context()
    const remaining = database.prepare("SELECT COUNT(*) AS count FROM agent_plan_steps WHERE plan_id = ? AND status IN ('proposed', 'confirmed', 'running')").get(planId).count
    if (!remaining) {
      const now = timestamp()
      database.prepare("UPDATE agent_plans SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ?").run(now, now, planId)
    }
  }

  #runTool(name, input) {
    const { current, database } = this.#context()
    if (name === 'searchPaper') {
      const query = text(input.query, '检索词', 4000)
      const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 1).slice(0, 8)
      const rows = database.prepare(`
        SELECT id, title, abstract, issued, keywords_json, identifiers_json
        FROM bibliographic_items WHERE project_id = ? AND archived_at IS NULL
        ORDER BY updated_at DESC LIMIT 500
      `).all(current.projectId)
      const matches = rows.filter(row => {
        const haystack = `${row.title}\n${row.abstract || ''}\n${row.keywords_json}`.toLowerCase()
        return !terms.length || terms.some(term => haystack.includes(term))
      }).slice(0, 20).map(row => ({ id: row.id, title: row.title, abstract: row.abstract ?? '', issued: row.issued ?? undefined, keywords: parseJson(row.keywords_json, []), identifiers: parseJson(row.identifiers_json, {}) }))
      return { matches, count: matches.length, evidenceRefs: matches.map(row => ({ type: 'bibliography', id: row.id, label: row.title })) }
    }
    if (name === 'readPaper') {
      const sourceId = text(input.sourceId, '资料 ID', 160)
      const row = database.prepare('SELECT id, bibliographic_item_id, name, pages, content_sha256, extracted_text, derived_markdown FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL').get(sourceId, current.projectId)
      if (!row) throw new Error('指定论文不存在或不属于当前研究库。')
      const content = String(row.derived_markdown || row.extracted_text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
      return { sourceId: row.id, itemId: row.bibliographic_item_id ?? undefined, name: row.name, pages: row.pages ?? undefined, contentSha256: row.content_sha256 ?? undefined, content: content.slice(0, 120000), truncated: content.length > 120000, evidenceRefs: [{ type: 'source', id: row.id, label: row.name }] }
    }
    if (name === 'queryKnowledgeGraph') {
      const rows = database.prepare(`
        SELECT edge.id, edge.edge_type, edge.rationale, edge.evidence_refs_json,
               source.id AS from_id, source.node_type AS from_type, source.label AS from_label,
               target.id AS to_id, target.node_type AS to_type, target.label AS to_label
        FROM knowledge_edges edge
        JOIN knowledge_nodes source ON source.id = edge.from_node_id
        JOIN knowledge_nodes target ON target.id = edge.to_node_id
        WHERE edge.project_id = ? AND edge.review_state = 'confirmed'
          AND source.review_state = 'confirmed' AND target.review_state = 'confirmed'
        ORDER BY edge.reviewed_at DESC, edge.created_at DESC LIMIT 200
      `).all(current.projectId)
      return {
        relations: rows.map(row => ({ id: row.id, type: row.edge_type, fromId: row.from_id, toId: row.to_id, fromType: row.from_type, toType: row.to_type, from: row.from_label, to: row.to_label, rationale: row.rationale, evidenceRefs: parseJson(row.evidence_refs_json, []) })),
        count: rows.length,
        evidenceRefs: rows.flatMap(row => parseJson(row.evidence_refs_json, [])),
      }
    }
    if (name === 'extractEvidence') {
      const sourceId = text(input.sourceId, '资料 ID', 160)
      const quote = text(input.quote, '证据原文', 100000)
      const source = database.prepare('SELECT id, bibliographic_item_id, name, content_sha256 FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL').get(sourceId, current.projectId)
      if (!source) throw new Error('指定资料不存在或不属于当前研究库。')
      const pageNumber = input.pageNumber === undefined ? undefined : Math.max(1, Math.round(Number(input.pageNumber)))
      const anchor = { type: 'text', state: 'resolved', ...(pageNumber ? { pageNumber } : {}), quote: { exact: quote }, sourceContentSha256: source.content_sha256 ?? undefined }
      const annotationId = crypto.randomUUID()
      const fragmentId = crypto.randomUUID()
      const now = timestamp()
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('INSERT INTO annotations(id, project_id, source_id, category, anchor_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(annotationId, current.projectId, sourceId, '数据/证据', JSON.stringify(anchor), now, now)
        database.prepare(`
          INSERT INTO note_fragments(id, project_id, bibliographic_item_id, source_id, annotation_id, origin, kind, content, content_sha256, purpose_tags_json, anchor_json, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, 'source_evidence', 'quote', ?, ?, '[]', ?, ?, 'system')
        `).run(fragmentId, current.projectId, source.bibliographic_item_id || null, sourceId, annotationId, quote, sha256(quote), JSON.stringify(anchor), now)
        database.prepare('UPDATE annotations SET current_note_fragment_id = ? WHERE id = ?').run(fragmentId, annotationId)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return { annotationId, fragmentId, sourceId, sourceName: source.name, pageNumber, evidenceRefs: [{ type: 'fragment', id: fragmentId, label: `${source.name}${pageNumber ? ` · p.${pageNumber}` : ''}` }] }
    }
    if (name === 'createTask') {
      const created = this.workspace.createResearchTask({ title: text(input.title, '任务标题', 240), detail: text(input.detail, '任务说明', 10000, false), status: input.status || 'inbox', sourceType: 'manual', origin: 'user' })
      return { task: created.task, alreadyExists: created.alreadyExists }
    }
    if (name === 'updateExperiment') {
      const runId = text(input.runId, '实验 Run ID', 160)
      const patch = object(input.patch, '实验变更')
      return { workspace: this.workspace.saveResearchRun({ ...patch, id: runId }) }
    }
    if (name === 'generateReport') {
      const report = this.workspace.saveResearchReport({ title: text(input.title, '报告标题', 300), type: input.type || 'weekly', period: text(input.period, '报告周期', 400, false), markdown: text(input.markdown, '报告正文', 1000000, false), sourceRefs: array(input.sourceRefs, '报告来源', 500) })
      return { report }
    }
    throw new Error('Agent 工具尚未实现。')
  }

  getSession(sessionIdValue) {
    const { current, database } = this.#context()
    const sessionId = text(sessionIdValue, 'Agent 会话 ID', 160)
    const row = database.prepare('SELECT * FROM agent_sessions WHERE id = ? AND project_id = ?').get(sessionId, current.projectId)
    if (!row) throw new Error('Agent 会话不存在或不属于当前研究库。')
    const turns = database.prepare('SELECT * FROM agent_turns WHERE session_id = ? AND project_id = ? ORDER BY created_at, rowid').all(sessionId, current.projectId).map(turn => ({ id: turn.id, role: turn.role, content: turn.content, evidenceRefs: parseJson(turn.evidence_refs_json, []), createdAt: turn.created_at }))
    const plans = database.prepare('SELECT id FROM agent_plans WHERE session_id = ? AND project_id = ? ORDER BY updated_at DESC').all(sessionId, current.projectId).map(plan => this.getPlan(plan.id))
    return { id: row.id, title: row.title, status: row.status, scope: parseJson(row.scope_json, {}), turns, plans, createdAt: row.created_at, updatedAt: row.updated_at }
  }
}

module.exports = { ResearchAgentService, TOOL_DEFINITIONS }
