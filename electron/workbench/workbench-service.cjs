const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { CAPABILITY_PACKS, getCapabilityPack } = require('./capability-packs.cjs')
const { CONVERSATION_WORKFLOWS, getConversationWorkflow, buildConversationWorkflowSteps, normalizedSourceIds } = require('./conversation-workflows.cjs')

const RUN_STATUSES = Object.freeze(['draft', 'awaiting_authorization', 'running', 'replanning', 'waiting_human', 'paused', 'verifying', 'completed', 'failed', 'cancelled'])
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const TRANSITIONS = Object.freeze({
  draft: ['awaiting_authorization', 'cancelled'],
  awaiting_authorization: ['running', 'cancelled'],
  running: ['replanning', 'waiting_human', 'paused', 'verifying', 'failed', 'cancelled'],
  replanning: ['running', 'waiting_human', 'failed', 'cancelled'],
  waiting_human: ['running', 'cancelled'],
  paused: ['running', 'cancelled'],
  verifying: ['completed', 'replanning', 'waiting_human', 'failed', 'cancelled'],
  completed: [], failed: [], cancelled: [],
})

function now() { return new Date().toISOString() }
function json(value, fallback) { try { return JSON.parse(value) } catch { return fallback } }
function text(value, label, maximum = 10000) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maximum) throw new Error(`${label}不能超过 ${maximum} 个字符。`)
  return normalized
}
function list(value, maximum = 100) { return Array.isArray(value) ? value.slice(0, maximum) : [] }
function uniqueStrings(value) { return [...new Set(list(value, 200).map(item => String(item || '').trim()).filter(Boolean))] }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function valueAt(input, pathValue) {
  return String(pathValue || '').split('.').filter(Boolean).reduce((value, key) => value === undefined || value === null ? undefined : value[key], input)
}
function validateCapabilityInput(pack, inputValue) {
  const input = object(inputValue); const schema = object(pack?.inputSchema); const properties = object(schema.properties); const errors = []
  for (const key of list(schema.required, 100)) if (input[key] === undefined || input[key] === null || String(input[key]).trim() === '') errors.push(`${properties[key]?.label || key}不能为空。`)
  for (const rule of list(pack?.inputRules, 20)) {
    if (Array.isArray(rule?.anyOf) && !rule.anyOf.some(key => input[key] !== undefined && input[key] !== null && String(input[key]).trim() !== '')) errors.push(String(rule.message || '至少填写一项输入。'))
  }
  return { valid: errors.length === 0, errors, input: Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(properties, key))) }
}
function structuredJson(value) {
  const raw = String(value || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  for (const candidate of [fenced, raw]) {
    if (!candidate) continue
    try { return JSON.parse(candidate) } catch {}
  }
  return undefined
}

const PREVIEW_SKIP_NAMES = new Set(['.git', 'node_modules', 'dist', 'release', '.cache'])
const TEXT_PREVIEW_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log', '.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.htm', '.py', '.ps1', '.sh', '.bat', '.cmd', '.c', '.h', '.cpp', '.hpp', '.java', '.rs', '.go', '.sql', '.tex', '.bib'])
const IMAGE_PREVIEW_MIME = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' })

function safeProjectPath(project, rootValue, relativeValue = '') {
  const configuredRoots = uniqueStrings([project.vaultPath, ...project.externalRoots]).map(root => path.resolve(root))
  const requestedRoot = path.resolve(String(rootValue || configuredRoots[0] || ''))
  const allowedRoot = configuredRoots.find(root => requestedRoot === root || requestedRoot.startsWith(`${root}${path.sep}`))
  if (!allowedRoot) throw new Error('只能查看当前项目登记的文件夹。')
  const target = path.resolve(requestedRoot, String(relativeValue || ''))
  if (target !== requestedRoot && !target.startsWith(`${requestedRoot}${path.sep}`)) throw new Error('文件路径超出了当前项目。')
  const canonicalRoot = fs.realpathSync(requestedRoot)
  if (fs.existsSync(target)) {
    const canonicalTarget = fs.realpathSync(target)
    if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error('文件链接指向了项目以外的位置。')
  }
  return { root: requestedRoot, target }
}

function runView(row) {
  return {
    id: row.id, projectId: row.workbench_project_id, objective: row.objective,
    sessionId: row.legacy_session_id || undefined,
    acceptance: json(row.acceptance_json, []), status: row.status, planVersion: row.plan_version,
    permissionRevision: row.permission_revision, budget: json(row.budget_json, {}),
    modelRoles: json(row.model_roles_json, {}), currentStepId: row.current_step_id || undefined,
    currentCheckpointId: row.current_checkpoint_id || undefined, failureCount: row.failure_count,
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
  }
}
function stepView(row) {
  return {
    id: row.id, runId: row.run_id, planVersion: row.plan_version, position: row.position,
    kind: row.kind, toolName: row.tool_name || undefined, title: row.title, rationale: row.rationale,
    input: json(row.input_json, {}), status: row.status, attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts, highRisk: Boolean(row.high_risk),
    output: row.output_json ? json(row.output_json, {}) : undefined, error: row.error || undefined,
    createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
  }
}

class WorkbenchService {
  constructor({ workspaceService, toolRegistry, policyEngine, llmService, settingsStore }) {
    this.workspace = workspaceService
    this.tools = toolRegistry
    this.policy = policyEngine
    this.llm = llmService
    this.settings = settingsStore
  }

  #context() {
    const current = this.workspace.getCurrent()
    if (!current || !this.workspace.database) throw new Error('请先创建或打开工作台项目。')
    return { current, database: this.workspace.database }
  }

  #event(database, runId, eventType, actor = 'system', payload = {}, stepId) {
    database.prepare('INSERT INTO agent_events(id, run_id, step_id, event_type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), runId, stepId || null, eventType, actor, JSON.stringify(payload), now())
  }

  ensureProject(input = {}) {
    const { current, database } = this.#context()
    const existing = database.prepare('SELECT * FROM workbench_projects WHERE project_id = ?').get(current.projectId)
    if (existing) return this.getProject(existing.id)
    const id = crypto.randomUUID(); const createdAt = now()
    database.prepare(`INSERT INTO workbench_projects(id, project_id, kind, name, vault_path, external_roots_json, capability_packs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, current.projectId, input.kind || 'research', current.name || '个人项目', current.path, JSON.stringify([current.path]), JSON.stringify(['research', 'files', 'web', 'command', 'desktop']), createdAt, createdAt)
    return this.getProject(id)
  }

  getProject(idValue) {
    const { database } = this.#context(); const id = text(idValue, '项目 ID', 160)
    const row = database.prepare('SELECT * FROM workbench_projects WHERE id = ?').get(id)
    if (!row) throw new Error('工作台项目不存在。')
    return { id: row.id, projectId: row.project_id, kind: row.kind, name: row.name, vaultPath: row.vault_path, externalRoots: json(row.external_roots_json, []), capabilityPacks: json(row.capability_packs_json, []), createdAt: row.created_at, updatedAt: row.updated_at }
  }

  updateProject(input = {}) {
    const project = this.getProject(input.id || this.ensureProject().id)
    const { database } = this.#context()
    const kinds = ['general', 'research', 'engineering', 'document', 'code', 'data']
    const kind = kinds.includes(input.kind) ? input.kind : project.kind
    const name = String(input.name ?? project.name).trim().slice(0, 120) || project.name
    const roots = list(input.externalRoots ?? project.externalRoots, 40).map(String).filter(Boolean)
    const packs = list(input.capabilityPacks ?? project.capabilityPacks, 30).map(String).filter(Boolean)
    database.prepare('UPDATE workbench_projects SET kind = ?, name = ?, external_roots_json = ?, capability_packs_json = ?, updated_at = ? WHERE id = ?')
      .run(kind, name, JSON.stringify(roots), JSON.stringify(packs), now(), project.id)
    return this.getProject(project.id)
  }

  listCapabilityPacks() {
    const enabled = new Set(this.ensureProject().capabilityPacks)
    return CAPABILITY_PACKS.map(pack => {
      const preflight = this.preflightCapability(pack.id)
      const maturity = preflight.ready ? (pack.implementationStatus || (pack.maturity === 'available' ? 'trial' : 'not_connected')) : 'missing_tools'
      return { ...pack, maturity, enabled: enabled.has(pack.id), preflight }
    })
  }

  preflightCapability(idValue) {
    const pack = getCapabilityPack(String(idValue || ''))
    if (!pack) throw new Error('这个固定工作流不存在。')
    const requiredTools = list(pack.requiredTools, 100)
    const tools = requiredTools.map(name => ({ name, ...this.tools.availability(name) }))
    const missing = tools.filter(tool => !tool.available).map(tool => ({ kind: 'tool', id: tool.name, message: tool.reason || '工具不可用。' }))
    const connectors = list(pack.connectors, 30).map(connector => ({ ...connector, available: true, authorizationRequired: true }))
    const permissionRequirements = {
      domains: uniqueStrings(connectors.flatMap(connector => connector.domains || [])),
      applications: uniqueStrings(connectors.filter(connector => connector.kind === 'application').map(connector => connector.id)),
      commands: uniqueStrings(connectors.flatMap(connector => connector.commands || [])),
    }
    if (!pack.workflow || !pack.inputSchema || !pack.outputSchema) missing.push({ kind: 'workflow', id: pack.id, message: '这个能力还没有接入结构化工作流合同。' })
    return {
      ready: missing.length === 0,
      status: missing.length ? 'missing_tools' : (pack.implementationStatus || 'trial'),
      tools, connectors, missing, permissionRequirements,
      message: missing.length ? missing.map(item => item.message).join('；') : '运行底座已就绪；开始前仍需确认本次任务的目录、域名和应用权限。',
    }
  }

  setCapabilityPack(input = {}) {
    const project = this.ensureProject(); const id = text(input.id, '固定工作流 ID', 160)
    if (!getCapabilityPack(id)) throw new Error('这个固定工作流不存在。')
    const next = new Set(project.capabilityPacks)
    if (input.enabled === false) next.delete(id); else next.add(id)
    return { project: this.updateProject({ id: project.id, capabilityPacks: [...next] }), packs: this.listCapabilityPacks() }
  }

  listConversationWorkflows() {
    return CONVERSATION_WORKFLOWS.map(workflow => {
      const tools = [...workflow.requiredTools, ...(workflow.optionalTools || [])].map(name => ({ name, ...this.tools.availability(name) }))
      const missing = tools.filter(tool => workflow.requiredTools.includes(tool.name) && !tool.available)
      return { ...workflow, available: missing.length === 0, tools, message: missing.length ? missing.map(tool => tool.reason).filter(Boolean).join('；') : '已就绪' }
    })
  }

  createRun(input = {}) {
    const { database } = this.#context(); const project = this.ensureProject()
    const objective = text(input.objective, '目标', 12000)
    const acceptance = list(input.acceptance, 20).map(item => String(item).trim()).filter(Boolean)
    const runId = crypto.randomUUID(); const createdAt = now()
    const sessionId = input.sessionId ? text(input.sessionId, '对话 ID', 160) : undefined
    if (sessionId) {
      const session = database.prepare('SELECT id FROM agent_sessions WHERE id = ? AND project_id = ?').get(sessionId, project.projectId)
      if (!session) throw new Error('这段对话不属于当前项目。')
    }
    const capabilityPack = input.capabilityPack ? getCapabilityPack(input.capabilityPack) : undefined
    if (input.capabilityPack && !capabilityPack) throw new Error('选择的固定工作流不存在。')
    const conversationWorkflow = input.conversationWorkflowId ? getConversationWorkflow(input.conversationWorkflowId) : undefined
    if (input.conversationWorkflowId && !conversationWorkflow) throw new Error('选择的对话工作流不存在。')
    if (capabilityPack && conversationWorkflow) throw new Error('一次任务只能选择一个固定工作流。')
    let conversationWorkflowInput = object(input.conversationWorkflowInput)
    if (conversationWorkflow) {
      conversationWorkflowInput = { sourceIds: normalizedSourceIds(conversationWorkflowInput, conversationWorkflow.maximumSources ?? 6) }
      const minimumSources = conversationWorkflow.minimumSources ?? (conversationWorkflow.sourceSelection === 'required' ? 1 : 0)
      if (conversationWorkflowInput.sourceIds.length < minimumSources) throw new Error(`“${conversationWorkflow.name}”需要先选择至少 ${minimumSources} 份项目资料。`)
      const missingTool = conversationWorkflow.requiredTools.map(name => ({ name, ...this.tools.availability(name) })).find(tool => !tool.available)
      if (missingTool) throw new Error(`“${conversationWorkflow.name}”暂时不能使用：${missingTool.reason || `${missingTool.name} 未就绪`}`)
    }
    let capabilityInput = object(input.capabilityInput)
    let preflight
    if (capabilityPack) {
      preflight = this.preflightCapability(capabilityPack.id)
      if (!preflight.ready) throw new Error(`“${capabilityPack.name}”暂时不能建立任务：${preflight.message}`)
      const properties = object(capabilityPack.inputSchema?.properties)
      for (const [key, definition] of Object.entries(properties)) {
        const missing = capabilityInput[key] === undefined || capabilityInput[key] === null || (typeof capabilityInput[key] === 'string' && !capabilityInput[key].trim())
        if (missing && definition.default !== undefined) capabilityInput[key] = JSON.parse(JSON.stringify(definition.default))
        if (definition.type === 'path' && !capabilityInput[key] && definition.suggested) capabilityInput[key] = path.join(project.vaultPath, definition.suggested)
        if (definition.type === 'object' && typeof capabilityInput[key] === 'string' && capabilityInput[key].trim()) {
          const parsed = structuredJson(capabilityInput[key])
          if (!parsed || typeof parsed !== 'object') throw new Error(`${definition.label || key}必须是有效 JSON 对象或数组。`)
          capabilityInput[key] = parsed
        }
        if (definition.type === 'number' && capabilityInput[key] !== undefined && capabilityInput[key] !== '') {
          const parsed = Number(capabilityInput[key])
          if (!Number.isFinite(parsed)) throw new Error(`${definition.label || key}必须是有效数字。`)
          capabilityInput[key] = parsed
        }
      }
      const validation = validateCapabilityInput(capabilityPack, capabilityInput)
      if (!validation.valid) throw new Error(validation.errors.join('；'))
      capabilityInput = validation.input
    }
    const workflowPreflight = conversationWorkflow ? { ready: true, status: 'ready', tools: conversationWorkflow.requiredTools.map(name => ({ name, ...this.tools.availability(name) })), connectors: [], missing: [], permissionRequirements: conversationWorkflow.permissionRequirements, message: '固定步骤已就绪；开始前请确认本次任务范围。' } : undefined
    const steps = this.#initialSteps(objective, input.taskType, project, capabilityPack, capabilityInput, conversationWorkflow, conversationWorkflowInput)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`INSERT INTO agent_runs(id, workbench_project_id, legacy_session_id, objective, acceptance_json, status, budget_json, model_roles_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
        .run(runId, project.id, sessionId || null, objective, JSON.stringify(acceptance), JSON.stringify(input.budget || {}), JSON.stringify(input.modelRoles || {}), createdAt, createdAt)
      steps.forEach((step, position) => database.prepare(`INSERT INTO agent_run_steps(id, run_id, plan_version, position, kind, tool_name, title, rationale, input_json, status, max_attempts, high_risk, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'queued', 2, ?, ?, ?)`)
        .run(crypto.randomUUID(), runId, position, step.kind, step.toolName || null, step.title, step.rationale || '', JSON.stringify(step.input || {}), step.highRisk ? 1 : 0, createdAt, createdAt))
      this.#event(database, runId, 'run_created', 'user', { objective, acceptance, capabilityPack: capabilityPack?.id, capabilityVersion: capabilityPack?.version, capabilityInput, conversationWorkflowId: conversationWorkflow?.id, conversationWorkflowInput, preflight: workflowPreflight || preflight })
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
    this.#transition(runId, 'awaiting_authorization', { reason: 'plan_ready' })
    return this.getRun(runId)
  }

  #initialSteps(objective, taskType, project, capabilityPack, capabilityInput = {}, conversationWorkflow, conversationWorkflowInput = {}) {
    if (conversationWorkflow) return buildConversationWorkflowSteps(conversationWorkflow, objective, project, conversationWorkflowInput)
    const root = project.externalRoots[0] || project.vaultPath
    const type = ['research', 'engineering', 'document', 'code', 'data', 'desktop'].includes(taskType) ? taskType : 'engineering'
    const common = [{ kind: 'tool', toolName: 'project.inspect', title: '观察项目现场', rationale: '先读取授权范围内的真实结构。', input: { root } }]
    if (capabilityPack?.workflow?.steps?.length) {
      for (const workflowStep of capabilityPack.workflow.steps) common.push({
        kind: workflowStep.kind,
        toolName: workflowStep.toolName,
        title: workflowStep.title,
        rationale: [workflowStep.disclosure, workflowStep.confirmation ? '此步骤需要人工确认。' : ''].filter(Boolean).join(' '),
        input: { ...object(workflowStep.input), _workflowStepId: workflowStep.id, _capabilityInput: capabilityInput },
        highRisk: workflowStep.kind === 'human' || Boolean(workflowStep.confirmation),
      })
      common.push({ kind: 'verify', title: '核对能力 QA 与验收条件', rationale: '只有固定工作流、QA 和用户验收均有证据才完成。', input: { expectedOutputs: capabilityPack.outputs || [], qaRules: capabilityPack.qaRules || [], _workflowStepId: 'verify-capability' } })
      return common
    }
    if (capabilityPack) common.push({ kind: 'model', title: `制定“${capabilityPack.name}”执行方案`, rationale: capabilityPack.description, input: { role: 'planner', objective, capabilityPack: capabilityPack.id, expectedOutputs: capabilityPack.outputs } })
    if (type === 'research') common.push({ kind: 'model', title: '整理问题与证据缺口', rationale: '根据当前资料确定检索与验证方向。', input: { role: 'planner', objective } })
    if (type === 'document') common.push({ kind: 'model', title: '形成文档结构', input: { role: 'planner', objective } })
    if (type === 'code' || type === 'data' || type === 'engineering') common.push({ kind: 'model', title: '分析实现路径', input: { role: 'planner', objective } })
    if (type === 'desktop') common.push({ kind: 'human', title: '选择并授权目标应用', rationale: '桌面控制必须绑定明确窗口。', highRisk: true, input: { applications: ['browser', 'word', 'excel', 'powerpoint', 'vscode'] } })
    common.push({ kind: 'verify', title: '核对验收条件', rationale: '只有全部验收条件有证据才完成。', input: { expectedOutputs: capabilityPack?.outputs || [] } })
    return common
  }

  listRuns(input = {}) {
    const { database } = this.#context(); const project = this.ensureProject()
    const statuses = list(input.statuses, 20).filter(value => RUN_STATUSES.includes(value))
    const rows = statuses.length
      ? database.prepare(`SELECT * FROM agent_runs WHERE workbench_project_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 200`).all(project.id, ...statuses)
      : database.prepare('SELECT * FROM agent_runs WHERE workbench_project_id = ? ORDER BY updated_at DESC LIMIT 200').all(project.id)
    return rows.map(runView)
  }

  getRun(idValue) {
    const { database } = this.#context(); const id = text(idValue, 'Run ID', 160)
    const row = database.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id)
    if (!row) throw new Error('Run 不存在。')
    const run = runView(row)
    const createdEvent = database.prepare("SELECT payload_json FROM agent_events WHERE run_id = ? AND event_type = 'run_created' ORDER BY created_at LIMIT 1").get(id)
    const creation = json(createdEvent?.payload_json, {})
    const artifactRows = database.prepare('SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at DESC').all(id)
    const artifacts = artifactRows.map(row => ({ id: row.id, kind: row.kind, label: row.label, path: row.path || undefined, sha256: row.sha256 || undefined, metadata: json(row.metadata_json, {}), createdAt: row.created_at }))
    const resultVersions = artifacts.filter(artifact => artifact.kind === 'report' && artifact.metadata?.resultId)
    const latestResults = [...new Set(resultVersions.map(artifact => artifact.metadata.resultId))].map(resultId => resultVersions.find(artifact => artifact.metadata.resultId === resultId)).filter(Boolean).map(artifact => ({
      id: artifact.metadata.resultId, type: artifact.metadata.resultType, label: artifact.label, content: artifact.metadata.content || '', data: artifact.metadata.data || {}, sourceLinks: artifact.metadata.sourceLinks || [], reviewState: artifact.metadata.reviewState || 'draft', version: artifact.metadata.version || 1, artifactId: artifact.id, updatedAt: artifact.createdAt,
    }))
    return {
      ...run,
      capabilityPackId: creation.capabilityPack || undefined,
      capabilityVersion: creation.capabilityVersion || undefined,
      capabilityInput: creation.capabilityInput || {},
      conversationWorkflowId: creation.conversationWorkflowId || undefined,
      conversationWorkflowInput: creation.conversationWorkflowInput || {},
      preflight: creation.preflight,
      steps: database.prepare('SELECT * FROM agent_run_steps WHERE run_id = ? AND plan_version = ? ORDER BY position').all(id, run.planVersion).map(stepView),
      permission: this.#activeGrant(database, id),
      decisions: database.prepare("SELECT * FROM agent_decisions WHERE run_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC").all(id).map(row => ({ id: row.id, runId: row.run_id, stepId: row.step_id || undefined, type: row.decision_type, prompt: row.prompt, options: json(row.options_json, []), status: row.status, response: row.response_json ? json(row.response_json, {}) : undefined, createdAt: row.created_at, resolvedAt: row.resolved_at || undefined })),
      artifacts,
      results: latestResults,
      latestEvaluation: (() => { const result = database.prepare('SELECT * FROM agent_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(id); return result ? { status: result.status, score: result.score, criteria: json(result.criteria_json, []), summary: result.summary, createdAt: result.created_at } : undefined })(),
    }
  }

  authorizeRun(input = {}) {
    const { database } = this.#context(); const run = this.getRun(input.runId)
    if (run.status !== 'awaiting_authorization' && run.status !== 'waiting_human') throw new Error('当前 Run 不等待授权。')
    const grant = this.policy.normalizeGrant(input.scope)
    if (!grant.readRoots.length && !grant.writeRoots.length) throw new Error('至少授权一个项目目录。')
    const requiredDomains = list(run.preflight?.permissionRequirements?.domains, 30)
    const missingDomains = requiredDomains.filter(required => !grant.domains.some(domain => required === domain || required.endsWith(`.${domain}`)))
    if (missingDomains.length) throw new Error(`这个能力必须访问：${missingDomains.join('、')}。请在“允许访问的域名”中确认后再开始。`)
    const requiredApplications = list(run.preflight?.permissionRequirements?.applications, 20)
    const missingApplications = requiredApplications.filter(required => !grant.applications.some(application => application.toLowerCase() === required.toLowerCase()))
    if (missingApplications.length) throw new Error(`这个能力必须使用：${missingApplications.join('、')}。请在“允许控制的应用”中确认后再开始。`)
    const requiredCommands = list(run.preflight?.permissionRequirements?.commands, 20)
    const missingCommands = requiredCommands.filter(required => !grant.commands.some(command => command.toLowerCase() === required.toLowerCase() || path.basename(command).toLowerCase() === path.basename(required).toLowerCase()))
    if (missingCommands.length) throw new Error(`这个能力必须运行：${missingCommands.join('、')}。请在“允许执行的程序”中确认后再开始。`)
    const pack = run.capabilityPackId ? getCapabilityPack(run.capabilityPackId) : undefined
    for (const [key, definition] of Object.entries(object(pack?.inputSchema?.properties))) {
      if (definition.type === 'path' && run.capabilityInput?.[key]) this.policy.requirePath(grant, run.capabilityInput[key], definition.mode === 'write' ? 'write' : 'read')
    }
    const revision = run.permissionRevision + 1; const authorizedAt = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare("UPDATE agent_permission_grants SET status = 'revoked', invalidated_reason = 'superseded' WHERE run_id = ? AND status = 'active'").run(run.id)
      database.prepare("INSERT INTO agent_permission_grants(id, run_id, revision, scope_json, status, authorized_by, authorized_at) VALUES (?, ?, ?, ?, 'active', 'user', ?)")
        .run(crypto.randomUUID(), run.id, revision, JSON.stringify(grant), authorizedAt)
      database.prepare('UPDATE agent_runs SET permission_revision = ?, updated_at = ? WHERE id = ?').run(revision, authorizedAt, run.id)
      this.#event(database, run.id, 'authorization_granted', 'user', { revision, scope: grant })
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
    this.#transition(run.id, 'running', { reason: 'authorized' })
    return this.getRun(run.id)
  }

  #activeGrant(database, runId) {
    const row = database.prepare("SELECT * FROM agent_permission_grants WHERE run_id = ? AND status = 'active' ORDER BY revision DESC LIMIT 1").get(runId)
    return row ? { id: row.id, revision: row.revision, scope: json(row.scope_json, {}), status: row.status, authorizedAt: row.authorized_at } : undefined
  }

  #transition(runId, next, payload = {}) {
    const { database } = this.#context(); const row = database.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId)
    if (!row) throw new Error('Run 不存在。')
    if (!TRANSITIONS[row.status]?.includes(next)) throw new Error(`Run 不能从 ${row.status} 进入 ${next}。`)
    const timestamp = now()
    database.prepare('UPDATE agent_runs SET status = ?, updated_at = ?, started_at = CASE WHEN ? = \'running\' THEN COALESCE(started_at, ?) ELSE started_at END, completed_at = CASE WHEN ? IN (\'completed\',\'failed\',\'cancelled\') THEN ? ELSE completed_at END WHERE id = ?')
      .run(next, timestamp, next, timestamp, next, timestamp, runId)
    this.#event(database, runId, 'status_changed', 'system', { from: row.status, to: next, ...payload })
  }

  pauseRun(runId) { this.#transition(text(runId, 'Run ID', 160), 'paused', { reason: 'user' }); return this.getRun(runId) }
  resumeRun(runId) { this.#transition(text(runId, 'Run ID', 160), 'running', { reason: 'user' }); return this.getRun(runId) }
  cancelRun(runId) { const run = this.getRun(runId); if (TERMINAL_STATUSES.has(run.status)) return run; this.#transition(run.id, 'cancelled', { reason: 'user' }); return this.getRun(run.id) }

  checkpoint(runIdValue, reason, stepId, snapshot = {}) {
    const { database } = this.#context(); const runId = text(runIdValue, 'Run ID', 160); const id = crypto.randomUUID(); const createdAt = now()
    database.prepare('INSERT INTO agent_checkpoints(id, run_id, step_id, reason, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, runId, stepId || null, String(reason || 'step'), JSON.stringify(snapshot), createdAt)
    database.prepare('UPDATE agent_runs SET current_checkpoint_id = ?, updated_at = ? WHERE id = ?').run(id, createdAt, runId)
    this.#event(database, runId, 'checkpoint_created', 'system', { checkpointId: id, reason }, stepId)
    return { id, runId, stepId, reason, snapshot, createdAt }
  }

  #resolvedStepInput(run, step) {
    const capabilityInput = object(step.input?._capabilityInput)
    const resolve = value => {
      if (typeof value === 'string' && value.startsWith('$input.')) return valueAt(capabilityInput, value.slice(7))
      if (Array.isArray(value)) return value.map(resolve)
      if (value && typeof value === 'object') {
        if (typeof value.$from === 'string') {
          const sourceStep = run.steps.find(candidate => candidate.input?._workflowStepId === value.$from)
          if (!sourceStep || sourceStep.status !== 'completed') throw new Error(`工作流上游步骤“${value.$from}”尚未产生可用输出。`)
          return value.path ? valueAt(sourceStep.output, value.path) : sourceStep.output
        }
        if (typeof value.$result === 'string') {
          const result = run.results?.find(candidate => candidate.type === value.$result)
          if (!result) throw new Error(`工作流结果“${value.$result}”尚未建立。`)
          return value.path ? valueAt(result, value.path) : result
        }
        return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')).map(([key, item]) => [key, resolve(item)]))
      }
      return value
    }
    return resolve(step.input)
  }

  async executeNext(runIdValue) {
    const { database } = this.#context(); const run = this.getRun(runIdValue)
    if (run.status !== 'running') throw new Error('Run 当前没有处于运行状态。')
    const grant = run.permission?.scope
    if (!grant) throw new Error('Run 尚未获得任务级授权。')
    const step = run.steps.find(item => item.status === 'queued' || item.status === 'failed')
    if (!step) { this.#transition(run.id, 'verifying', { reason: 'steps_finished' }); return this.verifyRun(run.id) }
    const approvedDecision = database.prepare("SELECT id FROM agent_decisions WHERE run_id = ? AND step_id = ? AND status = 'approved' ORDER BY resolved_at DESC LIMIT 1").get(run.id, step.id)
    if ((step.highRisk || step.kind === 'human') && !approvedDecision) return this.#requestDecision(database, run.id, step, 'high_risk', `需要确认：${step.title}`)
    this.checkpoint(run.id, 'before-step', step.id, { step, permissionRevision: run.permissionRevision })
    const startedAt = now()
    database.prepare("UPDATE agent_run_steps SET status = 'running', attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL WHERE id = ?").run(startedAt, startedAt, step.id)
    database.prepare('UPDATE agent_runs SET current_step_id = ?, updated_at = ? WHERE id = ?').run(step.id, startedAt, run.id)
    this.#event(database, run.id, 'step_started', 'system', { title: step.title, attempt: step.attemptCount + 1 }, step.id)
    try {
      let output
      if (step.kind === 'human') output = { approved: true, decisionId: approvedDecision.id }
      else if (step.kind === 'tool') output = await this.tools.execute(step.toolName, this.#resolvedStepInput(run, step), grant, { highRiskApproved: Boolean(approvedDecision) })
      else if (step.kind === 'model') output = await this.#executeModelStep(run, step)
      else if (step.kind === 'verify') return this.verifyRun(run.id)
      if (output?.requiresHighRiskConfirmation) {
        database.prepare("UPDATE agent_run_steps SET status = 'waiting_confirmation', updated_at = ? WHERE id = ?").run(now(), step.id)
        return this.#requestDecision(database, run.id, step, 'high_risk', `危险动作需要二次确认：${output.summary}`)
      }
      const completedAt = now()
      database.prepare("UPDATE agent_run_steps SET status = 'completed', output_json = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(JSON.stringify(output || {}), completedAt, completedAt, step.id)
      if (step.kind === 'model' && output?.proposedSteps?.length) this.#expandPlan(database, run, step, output.proposedSteps)
      this.#event(database, run.id, 'step_completed', 'tool', { output }, step.id)
      if (output?.path) database.prepare("INSERT INTO agent_artifacts(id, run_id, step_id, kind, label, path, sha256, metadata_json, created_at) VALUES (?, ?, ?, 'file', ?, ?, ?, '{}', ?)").run(crypto.randomUUID(), run.id, step.id, step.title, output.path, output.sha256 || null, completedAt)
      if (output?.result && typeof output.result === 'object') {
        const resultId = crypto.randomUUID()
        const metadata = { resultId, resultType: String(output.result.type || 'structured_result'), content: String(output.result.content || ''), data: object(output.result.data), sourceLinks: list(output.result.sourceLinks, 500), reviewState: 'draft', version: 1 }
        database.prepare("INSERT INTO agent_artifacts(id, run_id, step_id, kind, label, metadata_json, created_at) VALUES (?, ?, ?, 'report', ?, ?, ?)")
          .run(crypto.randomUUID(), run.id, step.id, String(output.result.label || step.title), JSON.stringify(metadata), completedAt)
      }
      this.checkpoint(run.id, 'after-step', step.id, { output })
      return this.getRun(run.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '步骤执行失败。'; const failedAt = now(); const attempts = step.attemptCount + 1
      database.prepare("UPDATE agent_run_steps SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message.slice(0, 2000), failedAt, step.id)
      database.prepare('UPDATE agent_runs SET failure_count = failure_count + 1, updated_at = ? WHERE id = ?').run(failedAt, run.id)
      this.#event(database, run.id, 'step_failed', 'tool', { error: message, attempts }, step.id)
      if ((run.capabilityPackId && step.input?._workflowStepId) || (run.conversationWorkflowId && step.input?._conversationWorkflowStep)) {
        this.#transition(run.id, 'waiting_human', { reason: 'fixed_workflow_step_failed', stepId: step.id })
        this.#requestDecision(database, run.id, step, 'recovery', `固定工作流的“${step.title}”没有成功。为避免改变科研方法，请修正输入后重试，或取消任务。`, ['重试', '取消任务'])
      } else if (attempts >= step.maxAttempts) {
        this.#transition(run.id, 'waiting_human', { reason: 'attempt_limit', stepId: step.id })
        this.#requestDecision(database, run.id, step, 'recovery', `“${step.title}”已经尝试两种方案仍失败，需要你决定下一步。`, ['重试', '跳过', '取消任务'])
      } else if (step.kind === 'tool') {
        this.#transition(run.id, 'replanning', { reason: 'step_failed', stepId: step.id })
        try {
          await this.#replanFailedToolStep(run, step, message)
          this.#transition(run.id, 'running', { reason: 'plan_revised', previousStepId: step.id })
        } catch (replanError) {
          this.#event(database, run.id, 'replan_failed', 'agent', { error: replanError instanceof Error ? replanError.message : '重规划失败' }, step.id)
          this.#transition(run.id, 'running', { reason: 'replan_unavailable_retry_original', stepId: step.id })
        }
      }
      return this.getRun(run.id)
    }
  }

  async executeUntilBlocked(runIdValue) {
    const runId = text(runIdValue, 'Run ID', 160)
    let current = this.getRun(runId)
    for (let index = 0; index < 50 && current.status === 'running'; index += 1) {
      current = await this.executeNext(runId)
    }
    if (current.status === 'running') {
      this.#transition(runId, 'waiting_human', { reason: 'safety_step_limit', limit: 50 })
      const { database } = this.#context()
      const step = this.getRun(runId).steps.find(item => item.status === 'queued' || item.status === 'failed') || current.steps[current.steps.length - 1]
      return this.#requestDecision(database, runId, step, 'recovery', '本轮已连续执行 50 步，为避免异常循环已暂停，请确认是否继续。', ['继续', '取消任务'])
    }
    return current
  }

  async #executeModelStep(run, step) {
    const role = ['planner', 'executor', 'vision', 'verifier'].includes(step.input.role) ? step.input.role : 'executor'
    const profileRole = ['planner', 'executor', 'vision', 'verifier'].includes(run.modelRoles?.selectedRole) ? run.modelRoles.selectedRole : role
    const started = Date.now(); let outcome = 'completed'; let result; let failure
    try {
      const previous = run.steps.filter(item => item.status === 'completed' && item.output).map(item => ({ title: item.title, toolName: item.toolName, output: item.output })).slice(-5)
      const toolNames = this.tools.list().map(tool => tool.name)
      const planningInstruction = role === 'planner' ? `\n如果需要继续执行工具，请只输出 JSON：{"summary":"...","steps":[{"kind":"tool","toolName":"${toolNames[0]}","title":"...","rationale":"...","input":{}}]}。toolName 只能是：${toolNames.join('、')}。最多 12 步，不要生成 shell 字符串，command.run 必须拆成 executable、args 数组和 cwd。若不需要工具，steps 为空。` : ''
      result = await this.llm.complete({ role, profileRole, purpose: 'research-agent', messages: [
        { role: 'system', content: `你是单 Agent 工作台中的一个模型角色。只基于给定目标和已授权现场输出当前步骤结果，不声称执行未调用的工具。${planningInstruction}` },
        { role: 'user', content: `目标：${run.objective}\n验收条件：${JSON.stringify(run.acceptance)}\n当前步骤：${step.title}\n说明：${step.rationale}\n已完成观察：${JSON.stringify(previous).slice(0, 14000)}` },
      ], temperature: 0.1, maxTokens: 1400 })
      const parsed = role === 'planner' ? structuredJson(result.content) : undefined
      const proposedSteps = this.#validatedProposedSteps(parsed?.steps)
      return { content: result.content, summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 2000) : undefined, proposedSteps, providerId: result.providerId, model: result.model, usage: result.usage }
    } catch (error) { outcome = 'failed'; failure = error; throw error }
    finally {
      const profile = (() => { try { return this.settings.loadModelRoleConfig(profileRole) } catch { return {} } })()
      const usage = result?.usage || {}
      const cost = usage.promptTokens !== undefined || usage.completionTokens !== undefined
        ? ((usage.promptTokens || 0) * (profile.inputPricePerMillion || 0) + (usage.completionTokens || 0) * (profile.outputPricePerMillion || 0)) / 1_000_000
        : undefined
      const { database } = this.#context()
      database.prepare(`INSERT INTO model_call_metrics(id, run_id, step_id, role, provider_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost, outcome, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), run.id, step.id, role, result?.providerId || profile.providerId || 'unknown', result?.model || profile.model || 'unknown', usage.promptTokens || null, usage.completionTokens || null, usage.totalTokens || null, result?.latencyMs || Date.now() - started, cost ?? null, outcome, failure?.message || null, now())
    }
  }

  #validatedProposedSteps(value) {
    const allowed = new Set(this.tools.list().map(tool => tool.name))
    return list(value, 12).flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object') return []
      const kind = candidate.kind === 'model' ? 'model' : 'tool'
      const toolName = kind === 'tool' ? String(candidate.toolName || '') : undefined
      if (kind === 'tool' && !allowed.has(toolName)) return []
      const input = candidate.input && typeof candidate.input === 'object' && !Array.isArray(candidate.input) ? candidate.input : {}
      if (JSON.stringify(input).length > 20000) return []
      const title = String(candidate.title || '').trim().slice(0, 240)
      if (!title) return []
      const summary = `${toolName || kind} ${candidate.rationale || ''} ${JSON.stringify(input)}`
      const highRisk = kind === 'tool' && this.policy.classify({ kind: candidate.intent, summary }).highRisk
      return [{ kind, toolName, title, rationale: String(candidate.rationale || '').trim().slice(0, 1200), input, highRisk }]
    })
  }

  #expandPlan(database, run, plannerStep, steps) {
    const existing = database.prepare("SELECT COUNT(*) count FROM agent_events WHERE run_id = ? AND step_id = ? AND event_type = 'plan_expanded'").get(run.id, plannerStep.id)
    if (existing.count || !steps.length) return
    const timestamp = now(); const count = steps.length
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('UPDATE agent_run_steps SET position = position + 1000 WHERE run_id = ? AND plan_version = ? AND position > ?').run(run.id, run.planVersion, plannerStep.position)
      database.prepare('UPDATE agent_run_steps SET position = position - ? WHERE run_id = ? AND plan_version = ? AND position >= ?').run(1000 - count, run.id, run.planVersion, plannerStep.position + 1000 + 1)
      steps.forEach((candidate, index) => database.prepare(`INSERT INTO agent_run_steps(id, run_id, plan_version, position, kind, tool_name, title, rationale, input_json, status, max_attempts, high_risk, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 2, ?, ?, ?)`)
        .run(crypto.randomUUID(), run.id, run.planVersion, plannerStep.position + 1 + index, candidate.kind, candidate.toolName || null, candidate.title, candidate.rationale, JSON.stringify(candidate.input), candidate.highRisk ? 1 : 0, timestamp, timestamp))
      this.#event(database, run.id, 'plan_expanded', 'agent', { plannerStepId: plannerStep.id, addedSteps: steps.map(item => ({ title: item.title, kind: item.kind, toolName: item.toolName })) }, plannerStep.id)
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }

  async #replanFailedToolStep(run, failedStep, errorMessage) {
    const started = Date.now(); let result; let failure
    const profileRole = ['planner', 'executor', 'vision', 'verifier'].includes(run.modelRoles?.selectedRole) ? run.modelRoles.selectedRole : 'planner'
    try {
      const tools = this.tools.list().map(tool => tool.name)
      result = await this.llm.complete({ role: 'planner', profileRole, purpose: 'research-agent', temperature: 0.1, maxTokens: 900, messages: [
        { role: 'system', content: `一个工具步骤首次失败。请提供第二种可验证方案，只输出 JSON：{"strategy":"...","replacement":{"kind":"tool","toolName":"...","title":"...","rationale":"...","input":{}}}。toolName 只能是：${tools.join('、')}。command.run 必须使用 executable、args 数组和 cwd，不要输出 shell 字符串。` },
        { role: 'user', content: `目标：${run.objective}\n失败步骤：${failedStep.title}\n工具：${failedStep.toolName}\n原输入：${JSON.stringify(failedStep.input)}\n错误：${errorMessage}` },
      ] })
      const parsed = structuredJson(result.content)
      const replacement = this.#validatedProposedSteps([parsed?.replacement])[0] || { kind: failedStep.kind, toolName: failedStep.toolName, title: failedStep.title, rationale: `${failedStep.rationale}\n重规划未提供有效替代输入，保留原方案重试。`, input: failedStep.input, highRisk: failedStep.highRisk }
      this.#createPlanRevision(run, failedStep, replacement, String(parsed?.strategy || '针对失败结果生成第二种执行方案。').slice(0, 2000))
    } catch (error) { failure = error; throw error }
    finally {
      const profile = (() => { try { return this.settings.loadModelRoleConfig(profileRole) } catch { return {} } })()
      const usage = result?.usage || {}
      const cost = usage.promptTokens !== undefined || usage.completionTokens !== undefined
        ? ((usage.promptTokens || 0) * (profile.inputPricePerMillion || 0) + (usage.completionTokens || 0) * (profile.outputPricePerMillion || 0)) / 1_000_000
        : undefined
      const { database } = this.#context()
      database.prepare(`INSERT INTO model_call_metrics(id, run_id, step_id, role, provider_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost, outcome, error, created_at)
        VALUES (?, ?, ?, 'planner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), run.id, failedStep.id, result?.providerId || profile.providerId || 'unknown', result?.model || profile.model || 'unknown', usage.promptTokens || null, usage.completionTokens || null, usage.totalTokens || null, result?.latencyMs || Date.now() - started, cost ?? null, failure ? 'failed' : 'completed', failure?.message || null, now())
    }
  }

  #createPlanRevision(run, failedStep, replacement, strategy) {
    const { database } = this.#context(); const timestamp = now(); const nextVersion = run.planVersion + 1
    const rows = database.prepare('SELECT * FROM agent_run_steps WHERE run_id = ? AND plan_version = ? ORDER BY position').all(run.id, run.planVersion)
    let revisedStepId
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        const revised = row.id === failedStep.id
        const id = crypto.randomUUID()
        if (revised) revisedStepId = id
        database.prepare(`INSERT INTO agent_run_steps(id, run_id, plan_version, position, kind, tool_name, title, rationale, input_json, status, attempt_count, max_attempts, high_risk, output_json, error, created_at, updated_at, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, run.id, nextVersion, row.position, revised ? replacement.kind : row.kind, revised ? replacement.toolName || null : row.tool_name,
            revised ? replacement.title : row.title, revised ? replacement.rationale : row.rationale, revised ? JSON.stringify(replacement.input) : row.input_json,
            revised ? 'queued' : row.status, row.attempt_count, row.max_attempts, revised ? (replacement.highRisk ? 1 : 0) : row.high_risk,
            revised ? null : row.output_json, revised ? null : row.error, row.created_at, timestamp, revised ? null : row.started_at, revised ? null : row.completed_at)
      }
      database.prepare('UPDATE agent_runs SET plan_version = ?, current_step_id = ?, updated_at = ? WHERE id = ?').run(nextVersion, revisedStepId || null, timestamp, run.id)
      this.#event(database, run.id, 'plan_replanned', 'agent', { fromVersion: run.planVersion, toVersion: nextVersion, failedStepId: failedStep.id, revisedStepId, strategy, replacement: { title: replacement.title, toolName: replacement.toolName } }, failedStep.id)
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }

  #requestDecision(database, runId, step, type, prompt, options = ['批准', '拒绝']) {
    const existing = database.prepare("SELECT id FROM agent_decisions WHERE run_id = ? AND step_id = ? AND status = 'pending'").get(runId, step.id)
    if (!existing) database.prepare("INSERT INTO agent_decisions(id, run_id, step_id, decision_type, prompt, options_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(crypto.randomUUID(), runId, step.id, type, prompt, JSON.stringify(options), now())
    const current = database.prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId)
    if (current.status === 'running') this.#transition(runId, 'waiting_human', { reason: type, stepId: step.id })
    return this.getRun(runId)
  }

  resolveDecision(input = {}) {
    const { database } = this.#context(); const id = text(input.decisionId, '决定 ID', 160)
    const decision = database.prepare('SELECT * FROM agent_decisions WHERE id = ?').get(id)
    if (!decision || decision.status !== 'pending') throw new Error('这个决定已经处理或不存在。')
    const approved = input.approved === true
    const timestamp = now()
    database.prepare('UPDATE agent_decisions SET status = ?, response_json = ?, resolved_at = ? WHERE id = ?').run(approved ? 'approved' : 'rejected', JSON.stringify({ approved, value: input.value }), timestamp, id)
    if (decision.step_id) database.prepare("UPDATE agent_run_steps SET status = ?, updated_at = ? WHERE id = ?").run(approved ? 'queued' : 'skipped', timestamp, decision.step_id)
    this.#event(database, decision.run_id, 'decision_resolved', 'user', { decisionId: id, approved, value: input.value }, decision.step_id)
    const run = this.getRun(decision.run_id)
    if (run.status === 'waiting_human') this.#transition(run.id, 'running', { reason: 'decision_resolved' })
    return this.getRun(decision.run_id)
  }

  saveResult(input = {}) {
    const { database } = this.#context(); const runId = text(input.runId, 'Run ID', 160); const resultId = text(input.resultId, '结果 ID', 160)
    const rows = database.prepare("SELECT * FROM agent_artifacts WHERE run_id = ? AND kind = 'report' ORDER BY created_at DESC").all(runId)
    const latestRow = rows.find(row => json(row.metadata_json, {}).resultId === resultId)
    if (!latestRow) throw new Error('可编辑结果不存在。')
    const previous = json(latestRow.metadata_json, {}); const timestamp = now()
    const reviewState = ['draft', 'confirmed', 'rejected', 'archived'].includes(input.reviewState) ? input.reviewState : previous.reviewState || 'draft'
    const metadata = { ...previous, content: String(input.content ?? previous.content ?? ''), data: input.data && typeof input.data === 'object' ? input.data : previous.data || {}, sourceLinks: Array.isArray(input.sourceLinks) ? input.sourceLinks.slice(0, 500) : previous.sourceLinks || [], reviewState, version: Number(previous.version || 1) + 1 }
    database.prepare("INSERT INTO agent_artifacts(id, run_id, step_id, kind, label, metadata_json, created_at) VALUES (?, ?, ?, 'report', ?, ?, ?)")
      .run(crypto.randomUUID(), runId, latestRow.step_id, latestRow.label, JSON.stringify(metadata), timestamp)
    this.#event(database, runId, 'result_version_saved', 'user', { resultId, version: metadata.version, reviewState })
    return this.getRun(runId)
  }

  async verifyRun(runIdValue) {
    const { database } = this.#context(); const run = this.getRun(runIdValue)
    if (run.status !== 'verifying') this.#transition(run.id, 'verifying', { reason: 'acceptance_check' })
    const allStepsFinished = run.steps.every(step => ['completed', 'skipped'].includes(step.status) || step.kind === 'verify')
    let criteria
    let verifierSummary = ''
    if (!run.acceptance.length) {
      criteria = [{ label: '所有计划步骤完成', passed: allStepsFinished, evidence: run.steps.filter(step => step.status === 'completed').map(step => ({ type: 'step', id: step.id })) }]
      verifierSummary = allStepsFinished ? '所有计划步骤均已结束。' : '仍有计划步骤未结束。'
    } else {
      const verification = await this.#verifyAcceptanceWithModel(run)
      criteria = verification.criteria
      verifierSummary = verification.summary
    }
    const passed = criteria.every(item => item.passed)
    const score = criteria.filter(item => item.passed).length / criteria.length
    const verificationStep = run.steps.find(step => step.kind === 'verify')
    const evaluatedAt = now()
    if (verificationStep) database.prepare("UPDATE agent_run_steps SET status = 'completed', output_json = ?, error = NULL, updated_at = ?, completed_at = ? WHERE id = ?")
      .run(JSON.stringify({ passed, score, criteria }), evaluatedAt, evaluatedAt, verificationStep.id)
    database.prepare('INSERT INTO agent_evaluations(id, run_id, status, score, criteria_json, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), run.id, passed ? 'passed' : score ? 'partial' : 'failed', score, JSON.stringify(criteria), passed ? '全部验收条件已有运行证据。' : verifierSummary || '仍有验收条件缺少证据，不能标记完成。', evaluatedAt)
    this.checkpoint(run.id, 'after-verification', verificationStep?.id, { passed, score, criteria })
    if (passed) this.#transition(run.id, 'completed', { score })
    else {
      this.#transition(run.id, 'waiting_human', { reason: 'acceptance_incomplete', score })
      const decisionStep = verificationStep || run.steps[run.steps.length - 1]
      this.#requestDecision(database, run.id, decisionStep, 'choice', '验收尚未全部通过，请补充证据或调整任务。', ['继续完善', '接受部分结果', '取消任务'])
    }
    return this.getRun(run.id)
  }

  async #verifyAcceptanceWithModel(run) {
    // Only non-content metadata is sent: no step output, file body, screenshot, command output, or local path.
    const evidence = [
      ...run.steps.filter(step => step.status === 'completed').map(step => ({ type: 'step', id: step.id, title: step.title, toolName: step.toolName, status: step.status })),
      ...run.artifacts.map(artifact => ({ type: 'artifact', id: artifact.id, kind: artifact.kind, label: artifact.label, sha256: artifact.sha256 })),
    ]
    const allowedEvidence = new Set(evidence.map(item => `${item.type}:${item.id}`))
    const started = Date.now(); let result; let failure
    const profileRole = ['planner', 'executor', 'vision', 'verifier'].includes(run.modelRoles?.selectedRole) ? run.modelRoles.selectedRole : 'verifier'
    try {
      result = await this.llm.complete({ role: 'verifier', profileRole, purpose: 'research-agent', temperature: 0, maxTokens: 1200, messages: [
        { role: 'system', content: '你是独立验收角色。只根据给出的非内容型运行证据判断，不得用常识补足。只输出 JSON：{"summary":"...","criteria":[{"label":"原验收条件","passed":true,"evidence":[{"type":"step或artifact","id":"真实ID"}]}]}。passed=true 必须至少引用一个真实证据 ID；证据不足就判 false。' },
        { role: 'user', content: `目标：${run.objective}\n验收条件：${JSON.stringify(run.acceptance)}\n运行证据元数据：${JSON.stringify(evidence).slice(0, 30000)}` },
      ] })
      const parsed = structuredJson(result.content)
      const responses = Array.isArray(parsed?.criteria) ? parsed.criteria : []
      const criteria = run.acceptance.map(label => {
        const candidate = responses.find(item => String(item?.label || '').trim() === label)
        const refs = list(candidate?.evidence, 30).filter(item => item && allowedEvidence.has(`${item.type}:${item.id}`)).map(item => ({ type: item.type, id: item.id }))
        return { label, passed: candidate?.passed === true && refs.length > 0, evidence: refs }
      })
      return { criteria, summary: String(parsed?.summary || '').slice(0, 2000) }
    } catch (error) {
      failure = error
      return { criteria: run.acceptance.map(label => ({ label, passed: false, evidence: [] })), summary: `Verifier 未能完成验收：${error instanceof Error ? error.message : '未知错误'}` }
    } finally {
      const profile = (() => { try { return this.settings.loadModelRoleConfig(profileRole) } catch { return {} } })()
      const usage = result?.usage || {}
      const cost = usage.promptTokens !== undefined || usage.completionTokens !== undefined
        ? ((usage.promptTokens || 0) * (profile.inputPricePerMillion || 0) + (usage.completionTokens || 0) * (profile.outputPricePerMillion || 0)) / 1_000_000
        : undefined
      const { database } = this.#context()
      database.prepare(`INSERT INTO model_call_metrics(id, run_id, step_id, role, provider_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, estimated_cost, outcome, error, created_at)
        VALUES (?, ?, NULL, 'verifier', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), run.id, result?.providerId || profile.providerId || 'unknown', result?.model || profile.model || 'unknown', usage.promptTokens || null, usage.completionTokens || null, usage.totalTokens || null, result?.latencyMs || Date.now() - started, cost ?? null, failure ? 'failed' : 'completed', failure?.message || null, now())
    }
  }

  recoverInterruptedRuns() {
    const { database } = this.#context(); const project = this.ensureProject()
    const rows = database.prepare("SELECT * FROM agent_runs WHERE workbench_project_id = ? AND status IN ('running','replanning','verifying')").all(project.id)
    rows.forEach(row => {
      database.prepare("UPDATE agent_runs SET status = 'paused', updated_at = ? WHERE id = ?").run(now(), row.id)
      database.prepare("UPDATE agent_permission_grants SET status = 'expired', invalidated_reason = 'application_restart' WHERE run_id = ? AND status = 'active'").run(row.id)
      this.#event(database, row.id, 'run_recovered_paused', 'system', { reason: 'application_restart', desktopAuthorizationExpired: true })
    })
    return rows.length
  }

  getDashboard() {
    const runs = this.listRuns()
    return {
      project: this.ensureProject(), runs: runs.slice(0, 8),
      activeCount: runs.filter(run => ['running', 'replanning', 'verifying', 'paused'].includes(run.status)).length,
      waitingCount: runs.filter(run => run.status === 'waiting_human' || run.status === 'awaiting_authorization').length,
      completedCount: runs.filter(run => run.status === 'completed').length,
    }
  }

  listProjectFiles(input = {}) {
    const project = this.ensureProject()
    const { root, target } = safeProjectPath(project, input.root, input.relativePath)
    if (!fs.existsSync(target)) throw new Error('这个项目位置已不存在。')
    const maximum = Math.min(500, Math.max(20, Number(input.maximum) || 240))
    const maximumDepth = Math.min(6, Math.max(1, Number(input.maximumDepth) || 4))
    const entries = []
    const visit = (directory, depth) => {
      if (entries.length >= maximum || depth > maximumDepth) return
      const children = fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => !PREVIEW_SKIP_NAMES.has(entry.name) && !entry.name.startsWith('release-'))
        .sort((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name, 'zh-CN'))
      for (const entry of children) {
        if (entries.length >= maximum) break
        const absolutePath = path.join(directory, entry.name)
        const relativePath = path.relative(root, absolutePath)
        const item = { name: entry.name, relativePath, kind: entry.isDirectory() ? 'directory' : 'file', depth, extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : '' }
        if (entry.isFile()) {
          try { item.size = fs.statSync(absolutePath).size } catch {}
        }
        entries.push(item)
        if (entry.isDirectory()) visit(absolutePath, depth + 1)
      }
    }
    const stat = fs.statSync(target)
    if (stat.isDirectory()) visit(target, 0)
    return { root, relativePath: path.relative(root, target), entries, truncated: entries.length >= maximum }
  }

  previewProjectFile(input = {}) {
    const project = this.ensureProject()
    const { root, target } = safeProjectPath(project, input.root, input.relativePath)
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('请选择项目中的文件。')
    const stat = fs.statSync(target)
    const extension = path.extname(target).toLowerCase()
    const base = { root, relativePath: path.relative(root, target), name: path.basename(target), extension, size: stat.size }
    if (extension === '.pdf') {
      if (stat.size > 25 * 1024 * 1024) return { ...base, kind: 'pdf', previewable: false, content: '', message: 'PDF 超过 25 MB，请在文献阅读区打开。' }
      return { ...base, kind: 'pdf', previewable: true, content: `data:application/pdf;base64,${fs.readFileSync(target).toString('base64')}` }
    }
    if (IMAGE_PREVIEW_MIME[extension]) {
      if (stat.size > 12 * 1024 * 1024) return { ...base, kind: 'image', previewable: false, content: '', message: '图片超过 12 MB，请用原文件查看。' }
      return { ...base, kind: 'image', previewable: true, content: `data:${IMAGE_PREVIEW_MIME[extension]};base64,${fs.readFileSync(target).toString('base64')}` }
    }
    const textLike = TEXT_PREVIEW_EXTENSIONS.has(extension) || stat.size === 0
    if (!textLike) return { ...base, kind: 'binary', previewable: false, content: '', message: '这个文件需要在对应工作区打开。' }
    if (stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB，请用对应工作区打开。')
    return { ...base, kind: 'text', previewable: true, content: fs.readFileSync(target, 'utf8') }
  }
}

module.exports = { RUN_STATUSES, TRANSITIONS, WorkbenchService }
