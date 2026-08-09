const FINISHED_RUN_OUTCOMES = new Set(['success', 'failure', 'failed', 'invalid'])
const OPEN_RUN_OUTCOMES = new Set(['planned', 'running', 'interrupted'])
const SATISFIED_STATES = new Set(['satisfied', 'completed', 'done', 'met', 'passed', '已完成', '已满足'])
const ARTIFACT_ROLE_LABELS = {
  raw_data: '原始数据',
  processed_data: '处理后数据',
  figure: '图表',
  log: '日志',
  script: '脚本',
  config: '配置/参数',
  model: '模型',
  video: '视频',
  image: '图片',
  document: '文档',
  directory: '目录',
  other: '其他',
}

function list(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function identifier(value) {
  return text(value).slice(0, 240)
}

function timestamp(entity, ...keys) {
  for (const key of keys) {
    const value = text(entity?.[key])
    if (value) return value
  }
  return ''
}

function compareRecent(left, right) {
  return text(right.at).localeCompare(text(left.at))
    || text(left.kind).localeCompare(text(right.kind))
    || text(left.id).localeCompare(text(right.id))
}

function compareEntities(left, right, ...timeKeys) {
  const leftAt = timestamp(left, ...timeKeys)
  const rightAt = timestamp(right, ...timeKeys)
  return rightAt.localeCompare(leftAt) || identifier(left?.id).localeCompare(identifier(right?.id))
}

function ref(kind, id) {
  const normalizedId = identifier(id)
  return normalizedId ? { kind, id: normalizedId, tag: `${kind}:${normalizedId}` } : undefined
}

function uniqueRefs(refs) {
  const seen = new Set()
  return refs.filter(Boolean).filter(item => {
    if (seen.has(item.tag)) return false
    seen.add(item.tag)
    return true
  })
}

function normalizeCriterion(criterion, milestoneId, index) {
  const object = criterion && typeof criterion === 'object' ? criterion : {}
  const label = typeof criterion === 'string'
    ? text(criterion, `验收条件 ${index + 1}`)
    : text(object.text ?? object.label ?? object.title, `验收条件 ${index + 1}`)
  const rawState = text(object.status ?? object.state).toLocaleLowerCase()
  const satisfied = object.satisfied === true
    || object.done === true
    || object.completed === true
    || SATISFIED_STATES.has(rawState)
  return {
    id: identifier(object.id) || `${milestoneId}:criterion:${index + 1}`,
    label,
    state: satisfied ? 'satisfied' : 'missing',
    satisfied,
    evidenceRefs: normalizeLooseRefs(object.evidenceRefs ?? object.sources),
  }
}

function normalizeLooseRefs(value) {
  if (!Array.isArray(value)) return []
  return uniqueRefs(value.map(item => {
    if (typeof item === 'string') {
      const separator = item.indexOf(':')
      return separator > 0 ? ref(item.slice(0, separator), item.slice(separator + 1)) : undefined
    }
    if (!item || typeof item !== 'object') return undefined
    return ref(text(item.kind ?? item.entityKind ?? item.type), item.id ?? item.entityId)
  }))
}

function focusMilestone(milestones) {
  const priority = { active: 0, blocked: 1, planned: 2, completed: 3, archived: 4 }
  return [...milestones]
    .filter(item => text(item.status) !== 'archived')
    .sort((left, right) => (priority[text(left.status)] ?? 9) - (priority[text(right.status)] ?? 9)
      || compareEntities(left, right, 'updatedAt', 'dueAt', 'createdAt'))[0]
}

function runClosure(run) {
  const outcome = text(run.outcome ?? run.status, 'planned').toLocaleLowerCase()
  const reasons = []
  if (OPEN_RUN_OUTCOMES.has(outcome)) reasons.push(outcome === 'running' ? '测试仍在进行' : outcome === 'planned' ? '测试尚未开始' : '测试被中断')
  if (!text(run.endedAt) && outcome !== 'planned') reasons.push('尚未记录结束时间')
  if (FINISHED_RUN_OUTCOMES.has(outcome) && !text(run.observations)) reasons.push('尚未记录观察')
  if (['failure', 'failed', 'invalid', 'interrupted'].includes(outcome) && !text(run.nextStep)) reasons.push('尚未确认后续处置')
  return { outcome, needsClosure: reasons.length > 0, reasons }
}

function allActivity(workspace) {
  const activity = []
  for (const item of list(workspace?.milestones)) activity.push({
    kind: 'milestone', id: identifier(item.id), title: text(item.title, '未命名里程碑'),
    at: timestamp(item, 'updatedAt', 'completedAt', 'createdAt'), sourceRef: ref('milestone', item.id),
  })
  for (const item of list(workspace?.runs)) activity.push({
    kind: 'run', id: identifier(item.id), title: text(item.title, '未命名测试'),
    at: timestamp(item, 'updatedAt', 'endedAt', 'startedAt', 'createdAt'), sourceRef: ref('run', item.id),
  })
  for (const item of list(workspace?.artifacts)) activity.push({
    kind: 'artifact', id: identifier(item.id), title: text(item.label ?? item.filePath, '未命名产物'),
    at: timestamp(item, 'updatedAt', 'modifiedAt', 'createdAt'), sourceRef: ref('artifact', item.id),
  })
  for (const item of list(workspace?.records)) activity.push({
    kind: 'record', id: identifier(item.id), title: text(item.title, '未命名记录'),
    at: timestamp(item, 'updatedAt', 'occurredAt', 'createdAt'), sourceRef: ref('record', item.id),
  })
  return activity.filter(item => item.id && item.at).sort(compareRecent)
}

function workspaceIssues(workspace) {
  const blockers = []
  const anomalies = []
  for (const milestone of list(workspace?.milestones)) {
    if (text(milestone.status).toLocaleLowerCase() !== 'blocked') continue
    blockers.push({
      kind: 'milestone', id: identifier(milestone.id), title: text(milestone.title, '被阻塞的里程碑'),
      detail: text(milestone.description, '该里程碑已标记为阻塞'), sourceRef: ref('milestone', milestone.id),
    })
  }
  for (const record of list(workspace?.records)) {
    if (text(record.status).toLocaleLowerCase() !== 'blocked') continue
    blockers.push({
      kind: 'record', id: identifier(record.id), title: text(record.title, '被阻塞的记录'),
      detail: text(record.content, '该记录已标记为阻塞'), sourceRef: ref('record', record.id),
    })
  }
  for (const run of list(workspace?.runs)) {
    if (!text(run.anomaly)) continue
    anomalies.push({
      kind: 'run', id: identifier(run.id), title: text(run.title, '测试异常'), detail: text(run.anomaly),
      sourceRef: ref('run', run.id), at: timestamp(run, 'updatedAt', 'endedAt', 'startedAt'),
    })
  }
  for (const artifact of list(workspace?.artifacts)) {
    const state = text(artifact.existsState).toLocaleLowerCase()
    if (!['missing', 'denied'].includes(state)) continue
    blockers.push({
      kind: 'artifact', id: identifier(artifact.id), title: text(artifact.label ?? artifact.filePath, '产物不可用'),
      detail: state === 'missing' ? '已登记路径上找不到该产物' : '当前无权访问该产物',
      sourceRef: ref('artifact', artifact.id),
    })
  }
  return {
    blockers: blockers.filter(item => item.id).sort((left, right) => text(left.kind).localeCompare(text(right.kind)) || text(left.id).localeCompare(text(right.id))),
    anomalies: anomalies.filter(item => item.id).sort(compareRecent),
  }
}

export function synthesizeResearchWorkspace(workspace = {}) {
  const project = workspace?.project && typeof workspace.project === 'object' ? workspace.project : {}
  const milestones = list(workspace?.milestones)
  const runs = list(workspace?.runs)
  const currentMilestone = focusMilestone(milestones)
  const acceptanceCriteria = currentMilestone
    ? (Array.isArray(currentMilestone.acceptanceCriteria) ? currentMilestone.acceptanceCriteria : [])
      .map((criterion, index) => normalizeCriterion(criterion, identifier(currentMilestone.id), index))
    : []
  const unfinishedRuns = runs.map(run => ({ run, closure: runClosure(run) }))
    .filter(item => item.closure.needsClosure)
    .sort((left, right) => compareEntities(left.run, right.run, 'updatedAt', 'startedAt', 'createdAt'))
    .map(({ run, closure }) => ({
      id: identifier(run.id), title: text(run.title, '未命名测试'), outcome: closure.outcome,
      reasons: closure.reasons, startedAt: text(run.startedAt), updatedAt: text(run.updatedAt), sourceRef: ref('run', run.id),
    }))
  const issues = workspaceIssues(workspace)
  const activity = allActivity(workspace)
  const currentAcceptance = {
    satisfied: acceptanceCriteria.filter(item => item.satisfied),
    missing: acceptanceCriteria.filter(item => !item.satisfied),
  }
  const nextCandidates = []
  for (const run of [...runs].sort((left, right) => compareEntities(left, right, 'updatedAt', 'startedAt'))) {
    if (!text(run.nextStep)) continue
    nextCandidates.push({
      id: `run-next:${identifier(run.id)}`, kind: 'recorded_next_step', title: text(run.nextStep),
      rationale: `来自测试“${text(run.title, '未命名测试')}”中用户已保存的下一步`,
      epistemicType: 'user_observation', sourceRefs: [ref('run', run.id)].filter(Boolean),
    })
  }
  for (const run of [...runs].sort((left, right) => compareEntities(left, right, 'updatedAt', 'startedAt'))) {
    if (text(run.outcome ?? run.status, 'planned') !== 'planned' || text(run.nextStep)) continue
    nextCandidates.push({
      id: `planned-run:${identifier(run.id)}`, kind: 'planned_run', title: text(run.title, '未命名计划测试'),
      rationale: '这是一项用户已经登记、尚未开始的测试', epistemicType: 'fact',
      sourceRefs: [ref('run', run.id)].filter(Boolean),
    })
  }
  for (const criterion of currentAcceptance.missing) nextCandidates.push({
    id: `criterion:${criterion.id}`, kind: 'acceptance_gap', title: criterion.label,
    rationale: `当前里程碑“${text(currentMilestone?.title, '未命名里程碑')}”的验收条件尚未明确满足`,
    epistemicType: 'fact', sourceRefs: [ref('milestone', currentMilestone?.id)].filter(Boolean),
  })
  const lastActivity = activity[0] ?? null
  const summary = {
    project: {
      id: identifier(project.id), name: text(project.name, '未命名课题'),
      mode: text(project.mode, 'exploration'), stage: text(project.stage, '探索中'),
      researchQuestion: text(project.researchQuestion), currentHypothesis: text(project.currentHypothesis),
    },
    isExplorationEmpty: text(project.mode, 'exploration') === 'exploration'
      && !text(project.researchQuestion) && !text(project.currentHypothesis) && !milestones.length && !runs.length,
    lastActivity,
    resume: {
      headline: lastActivity
        ? `上次停在“${lastActivity.title}”`
        : text(project.mode, 'exploration') === 'exploration' ? '尚未开始记录探索过程' : '尚未记录科研活动',
      lastActivity,
      milestoneId: identifier(currentMilestone?.id) || null,
      unfinishedRunCount: unfinishedRuns.length,
      blockerCount: issues.blockers.length,
      anomalyCount: issues.anomalies.length,
    },
    currentMilestone: currentMilestone ? {
      id: identifier(currentMilestone.id), title: text(currentMilestone.title, '未命名里程碑'),
      status: text(currentMilestone.status, 'planned'), description: text(currentMilestone.description),
      dueAt: text(currentMilestone.dueAt), sourceRef: ref('milestone', currentMilestone.id),
    } : null,
    activeMilestone: currentMilestone && text(currentMilestone.status) === 'active' ? {
      id: identifier(currentMilestone.id), title: text(currentMilestone.title, '未命名里程碑'),
      status: 'active', sourceRef: ref('milestone', currentMilestone.id),
    } : null,
    acceptance: currentAcceptance,
    unfinishedRuns,
    blockers: issues.blockers,
    anomalies: issues.anomalies,
    nextCandidates: nextCandidates.slice(0, 12),
  }
  return { ...summary, suggestedActions: suggestResearchActions(summary) }
}

export function suggestResearchActions(workspaceOrSummary = {}) {
  const summary = Object.hasOwn(workspaceOrSummary, 'unfinishedRuns')
    ? workspaceOrSummary
    : synthesizeResearchWorkspaceWithoutSuggestions(workspaceOrSummary)
  const actions = []
  const add = (action) => {
    if (!action.sourceRefs?.length && action.actionType !== 'define_direction' && action.actionType !== 'define_milestone') return
    if (actions.some(item => item.id === action.id)) return
    actions.push({ ...action, requiresConfirmation: true, writesFormalRecord: false })
  }
  if (summary.isExplorationEmpty) add({
    id: 'suggestion:define-direction', actionType: 'define_direction', title: '记录一个候选研究方向',
    rationale: '当前处于空白探索状态，先记录候选方向才能把阅读和小测试串起来。',
    sourceRefs: [ref('project', summary.project?.id)].filter(Boolean),
  })
  if (!summary.currentMilestone && !summary.isExplorationEmpty) add({
    id: `suggestion:define-milestone:${summary.project?.id || 'project'}`, actionType: 'define_milestone', title: '定义一个可验收的当前里程碑',
    rationale: '当前没有可用来判断进展的里程碑。', sourceRefs: [ref('project', summary.project?.id)].filter(Boolean),
  })
  for (const run of summary.unfinishedRuns ?? []) add({
    id: `suggestion:close-run:${run.id}`, actionType: 'close_run', title: `收尾测试：${run.title}`,
    rationale: run.reasons.join('；'), sourceRefs: [run.sourceRef].filter(Boolean),
  })
  for (const blocker of summary.blockers ?? []) add({
    id: `suggestion:resolve:${blocker.kind}:${blocker.id}`,
    actionType: blocker.kind === 'artifact' ? 'relink_artifact' : 'resolve_blocker',
    title: blocker.kind === 'artifact' ? `重新定位产物：${blocker.title}` : `处理阻塞：${blocker.title}`,
    rationale: blocker.detail, sourceRefs: [blocker.sourceRef].filter(Boolean),
  })
  for (const anomaly of summary.anomalies ?? []) add({
    id: `suggestion:review-anomaly:${anomaly.id}`, actionType: 'review_anomaly', title: `复查异常：${anomaly.title}`,
    rationale: anomaly.detail, sourceRefs: [anomaly.sourceRef].filter(Boolean),
  })
  for (const criterion of summary.acceptance?.missing ?? []) add({
    id: `suggestion:criterion:${criterion.id}`, actionType: 'satisfy_criterion', title: `补齐验收条件：${criterion.label}`,
    rationale: '该条件尚未明确标记为已满足。',
    sourceRefs: [summary.currentMilestone?.sourceRef, ...(criterion.evidenceRefs ?? [])].filter(Boolean),
  })
  return actions.slice(0, 16)
}

function synthesizeResearchWorkspaceWithoutSuggestions(workspace) {
  const summary = synthesizeResearchWorkspace(workspace)
  const { suggestedActions: _ignored, ...withoutSuggestions } = summary
  return withoutSuggestions
}

function inReportRange(entity, options) {
  const at = timestamp(entity, 'updatedAt', 'occurredAt', 'endedAt', 'startedAt', 'modifiedAt', 'createdAt')
  if (options.from && at && at < options.from) return false
  if (options.to && at && at > options.to) return false
  return true
}

function reportItem(epistemicType, content, refs) {
  const sourceRefs = uniqueRefs(refs)
  if (!sourceRefs.length) return undefined
  return { epistemicType, content: text(content), sourceRefs }
}

function sourceLabel(refs) {
  return refs.map(item => item.tag).join(', ')
}

function markdownLine(item) {
  const epistemic = item.epistemicType === 'fact' ? '事实' : item.epistemicType === 'user_observation' ? '用户观察' : '建议·待确认'
  return `- [${epistemic}] ${item.content} [来源 ${sourceLabel(item.sourceRefs)}]`
}

export function generateTraceableResearchReport(workspace = {}, options = {}) {
  const project = workspace?.project && typeof workspace.project === 'object' ? workspace.project : {}
  const reportOptions = { from: text(options.from), to: text(options.to), title: text(options.title) }
  const records = list(workspace?.records).filter(item => inReportRange(item, reportOptions))
  const runs = list(workspace?.runs).filter(item => inReportRange(item, reportOptions))
    .sort((left, right) => compareEntities(left, right, 'updatedAt', 'endedAt', 'startedAt'))
  const artifacts = list(workspace?.artifacts).filter(item => inReportRange(item, reportOptions))
    .sort((left, right) => compareEntities(left, right, 'updatedAt', 'modifiedAt', 'createdAt'))
  const summary = synthesizeResearchWorkspace(workspace)
  const sections = [
    { id: 'new-evidence', title: '新增证据', items: [] },
    { id: 'test-results', title: '测试结果', items: [] },
    { id: 'failed-tests', title: '失败或无效测试', items: [] },
    { id: 'artifacts', title: '产物', items: [] },
    { id: 'decisions', title: '决策变化', items: [] },
    { id: 'blockers', title: '阻塞', items: [] },
    { id: 'next', title: '下周建议', items: [] },
  ]
  const section = id => sections.find(item => item.id === id)
  for (const record of records.sort((left, right) => compareEntities(left, right, 'updatedAt', 'occurredAt'))) {
    const recordRef = ref('record', record.id)
    const sourceRefs = [recordRef, ...(Array.isArray(record.sourceIds) ? record.sourceIds.map(id => ref('source', id)) : [])]
    if (sourceRefs.length > 1) section('new-evidence').items.push(reportItem('fact', `${text(record.title, '未命名记录')}：${text(record.content, '已关联新证据')}`, sourceRefs))
    if (text(record.recordType) === 'decision') section('decisions').items.push(reportItem('fact', `${text(record.title, '未命名决策')}：${text(record.content, '已记录决策变化')}`, [recordRef]))
    if (text(record.status) === 'blocked') section('blockers').items.push(reportItem('fact', `${text(record.title, '阻塞记录')}：${text(record.content, '已标记为阻塞')}`, [recordRef]))
  }
  for (const run of runs) {
    const runRef = ref('run', run.id)
    const outcome = text(run.outcome ?? run.status, 'planned').toLocaleLowerCase()
    if (Array.isArray(run.sourceIds) && run.sourceIds.length) section('new-evidence').items.push(reportItem(
      'fact', `${text(run.title, '未命名测试')}关联了 ${run.sourceIds.length} 项文献/来源证据`,
      [runRef, ...run.sourceIds.map(id => ref('source', id))],
    ))
    const target = ['failure', 'failed', 'invalid', 'interrupted'].includes(outcome) ? section('failed-tests') : section('test-results')
    if (outcome !== 'planned' && outcome !== 'running') target.items.push(reportItem(
      'fact', `${text(run.title, '未命名测试')}：结果为 ${outcome}`,
      [runRef],
    ))
    if (text(run.observations)) target.items.push(reportItem('user_observation', `${text(run.title, '未命名测试')}：${text(run.observations)}`, [runRef]))
    if (text(run.anomaly)) section('blockers').items.push(reportItem('user_observation', `${text(run.title, '未命名测试')}的异常：${text(run.anomaly)}`, [runRef]))
  }
  for (const artifact of artifacts) {
    const role = ARTIFACT_ROLE_LABELS[text(artifact.role)] ?? text(artifact.role, '其他')
    const state = text(artifact.existsState, 'unknown')
    const item = reportItem('fact', `${text(artifact.label ?? artifact.filePath, '未命名产物')} · ${role} · ${state}`, [ref('artifact', artifact.id), ref('run', artifact.runId)])
    section('artifacts').items.push(item)
    if (['missing', 'denied'].includes(state)) section('blockers').items.push(reportItem(
      'fact', `${text(artifact.label ?? artifact.filePath, '未命名产物')}当前${state === 'missing' ? '丢失' : '无权访问'}`,
      [ref('artifact', artifact.id), ref('run', artifact.runId)],
    ))
  }
  for (const action of summary.suggestedActions) section('next').items.push(reportItem(
    'suggestion', `${action.title}：${action.rationale}`, action.sourceRefs,
  ))
  for (const currentSection of sections) currentSection.items = currentSection.items.filter(Boolean)
  const range = reportOptions.from || reportOptions.to
    ? `\n\n> 时间范围：${reportOptions.from || '不限'} 至 ${reportOptions.to || '不限'}`
    : ''
  const heading = reportOptions.title || `${text(project.name, '未命名课题')}·科研周报/组会纪要`
  const markdown = [`# ${heading}${range}`]
  for (const currentSection of sections) {
    markdown.push(`## ${currentSection.title}`)
    markdown.push(currentSection.items.length ? currentSection.items.map(markdownLine).join('\n') : '- 暂无可追溯条目。')
  }
  const sourceRefs = uniqueRefs(sections.flatMap(item => item.items.flatMap(entry => entry.sourceRefs)))
  return { markdown: `${markdown.join('\n\n')}\n`, sections, sourceRefs }
}

function canonicalEvidenceKind(value) {
  const normalized = text(value).toLocaleLowerCase().replace(/[\s-]+/g, '_')
  if (['bibliography', 'bibliographic', 'literature', 'paper', 'source', 'citation'].includes(normalized)) return 'bibliography'
  if (['run', 'test', 'experiment'].includes(normalized)) return 'run'
  if (['artifact', 'file', 'figure', 'raw_data', 'dataset'].includes(normalized)) return 'artifact'
  return normalized
}

function requirementKind(value) {
  const normalized = text(value).toLocaleLowerCase().replace(/[\s-]+/g, '_')
  if (['bibliography', 'literature', 'paper', 'citation', 'source'].includes(normalized)) return 'bibliography'
  if (['run', 'test', 'experiment'].includes(normalized)) return 'run'
  if (['figure', 'chart', 'plot', 'image'].includes(normalized)) return 'figure'
  if (['raw', 'raw_data', 'dataset', 'original_data'].includes(normalized)) return 'raw_data'
  if (['artifact', 'file'].includes(normalized)) return 'artifact'
  return normalized
}

function inferRequirements(claim) {
  const explicit = claim.requiredEvidence ?? claim.requiredEvidenceKinds ?? claim.requirements
  if (Array.isArray(explicit)) return [...new Set(explicit.map(requirementKind).filter(Boolean))]
  const kind = text(claim.kind ?? claim.type).toLocaleLowerCase()
  if (/figure|chart|plot|图表/.test(kind)) return ['run', 'raw_data', 'figure']
  if (/experiment|empirical|result|实验|测试|结果/.test(kind)) return ['run', 'raw_data']
  if (/literature|theory|review|文献|理论|综述/.test(kind)) return ['bibliography']
  return []
}

function claimRefs(claim) {
  const candidates = [...normalizeLooseRefs(claim.evidenceRefs ?? claim.evidence)]
  for (const id of Array.isArray(claim.bibliographyIds) ? claim.bibliographyIds : []) candidates.push(ref('bibliography', id))
  for (const id of Array.isArray(claim.runIds) ? claim.runIds : []) candidates.push(ref('run', id))
  for (const id of Array.isArray(claim.artifactIds) ? claim.artifactIds : []) candidates.push(ref('artifact', id))
  return uniqueRefs(candidates.map(item => item ? ref(canonicalEvidenceKind(item.kind), item.id) : undefined))
}

export function auditClaimEvidence(input = {}) {
  const claims = list(input.claims)
  const bibliography = list(input.bibliography ?? input.bibliographicItems)
  const runs = list(input.runs)
  const artifacts = list(input.artifacts)
  const bibliographyById = new Map()
  for (const item of bibliography) {
    if (identifier(item.id)) bibliographyById.set(identifier(item.id), item)
    if (identifier(item.sourceId)) bibliographyById.set(identifier(item.sourceId), item)
  }
  const runById = new Map(runs.map(item => [identifier(item.id), item]).filter(([id]) => id))
  const artifactById = new Map(artifacts.map(item => [identifier(item.id), item]).filter(([id]) => id))
  const results = claims.map((claim, index) => {
    const id = identifier(claim.id) || `claim:${index + 1}`
    const refs = claimRefs(claim)
    const brokenRefs = []
    const resolvedRefs = []
    for (const item of refs) {
      const entity = item.kind === 'bibliography' ? bibliographyById.get(item.id)
        : item.kind === 'run' ? runById.get(item.id)
          : item.kind === 'artifact' ? artifactById.get(item.id) : undefined
      if (!entity) brokenRefs.push(item)
      else resolvedRefs.push({ ...item, entity })
    }
    const referencedRunIds = new Set(resolvedRefs.filter(item => item.kind === 'run').map(item => item.id))
    const connectedArtifacts = artifacts.filter(item => referencedRunIds.has(identifier(item.runId)))
    const explicitArtifacts = resolvedRefs.filter(item => item.kind === 'artifact').map(item => item.entity)
    const evidenceArtifacts = [...new Map([...explicitArtifacts, ...connectedArtifacts].map(item => [identifier(item.id), item])).values()]
    const foundArtifacts = evidenceArtifacts.filter(item => text(item.existsState, 'found') === 'found')
    const unavailableArtifacts = evidenceArtifacts.filter(item => ['missing', 'denied'].includes(text(item.existsState)))
    const requirements = inferRequirements(claim)
    const missing = []
    const hasBibliography = resolvedRefs.some(item => item.kind === 'bibliography')
    const hasRun = resolvedRefs.some(item => item.kind === 'run')
    const hasArtifact = foundArtifacts.length > 0
    const hasFigure = foundArtifacts.some(item => ['figure', 'image'].includes(text(item.role)))
    const hasRawData = foundArtifacts.some(item => text(item.role) === 'raw_data')
    for (const requirement of requirements) {
      const satisfied = requirement === 'bibliography' ? hasBibliography
        : requirement === 'run' ? hasRun
          : requirement === 'artifact' ? hasArtifact
            : requirement === 'figure' ? hasFigure
              : requirement === 'raw_data' ? hasRawData : false
      if (!satisfied) missing.push(requirement)
    }
    if (!resolvedRefs.length && !requirements.length) missing.push('linked_evidence')
    if (unavailableArtifacts.length) missing.push('available_artifact_file')
    const uniqueMissing = [...new Set(missing)]
    const status = resolvedRefs.length === 0
      ? 'unsupported'
      : uniqueMissing.length || brokenRefs.length ? 'partial' : 'supported'
    return {
      id,
      text: text(claim.text ?? claim.content ?? claim.title, '未命名论断'),
      status,
      requirements,
      missing: uniqueMissing,
      resolvedEvidence: resolvedRefs.map(item => ({ kind: item.kind, id: item.id, tag: item.tag })),
      brokenRefs,
      connectedArtifacts: evidenceArtifacts.map(item => ({
        id: identifier(item.id), role: text(item.role, 'other'), existsState: text(item.existsState, 'found'),
        sourceRef: ref('artifact', item.id),
      })),
    }
  })
  return {
    claims: results,
    counts: {
      supported: results.filter(item => item.status === 'supported').length,
      partial: results.filter(item => item.status === 'partial').length,
      unsupported: results.filter(item => item.status === 'unsupported').length,
    },
  }
}
