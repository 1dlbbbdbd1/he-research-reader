const fs = require('node:fs')
const path = require('node:path')

const VAULT_FORMAT_VERSION = 2
const USER_DIRECTORIES = Object.freeze([
  'database', 'papers', 'notes', 'evidence', 'experiments', 'datasets', 'reports', 'attachments', 'config', 'exports',
])

const DIRECTORY_GUIDES = Object.freeze({
  database: '# 数据库\n\n主数据库仍是研究库根目录的 `library.sqlite`，以兼容旧版本并避免搬动用户数据。`schema.generated.json` 是可重建的结构说明。\n',
  papers: '# 论文原件与派生稿\n\n软件导入的论文按来源 ID 保存。`original` 保留原件副本，`derived` 保存 MinerU 等可重建派生结果。\n',
  notes: '# 科研笔记\n\n你可以在本目录自由创建 Markdown。`index.generated.md` 是数据库笔记的只读投影，重建时会覆盖。\n',
  evidence: '# 证据卡\n\n`index.generated.md` 保存可追溯原文证据投影；正式证据仍以 `library.sqlite` 为准。\n',
  experiments: '# 实验与 Run\n\n`index.generated.md` 投影实验目的、参数、环境、观察、异常、下一步和登记产物。\n',
  datasets: '# 数据集与原始产物\n\n软件只登记原始路径、状态和 SHA-256，不会擅自移动外部数据。\n',
  reports: '# 报告\n\n`index.generated.md` 投影周报、组会和阶段复盘；正式导出文件位于 `exports`。\n',
  attachments: '# 附件\n\n用于用户主动放入、且不属于论文原件或实验外部产物的附件。\n',
  config: '# 研究库配置\n\n`vault-layout.generated.json` 描述开放目录与投影文件；API Key 不保存在这里。\n',
  exports: '# 正式导出\n\n保存用户主动生成的 Markdown、Word 和其他成果文件。\n',
})

function writeTextAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, content, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function ensureDirectory(directory) {
  if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory()) {
    throw new Error(`Research Vault 需要目录，但当前位置是文件：${directory}`)
  }
  fs.mkdirSync(directory, { recursive: true })
}

function ensureVaultLayout(root) {
  for (const name of USER_DIRECTORIES) {
    const directory = path.join(root, name)
    ensureDirectory(directory)
    const guidePath = path.join(directory, 'README.md')
    if (!fs.existsSync(guidePath)) writeTextAtomic(guidePath, DIRECTORY_GUIDES[name])
  }
  const layout = {
    version: VAULT_FORMAT_VERSION,
    database: '../library.sqlite',
    userEditableDirectories: ['notes', 'attachments'],
    generatedProjections: [
      '../VAULT_INDEX.generated.md',
      '../database/schema.generated.json',
      '../notes/index.generated.md',
      '../notes/agent-memory.generated.md',
      '../evidence/index.generated.md',
      '../experiments/index.generated.md',
      '../datasets/index.generated.md',
      '../reports/index.generated.md',
      '../reports/agent-plans.generated.md',
    ],
    rule: 'Only files ending in .generated.md or .generated.json may be replaced during projection rebuilds.',
  }
  writeTextAtomic(path.join(root, 'config', 'vault-layout.generated.json'), `${JSON.stringify(layout, null, 2)}\n`)
  return layout
}

function json(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function text(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

function yamlValue(value) {
  return JSON.stringify(String(value ?? ''))
}

function generatedHeader(title, generatedAt) {
  return `# ${title}\n\n> 自动生成的只读预览 · ${generatedAt}\n> 可在小何的科研助手中修改正式记录；重新生成预览会覆盖本文件。\n\n`
}

function renderNotes(database, projectId, generatedAt) {
  const rows = database.prepare(`
    SELECT nf.id, nf.origin, nf.kind, nf.content, nf.created_at, nf.source_id, s.name AS source_name
    FROM note_fragments nf
    LEFT JOIN sources s ON s.id = nf.source_id
    WHERE nf.project_id = ? AND nf.origin IN ('user', 'ai')
    ORDER BY nf.created_at DESC, nf.id
  `).all(projectId)
  const body = rows.map(row => [
    `## ${row.kind} · ${row.origin === 'user' ? '用户' : 'AI 建议'} · ${row.id}`,
    '',
    `- 来源：${row.source_name || row.source_id || '未关联资料'}`,
    `- 创建：${row.created_at}`,
    '',
    text(row.content) || '（空）',
  ].join('\n')).join('\n\n')
  return { count: rows.length, content: `${generatedHeader('科研笔记索引', generatedAt)}${body || '当前没有数据库笔记。'}\n` }
}

function renderEvidence(database, projectId, generatedAt) {
  const rows = database.prepare(`
    SELECT nf.id, nf.content, nf.anchor_json, nf.created_at, nf.source_id, s.name AS source_name, s.content_sha256
    FROM note_fragments nf
    LEFT JOIN sources s ON s.id = nf.source_id
    WHERE nf.project_id = ? AND nf.origin = 'source_evidence'
    ORDER BY nf.created_at DESC, nf.id
  `).all(projectId)
  const body = rows.map(row => {
    const anchor = json(row.anchor_json, {})
    return [
      `## 证据 ${row.id}`,
      '',
      '```yaml',
      `source: ${yamlValue(row.source_name || row.source_id || '')}`,
      `source_id: ${yamlValue(row.source_id || '')}`,
      `source_sha256: ${yamlValue(row.content_sha256 || '')}`,
      `page: ${anchor.pageNumber ?? anchor.page ?? 'null'}`,
      `figure: ${yamlValue(anchor.figureLabel || '')}`,
      `created_at: ${yamlValue(row.created_at)}`,
      '```',
      '',
      text(row.content),
    ].join('\n')
  }).join('\n\n')
  return { count: rows.length, content: `${generatedHeader('证据卡索引', generatedAt)}${body || '当前没有已固定的原文证据。'}\n` }
}

function renderExperiments(database, projectId, generatedAt) {
  const rows = database.prepare(`
    SELECT id, title, purpose, hypothesis, changed_variables_json, command, environment, procedure,
           outcome, observations, anomaly, next_step, started_at, ended_at
    FROM research_runs WHERE project_id = ? ORDER BY started_at DESC, id
  `).all(projectId)
  const artifacts = database.prepare(`
    SELECT run_id, label, role, path_original, exists_state, content_sha256
    FROM research_artifacts WHERE project_id = ? ORDER BY created_at, id
  `).all(projectId)
  const byRun = new Map()
  for (const artifact of artifacts) byRun.set(artifact.run_id, [...(byRun.get(artifact.run_id) || []), artifact])
  const body = rows.map(row => {
    const variables = json(row.changed_variables_json, [])
    const runArtifacts = byRun.get(row.id) || []
    return [
      `## ${row.title} · ${row.id}`,
      '',
      `- 状态：${row.outcome}`,
      `- 时间：${row.started_at}${row.ended_at ? ` → ${row.ended_at}` : ''}`,
      `- 目的：${text(row.purpose) || '未填写'}`,
      `- 假设：${text(row.hypothesis) || '未填写'}`,
      `- 环境：${text(row.environment) || '未填写'}`,
      `- 命令：${text(row.command) || '未填写'}`,
      `- 改变变量：${variables.length ? variables.map(item => `${item.name}=${item.currentValue}${item.unit || ''}`).join('；') : '无'}`,
      '',
      '### 过程与结果', '',
      text(row.procedure) || '未填写', '',
      `观察：${text(row.observations) || '未填写'}`, '',
      `异常：${text(row.anomaly) || '无'}`, '',
      `下一步：${text(row.next_step) || '未填写'}`, '',
      '### 登记产物', '',
      ...(runArtifacts.length ? runArtifacts.map(item => `- [${item.exists_state}] ${item.label} · ${item.role} · \`${item.path_original}\`${item.content_sha256 ? ` · SHA-256 ${item.content_sha256}` : ''}`) : ['- 无']),
    ].join('\n')
  }).join('\n\n')
  return { count: rows.length, content: `${generatedHeader('实验与 Run 索引', generatedAt)}${body || '当前没有实验 Run。'}\n` }
}

function renderDatasets(database, projectId, generatedAt) {
  const records = database.prepare(`
    SELECT id, title, content, status, occurred_at, file_path, tags_json
    FROM research_records WHERE project_id = ? AND record_type = 'dataset'
    ORDER BY occurred_at DESC, id
  `).all(projectId)
  const artifacts = database.prepare(`
    SELECT id, run_id, label, role, path_original, exists_state, size_bytes, content_sha256
    FROM research_artifacts
    WHERE project_id = ? AND role IN ('raw_data', 'processed_data')
    ORDER BY created_at DESC, id
  `).all(projectId)
  const recordBody = records.map(row => `## ${row.title}\n\n- ID：${row.id}\n- 状态：${row.status}\n- 时间：${row.occurred_at}\n- 路径：${row.file_path || '未登记'}\n- 标签：${json(row.tags_json, []).join('、') || '无'}\n\n${text(row.content) || '（无说明）'}`).join('\n\n')
  const artifactBody = artifacts.map(row => `- [${row.exists_state}] ${row.label} · Run ${row.run_id} · ${row.role} · \`${row.path_original}\`${row.size_bytes ? ` · ${row.size_bytes} B` : ''}${row.content_sha256 ? ` · SHA-256 ${row.content_sha256}` : ''}`).join('\n')
  return { count: records.length + artifacts.length, content: `${generatedHeader('数据集与数据产物索引', generatedAt)}${recordBody || '当前没有数据集记录。'}\n\n## Run 数据产物\n\n${artifactBody || '当前没有登记的原始或处理后数据产物。'}\n` }
}

function renderReports(database, projectId, generatedAt) {
  const rows = database.prepare(`
    SELECT id, title, report_type, period, markdown, source_refs_json, status, revision_number, updated_at
    FROM research_reports WHERE project_id = ? ORDER BY updated_at DESC, id
  `).all(projectId)
  const body = rows.map(row => [
    `## ${row.title}`,
    '',
    `- ID：${row.id}`,
    `- 类型：${row.report_type}`,
    `- 周期：${row.period || '未填写'}`,
    `- 状态：${row.status} · 修订 ${row.revision_number}`,
    `- 来源引用：${json(row.source_refs_json, []).length} 项`,
    `- 更新：${row.updated_at}`,
    '',
    text(row.markdown) || '（空报告）',
  ].join('\n')).join('\n\n')
  return { count: rows.length, content: `${generatedHeader('科研报告索引', generatedAt)}${body || '当前没有科研报告。'}\n` }
}

function renderAgentMemory(database, projectId, generatedAt) {
  const rows = database.prepare(`
    SELECT id, kind, content, source_type, source_id, importance, review_state, created_by, updated_at
    FROM agent_memory_items WHERE project_id = ? AND review_state != 'archived'
    ORDER BY review_state, importance DESC, updated_at DESC
  `).all(projectId)
  const body = rows.map(row => [
    `## ${row.kind} · ${row.id}`,
    '',
    `- 复核：${row.review_state}`,
    `- 来源：${row.source_type}${row.source_id ? `:${row.source_id}` : ''}`,
    `- 创建者：${row.created_by} · 重要度 ${row.importance}/5`,
    `- 更新：${row.updated_at}`,
    '',
    text(row.content),
  ].join('\n')).join('\n\n')
  return { count: rows.length, content: `${generatedHeader('Research Agent 长期记忆', generatedAt)}${body || '当前没有长期记忆。'}\n` }
}

function renderAgentPlans(database, projectId, generatedAt) {
  const plans = database.prepare(`
    SELECT id, objective, status, created_by, created_at, updated_at
    FROM agent_plans WHERE project_id = ? ORDER BY updated_at DESC, id LIMIT 500
  `).all(projectId)
  const steps = database.prepare(`
    SELECT plan_id, position, tool_name, title, rationale, status, requires_confirmation, error
    FROM agent_plan_steps WHERE project_id = ? ORDER BY plan_id, position
  `).all(projectId)
  const byPlan = new Map()
  for (const step of steps) byPlan.set(step.plan_id, [...(byPlan.get(step.plan_id) || []), step])
  const body = plans.map(plan => [
    `## ${plan.objective}`,
    '',
    `- ID：${plan.id}`,
    `- 状态：${plan.status} · 创建者 ${plan.created_by}`,
    `- 创建：${plan.created_at} · 更新：${plan.updated_at}`,
    '',
    ...(byPlan.get(plan.id) || []).map(step => `${step.position + 1}. [${step.status}] ${step.title} · \`${step.tool_name}\`${step.requires_confirmation ? ' · 需人工确认' : ' · 只读'}${step.error ? ` · 错误：${step.error}` : ''}\n   - ${step.rationale}`),
  ].join('\n')).join('\n\n')
  return { count: plans.length, content: `${generatedHeader('Research Agent 计划审计', generatedAt)}${body || '当前没有 Agent 计划。'}\n` }
}

function rebuildVaultProjections({ root, database, projectId, vaultName, schemaVersion }) {
  ensureVaultLayout(root)
  const generatedAt = new Date().toISOString()
  const projections = {
    notes: renderNotes(database, projectId, generatedAt),
    evidence: renderEvidence(database, projectId, generatedAt),
    experiments: renderExperiments(database, projectId, generatedAt),
    datasets: renderDatasets(database, projectId, generatedAt),
    reports: renderReports(database, projectId, generatedAt),
  }
  for (const [directory, projection] of Object.entries(projections)) {
    writeTextAtomic(path.join(root, directory, 'index.generated.md'), projection.content)
  }
  const agentMemory = renderAgentMemory(database, projectId, generatedAt)
  const agentPlans = renderAgentPlans(database, projectId, generatedAt)
  writeTextAtomic(path.join(root, 'notes', 'agent-memory.generated.md'), agentMemory.content)
  writeTextAtomic(path.join(root, 'reports', 'agent-plans.generated.md'), agentPlans.content)
  const schema = {
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    schemaVersion,
    database: '../library.sqlite',
    tables: database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name),
    generatedAt,
  }
  writeTextAtomic(path.join(root, 'database', 'schema.generated.json'), `${JSON.stringify(schema, null, 2)}\n`)
  const counts = Object.fromEntries(Object.entries(projections).map(([key, value]) => [key, value.count]))
  counts.agentMemory = agentMemory.count
  counts.agentPlans = agentPlans.count
  const index = [
    `# ${vaultName}`,
    '',
    '> 小何的科研助手 Research Vault v2 项目索引。应用中的记录是正式版本；下列 `.generated` 文件可随时重新生成。',
    '',
    `- 最近重建：${generatedAt}`,
    `- 数据库：\`library.sqlite\`（Schema v${schemaVersion}）`,
    `- 笔记：${counts.notes} · [打开投影](notes/index.generated.md)`,
    `- 证据：${counts.evidence} · [打开投影](evidence/index.generated.md)`,
    `- 实验 Run：${counts.experiments} · [打开投影](experiments/index.generated.md)`,
    `- 数据集与数据产物：${counts.datasets} · [打开投影](datasets/index.generated.md)`,
    `- 报告：${counts.reports} · [打开投影](reports/index.generated.md)`,
    `- Agent 记忆：${counts.agentMemory} · [打开投影](notes/agent-memory.generated.md)`,
    `- Agent 计划：${counts.agentPlans} · [打开审计](reports/agent-plans.generated.md)`,
    '',
    '用户可自由编辑 `notes` 中自行创建的文件和 `attachments`；软件只覆盖文件名含 `.generated` 的投影。',
    '',
  ].join('\n')
  writeTextAtomic(path.join(root, 'VAULT_INDEX.generated.md'), index)
  return {
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    generatedAt,
    counts,
    files: [
      ...Object.keys(projections).map(name => path.join(root, name, 'index.generated.md')),
      path.join(root, 'notes', 'agent-memory.generated.md'),
      path.join(root, 'reports', 'agent-plans.generated.md'),
    ],
  }
}

module.exports = {
  USER_DIRECTORIES,
  VAULT_FORMAT_VERSION,
  ensureVaultLayout,
  rebuildVaultProjections,
}
