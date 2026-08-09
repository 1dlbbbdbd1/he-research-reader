const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { openWorkspaceDatabase, SCHEMA_VERSION } = require('./workspace-db.cjs')
const { detectBibliographyFormat, parseBibliography } = require('./bibliography-adapters.cjs')
const { CitationFormatter } = require('./citation-formatter.cjs')
const {
  ZOTERO_SYNC_ADAPTER,
  planZoteroMetadataSync,
  zoteroSyncCapabilities,
} = require('./bibliography-sync.cjs')
const { portableMarkdownFileName, renderPortableMarkdown } = require('./portable-markdown.cjs')
const {
  legacyTaskId,
  milestoneStatusFromTask,
  taskApprovalFromActionItem,
  taskStatusFromActionItem,
  taskStatusFromMilestone,
  taskStatusFromReading,
  taskViewFromRow,
  validateTaskSourceType,
  validateTaskStatus,
} = require('./research-task.cjs')
const {
  buildStructuredReadingDraft,
  structuredSourceFingerprint,
  validateManualAdjustment,
} = require('./structured-reading.cjs')
const {
  semanticDocumentsFromSearchRows,
  vectorFromBuffer,
  vectorToBuffer,
} = require('./semantic-index.cjs')

const VAULT_FILE = 'vault.json'
const DATABASE_FILE = 'library.sqlite'
const citationFormatter = new CitationFormatter()

function now() {
  return new Date().toISOString()
}

const READING_STATUS_VALUES = new Set(['unread', 'title_only', 'skimming', 'reading', 'finished'])
const RELEVANCE_VALUES = new Set(['undecided', 'core', 'relevant', 'supplemental', 'mismatched'])
const IDEA_STATE_VALUES = new Set(['undecided', 'has_ideas', 'no_new_ideas'])
const QUESTION_STATE_VALUES = new Set(['undecided', 'has_questions', 'no_questions'])
const RESEARCH_RECORD_TYPE_VALUES = new Set(['log', 'experiment', 'dataset', 'decision', 'milestone'])
const RESEARCH_RECORD_STATUS_VALUES = new Set(['planned', 'active', 'completed', 'blocked', 'archived'])
const RESEARCH_PROJECT_MODE_VALUES = new Set(['exploration', 'execution'])
const RESEARCH_MILESTONE_STATUS_VALUES = new Set(['planned', 'active', 'completed', 'blocked', 'archived'])
const RESEARCH_RUN_OUTCOME_VALUES = new Set(['planned', 'running', 'success', 'failure', 'invalid', 'interrupted'])
const RESEARCH_ARTIFACT_ROLE_VALUES = new Set([
  'raw_data', 'processed_data', 'figure', 'log', 'script', 'config', 'model',
  'video', 'image', 'document', 'directory', 'other',
])
const RESEARCH_REPORT_TYPE_VALUES = new Set(['weekly', 'meeting', 'stage_review'])
const RESEARCH_REPORT_STATUS_VALUES = new Set(['draft', 'confirmed'])
const RESEARCH_CLAIM_STATUS_VALUES = new Set(['draft', 'confirmed'])
const RESEARCH_EVIDENCE_REF_TYPE_VALUES = new Set(['bibliography', 'source', 'run', 'artifact', 'milestone'])
const TRANSLATION_SEGMENT_STATUS_VALUES = new Set(['pending', 'translated', 'failed'])
const RESEARCH_RESUME_VIEW_VALUES = new Set([
  'today', 'research-workspace', 'research-review', 'sources', 'reader', 'dashboard', 'evidence', 'actions',
])
const RESEARCH_RESUME_READER_MODE_VALUES = new Set(['original', 'markdown', 'parallel', 'bilingual'])
const EDITABLE_EVIDENCE_RELATIONS = new Set(['supports', 'refutes', 'mentions'])
const ACTION_TYPE_VALUES = new Set(['read', 'compare', 'verify', 'experiment', 'review', 'note'])
const SEARCH_ORIGIN_VALUES = new Set([
  'bibliography', 'source', 'document', 'mineru',
  'source_evidence', 'user', 'ai', 'review',
])
const SEARCH_ORIGIN_LABELS = {
  bibliography: '题录',
  source: '资料标题',
  document: '解析正文',
  mineru: 'MinerU Markdown',
  source_evidence: '原文证据',
  user: '用户笔记',
  ai: 'AI 内容',
  review: '复查文档',
}
const READING_STATUS_LABELS = {
  unread: '未读',
  title_only: '只看标题',
  skimming: '快速浏览',
  reading: '正在精读',
  finished: '已读完',
}
const RELEVANCE_LABELS = {
  undecided: '相关性待定',
  core: '核心文献',
  relevant: '相关',
  supplemental: '补充材料',
  mismatched: '方向不匹配',
}
const IDEA_STATE_LABELS = {
  undecided: '想法待定',
  has_ideas: '有想法',
  no_new_ideas: '没有新想法',
}
const QUESTION_STATE_LABELS = {
  undecided: '疑问待定',
  has_questions: '有疑问',
  no_questions: '没有疑问',
}
const READING_CARD_SECTION_TITLES = {
  problem: '文献解决的问题',
  method: '研究对象与方法',
  findings: '主要结论',
  limitations: '作者局限与适用边界',
  user_notes: '我的批注与疑问',
  relevance: '与当前研究的关系',
  reuse: '可用于论文的位置',
  next_steps: '待核验问题与下一步',
}

function ensureVaultName(name) {
  const normalized = String(name || '').trim()
  if (!normalized) throw new Error('研究库名称不能为空。')
  if (normalized.length > 80) throw new Error('研究库名称不能超过 80 个字符。')
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(normalized)) throw new Error('研究库名称包含 Windows 不支持的字符。')
  return normalized
}

function ensureResearchText(value, label, maximumLength, { required = false } = {}) {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label}必须是文本。`)
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maximumLength) throw new Error(`${label}不能超过 ${maximumLength} 个字符。`)
  return normalized
}

function ensureResearchStringList(value, label, maximumItems, maximumItemLength) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表。`)
  if (value.length > maximumItems) throw new Error(`${label}不能超过 ${maximumItems} 项。`)
  const normalized = value.map((item) => {
    if (typeof item !== 'string') throw new Error(`${label}中的每一项都必须是文本。`)
    const text = item.trim()
    if (!text) throw new Error(`${label}中不能包含空项。`)
    if (text.length > maximumItemLength) throw new Error(`${label}中的单项不能超过 ${maximumItemLength} 个字符。`)
    return text
  })
  return [...new Set(normalized)]
}

function ensureResearchDateTime(value) {
  if (value === undefined || value === null || value === '') return now()
  if (typeof value !== 'string') throw new Error('科研记录时间必须是 ISO 日期时间文本。')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('科研记录时间无效。')
  return new Date(timestamp).toISOString()
}

function ensureOptionalResearchDateTime(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label}必须是 ISO 日期时间文本。`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${label}无效。`)
  return new Date(timestamp).toISOString()
}

function ensureResearchObject(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`)
  return value
}

function ensureChangedVariables(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('改变变量必须是列表。')
  if (value.length > 100) throw new Error('改变变量不能超过 100 项。')
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`第 ${index + 1} 个改变变量格式无效。`)
    }
    const name = ensureResearchText(entry.name, `第 ${index + 1} 个变量名称`, 160, { required: true })
    const currentValue = ensureResearchText(entry.currentValue, `第 ${index + 1} 个变量当前值`, 1000, { required: true })
    const previousValue = ensureResearchText(entry.previousValue, `第 ${index + 1} 个变量原值`, 1000)
    const unit = ensureResearchText(entry.unit, `第 ${index + 1} 个变量单位`, 80)
    return {
      name,
      currentValue,
      ...(previousValue ? { previousValue } : {}),
      ...(unit ? { unit } : {}),
    }
  })
}

function ensureTemplateDefaults(value) {
  const input = ensureResearchObject(value, '模板默认值')
  const defaults = {}
  for (const key of ['purpose', 'hypothesis', 'command', 'environment', 'procedure', 'observations', 'anomaly', 'nextStep']) {
    if (input[key] !== undefined) defaults[key] = ensureResearchText(input[key], `模板 ${key}`, 20000)
  }
  if (input.changedVariables !== undefined) defaults.changedVariables = ensureChangedVariables(input.changedVariables)
  if (JSON.stringify(defaults).length > 50000) throw new Error('模板默认值过大。')
  return defaults
}

function ensureResearchEvidenceRefs(value, label) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表。`)
  if (value.length > 500) throw new Error(`${label}不能超过 500 项。`)
  const seen = new Set()
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label}第 ${index + 1} 项格式无效。`)
    }
    const type = ensureResearchText(entry.type, `${label}第 ${index + 1} 项类型`, 40, { required: true })
    if (!RESEARCH_EVIDENCE_REF_TYPE_VALUES.has(type)) throw new Error(`${label}第 ${index + 1} 项类型无效。`)
    const id = ensureResearchText(entry.id, `${label}第 ${index + 1} 项 ID`, 160, { required: true })
    const labelText = ensureResearchText(entry.label, `${label}第 ${index + 1} 项名称`, 500)
    const key = `${type}:${id}`
    if (seen.has(key)) throw new Error(`${label}中存在重复引用：${key}。`)
    seen.add(key)
    return { type, id, ...(labelText ? { label: labelText } : {}) }
  })
}

function researchReportTypeLabel(value) {
  return { weekly: '周报', meeting: '组会', stage_review: '阶段复盘' }[value] || value
}

function renderResearchReportMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    '',
    `- 类型：${researchReportTypeLabel(report.type)}`,
    `- 周期：${report.period || '未填写'}`,
    `- 状态：${report.status === 'confirmed' ? '已确认' : '草稿'}`,
    `- 更新时间：${report.updatedAt}`,
    '',
    report.markdown.trim(),
  ]
  if (report.sourceRefs.length) {
    lines.push('', '## 来源追溯', '')
    report.sourceRefs.forEach((ref, index) => {
      lines.push(`${index + 1}. [${ref.type}] ${ref.label || ref.id}（${ref.id}）`)
    })
  }
  return `${lines.join('\n').trim()}\n`
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function bilingualSourceHash(value) {
  const normalized = String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${normalized.length}`
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const handle = fs.openSync(filePath, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null)
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(handle)
  }
  return hash.digest('hex')
}

function inspectResearchArtifactPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('成果文件路径不能为空。')
  if (filePath.includes('\u0000')) throw new Error('成果文件路径无效。')
  const originalPath = filePath.trim()
  if (!path.isAbsolute(originalPath)) throw new Error('成果文件路径必须是绝对路径。')
  const absolutePath = path.resolve(originalPath)
  let resolvedPath
  let stats
  try {
    fs.accessSync(absolutePath, fs.constants.R_OK)
    resolvedPath = fs.realpathSync.native(absolutePath)
    stats = fs.statSync(resolvedPath)
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') throw new Error('成果文件路径无法读取，未登记。')
    throw new Error('成果文件或目录不存在，未登记。')
  }
  if (!stats.isFile() && !stats.isDirectory()) throw new Error('只支持登记普通文件或目录。')
  const kind = stats.isDirectory() ? 'directory' : 'file'
  let metadata = {}
  let contentSha256
  if (kind === 'file') {
    contentSha256 = sha256File(resolvedPath)
    metadata = { extension: path.extname(resolvedPath).toLowerCase() }
  } else {
    let entryCount
    try {
      entryCount = fs.readdirSync(resolvedPath).length
    } catch {
      entryCount = undefined
    }
    metadata = { ...(entryCount === undefined ? {} : { entryCount }), hashScope: 'not-computed-for-directory' }
  }
  return {
    originalPath,
    resolvedPath,
    kind,
    sizeBytes: kind === 'file' ? stats.size : undefined,
    modifiedAt: stats.mtime.toISOString(),
    contentSha256,
    metadata,
  }
}

function safeFileName(name) {
  const base = path.basename(String(name || 'paper.pdf'))
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '') || 'paper.pdf'
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, filePath)
}

function researchResumeStateFromRow(row, extra = {}) {
  return {
    projectId: row.project_id,
    activeView: row.active_view,
    sourceId: row.source_id ?? undefined,
    pageNumber: row.reader_page ?? undefined,
    readerMode: row.reader_mode ?? undefined,
    activeRunId: row.active_run_id ?? undefined,
    lastOpenedAt: row.last_opened_at ?? undefined,
    lastActiveAt: row.last_active_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  }
}

class WorkspaceService {
  constructor({ registryPath }) {
    this.registryPath = registryPath
    this.current = undefined
    this.database = undefined
  }

  listRecent() {
    const registry = this.#readRegistry()
    return registry.recent
      .filter(entry => fs.existsSync(path.join(entry.path, VAULT_FILE)))
      .map(entry => ({ ...entry, isCurrent: entry.id === registry.currentId }))
  }

  getCurrent() {
    return this.current
  }

  restoreCurrent() {
    const registry = this.#readRegistry()
    const entry = registry.recent.find(candidate => candidate.id === registry.currentId)
    if (!entry) return undefined
    try {
      return this.open(entry.path)
    } catch {
      registry.currentId = undefined
      this.#writeRegistry(registry)
      return undefined
    }
  }

  create(parentDirectory, requestedName) {
    const name = ensureVaultName(requestedName)
    const root = path.resolve(parentDirectory, name)
    if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
      throw new Error(`“${name}”文件夹已经存在且不为空，请换一个名称。`)
    }
    fs.mkdirSync(root, { recursive: true })
    return this.#initializeWorkspace(root, name)
  }

  createAt(directory, requestedName) {
    const name = ensureVaultName(requestedName)
    const root = path.resolve(directory)
    fs.mkdirSync(root, { recursive: true })
    if (fs.existsSync(path.join(root, VAULT_FILE))) {
      throw new Error('这个文件夹已经是研究库，请直接打开。')
    }
    if (fs.existsSync(path.join(root, DATABASE_FILE))) {
      throw new Error('文件夹中已有 library.sqlite，但缺少研究库清单。为保护数据，未覆盖该文件。')
    }
    return this.#initializeWorkspace(root, name)
  }

  #initializeWorkspace(root, name) {
    fs.mkdirSync(path.join(root, 'papers'), { recursive: true })
    fs.mkdirSync(path.join(root, 'exports'), { recursive: true })
    fs.mkdirSync(path.join(root, '.reader-cache'), { recursive: true })

    const createdAt = now()
    const vault = {
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      name,
      path: root,
      schemaVersion: SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
    }
    writeJsonAtomic(path.join(root, VAULT_FILE), {
      id: vault.id,
      projectId: vault.projectId,
      name: vault.name,
      schemaVersion: vault.schemaVersion,
      createdAt,
      updatedAt: createdAt,
    })

    const database = openWorkspaceDatabase(path.join(root, DATABASE_FILE))
    database.prepare('INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      vault.projectId,
      name,
      createdAt,
      createdAt,
    )
    database.close()
    return this.open(root)
  }

  open(directory) {
    const root = path.resolve(directory)
    const manifestPath = path.join(root, VAULT_FILE)
    if (!fs.existsSync(manifestPath)) {
      throw new Error('所选文件夹不是科研阅读研究库：缺少 vault.json。')
    }
    const manifest = readJson(manifestPath)
    if (!manifest.id || !manifest.projectId || !manifest.name) {
      throw new Error('研究库清单不完整，已停止打开以保护数据。')
    }

    const nextDatabase = openWorkspaceDatabase(path.join(root, DATABASE_FILE))
    const project = nextDatabase.prepare('SELECT id, name FROM projects WHERE id = ?').get(manifest.projectId)
    if (!project) {
      nextDatabase.close()
      throw new Error('研究库数据库与清单不匹配，已停止打开以保护数据。')
    }
    if (manifest.schemaVersion !== SCHEMA_VERSION) {
      manifest.schemaVersion = SCHEMA_VERSION
      manifest.updatedAt = now()
      writeJsonAtomic(manifestPath, manifest)
    }

    this.close()
    this.database = nextDatabase
    this.current = {
      id: manifest.id,
      projectId: manifest.projectId,
      name: project.name,
      path: root,
      schemaVersion: SCHEMA_VERSION,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    }
    this.#remember(this.current)
    return this.current
  }

  switch(id) {
    const entry = this.#readRegistry().recent.find(candidate => candidate.id === id)
    if (!entry) throw new Error('最近研究库中找不到这个项目。')
    return this.open(entry.path)
  }

  close() {
    if (this.database && this.current) this.endResearchSession()
    this.database?.close()
    this.database = undefined
    this.current = undefined
  }

  inspectSchema() {
    if (!this.database || !this.current) throw new Error('请先创建或打开研究库。')
    return {
      schemaVersion: this.database.prepare('PRAGMA user_version').get().user_version,
      tables: this.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name),
    }
  }

  loadLibraryState() {
    this.#requireOpen()
    const sources = this.database.prepare(`
      SELECT id, bibliographic_item_id, name, kind, version, status, pages, content_sha256, extracted_text,
             derived_markdown, source_metadata_json
      FROM sources
      WHERE project_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC
    `).all(this.current.projectId).map(row => {
      const metadata = JSON.parse(row.source_metadata_json)
      return {
        ...metadata,
        id: row.id,
        bibliographicItemId: row.bibliographic_item_id ?? undefined,
        name: row.name,
        kind: row.kind,
        version: row.version,
        status: row.status,
        pages: row.pages ?? undefined,
        hash: row.content_sha256 ?? undefined,
        extractedText: row.extracted_text ?? undefined,
        mineruMarkdown: row.derived_markdown ?? undefined,
      }
    })
    const annotations = this.database.prepare(`
      SELECT a.id, a.source_id, a.category, a.anchor_json, a.current_note_fragment_id,
             a.created_at, a.updated_at,
             s.bibliographic_item_id, s.name AS source_name, b.title AS paper_title,
             (
               SELECT quote.id FROM note_fragments quote
               WHERE quote.annotation_id = a.id AND quote.origin = 'source_evidence'
               ORDER BY quote.created_at, quote.rowid LIMIT 1
             ) AS quote_fragment_id,
             (
               SELECT quote.content FROM note_fragments quote
               WHERE quote.annotation_id = a.id AND quote.origin = 'source_evidence'
               ORDER BY quote.created_at, quote.rowid LIMIT 1
             ) AS quote_text,
             note.content AS note_text,
             (
               SELECT rt.status FROM research_tasks rt
               WHERE rt.project_id = a.project_id AND rt.source_type = 'annotation'
                 AND rt.source_id = a.id AND rt.source_role = 'primary'
               LIMIT 1
             ) AS task_status
      FROM annotations a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN bibliographic_items b ON b.id = s.bibliographic_item_id
      LEFT JOIN note_fragments note
        ON note.id = a.current_note_fragment_id AND note.origin = 'user'
      WHERE a.project_id = ? AND a.archived_at IS NULL
      ORDER BY COALESCE(a.updated_at, a.created_at) DESC
    `).all(this.current.projectId).map(row => {
      const anchor = JSON.parse(row.anchor_json)
      return {
        id: row.id,
        sourceId: row.source_id ?? undefined,
        bibliographicItemId: row.bibliographic_item_id ?? undefined,
        sourceName: row.source_name ?? undefined,
        paperTitle: row.paper_title ?? undefined,
        text: row.quote_text ?? '',
        note: row.note_text ?? '',
        category: row.category,
        anchor,
        page: anchor.pageNumber ? `第 ${anchor.pageNumber} 页` : anchor.legacyLocatorText || '',
        ...(row.task_status ? { taskStatus: row.task_status } : {}),
      }
    })
    const bibliographicItems = this.database.prepare(`
      SELECT b.id, b.title, b.item_type, b.authors_json, b.issued, b.accessed,
             b.container_title, b.publisher, b.publisher_place, b.volume, b.issue, b.pages,
             b.abstract, b.language, b.keywords_json, b.identifiers_json,
             b.needs_metadata_review,
             count(a.id) AS attachment_count,
             max(a.exists_state) AS attachment_state,
             max(a.source_id) AS source_id,
             (
               SELECT count(*)
               FROM annotations note
               JOIN sources note_source ON note_source.id = note.source_id
               WHERE note_source.bibliographic_item_id = b.id
                 AND note.archived_at IS NULL
             ) AS annotation_count,
             rs.reading_status, rs.relevance, rs.idea_state, rs.question_state, rs.purpose_tags_json,
             rs.decision_note, rs.last_page, rs.total_pages
      FROM bibliographic_items b
      LEFT JOIN bibliographic_attachments a ON a.item_id = b.id
      LEFT JOIN bibliographic_reading_states rs ON rs.item_id = b.id
      WHERE b.project_id = ? AND b.archived_at IS NULL
      GROUP BY b.id
      ORDER BY b.updated_at DESC
    `).all(this.current.projectId).map(row => {
      const item = bibliographicSummaryFromRow(row)
      return {
        ...item,
        citation: citationFormatter.format(item, { style: 'gb-t-7714-2015' }),
        needsMetadataReview: Boolean(row.needs_metadata_review),
        attachmentCount: row.attachment_count,
        attachmentState: row.attachment_state ?? 'unknown',
        sourceId: row.source_id ?? undefined,
        annotationCount: row.annotation_count,
        readingState: {
        readingStatus: row.reading_status ?? 'unread',
        relevance: row.relevance ?? 'undecided',
        ideaState: row.idea_state ?? 'undecided',
        questionState: row.question_state ?? 'undecided',
        purposeTags: row.purpose_tags_json ? JSON.parse(row.purpose_tags_json) : [],
        decisionNote: row.decision_note ?? '',
        lastPage: row.last_page ?? undefined,
        totalPages: row.total_pages ?? undefined,
        },
      }
    })
    return { sources, annotations, bibliographicItems, researchWorkspace: this.getResearchWorkspace() }
  }

  getResearchWorkspace() {
    this.#requireOpen()
    const project = this.database.prepare(`
      SELECT id, name, research_question, current_hypothesis, stage, mode, updated_at
      FROM projects WHERE id = ?
    `).get(this.current.projectId)
    const records = this.database.prepare(`
      SELECT id, record_type, title, content, status, occurred_at, file_path,
             source_ids_json, tags_json, created_at, updated_at
      FROM research_records
      WHERE project_id = ? AND status != 'archived'
      ORDER BY occurred_at DESC, updated_at DESC
      LIMIT 300
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      recordType: row.record_type,
      title: row.title,
      content: row.content,
      status: row.status,
      occurredAt: row.occurred_at,
      filePath: row.file_path ?? undefined,
      sourceIds: JSON.parse(row.source_ids_json),
      tags: JSON.parse(row.tags_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const milestones = this.database.prepare(`
      SELECT id, title, description, status, acceptance_criteria_json, due_at,
             completed_at, created_at, updated_at
      FROM research_milestones
      WHERE project_id = ? AND status != 'archived'
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'blocked' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END,
               COALESCE(due_at, updated_at), updated_at DESC
      LIMIT 300
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      acceptanceCriteria: safeJson(row.acceptance_criteria_json, []),
      dueAt: row.due_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const runTemplates = this.database.prepare(`
      SELECT id, project_id, name, category, description, defaults_json, built_in,
             created_at, updated_at
      FROM research_run_templates
      WHERE archived_at IS NULL AND (built_in = 1 OR project_id = ?)
      ORDER BY built_in DESC, name
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      projectId: row.project_id ?? undefined,
      name: row.name,
      category: row.category,
      description: row.description,
      defaults: safeJson(row.defaults_json, {}),
      builtIn: Boolean(row.built_in),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const runs = this.database.prepare(`
      SELECT id, milestone_id, template_id, title, purpose, hypothesis,
             changed_variables_json, command, environment, procedure, outcome,
             observations, anomaly, next_step, source_ids_json, started_at,
             (SELECT rt.status FROM research_tasks rt WHERE rt.project_id = research_runs.project_id AND rt.source_type = 'run' AND rt.source_id = research_runs.id AND rt.source_role = 'next_step' LIMIT 1) AS next_step_task_status,
             (SELECT rt.status FROM research_tasks rt WHERE rt.project_id = research_runs.project_id AND rt.source_type = 'anomaly' AND rt.source_id = research_runs.id AND rt.source_role = 'anomaly' LIMIT 1) AS anomaly_task_status,
             ended_at, created_at, updated_at
      FROM research_runs
      WHERE project_id = ?
      ORDER BY started_at DESC, updated_at DESC
      LIMIT 500
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      milestoneId: row.milestone_id ?? undefined,
      templateId: row.template_id ?? undefined,
      title: row.title,
      purpose: row.purpose,
      hypothesis: row.hypothesis,
      changedVariables: safeJson(row.changed_variables_json, []),
      command: row.command,
      environment: row.environment,
      procedure: row.procedure,
      outcome: row.outcome,
      observations: row.observations,
      anomaly: row.anomaly,
      nextStep: row.next_step,
      nextStepTaskStatus: row.next_step_task_status ?? undefined,
      anomalyTaskStatus: row.anomaly_task_status ?? undefined,
      sourceIds: safeJson(row.source_ids_json, []),
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const artifacts = this.database.prepare(`
      SELECT id, run_id, label, role, path_original, path_resolved, kind,
             exists_state, size_bytes, modified_at, content_sha256, metadata_json,
             created_at, updated_at
      FROM research_artifacts
      WHERE project_id = ?
      ORDER BY updated_at DESC
      LIMIT 1500
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      runId: row.run_id,
      label: row.label,
      role: row.role,
      filePath: row.path_original,
      resolvedPath: row.path_resolved,
      kind: row.kind,
      existsState: row.exists_state,
      sizeBytes: row.size_bytes ?? undefined,
      modifiedAt: row.modified_at ?? undefined,
      contentSha256: row.content_sha256 ?? undefined,
      metadata: safeJson(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const reports = this.listResearchReports()
    const claims = this.listResearchClaims()
    const history = this.database.prepare(`
      SELECT id, changed_fields_json, snapshot_json, created_at, created_by
      FROM research_project_history
      WHERE project_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 100
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      changedFields: safeJson(row.changed_fields_json, []),
      snapshot: safeJson(row.snapshot_json, {}),
      createdAt: row.created_at,
      createdBy: row.created_by,
    }))
    return {
      project: {
        id: project.id,
        name: project.name,
        researchQuestion: project.research_question,
        currentHypothesis: project.current_hypothesis,
        stage: project.stage,
        mode: project.mode,
        updatedAt: project.updated_at,
      },
      records,
      milestones,
      runs,
      artifacts,
      runTemplates,
      reports,
      claims,
      history,
    }
  }

  getResearchResume() {
    this.#requireOpen()
    const row = this.database.prepare(`
      SELECT project_id, active_view, source_id, reader_page, reader_mode,
             active_run_id, last_opened_at, last_active_at, created_at, updated_at
      FROM research_resume_state WHERE project_id = ?
    `).get(this.current.projectId)
    if (!row) {
      return {
        projectId: this.current.projectId,
        activeView: 'today',
        firstVisit: true,
      }
    }
    return researchResumeStateFromRow(row, { firstVisit: !row.last_active_at })
  }

  beginResearchSession() {
    this.#requireOpen()
    const previous = this.database.prepare(`
      SELECT project_id, active_view, source_id, reader_page, reader_mode,
             active_run_id, last_opened_at, last_active_at, created_at, updated_at
      FROM research_resume_state WHERE project_id = ?
    `).get(this.current.projectId)
    const previousActiveAt = previous?.last_active_at ?? undefined
    let activeRunId = previous?.active_run_id ?? undefined
    if (activeRunId) {
      const valid = this.database.prepare(
        'SELECT id FROM research_runs WHERE id = ? AND project_id = ?',
      ).get(activeRunId, this.current.projectId)
      if (!valid) activeRunId = undefined
    }
    if (!activeRunId) {
      activeRunId = this.database.prepare(`
        SELECT id FROM research_runs
        WHERE project_id = ? AND outcome IN ('running', 'planned')
        ORDER BY CASE outcome WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC
        LIMIT 1
      `).get(this.current.projectId)?.id
    }
    const timestamp = now()
    const createdAt = previous?.created_at || timestamp
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO research_resume_state(
          project_id, active_view, source_id, reader_page, reader_mode, active_run_id,
          last_opened_at, last_active_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          active_run_id = excluded.active_run_id,
          last_opened_at = excluded.last_opened_at,
          last_active_at = excluded.last_active_at
      `).run(
        this.current.projectId,
        previous?.active_view || 'today',
        previous?.source_id || null,
        previous?.reader_page || null,
        previous?.reader_mode || null,
        activeRunId || null,
        timestamp,
        timestamp,
        createdAt,
        previous?.updated_at || timestamp,
      )
      const state = this.getResearchResume()
      this.#appendResearchResumeEvent('opened', state, timestamp)
      this.database.exec('COMMIT')
      return {
        ...state,
        previousActiveAt,
        firstVisit: !previousActiveAt,
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveResearchResume(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研现场格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧现场写入已取消。')
    }
    const previous = this.database.prepare(`
      SELECT project_id, active_view, source_id, reader_page, reader_mode,
             active_run_id, last_opened_at, last_active_at, created_at, updated_at
      FROM research_resume_state WHERE project_id = ?
    `).get(this.current.projectId)
    const activeView = input.activeView === undefined
      ? previous?.active_view || 'today'
      : validateEnum(input.activeView, RESEARCH_RESUME_VIEW_VALUES, '科研工作面')
    const sourceId = input.sourceId === undefined
      ? previous?.source_id ?? undefined
      : input.sourceId === null || input.sourceId === ''
        ? undefined
        : ensureResearchText(input.sourceId, '最后阅读资料 ID', 120, { required: true })
    if (sourceId) {
      const source = this.database.prepare(
        'SELECT id FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL',
      ).get(sourceId, this.current.projectId)
      if (!source) throw new Error('最后阅读资料不存在或不属于当前课题。')
    }
    const requestedPage = input.pageNumber === undefined ? previous?.reader_page : input.pageNumber
    const pageNumber = requestedPage === null || requestedPage === undefined
      ? undefined
      : Number(requestedPage)
    if (pageNumber !== undefined && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000)) {
      throw new Error('最后阅读页码无效。')
    }
    const readerMode = input.readerMode === undefined
      ? previous?.reader_mode ?? undefined
      : input.readerMode === null || input.readerMode === ''
        ? undefined
        : validateEnum(input.readerMode, RESEARCH_RESUME_READER_MODE_VALUES, '阅读模式')
    const activeRunId = input.activeRunId === undefined
      ? previous?.active_run_id ?? undefined
      : input.activeRunId === null || input.activeRunId === ''
        ? undefined
        : ensureResearchText(input.activeRunId, '当前 Run ID', 120, { required: true })
    if (activeRunId) {
      const run = this.database.prepare(
        'SELECT id FROM research_runs WHERE id = ? AND project_id = ?',
      ).get(activeRunId, this.current.projectId)
      if (!run) throw new Error('当前 Run 不存在或不属于当前课题。')
    }
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO research_resume_state(
          project_id, active_view, source_id, reader_page, reader_mode, active_run_id,
          last_opened_at, last_active_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          active_view = excluded.active_view,
          source_id = excluded.source_id,
          reader_page = excluded.reader_page,
          reader_mode = excluded.reader_mode,
          active_run_id = excluded.active_run_id,
          last_active_at = excluded.last_active_at,
          updated_at = excluded.updated_at
      `).run(
        this.current.projectId,
        activeView,
        sourceId || null,
        pageNumber ?? null,
        readerMode || null,
        activeRunId || null,
        previous?.last_opened_at || timestamp,
        timestamp,
        previous?.created_at || timestamp,
        timestamp,
      )
      const state = this.getResearchResume()
      this.#appendResearchResumeEvent('state_saved', state, timestamp)
      this.database.exec('COMMIT')
      return state
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  endResearchSession() {
    if (!this.database || !this.current) return undefined
    const previous = this.database.prepare(`
      SELECT project_id, active_view, source_id, reader_page, reader_mode,
             active_run_id, last_opened_at, last_active_at, created_at, updated_at
      FROM research_resume_state WHERE project_id = ?
    `).get(this.current.projectId)
    if (!previous) return undefined
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(
        'UPDATE research_resume_state SET last_active_at = ? WHERE project_id = ?',
      ).run(timestamp, this.current.projectId)
      const state = { ...researchResumeStateFromRow(previous), lastActiveAt: timestamp }
      this.#appendResearchResumeEvent('closed', state, timestamp)
      this.database.exec('COMMIT')
      return state
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  listResearchTasks(input = {}) {
    this.#requireOpen()
    this.#syncLegacyResearchTasks()
    const requestedStatus = input?.status === undefined ? undefined : validateTaskStatus(input.status)
    const rows = this.database.prepare(`
      SELECT * FROM research_tasks
      WHERE project_id = ? ${requestedStatus ? 'AND status = ?' : ''}
      ORDER BY CASE status
        WHEN 'today' THEN 0 WHEN 'inbox' THEN 1 WHEN 'waiting' THEN 2
        WHEN 'deferred' THEN 3 WHEN 'later' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
        updated_at DESC
      LIMIT 1000
    `).all(...(requestedStatus ? [this.current.projectId, requestedStatus] : [this.current.projectId]))
    const tasks = rows.map(row => ({
      ...taskViewFromRow(row),
      events: this.database.prepare(`
        SELECT id, event_type, from_status, to_status, actor, note, occurred_at
        FROM research_task_events WHERE task_id = ?
        ORDER BY occurred_at DESC, rowid DESC LIMIT 50
      `).all(row.id).map(event => ({
        id: event.id,
        eventType: event.event_type,
        fromStatus: event.from_status ?? undefined,
        toStatus: event.to_status ?? undefined,
        actor: event.actor,
        note: event.note,
        occurredAt: event.occurred_at,
      })),
    }))
    const summary = Object.fromEntries(
      ['inbox', 'today', 'later', 'waiting', 'completed', 'abandoned', 'deferred']
        .map(status => [status, tasks.filter(task => task.status === status).length]),
    )
    return { tasks, summary }
  }

  createResearchTask(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研任务格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧任务写入已取消。')
    }
    const sourceType = validateTaskSourceType(input.sourceType || 'manual')
    const sourceId = sourceType === 'manual'
      ? undefined
      : ensureResearchText(input.sourceId, '任务来源 ID', 160, { required: true })
    const sourceRole = ensureResearchText(input.sourceRole || 'primary', '任务来源角色', 80, { required: true })
    const source = sourceType === 'manual'
      ? { title: '', detail: '', returnTarget: {}, sourceSnapshot: {} }
      : this.#resolveResearchTaskSource(sourceType, sourceId, sourceRole)
    const title = input.title === undefined
      ? ensureResearchText(source.title, '科研任务标题', 240, { required: true })
      : ensureResearchText(input.title, '科研任务标题', 240, { required: true })
    const detail = input.detail === undefined
      ? ensureResearchText(source.detail, '科研任务说明', 10000)
      : ensureResearchText(input.detail, '科研任务说明', 10000)
    const origin = input.origin === 'ai' ? 'ai' : input.origin === 'system' ? 'system' : 'user'
    const approvalStatus = origin === 'ai' ? 'proposed' : 'not_required'
    const isFormal = origin === 'ai' ? 0 : 1
    const status = origin === 'ai' ? 'waiting' : validateTaskStatus(input.status || 'inbox')
    const waitCondition = ensureResearchText(input.waitCondition, '等待条件', 4000)
    const deferredUntil = ensureOptionalResearchDateTime(input.deferredUntil, '推迟时间')
    if (status === 'waiting' && origin !== 'ai' && !waitCondition) throw new Error('等待任务必须写明等待条件。')
    if (status === 'deferred' && !deferredUntil) throw new Error('推迟任务必须写明恢复时间。')
    const existing = sourceId ? this.database.prepare(`
      SELECT * FROM research_tasks
      WHERE project_id = ? AND source_type = ? AND source_id = ? AND source_role = ?
    `).get(this.current.projectId, sourceType, sourceId, sourceRole) : undefined
    if (existing) return { task: taskViewFromRow(existing), alreadyExists: true }
    const taskId = crypto.randomUUID()
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO research_tasks(
          id, project_id, title, detail, status, source_type, source_id, source_role,
          origin, approval_status, is_formal, wait_condition, deferred_until,
          return_target_json, source_snapshot_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId, this.current.projectId, title, detail, status, sourceType, sourceId || null, sourceRole,
        origin, approvalStatus, isFormal, waitCondition, deferredUntil || null,
        JSON.stringify(source.returnTarget || {}), JSON.stringify(source.sourceSnapshot || {}), timestamp, timestamp,
      )
      this.#appendResearchTaskEvent({
        taskId, eventType: 'created', toStatus: status, actor: origin, note: sourceId ? `来自 ${sourceType}:${sourceId}` : '快速收件箱', timestamp,
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { task: taskViewFromRow(this.database.prepare('SELECT * FROM research_tasks WHERE id = ?').get(taskId)), alreadyExists: false }
  }

  updateResearchTask(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研任务变更格式无效。')
    const taskId = ensureResearchText(input.taskId, '科研任务 ID', 160, { required: true })
    let task = this.database.prepare('SELECT * FROM research_tasks WHERE id = ? AND project_id = ?').get(taskId, this.current.projectId)
    if (!task) throw new Error('当前研究库中找不到这条科研任务。')
    const timestamp = now()

    if (input.decision !== undefined) {
      if (task.approval_status !== 'proposed' || !['confirm', 'reject'].includes(input.decision)) {
        throw new Error('这条任务不处于待确认 AI 建议状态。')
      }
      if (task.source_type === 'ai_suggestion') {
        this.reviewActionItem({ itemId: task.source_id, decision: input.decision === 'confirm' ? 'confirm' : 'dismiss' })
      }
      const nextStatus = input.decision === 'confirm' ? 'today' : 'abandoned'
      const approvalStatus = input.decision === 'confirm' ? 'confirmed' : 'rejected'
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.database.prepare(`
          UPDATE research_tasks
          SET status = ?, approval_status = ?, is_formal = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(nextStatus, approvalStatus, input.decision === 'confirm' ? 1 : 0, timestamp, taskId, this.current.projectId)
        this.#appendResearchTaskEvent({
          taskId,
          eventType: input.decision === 'confirm' ? 'confirmed' : 'rejected',
          fromStatus: task.status,
          toStatus: nextStatus,
          actor: 'user',
          note: input.decision === 'confirm' ? '人工确认后进入正式任务。' : '人工拒绝 AI 建议。',
          timestamp,
        })
        this.database.exec('COMMIT')
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      return this.listResearchTasks()
    }

    if (task.approval_status === 'proposed' || !task.is_formal) throw new Error('AI 建议必须人工确认后才能进入正式任务。')
    const nextStatus = validateTaskStatus(input.status)
    const waitCondition = input.waitCondition === undefined
      ? task.wait_condition
      : ensureResearchText(input.waitCondition, '等待条件', 4000)
    const deferredUntil = input.deferredUntil === undefined
      ? task.deferred_until ?? undefined
      : ensureOptionalResearchDateTime(input.deferredUntil, '推迟时间')
    if (nextStatus === 'waiting' && !waitCondition) throw new Error('等待任务必须写明等待条件。')
    if (nextStatus === 'deferred' && !deferredUntil) throw new Error('推迟任务必须写明恢复时间。')
    this.#writeBackResearchTaskSource(task, nextStatus, timestamp)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE research_tasks
        SET status = ?, wait_condition = ?, deferred_until = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(
        nextStatus,
        nextStatus === 'waiting' ? waitCondition : '',
        nextStatus === 'deferred' ? deferredUntil || null : null,
        timestamp,
        taskId,
        this.current.projectId,
      )
      this.#appendResearchTaskEvent({
        taskId, eventType: 'status_changed', fromStatus: task.status, toStatus: nextStatus,
        actor: 'user', note: ensureResearchText(input.note, '任务变更说明', 2000), timestamp,
      })
      this.#appendResearchTaskEvent({
        taskId, eventType: 'source_written_back', fromStatus: task.status, toStatus: nextStatus,
        actor: 'system', note: `${task.source_type}:${task.source_id || 'manual'} 已同步任务状态。`, timestamp,
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.listResearchTasks()
  }

  saveResearchWorkspace(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('课题资料格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const currentProject = this.database.prepare(`
      SELECT name, research_question, current_hypothesis, stage, mode
      FROM projects WHERE id = ?
    `).get(this.current.projectId)
    if (!currentProject) throw new Error('当前课题不存在。')
    const name = input.name === undefined ? currentProject.name : ensureVaultName(input.name)
    const researchQuestion = input.researchQuestion === undefined
      ? currentProject.research_question
      : ensureResearchText(input.researchQuestion, '研究问题', 4000)
    const currentHypothesis = input.currentHypothesis === undefined
      ? currentProject.current_hypothesis
      : ensureResearchText(input.currentHypothesis, '当前假设', 4000)
    const stage = input.stage === undefined
      ? currentProject.stage
      : ensureResearchText(input.stage, '研究阶段', 80, { required: true })
    const mode = input.mode === undefined
      ? currentProject.mode
      : ensureResearchText(input.mode, '课题模式', 40, { required: true })
    if (!RESEARCH_PROJECT_MODE_VALUES.has(mode)) throw new Error('课题模式无效。')
    const createdBy = input.createdBy === undefined
      ? 'user'
      : validateEnum(input.createdBy, new Set(['user', 'ai', 'system']), '修改来源')
    const changedFields = [
      ['name', currentProject.name, name],
      ['researchQuestion', currentProject.research_question, researchQuestion],
      ['currentHypothesis', currentProject.current_hypothesis, currentHypothesis],
      ['stage', currentProject.stage, stage],
      ['mode', currentProject.mode, mode],
    ].filter(([, previous, next]) => previous !== next).map(([field]) => field)
    if (!changedFields.length) return this.getResearchWorkspace()
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE projects
        SET name = ?, research_question = ?, current_hypothesis = ?, stage = ?, mode = ?, updated_at = ?
        WHERE id = ?
      `).run(name, researchQuestion, currentHypothesis, stage, mode, timestamp, this.current.projectId)
      this.database.prepare(`
        INSERT INTO research_project_history(
          id, project_id, changed_fields_json, snapshot_json, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        this.current.projectId,
        JSON.stringify(changedFields),
        JSON.stringify({ name, researchQuestion, currentHypothesis, stage, mode }),
        timestamp,
        createdBy,
      )
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    this.current.name = name
    this.current.updatedAt = timestamp
    const manifestPath = path.join(this.current.path, VAULT_FILE)
    const manifest = readJson(manifestPath)
    writeJsonAtomic(manifestPath, { ...manifest, name, updatedAt: timestamp, schemaVersion: SCHEMA_VERSION })
    this.#remember(this.current)
    return this.getResearchWorkspace()
  }

  saveResearchProject(input = {}) {
    return this.saveResearchWorkspace(input)
  }

  saveResearchRecord(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研记录格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const recordType = ensureResearchText(input.recordType, '科研记录类型', 40, { required: true })
    const status = input.status === undefined
      ? 'active'
      : ensureResearchText(input.status, '科研记录状态', 40, { required: true })
    const title = ensureResearchText(input.title, '科研记录标题', 240, { required: true })
    if (!RESEARCH_RECORD_TYPE_VALUES.has(recordType)) throw new Error('科研记录类型无效。')
    if (!RESEARCH_RECORD_STATUS_VALUES.has(status)) throw new Error('科研记录状态无效。')
    const recordId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '科研记录 ID', 120, { required: true })
    const existingRecord = this.database.prepare('SELECT project_id FROM research_records WHERE id = ?').get(recordId)
    if (existingRecord && existingRecord.project_id !== this.current.projectId) {
      throw new Error('科研记录不属于当前课题，已拒绝覆盖。')
    }
    const timestamp = now()
    const occurredAt = ensureResearchDateTime(input.occurredAt)
    const sourceIds = ensureResearchStringList(input.sourceIds, '关联文献', 100, 120)
    const tags = ensureResearchStringList(input.tags, '标签', 30, 80)
    const content = ensureResearchText(input.content, '科研记录内容', 100000)
    const filePath = ensureResearchText(input.filePath, '数据文件路径', 2000) || null
    if (sourceIds.length) {
      const placeholders = sourceIds.map(() => '?').join(', ')
      const validSources = this.database.prepare(`
        SELECT id FROM sources
        WHERE project_id = ? AND archived_at IS NULL AND id IN (${placeholders})
      `).all(this.current.projectId, ...sourceIds)
      if (validSources.length !== sourceIds.length) throw new Error('关联文献不存在或不属于当前课题。')
    }
    this.database.prepare(`
      INSERT INTO research_records(
        id, project_id, record_type, title, content, status, occurred_at,
        file_path, source_ids_json, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        record_type = excluded.record_type,
        title = excluded.title,
        content = excluded.content,
        status = excluded.status,
        occurred_at = excluded.occurred_at,
        file_path = excluded.file_path,
        source_ids_json = excluded.source_ids_json,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
      WHERE research_records.project_id = excluded.project_id
    `).run(
      recordId,
      this.current.projectId,
      recordType,
      title,
      content,
      status,
      occurredAt,
      filePath,
      JSON.stringify(sourceIds),
      JSON.stringify(tags),
      timestamp,
      timestamp,
    )
    return this.getResearchWorkspace()
  }

  saveResearchRunTemplate(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('测试模板格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const templateId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '模板 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, name, category, description, defaults_json, built_in, archived_at, created_at
      FROM research_run_templates WHERE id = ?
    `).get(templateId)
    if (existing?.built_in) throw new Error('内置测试模板不可修改，请另存为自定义模板。')
    if (existing && existing.project_id !== this.current.projectId) throw new Error('测试模板不属于当前课题。')
    const name = input.name === undefined && existing
      ? existing.name
      : ensureResearchText(input.name, '模板名称', 160, { required: true })
    const category = input.category === undefined && existing
      ? existing.category
      : ensureResearchText(input.category || 'custom', '模板类别', 80, { required: true })
    const description = input.description === undefined && existing
      ? existing.description
      : ensureResearchText(input.description, '模板说明', 4000)
    const defaults = input.defaults === undefined && existing
      ? safeJson(existing.defaults_json, {})
      : ensureTemplateDefaults(input.defaults)
    const timestamp = now()
    const archivedAt = input.archived === true ? timestamp : null
    this.database.prepare(`
      INSERT INTO research_run_templates(
        id, project_id, name, category, description, defaults_json, built_in,
        archived_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        defaults_json = excluded.defaults_json,
        archived_at = excluded.archived_at,
        updated_at = excluded.updated_at
      WHERE research_run_templates.project_id = excluded.project_id
        AND research_run_templates.built_in = 0
    `).run(
      templateId,
      this.current.projectId,
      name,
      category,
      description,
      JSON.stringify(defaults),
      archivedAt,
      existing?.created_at || timestamp,
      timestamp,
    )
    return this.getResearchWorkspace()
  }

  saveResearchMilestone(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('里程碑格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const milestoneId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '里程碑 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, title, description, status, acceptance_criteria_json,
             due_at, completed_at, created_at
      FROM research_milestones WHERE id = ?
    `).get(milestoneId)
    if (existing && existing.project_id !== this.current.projectId) throw new Error('里程碑不属于当前课题。')
    const title = input.title === undefined && existing
      ? existing.title
      : ensureResearchText(input.title, '里程碑标题', 240, { required: true })
    const description = input.description === undefined && existing
      ? existing.description
      : ensureResearchText(input.description, '里程碑说明', 10000)
    const status = input.status === undefined
      ? existing?.status || 'planned'
      : ensureResearchText(input.status, '里程碑状态', 40, { required: true })
    if (!RESEARCH_MILESTONE_STATUS_VALUES.has(status)) throw new Error('里程碑状态无效。')
    const acceptanceCriteria = input.acceptanceCriteria === undefined && existing
      ? safeJson(existing.acceptance_criteria_json, [])
      : ensureResearchStringList(input.acceptanceCriteria, '里程碑验收条件', 100, 1000)
    const dueAt = input.dueAt === undefined && existing
      ? existing.due_at ?? undefined
      : ensureOptionalResearchDateTime(input.dueAt, '里程碑截止时间')
    const timestamp = now()
    const completedAt = status === 'completed'
      ? existing?.completed_at || timestamp
      : null
    this.database.prepare(`
      INSERT INTO research_milestones(
        id, project_id, title, description, status, acceptance_criteria_json,
        due_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        acceptance_criteria_json = excluded.acceptance_criteria_json,
        due_at = excluded.due_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
      WHERE research_milestones.project_id = excluded.project_id
    `).run(
      milestoneId,
      this.current.projectId,
      title,
      description,
      status,
      JSON.stringify(acceptanceCriteria),
      dueAt || null,
      completedAt,
      existing?.created_at || timestamp,
      timestamp,
    )
    return this.getResearchWorkspace()
  }

  saveResearchRun(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('测试记录格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const runId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '测试 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, milestone_id, template_id, title, purpose, hypothesis,
             changed_variables_json, command, environment, procedure, outcome,
             observations, anomaly, next_step, source_ids_json, started_at,
             ended_at, created_at
      FROM research_runs WHERE id = ?
    `).get(runId)
    if (existing && existing.project_id !== this.current.projectId) throw new Error('测试不属于当前课题。')
    const templateId = input.templateId === undefined
      ? existing?.template_id ?? undefined
      : ensureResearchText(input.templateId, '测试模板 ID', 120) || undefined
    let template
    if (templateId) {
      template = this.database.prepare(`
        SELECT id, project_id, defaults_json, built_in
        FROM research_run_templates
        WHERE id = ? AND archived_at IS NULL
      `).get(templateId)
      if (!template || (!template.built_in && template.project_id !== this.current.projectId)) {
        throw new Error('测试模板不存在或不属于当前课题。')
      }
    }
    const defaults = template ? safeJson(template.defaults_json, {}) : {}
    const milestoneId = input.milestoneId === undefined
      ? existing?.milestone_id ?? undefined
      : ensureResearchText(input.milestoneId, '里程碑 ID', 120) || undefined
    if (milestoneId) {
      const milestone = this.database.prepare(
        'SELECT id FROM research_milestones WHERE id = ? AND project_id = ? AND status != ?',
      ).get(milestoneId, this.current.projectId, 'archived')
      if (!milestone) throw new Error('里程碑不存在或不属于当前课题。')
    }
    const pickText = (key, column, label, maximum, required = false) => {
      if (input[key] !== undefined) return ensureResearchText(input[key], label, maximum, { required })
      if (existing) return existing[column]
      if (defaults[key] !== undefined) return ensureResearchText(defaults[key], label, maximum, { required })
      return ensureResearchText('', label, maximum, { required })
    }
    const title = pickText('title', 'title', '测试标题', 240, true)
    const purpose = pickText('purpose', 'purpose', '测试目的', 10000)
    const hypothesis = pickText('hypothesis', 'hypothesis', '测试假设', 10000)
    const command = pickText('command', 'command', '运行命令', 30000)
    const environment = pickText('environment', 'environment', '运行环境', 10000)
    const procedure = pickText('procedure', 'procedure', '测试步骤', 30000)
    const observations = pickText('observations', 'observations', '测试观察', 30000)
    const anomaly = pickText('anomaly', 'anomaly', '异常记录', 30000)
    const nextStep = pickText('nextStep', 'next_step', '下一步', 10000)
    const changedVariables = input.changedVariables !== undefined
      ? ensureChangedVariables(input.changedVariables)
      : existing
        ? safeJson(existing.changed_variables_json, [])
        : ensureChangedVariables(defaults.changedVariables)
    const outcome = input.outcome === undefined
      ? existing?.outcome || 'planned'
      : ensureResearchText(input.outcome, '测试结果', 40, { required: true })
    if (!RESEARCH_RUN_OUTCOME_VALUES.has(outcome)) throw new Error('测试结果无效。')
    const sourceIds = input.sourceIds === undefined && existing
      ? safeJson(existing.source_ids_json, [])
      : ensureResearchStringList(input.sourceIds, '关联文献', 100, 120)
    if (sourceIds.length) {
      const placeholders = sourceIds.map(() => '?').join(', ')
      const validSources = this.database.prepare(`
        SELECT id FROM sources
        WHERE project_id = ? AND archived_at IS NULL AND id IN (${placeholders})
      `).all(this.current.projectId, ...sourceIds)
      if (validSources.length !== sourceIds.length) throw new Error('关联文献不存在或不属于当前课题。')
    }
    const startedAt = input.startedAt === undefined && existing
      ? existing.started_at
      : ensureResearchDateTime(input.startedAt)
    const endedAt = input.endedAt === undefined && existing
      ? existing.ended_at ?? undefined
      : ensureOptionalResearchDateTime(input.endedAt, '测试结束时间')
    if (endedAt && Date.parse(endedAt) < Date.parse(startedAt)) throw new Error('测试结束时间不能早于开始时间。')
    const timestamp = now()
    this.database.prepare(`
      INSERT INTO research_runs(
        id, project_id, milestone_id, template_id, title, purpose, hypothesis,
        changed_variables_json, command, environment, procedure, outcome,
        observations, anomaly, next_step, source_ids_json, started_at, ended_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        milestone_id = excluded.milestone_id,
        template_id = excluded.template_id,
        title = excluded.title,
        purpose = excluded.purpose,
        hypothesis = excluded.hypothesis,
        changed_variables_json = excluded.changed_variables_json,
        command = excluded.command,
        environment = excluded.environment,
        procedure = excluded.procedure,
        outcome = excluded.outcome,
        observations = excluded.observations,
        anomaly = excluded.anomaly,
        next_step = excluded.next_step,
        source_ids_json = excluded.source_ids_json,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        updated_at = excluded.updated_at
      WHERE research_runs.project_id = excluded.project_id
    `).run(
      runId,
      this.current.projectId,
      milestoneId || null,
      templateId || null,
      title,
      purpose,
      hypothesis,
      JSON.stringify(changedVariables),
      command,
      environment,
      procedure,
      outcome,
      observations,
      anomaly,
      nextStep,
      JSON.stringify(sourceIds),
      startedAt,
      endedAt || null,
      existing?.created_at || timestamp,
      timestamp,
    )
    if (outcome === 'running' || outcome === 'planned') {
      this.saveResearchResume({ activeRunId: runId })
    } else {
      const currentResume = this.getResearchResume()
      if (currentResume.activeRunId === runId) {
        const fallbackRunId = this.database.prepare(`
          SELECT id FROM research_runs
          WHERE project_id = ? AND id != ? AND outcome IN ('running', 'planned')
          ORDER BY CASE outcome WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC
          LIMIT 1
        `).get(this.current.projectId, runId)?.id
        this.saveResearchResume({ activeRunId: fallbackRunId || null })
      }
    }
    return this.getResearchWorkspace()
  }

  saveResearchArtifact(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('成果登记格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const artifactId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '成果 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, run_id, label, role, path_original, created_at
      FROM research_artifacts WHERE id = ?
    `).get(artifactId)
    if (existing && existing.project_id !== this.current.projectId) throw new Error('成果不属于当前课题。')
    const runId = input.runId === undefined
      ? existing?.run_id
      : ensureResearchText(input.runId, '测试 ID', 120, { required: true })
    const run = this.database.prepare('SELECT id FROM research_runs WHERE id = ? AND project_id = ?').get(
      runId,
      this.current.projectId,
    )
    if (!run) throw new Error('测试不存在或不属于当前课题，成果未登记。')
    const artifactPath = input.filePath === undefined && existing ? existing.path_original : input.filePath
    const inspected = inspectResearchArtifactPath(artifactPath)
    const label = input.label === undefined && existing
      ? existing.label
      : ensureResearchText(input.label || path.basename(inspected.resolvedPath), '成果名称', 240, { required: true })
    const role = input.role === undefined
      ? existing?.role || (inspected.kind === 'directory' ? 'directory' : 'other')
      : ensureResearchText(input.role, '成果角色', 40, { required: true })
    if (!RESEARCH_ARTIFACT_ROLE_VALUES.has(role)) throw new Error('成果角色无效。')
    const timestamp = now()
    this.database.prepare(`
      INSERT INTO research_artifacts(
        id, project_id, run_id, label, role, path_original, path_resolved, kind,
        exists_state, size_bytes, modified_at, content_sha256, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'found', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        run_id = excluded.run_id,
        label = excluded.label,
        role = excluded.role,
        path_original = excluded.path_original,
        path_resolved = excluded.path_resolved,
        kind = excluded.kind,
        exists_state = excluded.exists_state,
        size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at,
        content_sha256 = excluded.content_sha256,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
      WHERE research_artifacts.project_id = excluded.project_id
    `).run(
      artifactId,
      this.current.projectId,
      runId,
      label,
      role,
      inspected.originalPath,
      inspected.resolvedPath,
      inspected.kind,
      inspected.sizeBytes ?? null,
      inspected.modifiedAt,
      inspected.contentSha256 || null,
      JSON.stringify(inspected.metadata),
      existing?.created_at || timestamp,
      timestamp,
    )
    return this.getResearchWorkspace()
  }

  listResearchReports() {
    this.#requireOpen()
    const revisions = this.database.prepare(`
      SELECT id, report_id, revision_number, snapshot_json, created_at
      FROM research_report_revisions
      WHERE project_id = ?
      ORDER BY revision_number DESC
    `).all(this.current.projectId)
    const revisionsByReport = new Map()
    for (const row of revisions) {
      const values = revisionsByReport.get(row.report_id) || []
      values.push({
        id: row.id,
        revisionNumber: row.revision_number,
        snapshot: safeJson(row.snapshot_json, {}),
        createdAt: row.created_at,
      })
      revisionsByReport.set(row.report_id, values)
    }
    return this.database.prepare(`
      SELECT id, title, report_type, period, markdown, source_refs_json, status,
             revision_number, created_at, updated_at, confirmed_at
      FROM research_reports
      WHERE project_id = ?
      ORDER BY updated_at DESC, rowid DESC
      LIMIT 500
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      title: row.title,
      type: row.report_type,
      period: row.period,
      markdown: row.markdown,
      sourceRefs: safeJson(row.source_refs_json, []),
      status: row.status,
      revisionNumber: row.revision_number,
      revisions: revisionsByReport.get(row.id) || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at ?? undefined,
    }))
  }

  getResearchReport(reportId) {
    this.#requireOpen()
    const id = ensureResearchText(reportId, '科研报告 ID', 120, { required: true })
    const report = this.listResearchReports().find(candidate => candidate.id === id)
    if (!report) throw new Error('科研报告不存在或不属于当前课题。')
    return report
  }

  saveResearchReport(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研报告格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    if (input.status !== undefined && input.status !== 'draft') {
      throw new Error('保存科研报告只能写入草稿；请使用确认操作形成正式记录。')
    }
    const reportId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '科研报告 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, title, report_type, period, markdown, source_refs_json,
             status, revision_number, created_at, updated_at, confirmed_at
      FROM research_reports WHERE id = ?
    `).get(reportId)
    if (existing && existing.project_id !== this.current.projectId) throw new Error('科研报告不属于当前课题。')
    const title = input.title === undefined && existing
      ? existing.title
      : ensureResearchText(input.title, '科研报告标题', 300, { required: true })
    const type = input.type === undefined && existing
      ? existing.report_type
      : ensureResearchText(input.type, '科研报告类型', 40, { required: true })
    if (!RESEARCH_REPORT_TYPE_VALUES.has(type)) throw new Error('科研报告类型无效。')
    const period = input.period === undefined && existing
      ? existing.period
      : ensureResearchText(input.period, '科研报告周期', 400)
    const markdown = input.markdown === undefined && existing
      ? existing.markdown
      : ensureResearchText(input.markdown, '科研报告正文', 1000000)
    const sourceRefs = input.sourceRefs === undefined && existing
      ? safeJson(existing.source_refs_json, [])
      : this.#validatedResearchRefs(input.sourceRefs, '科研报告来源')
    if (input.sourceRefs === undefined && existing) this.#validatedResearchRefs(sourceRefs, '科研报告来源')
    const timestamp = now()
    const nextStatus = 'draft'
    const changed = !existing || title !== existing.title || type !== existing.report_type
      || period !== existing.period || markdown !== existing.markdown
      || JSON.stringify(sourceRefs) !== existing.source_refs_json || existing.status !== nextStatus
    if (!changed) return this.getResearchReport(reportId)
    const nextRevision = existing ? existing.revision_number + 1 : 1
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (existing) {
        this.database.prepare(`
          INSERT INTO research_report_revisions(
            id, report_id, project_id, revision_number, snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          reportId,
          this.current.projectId,
          existing.revision_number,
          JSON.stringify({
            title: existing.title,
            type: existing.report_type,
            period: existing.period,
            markdown: existing.markdown,
            sourceRefs: safeJson(existing.source_refs_json, []),
            status: existing.status,
            confirmedAt: existing.confirmed_at ?? undefined,
            updatedAt: existing.updated_at,
          }),
          timestamp,
        )
        this.database.prepare(`
          UPDATE research_reports
          SET title = ?, report_type = ?, period = ?, markdown = ?, source_refs_json = ?,
              status = 'draft', revision_number = ?, updated_at = ?, confirmed_at = NULL
          WHERE id = ? AND project_id = ?
        `).run(
          title, type, period, markdown, JSON.stringify(sourceRefs), nextRevision,
          timestamp, reportId, this.current.projectId,
        )
      } else {
        this.database.prepare(`
          INSERT INTO research_reports(
            id, project_id, title, report_type, period, markdown, source_refs_json,
            status, revision_number, created_at, updated_at, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, NULL)
        `).run(
          reportId, this.current.projectId, title, type, period, markdown,
          JSON.stringify(sourceRefs), timestamp, timestamp,
        )
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getResearchReport(reportId)
  }

  confirmResearchReport(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研报告确认格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const reportId = ensureResearchText(input.id, '科研报告 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, title, report_type, period, markdown, source_refs_json,
             status, revision_number, created_at, updated_at, confirmed_at
      FROM research_reports WHERE id = ?
    `).get(reportId)
    if (!existing || existing.project_id !== this.current.projectId) throw new Error('科研报告不存在或不属于当前课题。')
    if (!existing.markdown.trim()) throw new Error('科研报告正文为空，不能确认。')
    this.#validatedResearchRefs(safeJson(existing.source_refs_json, []), '科研报告来源')
    if (existing.status === 'confirmed') return this.getResearchReport(reportId)
    const timestamp = now()
    this.database.prepare(`
      UPDATE research_reports SET status = 'confirmed', confirmed_at = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).run(timestamp, timestamp, reportId, this.current.projectId)
    return this.getResearchReport(reportId)
  }

  exportResearchReport(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研报告导出格式无效。')
    const report = this.getResearchReport(input.id)
    let filePath
    if (input.filePath === undefined || input.filePath === null || input.filePath === '') {
      const baseName = safeFileName(report.title).replace(/\.[^.]+$/, '').slice(0, 100)
      const suffix = now().replace(/[:.]/g, '-')
      filePath = path.join(this.current.path, 'exports', `${baseName}-${suffix}.md`)
    } else {
      const requested = ensureResearchText(input.filePath, '科研报告导出路径', 4000, { required: true })
      if (!path.isAbsolute(requested)) throw new Error('科研报告导出路径必须是绝对路径。')
      filePath = path.extname(requested).toLowerCase() === '.md' ? path.resolve(requested) : path.resolve(`${requested}.md`)
      const parent = path.dirname(filePath)
      if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('科研报告导出目录不存在。')
    }
    const bytes = Buffer.from(renderResearchReportMarkdown(report), 'utf8')
    fs.writeFileSync(filePath, bytes)
    const timestamp = now()
    const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    this.database.prepare(`
      INSERT INTO research_report_exports(id, report_id, project_id, file_path, file_sha256, exported_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), report.id, this.current.projectId, filePath, fileSha256, timestamp)
    return { reportId: report.id, filePath, fileSha256, format: 'markdown', exportedAt: timestamp }
  }

  getZoteroSyncCapabilities() {
    this.#requireOpen()
    return zoteroSyncCapabilities()
  }

  previewZoteroMetadataSync(input = {}) {
    this.#requireOpen()
    const records = Array.isArray(input.records) ? input.records : []
    const existing = this.database.prepare(`
      SELECT item_id, external_library_id, external_item_key, record_fingerprint
      FROM bibliographic_external_refs
      WHERE project_id = ? AND adapter = ?
    `).all(this.current.projectId, ZOTERO_SYNC_ADAPTER).map(row => ({
      itemId: row.item_id,
      libraryId: row.external_library_id,
      itemKey: row.external_item_key,
      fingerprint: row.record_fingerprint,
    }))
    const plan = planZoteroMetadataSync({
      incoming: records,
      existing,
      resolveLocalItem: record => this.#resolveZoteroLocalItem(record),
    })
    return {
      ...plan,
      sourceFingerprint: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex'),
      writesZoteroDatabase: false,
    }
  }

  applyZoteroMetadataSync(input = {}) {
    this.#requireOpen()
    const plan = this.previewZoteroMetadataSync(input)
    if (plan.conflicts.length || plan.unmatched.length) {
      throw new Error(`Zotero 增量绑定未执行：${plan.conflicts.length} 条冲突，${plan.unmatched.length} 条尚未匹配本地题录。`)
    }
    const timestamp = now()
    const runId = crypto.randomUUID()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of [...plan.added, ...plan.updated]) {
        this.database.prepare(`
          INSERT INTO bibliographic_external_refs(
            id, project_id, item_id, adapter, external_library_id, external_item_key,
            external_version, collections_json, attachment_keys_json, record_fingerprint,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, adapter, external_library_id, external_item_key) DO UPDATE SET
            item_id = excluded.item_id,
            external_version = excluded.external_version,
            collections_json = excluded.collections_json,
            attachment_keys_json = excluded.attachment_keys_json,
            record_fingerprint = excluded.record_fingerprint,
            updated_at = excluded.updated_at
        `).run(
          crypto.randomUUID(), this.current.projectId, record.localItemId, ZOTERO_SYNC_ADAPTER,
          record.libraryId, record.itemKey, record.version || null, JSON.stringify(record.collections),
          JSON.stringify(record.attachmentKeys), record.fingerprint, timestamp, timestamp,
        )
      }
      this.database.prepare(`
        INSERT INTO bibliographic_sync_runs(
          id, project_id, adapter, mode, status, source_fingerprint, plan_json, created_at
        ) VALUES (?, ?, ?, 'applied', 'completed', ?, ?, ?)
      `).run(runId, this.current.projectId, ZOTERO_SYNC_ADAPTER, plan.sourceFingerprint, JSON.stringify({ counts: plan.counts }), timestamp)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { ...plan, runId, appliedAt: timestamp }
  }

  exportPortableMarkdown(input = {}) {
    this.#requireOpen()
    const kind = String(input.kind || '')
    const entityId = String(input.id || '').trim()
    const directory = path.resolve(String(input.directory || ''))
    if (!path.isAbsolute(String(input.directory || '')) || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error('请选择已存在的 Markdown 导出目录。')
    }
    const project = this.database.prepare('SELECT id, name FROM projects WHERE id = ?').get(this.current.projectId)
    const snapshot = this.#portableMarkdownSnapshot(kind, entityId, project)
    const fileName = portableMarkdownFileName(kind, snapshot.title, entityId)
    const filePath = path.join(directory, fileName)
    const markdown = renderPortableMarkdown({ kind, id: entityId, project, ...snapshot })
    const bytes = Buffer.from(markdown, 'utf8')
    const overwritten = fs.existsSync(filePath)
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    fs.writeFileSync(temporaryPath, bytes)
    fs.renameSync(temporaryPath, filePath)
    const exportedAt = now()
    const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    this.database.prepare(`
      INSERT INTO portable_markdown_exports(
        id, project_id, entity_kind, entity_id, file_path, file_sha256, exported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), this.current.projectId, kind, entityId, filePath, fileSha256, exportedAt)
    return {
      kind, entityId, filePath, fileName, fileSha256, exportedAt,
      sourceOfTruth: 'sqlite', direction: 'one-way-snapshot', overwritten,
    }
  }

  listResearchClaims(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研论断查询格式无效。')
    const includeArchived = input.includeArchived === true
    const revisions = this.database.prepare(`
      SELECT id, claim_id, revision_number, snapshot_json, created_at
      FROM research_claim_revisions
      WHERE project_id = ?
      ORDER BY revision_number DESC
    `).all(this.current.projectId)
    const revisionsByClaim = new Map()
    for (const row of revisions) {
      const values = revisionsByClaim.get(row.claim_id) || []
      values.push({
        id: row.id,
        revisionNumber: row.revision_number,
        snapshot: safeJson(row.snapshot_json, {}),
        createdAt: row.created_at,
      })
      revisionsByClaim.set(row.claim_id, values)
    }
    return this.database.prepare(`
      SELECT id, section, text, status, required_evidence, evidence_refs_json,
             revision_number, created_at, updated_at, confirmed_at, archived_at
      FROM research_claims
      WHERE project_id = ? AND (? = 1 OR archived_at IS NULL)
      ORDER BY updated_at DESC, rowid DESC
      LIMIT 1000
    `).all(this.current.projectId, includeArchived ? 1 : 0).map(row => ({
      id: row.id,
      section: row.section,
      text: row.text,
      status: row.status,
      requiredEvidence: safeJson(row.required_evidence, []),
      evidenceRefs: safeJson(row.evidence_refs_json, []),
      revisionNumber: row.revision_number,
      revisions: revisionsByClaim.get(row.id) || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      confirmedAt: row.confirmed_at ?? undefined,
      archivedAt: row.archived_at ?? undefined,
    }))
  }

  saveResearchClaim(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研论断格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const claimId = input.id === undefined
      ? crypto.randomUUID()
      : ensureResearchText(input.id, '科研论断 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, section, text, status, required_evidence, evidence_refs_json,
             revision_number, created_at, updated_at, confirmed_at, archived_at
      FROM research_claims WHERE id = ?
    `).get(claimId)
    if (existing && existing.project_id !== this.current.projectId) throw new Error('科研论断不属于当前课题。')
    if (existing?.archived_at) throw new Error('已归档科研论断不可修改。')
    const section = input.section === undefined && existing
      ? existing.section
      : ensureResearchText(input.section, '论文章节', 300)
    const text = input.text === undefined && existing
      ? existing.text
      : ensureResearchText(input.text, '科研论断', 100000, { required: true })
    let status = input.status === undefined
      ? existing?.status || 'draft'
      : ensureResearchText(input.status, '科研论断状态', 40, { required: true })
    if (!RESEARCH_CLAIM_STATUS_VALUES.has(status)) throw new Error('科研论断状态无效。')
    const requiredEvidence = input.requiredEvidence === undefined && existing
      ? safeJson(existing.required_evidence, [])
      : ensureResearchStringList(input.requiredEvidence, '所需证据', 100, 200)
    const evidenceRefs = input.evidenceRefs === undefined && existing
      ? safeJson(existing.evidence_refs_json, [])
      : this.#validatedResearchRefs(input.evidenceRefs, '科研论断证据')
    if (input.evidenceRefs === undefined && existing) this.#validatedResearchRefs(evidenceRefs, '科研论断证据')
    const confirmedContentChanged = existing?.status === 'confirmed' && input.status === undefined && (
      section !== existing.section || text !== existing.text
      || JSON.stringify(requiredEvidence) !== existing.required_evidence
      || JSON.stringify(evidenceRefs) !== existing.evidence_refs_json
    )
    if (confirmedContentChanged) status = 'draft'
    if (status === 'confirmed' && evidenceRefs.length === 0) {
      throw new Error('没有已验证证据的科研论断只能保存为草稿，不能确认。')
    }
    const timestamp = now()
    const changed = !existing || section !== existing.section || text !== existing.text || status !== existing.status
      || JSON.stringify(requiredEvidence) !== existing.required_evidence
      || JSON.stringify(evidenceRefs) !== existing.evidence_refs_json
    if (!changed) return this.listResearchClaims().find(candidate => candidate.id === claimId)
    const nextRevision = existing ? existing.revision_number + 1 : 1
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (existing) {
        this.database.prepare(`
          INSERT INTO research_claim_revisions(
            id, claim_id, project_id, revision_number, snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(), claimId, this.current.projectId, existing.revision_number,
          JSON.stringify({
            section: existing.section,
            text: existing.text,
            status: existing.status,
            requiredEvidence: safeJson(existing.required_evidence, []),
            evidenceRefs: safeJson(existing.evidence_refs_json, []),
            confirmedAt: existing.confirmed_at ?? undefined,
            archivedAt: existing.archived_at ?? undefined,
            updatedAt: existing.updated_at,
          }),
          timestamp,
        )
        this.database.prepare(`
          UPDATE research_claims
          SET section = ?, text = ?, status = ?, required_evidence = ?, evidence_refs_json = ?,
              revision_number = ?, updated_at = ?, confirmed_at = ?
          WHERE id = ? AND project_id = ?
        `).run(
          section, text, status, JSON.stringify(requiredEvidence), JSON.stringify(evidenceRefs),
          nextRevision, timestamp, status === 'confirmed' ? (existing.confirmed_at || timestamp) : null,
          claimId, this.current.projectId,
        )
      } else {
        this.database.prepare(`
          INSERT INTO research_claims(
            id, project_id, section, text, status, required_evidence, evidence_refs_json,
            revision_number, created_at, updated_at, confirmed_at, archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
        `).run(
          claimId, this.current.projectId, section, text, status,
          JSON.stringify(requiredEvidence), JSON.stringify(evidenceRefs), timestamp, timestamp,
          status === 'confirmed' ? timestamp : null,
        )
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.listResearchClaims().find(candidate => candidate.id === claimId)
  }

  archiveResearchClaim(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('科研论断归档格式无效。')
    if (input.projectId !== undefined && input.projectId !== this.current.projectId) {
      throw new Error('课题已切换，本次旧状态写入已取消。')
    }
    const claimId = ensureResearchText(input.id, '科研论断 ID', 120, { required: true })
    const existing = this.database.prepare(`
      SELECT project_id, section, text, status, required_evidence, evidence_refs_json,
             revision_number, created_at, updated_at, confirmed_at, archived_at
      FROM research_claims WHERE id = ?
    `).get(claimId)
    if (!existing || existing.project_id !== this.current.projectId) throw new Error('科研论断不存在或不属于当前课题。')
    if (existing.archived_at) return { id: claimId, archivedAt: existing.archived_at, alreadyArchived: true }
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO research_claim_revisions(
          id, claim_id, project_id, revision_number, snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), claimId, this.current.projectId, existing.revision_number,
        JSON.stringify({
          section: existing.section,
          text: existing.text,
          status: existing.status,
          requiredEvidence: safeJson(existing.required_evidence, []),
          evidenceRefs: safeJson(existing.evidence_refs_json, []),
          confirmedAt: existing.confirmed_at ?? undefined,
          updatedAt: existing.updated_at,
        }),
        timestamp,
      )
      this.database.prepare(`
        UPDATE research_claims
        SET archived_at = ?, updated_at = ?, revision_number = revision_number + 1
        WHERE id = ? AND project_id = ?
      `).run(timestamp, timestamp, claimId, this.current.projectId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { id: claimId, archivedAt: timestamp, alreadyArchived: false }
  }

  getReadingTranslationSegments(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('对照翻译缓存查询格式无效。')
    const sourceId = ensureResearchText(input.sourceId, '文献来源 ID', 120, { required: true })
    const source = this.database.prepare(`
      SELECT id FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('文献来源不存在或不属于当前研究库。')
    if (!Array.isArray(input.segments)) throw new Error('翻译分段查询必须是列表。')
    if (input.segments.length > 1000) throw new Error('一次最多查询 1000 个翻译分段。')
    const requested = input.segments.map((segment, index) => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw new Error(`第 ${index + 1} 个翻译分段格式无效。`)
      return {
        segmentId: ensureResearchText(segment.segmentId, `第 ${index + 1} 个分段 ID`, 240, { required: true }),
        sourceHash: ensureResearchText(segment.sourceHash, `第 ${index + 1} 个原文哈希`, 128, { required: true }),
      }
    })
    const found = []
    const misses = []
    const statement = this.database.prepare(`
      SELECT segment_id, source_hash, source_text, translated_text, source_language,
             target_language, provider, model, status, error, attempts, created_at, updated_at
      FROM reading_translation_segments
      WHERE project_id = ? AND source_id = ? AND segment_id = ? AND source_hash = ?
    `)
    const overrideStatement = this.database.prepare(`
      SELECT working_source_hash, working_source_text, locked, locked_at
      FROM reading_translation_overrides
      WHERE project_id = ? AND source_id = ? AND segment_id = ? AND base_source_hash = ?
    `)
    for (const segment of requested) {
      const override = overrideStatement.get(this.current.projectId, sourceId, segment.segmentId, segment.sourceHash)
      const workingSourceHash = override?.working_source_hash || segment.sourceHash
      const row = statement.get(this.current.projectId, sourceId, segment.segmentId, workingSourceHash)
      if (!row) {
        misses.push(segment)
        continue
      }
      found.push({
        sourceId,
        segmentId: row.segment_id,
        sourceHash: row.source_hash,
        baseSourceHash: segment.sourceHash,
        sourceText: row.source_text,
        translatedText: row.translated_text,
        sourceLanguage: row.source_language,
        targetLanguage: row.target_language,
        provider: row.provider,
        model: row.model ?? undefined,
        status: row.status,
        error: row.error ?? undefined,
        attempts: row.attempts,
        locked: Boolean(override?.locked),
        lockedAt: override?.locked_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    }
    return { sourceId, segments: found, misses }
  }

  saveReadingTranslationSegment(input = {}) {
    this.#requireOpen()
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('对照翻译缓存格式无效。')
    const sourceId = ensureResearchText(input.sourceId, '文献来源 ID', 120, { required: true })
    const source = this.database.prepare(`
      SELECT id FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('文献来源不存在或不属于当前研究库。')
    const segmentId = ensureResearchText(input.segmentId, '分段 ID', 240, { required: true })
    const sourceText = ensureResearchText(input.sourceText, '分段原文', 200000, { required: true })
    const sourceHash = ensureResearchText(input.sourceHash, '分段原文哈希', 128, { required: true }).toLowerCase()
    if (sha256Text(sourceText) !== sourceHash && bilingualSourceHash(sourceText) !== sourceHash) {
      throw new Error('分段原文哈希与原文不一致。')
    }
    const status = ensureResearchText(input.status, '翻译状态', 40, { required: true })
    if (!TRANSLATION_SEGMENT_STATUS_VALUES.has(status)) throw new Error('翻译状态无效。')
    const translatedText = ensureResearchText(input.translatedText, '分段译文', 200000)
    const errorText = ensureResearchText(input.error, '翻译错误', 10000)
    if (status === 'translated' && !translatedText) throw new Error('已完成的翻译必须包含译文。')
    if (status === 'failed' && !errorText) throw new Error('失败的翻译必须包含错误说明。')
    const provider = ensureResearchText(input.provider, '翻译提供方', 160, { required: true })
    const model = ensureResearchText(input.model, '翻译模型', 240)
    const sourceLanguage = ensureResearchText(input.sourceLanguage || 'en', '原文语言', 40, { required: true })
    const targetLanguage = ensureResearchText(input.targetLanguage || 'zh', '译文语言', 40, { required: true })
    const attempts = input.attempts === undefined ? 0 : Number(input.attempts)
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 100000) throw new Error('翻译尝试次数无效。')
    const timestamp = now()
    const baseSourceHash = ensureResearchText(input.baseSourceHash || sourceHash, '原始分段哈希', 128, { required: true }).toLowerCase()
    const previousOverride = this.database.prepare(`
      SELECT working_source_hash, working_source_text, locked, locked_at, created_at
      FROM reading_translation_overrides
      WHERE project_id = ? AND source_id = ? AND segment_id = ? AND base_source_hash = ?
    `).get(this.current.projectId, sourceId, segmentId, baseSourceHash)
    const previousCache = previousOverride ? this.database.prepare(`
      SELECT translated_text, provider, model, status, error, attempts
      FROM reading_translation_segments
      WHERE project_id = ? AND source_id = ? AND segment_id = ? AND source_hash = ?
    `).get(this.current.projectId, sourceId, segmentId, previousOverride.working_source_hash) : undefined
    const unchangedLockedWrite = previousOverride?.locked
      && previousOverride.working_source_hash === sourceHash
      && previousCache?.translated_text === translatedText
      && previousCache?.status === status
    if (previousOverride?.locked && !input.unlock && !unchangedLockedWrite) {
      throw new Error('这段译文已锁定；请先显式解锁再修改、重试或更换引擎。')
    }
    const locked = input.locked === undefined ? Boolean(previousOverride?.locked) : Boolean(input.locked)
    const lockedAt = locked ? previousOverride?.locked_at || timestamp : null
    const existing = this.database.prepare(`
      SELECT created_at FROM reading_translation_segments
      WHERE project_id = ? AND source_id = ? AND segment_id = ? AND source_hash = ?
    `).get(this.current.projectId, sourceId, segmentId, sourceHash)
    this.database.prepare(`
      INSERT INTO reading_translation_segments(
        project_id, source_id, segment_id, source_hash, source_text, translated_text,
        source_language, target_language, provider, model, status, error, created_at,
        updated_at, attempts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_id, segment_id, source_hash) DO UPDATE SET
        source_text = excluded.source_text,
        translated_text = excluded.translated_text,
        source_language = excluded.source_language,
        target_language = excluded.target_language,
        provider = excluded.provider,
        model = excluded.model,
        status = excluded.status,
        error = excluded.error,
        attempts = excluded.attempts,
        updated_at = excluded.updated_at
    `).run(
      this.current.projectId,
      sourceId,
      segmentId,
      sourceHash,
      sourceText,
      translatedText,
      sourceLanguage,
      targetLanguage,
      provider,
      model || null,
      status,
      errorText || null,
      existing?.created_at || timestamp,
      timestamp,
      attempts,
    )
    this.database.prepare(`
      INSERT INTO reading_translation_overrides(
        project_id, source_id, segment_id, base_source_hash, working_source_hash,
        working_source_text, locked, locked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_id, segment_id, base_source_hash) DO UPDATE SET
        working_source_hash = excluded.working_source_hash,
        working_source_text = excluded.working_source_text,
        locked = excluded.locked,
        locked_at = excluded.locked_at,
        updated_at = excluded.updated_at
    `).run(
      this.current.projectId, sourceId, segmentId, baseSourceHash, sourceHash, sourceText,
      locked ? 1 : 0, lockedAt, previousOverride?.created_at || timestamp, timestamp,
    )
    return this.getReadingTranslationSegments({ sourceId, segments: [{ segmentId, sourceHash: baseSourceHash }] }).segments[0]
  }

  listReadingTranslationTerms(input = {}) {
    this.#requireOpen()
    const sourceId = ensureResearchText(input.sourceId, '文献来源 ID', 120, { required: true })
    this.#requireTranslationSource(sourceId)
    return this.database.prepare(`
      SELECT id, source_term, target_term, note, created_at, updated_at
      FROM reading_translation_terms
      WHERE project_id = ? AND source_id = ?
      ORDER BY source_term COLLATE NOCASE, updated_at DESC
    `).all(this.current.projectId, sourceId).map(row => ({
      id: row.id,
      sourceId,
      sourceTerm: row.source_term,
      targetTerm: row.target_term,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  saveReadingTranslationTerm(input = {}) {
    this.#requireOpen()
    const sourceId = ensureResearchText(input.sourceId, '文献来源 ID', 120, { required: true })
    this.#requireTranslationSource(sourceId)
    const sourceTerm = ensureResearchText(input.sourceTerm, '原文术语', 240, { required: true })
    const targetTerm = ensureResearchText(input.targetTerm, '中文术语', 240, { required: true })
    const note = ensureResearchText(input.note, '术语备注', 2000)
    const timestamp = now()
    const existing = this.database.prepare(`
      SELECT id, created_at FROM reading_translation_terms
      WHERE project_id = ? AND source_id = ? AND source_term = ?
    `).get(this.current.projectId, sourceId, sourceTerm)
    const id = existing?.id || crypto.randomUUID()
    this.database.prepare(`
      INSERT INTO reading_translation_terms(id, project_id, source_id, source_term, target_term, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_id, source_term) DO UPDATE SET
        target_term = excluded.target_term, note = excluded.note, updated_at = excluded.updated_at
    `).run(id, this.current.projectId, sourceId, sourceTerm, targetTerm, note, existing?.created_at || timestamp, timestamp)
    return this.listReadingTranslationTerms({ sourceId })
  }

  deleteReadingTranslationTerm(input = {}) {
    this.#requireOpen()
    const sourceId = ensureResearchText(input.sourceId, '文献来源 ID', 120, { required: true })
    this.#requireTranslationSource(sourceId)
    const termId = ensureResearchText(input.termId, '术语 ID', 120, { required: true })
    const removed = this.database.prepare(`
      DELETE FROM reading_translation_terms WHERE id = ? AND project_id = ? AND source_id = ?
    `).run(termId, this.current.projectId, sourceId)
    if (!removed.changes) throw new Error('术语不存在或不属于当前文献。')
    return this.listReadingTranslationTerms({ sourceId })
  }

  #requireTranslationSource(sourceId) {
    const source = this.database.prepare(`
      SELECT id FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('文献来源不存在或不属于当前研究库。')
    return source
  }

  searchLibrary(input = {}) {
    this.#requireOpen()
    this.#ensureSearchIndex()
    const query = String(input.query || '').trim().slice(0, 300)
    const terms = searchTerms(query)
    const filters = normalizeSearchFilters(input.filters)
    const maximumResults = Math.min(Math.max(Number(input.limit) || 80, 20), 200)
    const items = this.#searchableItems()
    const eligibleItems = items.filter(item => itemMatchesSearchFilters(item, filters))
    const eligibleItemIds = new Set(eligibleItems.map(item => item.id))
    const itemFiltersActive = hasItemSearchFilters(filters)

    let rows
    if (!terms.length && !filters.origins.length) {
      rows = this.database.prepare(`
        SELECT *, 0 AS rank
        FROM library_search_fts
        WHERE project_id = ? AND entity_type = 'paper'
        ORDER BY title
      `).all(this.current.projectId)
    } else if (!terms.length) {
      rows = this.database.prepare(`
        SELECT *, 0 AS rank
        FROM library_search_fts
        WHERE project_id = ?
        ORDER BY title
        LIMIT 5000
      `).all(this.current.projectId)
    } else {
      const indexedTerms = terms.filter(term => [...term].length >= 3)
      if (indexedTerms.length) {
        const matchQuery = indexedTerms.map(ftsPhrase).join(' AND ')
        rows = this.database.prepare(`
          SELECT *, bm25(library_search_fts) AS rank
          FROM library_search_fts
          WHERE library_search_fts MATCH ? AND project_id = ?
          ORDER BY rank
          LIMIT 800
        `).all(matchQuery, this.current.projectId)
      } else {
        rows = this.database.prepare(`
          SELECT *, 0 AS rank
          FROM library_search_fts
          WHERE project_id = ?
          LIMIT 5000
        `).all(this.current.projectId)
      }
    }

    const results = rows
      .filter(row => {
        if (filters.origins.length && !filters.origins.includes(row.origin)) return false
        const rowItemIds = searchRowItemIds(row)
        if (itemFiltersActive && !rowItemIds.some(itemId => eligibleItemIds.has(itemId))) return false
        if (!terms.length) {
          if (!rowItemIds.length) return !itemFiltersActive
          return rowItemIds.some(itemId => eligibleItemIds.has(itemId))
        }
        return terms.every(term => normalizeSearchText([
          row.title,
          row.subtitle,
          row.body,
          row.tags,
          row.metadata,
        ].join(' ')).includes(term))
      })
      .slice(0, maximumResults)
      .map(row => searchResultFromRow(row, terms))

    return {
      query,
      filters,
      results,
      filteredItemCount: eligibleItems.length,
      totalItemCount: items.length,
      facets: buildSearchFacets(items),
    }
  }

  prepareSemanticIndex(input = {}) {
    this.#requireOpen()
    this.#ensureSearchIndex()
    const model = String(input.model || 'BAAI/bge-small-zh-v1.5').trim().slice(0, 200)
    const searchState = this.database.prepare(
      'SELECT indexed_at FROM search_index_state WHERE project_id = ? AND dirty = 0',
    ).get(this.current.projectId)
    if (!searchState?.indexed_at) throw new Error('本地精确索引尚未完成。')
    const rows = this.database.prepare(`
      SELECT * FROM library_search_fts
      WHERE project_id = ?
      ORDER BY entity_type, entity_id
      LIMIT 5000
    `).all(this.current.projectId)
    const documents = semanticDocumentsFromSearchRows(rows)
    return {
      projectId: this.current.projectId,
      model,
      sourceIndexedAt: searchState.indexed_at,
      documents,
    }
  }

  semanticIndexStatus(input = {}) {
    this.#requireOpen()
    this.#ensureSearchIndex()
    const model = String(input.model || 'BAAI/bge-small-zh-v1.5').trim().slice(0, 200)
    const searchState = this.database.prepare(
      'SELECT dirty, indexed_at FROM search_index_state WHERE project_id = ?',
    ).get(this.current.projectId)
    const semanticState = this.database.prepare(
      'SELECT model, dimension, source_indexed_at, indexed_at, chunk_count FROM semantic_index_state WHERE project_id = ?',
    ).get(this.current.projectId)
    const ready = Boolean(
      semanticState
      && semanticState.model === model
      && semanticState.source_indexed_at === searchState?.indexed_at
      && !searchState?.dirty
    )
    return {
      ready,
      stale: Boolean(semanticState) && !ready,
      model,
      dimension: semanticState?.dimension,
      chunkCount: semanticState?.chunk_count || 0,
      indexedAt: semanticState?.indexed_at,
      sourceIndexedAt: searchState?.indexed_at,
    }
  }

  commitSemanticIndex(input = {}) {
    this.#requireOpen()
    const model = String(input.model || '').trim().slice(0, 200)
    const dimension = Number(input.dimension)
    const sourceIndexedAt = String(input.sourceIndexedAt || '')
    const documents = Array.isArray(input.documents) ? input.documents : []
    const vectors = Array.isArray(input.vectors) ? input.vectors : []
    if (!model || !Number.isInteger(dimension) || dimension <= 0 || dimension > 4096) {
      throw new Error('语义索引模型或维度无效。')
    }
    if (documents.length !== vectors.length || documents.length > 50000) {
      throw new Error('语义分块与向量数量不一致。')
    }
    const currentState = this.database.prepare(
      'SELECT dirty, indexed_at FROM search_index_state WHERE project_id = ?',
    ).get(this.current.projectId)
    if (currentState?.dirty || !sourceIndexedAt || currentState?.indexed_at !== sourceIndexedAt) {
      throw new Error('研究库内容在生成向量期间发生变化，请重新建立语义索引。')
    }
    const timestamp = now()
    const insert = this.database.prepare(`
      INSERT INTO semantic_chunks(
        id, project_id, entity_type, entity_id, source_id, item_id, item_ids_json,
        review_document_id, page_number, anchor_json, origin, title, subtitle, body,
        chunk_index, start_offset, end_offset, content_sha256,
        model, dimension, vector_blob, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM semantic_chunks WHERE project_id = ?').run(this.current.projectId)
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index]
        if (document.projectId !== this.current.projectId || !document.id || !document.entityType || !document.entityId) {
          throw new Error('语义分块不属于当前研究库。')
        }
        insert.run(
          document.id,
          this.current.projectId,
          document.entityType,
          document.entityId,
          document.sourceId || null,
          document.itemId || null,
          document.itemIdsJson || '[]',
          document.reviewDocumentId || null,
          document.pageNumber || null,
          document.anchorJson || null,
          document.origin,
          document.title || '',
          document.subtitle || null,
          document.body,
          document.chunkIndex,
          document.startOffset,
          document.endOffset,
          document.contentSha256,
          model,
          dimension,
          vectorToBuffer(vectors[index], dimension),
          timestamp,
        )
      }
      this.database.prepare(`
        INSERT INTO semantic_index_state(project_id, model, dimension, source_indexed_at, indexed_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          model = excluded.model,
          dimension = excluded.dimension,
          source_indexed_at = excluded.source_indexed_at,
          indexed_at = excluded.indexed_at,
          chunk_count = excluded.chunk_count
      `).run(this.current.projectId, model, dimension, sourceIndexedAt, timestamp, documents.length)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.semanticIndexStatus({ model })
  }

  searchSemanticIndex(input = {}) {
    this.#requireOpen()
    const model = String(input.model || 'BAAI/bge-small-zh-v1.5').trim().slice(0, 200)
    const state = this.semanticIndexStatus({ model })
    if (!state.ready || !state.dimension) return { ...state, results: [] }
    const queryVector = vectorToBuffer(input.vector, state.dimension)
    const normalizedQuery = vectorFromBuffer(queryVector, state.dimension)
    const filters = normalizeSearchFilters(input.filters)
    const items = this.#searchableItems()
    const eligibleItems = items.filter(item => itemMatchesSearchFilters(item, filters))
    const eligibleItemIds = new Set(eligibleItems.map(item => item.id))
    const itemFiltersActive = hasItemSearchFilters(filters)
    const rows = this.database.prepare(`
      SELECT * FROM semantic_chunks
      WHERE project_id = ? AND model = ?
    `).all(this.current.projectId, model)
    const bestByEntity = new Map()
    for (const row of rows) {
      if (filters.origins.length && !filters.origins.includes(row.origin)) continue
      const rowItemIds = searchRowItemIds(row)
      if (itemFiltersActive && !rowItemIds.some(itemId => eligibleItemIds.has(itemId))) continue
      const vector = vectorFromBuffer(row.vector_blob, state.dimension)
      let score = 0
      for (let index = 0; index < vector.length; index += 1) score += normalizedQuery[index] * vector[index]
      const result = { ...searchResultFromRow(row, []), semanticScore: score }
      const current = bestByEntity.get(result.id)
      if (!current || score > current.semanticScore) bestByEntity.set(result.id, result)
    }
    const maximumResults = Math.min(Math.max(Number(input.limit) || 80, 1), 200)
    return {
      ...state,
      results: [...bestByEntity.values()]
        .sort((left, right) => right.semanticScore - left.semanticScore)
        .slice(0, maximumResults),
    }
  }

  updateReadingState(input = {}) {
    this.#requireOpen()
    const itemId = String(input.itemId || '')
    const item = this.database.prepare(
      'SELECT id FROM bibliographic_items WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    ).get(itemId, this.current.projectId)
    if (!item) throw new Error('当前研究库中找不到这篇文献。')
    const previousRow = this.database.prepare(
      'SELECT * FROM bibliographic_reading_states WHERE item_id = ?',
    ).get(itemId)
    const previous = previousRow ? readingStateFromRow(previousRow) : defaultReadingState()
    const next = {
      ...previous,
      ...(input.readingStatus !== undefined ? { readingStatus: validateEnum(input.readingStatus, READING_STATUS_VALUES, '阅读状态') } : {}),
      ...(input.relevance !== undefined ? { relevance: validateEnum(input.relevance, RELEVANCE_VALUES, '相关性') } : {}),
      ...(input.ideaState !== undefined ? { ideaState: validateEnum(input.ideaState, IDEA_STATE_VALUES, '想法状态') } : {}),
      ...(input.questionState !== undefined ? { questionState: validateEnum(input.questionState, QUESTION_STATE_VALUES, '疑问状态') } : {}),
      ...(input.purposeTags !== undefined ? { purposeTags: normalizePurposeTags(input.purposeTags) } : {}),
      ...(input.decisionNote !== undefined ? { decisionNote: String(input.decisionNote).trim().slice(0, 2000) } : {}),
      ...(input.lastPage !== undefined ? { lastPage: positiveIntegerOrUndefined(input.lastPage, '当前页码') } : {}),
      ...(input.totalPages !== undefined ? { totalPages: positiveIntegerOrUndefined(input.totalPages, '总页数') } : {}),
    }
    if (next.lastPage && next.totalPages && next.lastPage > next.totalPages) {
      throw new Error('当前页码不能大于总页数。')
    }
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO bibliographic_reading_states(
          item_id, reading_status, relevance, idea_state, question_state, purpose_tags_json,
          decision_note, last_page, total_pages, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          reading_status = excluded.reading_status,
          relevance = excluded.relevance,
          idea_state = excluded.idea_state,
          question_state = excluded.question_state,
          purpose_tags_json = excluded.purpose_tags_json,
          decision_note = excluded.decision_note,
          last_page = excluded.last_page,
          total_pages = excluded.total_pages,
          updated_at = excluded.updated_at
      `).run(
        itemId,
        next.readingStatus,
        next.relevance,
        next.ideaState,
        next.questionState,
        JSON.stringify(next.purposeTags),
        next.decisionNote || null,
        next.lastPage || null,
        next.totalPages || null,
        previousRow?.created_at || timestamp,
        timestamp,
      )
      const changes = [
        ['reading_status', previous.readingStatus, next.readingStatus],
        ['relevance', previous.relevance, next.relevance],
        ['idea_state', previous.ideaState, next.ideaState],
        ['question_state', previous.questionState, next.questionState],
        ['purpose_tags', JSON.stringify(previous.purposeTags), JSON.stringify(next.purposeTags)],
        ['decision_note', previous.decisionNote, next.decisionNote],
        ['position', JSON.stringify([previous.lastPage, previous.totalPages]), JSON.stringify([next.lastPage, next.totalPages])],
      ]
      for (const [eventType, fromValue, toValue] of changes) {
        if (fromValue === toValue) continue
        this.database.prepare(`
          INSERT INTO reading_state_events(id, item_id, event_type, from_value, to_value, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), itemId, eventType, fromValue || null, toValue || null, timestamp)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return next
  }

  reviseAnnotation(input = {}) {
    this.#requireOpen()
    const annotationId = String(input.annotationId || '').trim()
    if (!annotationId) throw new Error('批注编号不能为空。')
    const row = this.database.prepare(`
      SELECT a.id, a.source_id, a.category, a.anchor_json, a.current_note_fragment_id,
             s.bibliographic_item_id, current_note.content AS current_note
      FROM annotations a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN note_fragments current_note ON current_note.id = a.current_note_fragment_id
      WHERE a.id = ? AND a.project_id = ? AND a.archived_at IS NULL
    `).get(annotationId, this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条有效批注。')

    const category = String(input.category ?? row.category).trim().slice(0, 80) || '待核实'
    const note = String(input.note ?? row.current_note ?? '').slice(0, 100000)
    const timestamp = now()
    let changed = false
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (category !== row.category) {
        this.database.prepare(`
          UPDATE annotations SET category = ?, updated_at = ? WHERE id = ? AND project_id = ?
        `).run(category, timestamp, annotationId, this.current.projectId)
        this.#appendAnnotationEvent(annotationId, 'category_changed', row.category, category, timestamp)
        changed = true
      }
      if (note !== (row.current_note ?? '')) {
        const fragmentId = `note-revision:${crypto.randomUUID()}`
        const anchor = JSON.parse(row.anchor_json)
        this.database.prepare(`
          INSERT INTO note_fragments(
            id, project_id, bibliographic_item_id, source_id, annotation_id,
            origin, kind, content, content_sha256, purpose_tags_json, anchor_json,
            supersedes_id, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, 'user', 'note', ?, ?, '[]', ?, ?, ?, 'user')
        `).run(
          fragmentId,
          this.current.projectId,
          row.bibliographic_item_id || null,
          row.source_id || null,
          annotationId,
          note,
          crypto.createHash('sha256').update(note).digest('hex'),
          JSON.stringify(anchor),
          row.current_note_fragment_id || null,
          timestamp,
        )
        const quote = this.database.prepare(`
          SELECT id FROM note_fragments
          WHERE annotation_id = ? AND origin = 'source_evidence'
          ORDER BY created_at, rowid LIMIT 1
        `).get(annotationId)
        if (quote?.id) {
          this.#insertFragmentRelation({
            id: crypto.randomUUID(),
            fromFragmentId: fragmentId,
            toFragmentId: quote.id,
            relation: 'comments_on',
            createdBy: 'user',
            status: 'confirmed',
            rationale: '用户笔记来自这段原文摘录。',
            timestamp,
          })
        }
        this.database.prepare(`
          UPDATE annotations
          SET current_note_fragment_id = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(fragmentId, timestamp, annotationId, this.current.projectId)
        this.#appendAnnotationEvent(
          annotationId,
          'note_revised',
          row.current_note_fragment_id || null,
          fragmentId,
          timestamp,
        )
        changed = true
      }
      if (!changed) {
        this.database.exec('ROLLBACK')
        return this.loadLibraryState().annotations.find(annotation => annotation.id === annotationId)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.loadLibraryState().annotations.find(annotation => annotation.id === annotationId)
  }

  archiveAnnotation(input = {}) {
    this.#requireOpen()
    const annotationId = String(input.annotationId || '').trim()
    const row = this.database.prepare(`
      SELECT archived_at FROM annotations WHERE id = ? AND project_id = ?
    `).get(annotationId, this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条批注。')
    if (row.archived_at) return { annotationId, archivedAt: row.archived_at, alreadyArchived: true }
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE annotations SET archived_at = ?, updated_at = ? WHERE id = ? AND project_id = ?
      `).run(timestamp, timestamp, annotationId, this.current.projectId)
      this.#appendAnnotationEvent(annotationId, 'archived', null, timestamp, timestamp)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { annotationId, archivedAt: timestamp, alreadyArchived: false }
  }

  restoreAnnotation(input = {}) {
    this.#requireOpen()
    const annotationId = String(input.annotationId || '').trim()
    const row = this.database.prepare(`
      SELECT archived_at FROM annotations WHERE id = ? AND project_id = ?
    `).get(annotationId, this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条批注。')
    if (!row.archived_at) return this.loadLibraryState().annotations.find(annotation => annotation.id === annotationId)
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE annotations SET archived_at = NULL, updated_at = ? WHERE id = ? AND project_id = ?
      `).run(timestamp, annotationId, this.current.projectId)
      this.#appendAnnotationEvent(annotationId, 'restored', row.archived_at, null, timestamp)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.loadLibraryState().annotations.find(annotation => annotation.id === annotationId)
  }

  exportAnnotations(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '').trim()
    if (!sourceId) throw new Error('请选择要导出批注的论文附件。')
    const source = this.database.prepare(`
      SELECT s.id, s.name, s.content_sha256, b.title AS paper_title
      FROM sources s
      LEFT JOIN bibliographic_items b ON b.id = s.bibliographic_item_id
      WHERE s.id = ? AND s.project_id = ? AND s.archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('当前研究库中找不到这份论文附件。')
    const rows = this.database.prepare(`
      SELECT a.id, a.category, a.anchor_json, a.created_at, a.updated_at,
             quote.id AS quote_fragment_id, quote.content AS quote_text, quote.content_sha256 AS quote_sha256,
             note.content AS note_text, note.content_sha256 AS note_sha256,
             (SELECT count(*) FROM note_fragments revisions
              WHERE revisions.annotation_id = a.id AND revisions.origin = 'user') AS revision_count
      FROM annotations a
      LEFT JOIN note_fragments quote ON quote.id = (
        SELECT first_quote.id FROM note_fragments first_quote
        WHERE first_quote.annotation_id = a.id AND first_quote.origin = 'source_evidence'
        ORDER BY first_quote.created_at, first_quote.rowid LIMIT 1
      )
      LEFT JOIN note_fragments note ON note.id = a.current_note_fragment_id
      WHERE a.project_id = ? AND a.source_id = ? AND a.archived_at IS NULL
      ORDER BY COALESCE(a.updated_at, a.created_at) DESC
    `).all(this.current.projectId, sourceId)
    if (!rows.length) throw new Error('这篇论文目前没有可导出的有效批注。')

    const title = source.paper_title || source.name.replace(/\.pdf$/i, '')
    const timestamp = now()
    const lines = [
      `# ${title} · 研究批注`,
      '',
      `- 原始附件：${source.name}`,
      `- 来源编号：\`${source.id}\``,
      `- 附件 SHA-256：${source.content_sha256 || '未记录'}`,
      `- 导出时间：${timestamp}`,
      `- 有效批注：${rows.length} 条`,
      '',
      '> 本文档只导出当前有效版本。原文证据不可覆盖；用户笔记的历史修订仍保存在研究库中。',
      '',
    ]
    rows.forEach((row, index) => {
      const anchor = JSON.parse(row.anchor_json)
      const page = Number(anchor.pageNumber)
      const location = Number.isInteger(page) && page > 0 ? `第 ${page} 页` : anchor.legacyLocatorText || '位置待核对'
      const deepLink = `research-reader://open?${new URLSearchParams({
        sourceId,
        ...(Number.isInteger(page) && page > 0 ? { page: String(page) } : {}),
        ...(row.quote_fragment_id ? { fragmentId: row.quote_fragment_id } : {}),
      }).toString()}`
      lines.push(
        `## ${index + 1}. ${row.category}`,
        '',
        `- 位置：[${location}](${deepLink})`,
        `- 批注编号：\`${row.id}\``,
        `- 原文指纹：\`${row.quote_sha256 || '未记录'}\``,
        `- 当前笔记指纹：\`${row.note_sha256 || '空笔记'}\``,
        `- 笔记修订数：${row.revision_count}`,
        `- 最近更新：${row.updated_at || row.created_at}`,
        '',
        ...markdownBlockquote(row.quote_text || '（原文摘录为空）'),
        '',
        '### 我的笔记',
        '',
        row.note_text || '（无额外备注）',
        '',
      )
    })
    const bytes = Buffer.from(`${lines.join('\n')}\n`, 'utf8')
    const suffix = timestamp.replace(/[:.]/g, '-')
    const filePath = path.join(this.current.path, 'exports', `${safeFileName(title).slice(0, 100)}-批注-${suffix}.md`)
    fs.writeFileSync(filePath, bytes)
    const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    this.database.prepare(`
      INSERT INTO annotation_exports(
        id, project_id, source_id, format, annotation_count, file_path, file_sha256, exported_at
      ) VALUES (?, ?, ?, 'markdown', ?, ?, ?, ?)
    `).run(crypto.randomUUID(), this.current.projectId, sourceId, rows.length, filePath, fileSha256, timestamp)
    return { filePath, fileSha256, format: 'markdown', annotationCount: rows.length, exportedAt: timestamp }
  }

  resolveDeepLink(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '').trim()
    const fragmentId = String(input.fragmentId || '').trim()
    if (!sourceId) throw new Error('引用链接缺少来源编号。')
    const source = this.database.prepare(`
      SELECT id
      FROM sources
      WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('当前研究库中找不到这条引用对应的论文。')

    let anchor
    if (fragmentId) {
      const fragment = this.database.prepare(`
        SELECT anchor_json
        FROM note_fragments
        WHERE id = ? AND source_id = ? AND project_id = ?
      `).get(fragmentId, sourceId, this.current.projectId)
      if (!fragment) throw new Error('当前研究库中找不到这条引用对应的证据片段。')
      anchor = JSON.parse(fragment.anchor_json)
    }
    const requestedPage = Number(input.pageNumber)
    const anchorPage = Number(anchor?.pageNumber)
    return {
      sourceId,
      pageNumber: Number.isInteger(anchorPage) && anchorPage > 0
        ? anchorPage
        : (Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1),
      anchor,
    }
  }

  getPaperReadingCard(itemId) {
    this.#requireOpen()
    const normalizedItemId = String(itemId || '')
    const paper = this.loadLibraryState().bibliographicItems.find(item => item.id === normalizedItemId)
    if (!paper) throw new Error('当前研究库中找不到这篇文献。')
    const sources = this.database.prepare(`
      SELECT id, name, content_sha256, extracted_text, derived_markdown
      FROM sources
      WHERE project_id = ? AND bibliographic_item_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC
    `).all(this.current.projectId, normalizedItemId)
    const fragments = this.database.prepare(`
      SELECT nf.id, nf.source_id, nf.origin, nf.kind, nf.content,
             nf.content_sha256, nf.anchor_json, nf.created_at
      FROM note_fragments nf
      LEFT JOIN annotations a ON a.id = nf.annotation_id
      WHERE nf.project_id = ? AND nf.bibliographic_item_id = ?
        AND nf.origin IN ('source_evidence', 'user')
        AND nf.id NOT LIKE 'card-context:%'
        AND (
          nf.annotation_id IS NULL
          OR (a.archived_at IS NULL AND (nf.origin != 'user' OR a.current_note_fragment_id = nf.id))
        )
      ORDER BY nf.created_at
    `).all(this.current.projectId, normalizedItemId)
    const contexts = buildPaperReadingCardContexts({ paper, sources, fragments })

    const aiRows = this.database.prepare(`
      SELECT id, content, content_sha256, ai_provenance_json, created_at
      FROM note_fragments
      WHERE project_id = ? AND bibliographic_item_id = ?
        AND origin = 'ai' AND kind = 'summary'
      ORDER BY created_at DESC
    `).all(this.current.projectId, normalizedItemId)
      .map(row => ({ ...row, provenance: JSON.parse(row.ai_provenance_json || '{}') }))
      .filter(row => row.provenance.role === 'paper-reading-card')
    const latestRunId = aiRows[0]?.provenance?.generationRunId
    const latestRows = latestRunId
      ? aiRows.filter(row => row.provenance.generationRunId === latestRunId)
      : []
    const sections = latestRows
      .sort((left, right) => Number(left.provenance.position || 0) - Number(right.provenance.position || 0))
      .map(row => ({
        id: row.id,
        key: row.provenance.sectionKey,
        title: row.provenance.sectionTitle || READING_CARD_SECTION_TITLES[row.provenance.sectionKey] || row.provenance.sectionKey,
        content: row.content,
        contentSha256: row.content_sha256,
        citations: this.database.prepare(`
          SELECT target.id AS fragment_id, target.origin, target.source_id, target.anchor_json,
                 target.content, source.name AS source_name
          FROM fragment_relations relation
          JOIN note_fragments target ON target.id = relation.to_fragment_id
          LEFT JOIN sources source ON source.id = target.source_id
          WHERE relation.from_fragment_id = ? AND relation.relation = 'derived_from'
          ORDER BY target.created_at
        `).all(row.id).map(citation => {
          const anchor = JSON.parse(citation.anchor_json || '{}')
          const pageNumber = Number(anchor.pageNumber)
          return {
            fragmentId: citation.fragment_id,
            origin: citation.origin,
            sourceId: citation.source_id ?? undefined,
            sourceName: citation.source_name ?? undefined,
            pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
            anchor,
            excerpt: citation.content.slice(0, 240),
          }
        }),
      }))
    const firstProvenance = latestRows[0]?.provenance
    return {
      paper,
      contexts,
      card: latestRunId ? {
        generationRunId: latestRunId,
        status: latestRows.every(row => row.provenance.status === 'accepted') ? 'accepted' : 'draft',
        model: firstProvenance.model,
        provider: firstProvenance.provider,
        generatedAt: firstProvenance.generatedAt || latestRows[0].created_at,
        acceptedAt: firstProvenance.acceptedAt,
        sections,
      } : undefined,
    }
  }

  #resolveZoteroLocalItem(record) {
    const conditions = ['project_id = ?', 'archived_at IS NULL']
    const parameters = [this.current.projectId]
    if (record.localItemId) {
      conditions.push('id = ?')
      parameters.push(record.localItemId)
    } else if (record.rawRecordId) {
      conditions.push('raw_record_id = ?')
      parameters.push(record.rawRecordId)
      if (record.rawRecordIdField) {
        conditions.push('raw_record_id_field = ?')
        parameters.push(record.rawRecordIdField)
      }
      if (record.importFormat) {
        conditions.push('import_format = ?')
        parameters.push(record.importFormat)
      }
    } else {
      return undefined
    }
    const matches = this.database.prepare(`
      SELECT id FROM bibliographic_items WHERE ${conditions.join(' AND ')} LIMIT 2
    `).all(...parameters)
    return matches.length === 1 ? matches[0].id : undefined
  }

  #portableMarkdownSnapshot(kind, entityId, project) {
    if (kind === 'reading_card') {
      const snapshot = this.getPaperReadingCard(entityId)
      if (snapshot.card?.status !== 'accepted') throw new Error('阅读卡必须先由用户采纳，才能导出正式 Markdown。')
      const title = `阅读卡 · ${snapshot.paper.title}`
      const references = []
      const body = snapshot.card.sections.map(section => {
        for (const citation of section.citations) {
          references.push(this.#portableCitationReference({ ...citation, paperTitle: snapshot.paper.title }))
        }
        return `## ${section.title}\n\n${section.content}\n\n${section.citations.map(citation => `- ${citation.sourceName || snapshot.paper.title}${citation.pageNumber ? ` · 第 ${citation.pageNumber} 页` : ''}`).join('\n')}`
      }).join('\n\n')
      return {
        title, status: 'accepted', createdAt: snapshot.card.generatedAt, updatedAt: snapshot.card.acceptedAt || snapshot.card.generatedAt,
        body, references: uniquePortableReferences(references), links: [],
      }
    }
    if (kind === 'review_document') {
      const document = this.getReviewDocument(entityId)
      if (!['reviewed', 'exported'].includes(document.status)) throw new Error('复查文档必须先由用户确认，才能导出正式 Markdown。')
      const references = []
      const body = document.blocks.filter(block => !block.unsupported).map(block => {
        for (const citation of block.citations) references.push(this.#portableCitationReference(citation))
        const heading = block.blockType === 'heading' ? '##' : '###'
        return `${heading} ${reviewBlockPortableLabel(block.blockType)}\n\n${block.content}`
      }).join('\n\n')
      const links = document.items.map(item => ({
        fileName: portableMarkdownFileName('reading_card', `阅读卡 · ${item.title}`, item.id), label: `阅读卡 · ${item.title}`,
      }))
      return { title: document.title, status: document.status, createdAt: document.createdAt, updatedAt: document.updatedAt, body, references: uniquePortableReferences(references), links }
    }
    if (kind === 'experiment_retrospective') {
      const workspace = this.getResearchWorkspace()
      const run = workspace.runs.find(candidate => candidate.id === entityId)
      if (!run) throw new Error('找不到要导出的实验 Run。')
      if (['planned', 'running'].includes(run.outcome)) throw new Error('实验 Run 尚未形成结果，不能导出正式复盘。')
      const artifacts = workspace.artifacts.filter(artifact => artifact.runId === run.id)
      const variables = run.changedVariables.length
        ? run.changedVariables.map(item => `- ${item.name}: ${item.previousValue ? `${item.previousValue} → ` : ''}${item.currentValue}${item.unit ? ` ${item.unit}` : ''}`).join('\n')
        : '- 未记录变量变化'
      const body = `## 目的\n\n${run.purpose || '未记录'}\n\n## 可证伪假设\n\n${run.hypothesis || '未记录'}\n\n## 变量变化\n\n${variables}\n\n## 复现信息\n\n- 命令：\`${String(run.command || '未记录').replace(/`/g, '\\`')}\`\n- 环境：${run.environment || '未记录'}\n\n${run.procedure || ''}\n\n## 观察与结果\n\n${run.observations || '未记录'}\n\n## 异常\n\n${run.anomaly || '无'}\n\n## 下一步\n\n${run.nextStep || '未记录'}`
      const references = artifacts.map(artifact => ({ label: artifact.label, type: artifact.role, runTitle: run.title, originalFile: artifact.filePath, id: artifact.id }))
      return { title: `实验复盘 · ${run.title}`, status: run.outcome, createdAt: run.createdAt, updatedAt: run.updatedAt, body, references, links: [] }
    }
    if (kind === 'research_report') {
      const report = this.getResearchReport(entityId)
      if (report.status !== 'confirmed') throw new Error('科研报告必须先由用户确认，才能导出正式 Markdown。')
      const workspace = this.getResearchWorkspace()
      const links = report.sourceRefs.flatMap(ref => {
        if (ref.type === 'run') {
          const run = workspace.runs.find(candidate => candidate.id === ref.id)
          return run ? [{ fileName: portableMarkdownFileName('experiment_retrospective', `实验复盘 · ${run.title}`, run.id), label: `实验复盘 · ${run.title}` }] : []
        }
        const paper = ref.type === 'bibliography' ? this.loadLibraryState().bibliographicItems.find(item => item.id === ref.id) : undefined
        return paper ? [{ fileName: portableMarkdownFileName('reading_card', `阅读卡 · ${paper.title}`, paper.id), label: `阅读卡 · ${paper.title}` }] : []
      })
      const references = report.sourceRefs.map(ref => ({ label: ref.label || ref.type, type: ref.type, id: ref.id }))
      return { title: report.title, status: report.status, createdAt: report.createdAt, updatedAt: report.updatedAt, body: report.markdown, references, links }
    }
    throw new Error('不支持的可迁移 Markdown 类型。')
  }

  #portableCitationReference(citation) {
    const source = citation.sourceId ? this.database.prepare(`
      SELECT name, path_relative FROM sources WHERE id = ? AND project_id = ?
    `).get(citation.sourceId, this.current.projectId) : undefined
    const original = citation.itemId ? this.database.prepare(`
      SELECT path_original FROM bibliographic_attachments WHERE item_id = ? ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END LIMIT 1
    `).get(citation.itemId) : undefined
    return {
      label: citation.label || source?.name || '论文证据',
      paperTitle: citation.paperTitle,
      pageNumber: citation.pageNumber,
      originalFile: original?.path_original || (source?.path_relative ? path.join(this.current.path, source.path_relative) : undefined),
      deepLink: citation.sourceId ? reviewDeepLink(citation.sourceId, citation.pageNumber, citation.fragmentId) : undefined,
      id: citation.fragmentId || citation.sourceId,
    }
  }

  savePaperReadingCardDraft(input = {}) {
    this.#requireOpen()
    const itemId = String(input.itemId || '')
    const snapshot = this.getPaperReadingCard(itemId)
    const contextById = new Map(snapshot.contexts.map(context => [context.contextId, context]))
    const sections = []
    const usedKeys = new Set()
    for (const rawSection of Array.isArray(input.sections) ? input.sections : []) {
      const key = String(rawSection?.key || '')
      const content = String(rawSection?.content || '').trim().slice(0, 8000)
      const citationContexts = uniqueStrings(rawSection?.citationIds)
        .map(contextId => contextById.get(contextId))
        .filter(Boolean)
        .filter(context => readingCardContextAllowedForSection(key, context.origin))
      if (!READING_CARD_SECTION_TITLES[key] || usedKeys.has(key) || !content || !citationContexts.length) continue
      usedKeys.add(key)
      sections.push({
        key,
        title: READING_CARD_SECTION_TITLES[key],
        content,
        citationContexts,
      })
    }
    if (!sections.length) throw new Error('阅读卡没有任何带可验证来源的区块，未保存。')
    const generationRunId = crypto.randomUUID()
    const timestamp = now()
    const primarySourceId = snapshot.contexts.find(context => context.sourceId)?.sourceId
    this.database.exec('BEGIN IMMEDIATE')
    try {
      sections.forEach((section, position) => {
        const aiFragmentId = crypto.randomUUID()
        const provenance = {
          role: 'paper-reading-card',
          status: 'draft',
          generationRunId,
          sectionKey: section.key,
          sectionTitle: section.title,
          position,
          provider: String(input.provider || 'openai-compatible').slice(0, 120),
          model: String(input.model || '').slice(0, 200),
          promptFingerprint: String(input.promptFingerprint || '').slice(0, 200),
          generatedAt: timestamp,
        }
        this.database.prepare(`
          INSERT INTO note_fragments(
            id, project_id, bibliographic_item_id, source_id, origin, kind,
            content, content_sha256, purpose_tags_json, anchor_json,
            ai_provenance_json, created_at, created_by
          ) VALUES (?, ?, ?, ?, 'ai', 'summary', ?, ?, ?, ?, ?, ?, 'ai')
        `).run(
          aiFragmentId,
          this.current.projectId,
          itemId,
          primarySourceId || null,
          section.content,
          crypto.createHash('sha256').update(section.content).digest('hex'),
          JSON.stringify(snapshot.paper.readingState.purposeTags || []),
          JSON.stringify({ type: 'text', state: 'unresolved' }),
          JSON.stringify(provenance),
          timestamp,
        )
        for (const context of section.citationContexts) {
          const evidenceFragmentId = this.#materializeReadingCardContext(itemId, context, primarySourceId, timestamp)
          this.#insertFragmentRelation({
            id: crypto.randomUUID(),
            fromFragmentId: aiFragmentId,
            toFragmentId: evidenceFragmentId,
            relation: 'derived_from',
            createdBy: 'ai',
            status: 'proposed',
            rationale: 'AI 阅读卡草稿引用了这条输入材料。',
            timestamp,
          })
        }
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getPaperReadingCard(itemId)
  }

  acceptPaperReadingCard(input = {}) {
    this.#requireOpen()
    const itemId = String(input.itemId || '')
    const generationRunId = String(input.generationRunId || '')
    const rows = this.database.prepare(`
      SELECT id, ai_provenance_json
      FROM note_fragments
      WHERE project_id = ? AND bibliographic_item_id = ?
        AND origin = 'ai' AND kind = 'summary'
    `).all(this.current.projectId, itemId)
      .map(row => ({ ...row, provenance: JSON.parse(row.ai_provenance_json || '{}') }))
      .filter(row => row.provenance.role === 'paper-reading-card' && row.provenance.generationRunId === generationRunId)
    if (!rows.length) throw new Error('找不到要采纳的阅读卡草稿。')
    const acceptedAt = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        this.database.prepare(
          'UPDATE note_fragments SET ai_provenance_json = ? WHERE id = ?',
        ).run(JSON.stringify({ ...row.provenance, status: 'accepted', acceptedAt }), row.id)
        const proposedRelations = this.database.prepare(`
          SELECT id FROM fragment_relations
          WHERE from_fragment_id = ? AND relation = 'derived_from' AND status = 'proposed'
        `).all(row.id)
        for (const relation of proposedRelations) {
          this.database.prepare(`
            UPDATE fragment_relations
            SET status = 'confirmed', reviewed_at = ?
            WHERE id = ? AND status = 'proposed'
          `).run(acceptedAt, relation.id)
          this.#appendFragmentRelationEvent({
            relationId: relation.id,
            eventType: 'confirmed',
            actor: 'user',
            rationale: '用户采纳阅读卡时确认这条来源关系。',
            timestamp: acceptedAt,
          })
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getPaperReadingCard(itemId)
  }

  #validatedResearchRefs(value, label) {
    const refs = ensureResearchEvidenceRefs(value, label)
    const statements = {
      bibliography: this.database.prepare(`
        SELECT title AS label FROM bibliographic_items
        WHERE id = ? AND project_id = ? AND archived_at IS NULL
      `),
      source: this.database.prepare(`
        SELECT name AS label FROM sources
        WHERE id = ? AND project_id = ? AND archived_at IS NULL
      `),
      run: this.database.prepare(`
        SELECT title AS label FROM research_runs WHERE id = ? AND project_id = ?
      `),
      artifact: this.database.prepare(`
        SELECT label FROM research_artifacts WHERE id = ? AND project_id = ?
      `),
      milestone: this.database.prepare(`
        SELECT title AS label FROM research_milestones
        WHERE id = ? AND project_id = ? AND status != 'archived'
      `),
    }
    return refs.map((ref) => {
      const row = statements[ref.type].get(ref.id, this.current.projectId)
      if (!row) throw new Error(`${label}“${ref.type}:${ref.id}”不存在或不属于当前课题。`)
      return { type: ref.type, id: ref.id, label: ref.label || row.label }
    })
  }

  #materializeReadingCardContext(itemId, context, fallbackSourceId, timestamp) {
    if (context.fragmentId) return context.fragmentId
    const sourceId = context.sourceId || fallbackSourceId
    if (!sourceId) throw new Error('阅读卡引用无法关联到论文附件。')
    const fragmentId = `card-context:${crypto.createHash('sha256').update(`${itemId}\n${context.contextId}\n${context.content}`).digest('hex')}`
    const origin = context.origin === 'user_state' ? 'user' : 'source_evidence'
    const kind = origin === 'user' ? 'note' : 'quote'
    const contentSha256 = crypto.createHash('sha256').update(context.content).digest('hex')
    this.database.prepare(`
      INSERT OR IGNORE INTO note_fragments(
        id, project_id, bibliographic_item_id, source_id, origin, kind,
        content, content_sha256, purpose_tags_json, anchor_json,
        created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'system')
    `).run(
      fragmentId,
      this.current.projectId,
      itemId,
      sourceId,
      origin,
      kind,
      context.content,
      contentSha256,
      JSON.stringify(context.anchor || { type: 'text', state: 'unresolved' }),
      timestamp,
    )
    return fragmentId
  }

  getReviewInputs(input = {}) {
    this.#requireOpen()
    const itemIds = uniqueStrings(input.itemIds)
    const annotationIds = uniqueStrings(input.annotationIds)
    if (!itemIds.length) throw new Error('至少选择一篇论文。')
    const items = this.database.prepare(`
      SELECT id, title, item_type, authors_json, issued
      FROM bibliographic_items
      WHERE project_id = ? AND archived_at IS NULL
        AND id IN (${sqlPlaceholders(itemIds.length)})
      ORDER BY title
    `).all(this.current.projectId, ...itemIds).map(row => ({
      id: row.id,
      title: row.title,
      itemType: row.item_type,
      authors: JSON.parse(row.authors_json),
      issued: row.issued ?? undefined,
    }))
    if (items.length !== itemIds.length) throw new Error('选择中包含不属于当前研究库的论文。')
    let fragments = []
    if (annotationIds.length) {
      fragments = this.database.prepare(`
        SELECT nf.id, nf.bibliographic_item_id, nf.source_id, nf.annotation_id,
               nf.origin, nf.kind, nf.content, nf.content_sha256,
               nf.purpose_tags_json, nf.anchor_json, bi.title AS item_title
        FROM note_fragments nf
        JOIN bibliographic_items bi ON bi.id = nf.bibliographic_item_id
        JOIN annotations a ON a.id = nf.annotation_id
        WHERE nf.project_id = ?
          AND nf.bibliographic_item_id IN (${sqlPlaceholders(itemIds.length)})
          AND nf.annotation_id IN (${sqlPlaceholders(annotationIds.length)})
          AND a.archived_at IS NULL
          AND (nf.origin != 'user' OR a.current_note_fragment_id = nf.id)
        ORDER BY nf.created_at
      `).all(this.current.projectId, ...itemIds, ...annotationIds).map(reviewFragmentFromRow)
    }
    return { items, fragments }
  }

  createReviewDocument(input = {}) {
    this.#requireOpen()
    const reviewInputs = this.getReviewInputs(input)
    const title = String(input.title || '').trim().slice(0, 200) || `文献复查 ${new Date().toLocaleDateString('zh-CN')}`
    const aiSections = Array.isArray(input.aiSections) ? input.aiSections : []
    const documentId = crypto.randomUUID()
    const timestamp = now()
    const fragmentById = new Map(reviewInputs.fragments.map(fragment => [fragment.id, fragment]))
    let position = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO review_documents(
          id, project_id, title, status, generation_run_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?)
      `).run(documentId, this.current.projectId, title, input.generationRunId || null, timestamp, timestamp)
      reviewInputs.items.forEach((item, index) => {
        this.database.prepare(`
          INSERT INTO review_document_items(document_id, item_id, position) VALUES (?, ?, ?)
        `).run(documentId, item.id, index)
      })
      reviewInputs.fragments.forEach((fragment, index) => {
        this.database.prepare(`
          INSERT INTO review_document_fragments(document_id, fragment_id, position) VALUES (?, ?, ?)
        `).run(documentId, fragment.id, index)
      })

      const headingBlockId = crypto.randomUUID()
      this.#insertReviewBlock({
        id: headingBlockId,
        documentId,
        position: position++,
        blockType: 'heading',
        content: `复查范围：${reviewInputs.items.map(item => item.title).join('；')}`,
      })

      for (const fragment of reviewInputs.fragments) {
        if (!['source_evidence', 'user'].includes(fragment.origin)) continue
        const blockId = crypto.randomUUID()
        this.#insertReviewBlock({
          id: blockId,
          documentId,
          position: position++,
          blockType: fragment.origin === 'source_evidence' ? 'source_evidence' : 'user_note',
          content: fragment.content,
          sourceFragmentId: fragment.id,
        })
        if (fragment.sourceId && fragment.bibliographicItemId) {
          this.#insertReviewCitation(blockId, fragment, fragment.itemTitle)
        }
      }

      for (const section of aiSections) {
        const content = String(section?.content || '').trim()
        if (!content) continue
        const citedFragments = uniqueStrings(section.citationFragmentIds)
          .map(id => fragmentById.get(id))
          .filter(Boolean)
        const blockId = crypto.randomUUID()
        this.#insertReviewBlock({
          id: blockId,
          documentId,
          position: position++,
          blockType: 'ai_organization',
          content,
          unsupported: citedFragments.length === 0,
        })
        for (const fragment of citedFragments) {
          if (fragment.sourceId && fragment.bibliographicItemId) {
            this.#insertReviewCitation(blockId, fragment, fragment.itemTitle)
          }
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getReviewDocument(documentId)
  }

  listReviewDocuments() {
    this.#requireOpen()
    return this.database.prepare(`
      SELECT rd.id, rd.title, rd.status, rd.created_at, rd.updated_at,
             count(DISTINCT rdi.item_id) AS item_count,
             count(DISTINCT rb.id) AS block_count
      FROM review_documents rd
      LEFT JOIN review_document_items rdi ON rdi.document_id = rd.id
      LEFT JOIN review_blocks rb ON rb.document_id = rd.id
      WHERE rd.project_id = ?
      GROUP BY rd.id
      ORDER BY rd.updated_at DESC
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      itemCount: row.item_count,
      blockCount: row.block_count,
    }))
  }

  getReviewDocument(documentId) {
    this.#requireOpen()
    const document = this.database.prepare(`
      SELECT id, title, status, generation_run_id, created_at, updated_at
      FROM review_documents
      WHERE id = ? AND project_id = ?
    `).get(String(documentId || ''), this.current.projectId)
    if (!document) throw new Error('找不到这份复查文档。')
    const items = this.database.prepare(`
      SELECT bi.id, bi.title, bi.item_type, bi.authors_json, bi.issued, bi.accessed,
             bi.container_title, bi.publisher, bi.publisher_place, bi.volume, bi.issue,
             bi.pages, bi.language, bi.identifiers_json, rdi.position
      FROM review_document_items rdi
      JOIN bibliographic_items bi ON bi.id = rdi.item_id
      WHERE rdi.document_id = ?
      ORDER BY rdi.position
    `).all(document.id).map((row, index) => {
      const item = bibliographicSummaryFromRow(row)
      return { ...item, position: row.position, citation: citationFormatter.format(item, { style: 'gb-t-7714-2015', sequence: index + 1 }) }
    })
    const blocks = this.database.prepare(`
      SELECT id, position, block_type, content, content_sha256,
             source_fragment_id, unsupported
      FROM review_blocks
      WHERE document_id = ?
      ORDER BY position
    `).all(document.id).map(row => ({
      id: row.id,
      position: row.position,
      blockType: row.block_type,
      content: row.content,
      contentSha256: row.content_sha256,
      sourceFragmentId: row.source_fragment_id ?? undefined,
      unsupported: Boolean(row.unsupported),
      citations: this.database.prepare(`
        SELECT id, item_id, source_id, fragment_id, page_number,
               anchor_json, quoted_text_sha256, label
        FROM review_citations
        WHERE block_id = ?
        ORDER BY id
      `).all(row.id).map(citation => ({
        id: citation.id,
        itemId: citation.item_id,
        sourceId: citation.source_id,
        fragmentId: citation.fragment_id ?? undefined,
        pageNumber: citation.page_number ?? undefined,
        anchor: citation.anchor_json ? JSON.parse(citation.anchor_json) : undefined,
        quotedTextSha256: citation.quoted_text_sha256 ?? undefined,
        label: citation.label,
      })),
    }))
    return {
      id: document.id,
      title: document.title,
      status: document.status,
      generationRunId: document.generation_run_id ?? undefined,
      createdAt: document.created_at,
      updatedAt: document.updated_at,
      items,
      blocks,
    }
  }

  confirmReviewDocument(input = {}) {
    this.#requireOpen()
    const document = this.getReviewDocument(input.documentId)
    if (document.status === 'reviewed' || document.status === 'exported') return document
    if (!document.blocks.some(block => !block.unsupported)) throw new Error('复查文档没有可确认的来源内容。')
    const timestamp = now()
    this.database.prepare(`
      UPDATE review_documents SET status = 'reviewed', updated_at = ?
      WHERE id = ? AND project_id = ?
    `).run(timestamp, document.id, this.current.projectId)
    return this.getReviewDocument(document.id)
  }

  createActionPack(input = {}) {
    this.#requireOpen()
    const title = normalizeActionText(input.title, '行动包标题', 200)
    const objective = normalizeActionText(input.objective, '研究目标', 2000)
    const actions = Array.isArray(input.actions) ? input.actions.slice(0, 12) : []
    if (!actions.length) throw new Error('行动包至少需要一条可审查建议。')
    const createdBy = input.createdBy === 'user' ? 'user' : input.createdBy === 'system' ? 'system' : 'ai'
    const scope = normalizeActionScope(input.scope)
    const timestamp = now()
    const packId = crypto.randomUUID()
    const normalizedActions = actions.map((action, position) => {
      const actionType = validateEnum(action?.actionType, ACTION_TYPE_VALUES, '行动类型')
      const actionTitle = normalizeActionText(action?.title, `第 ${position + 1} 条行动标题`, 240)
      const rationale = normalizeActionText(action?.rationale, `第 ${position + 1} 条行动理由`, 2000)
      const evidence = Array.isArray(action?.evidence) ? action.evidence.slice(0, 12) : []
      if (!evidence.length) throw new Error(`“${actionTitle}”没有可追溯证据，不能进入行动包。`)
      return {
        id: crypto.randomUUID(),
        position,
        actionType,
        title: actionTitle,
        rationale,
        evidence: evidence.map(entry => this.#resolveActionEvidence(entry)),
      }
    })

    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        INSERT INTO action_packs(
          id, project_id, title, objective, scope_json, status, created_by,
          provider, model, generation_run_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
      `).run(
        packId,
        this.current.projectId,
        title,
        objective,
        JSON.stringify(scope),
        createdBy,
        String(input.provider || '').trim().slice(0, 200) || null,
        String(input.model || '').trim().slice(0, 200) || null,
        String(input.generationRunId || '').trim().slice(0, 200) || null,
        timestamp,
        timestamp,
      )
      for (const action of normalizedActions) {
        this.database.prepare(`
          INSERT INTO action_items(
            id, pack_id, position, action_type, title, rationale,
            status, payload_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', '{}', ?, ?)
        `).run(
          action.id,
          packId,
          action.position,
          action.actionType,
          action.title,
          action.rationale,
          timestamp,
          timestamp,
        )
        for (const evidence of action.evidence) this.#insertActionEvidence(action.id, evidence, timestamp)
      }
      this.#appendActionPackEvent({
        packId,
        eventType: 'created',
        actor: createdBy,
        note: `创建 ${normalizedActions.length} 条待确认行动。`,
        timestamp,
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getActionPack(packId)
  }

  listActionPacks() {
    this.#requireOpen()
    return this.database.prepare(`
      SELECT ap.id, ap.title, ap.objective, ap.status, ap.created_by,
             ap.created_at, ap.updated_at,
             count(ai.id) AS item_count,
             sum(CASE WHEN ai.status = 'proposed' THEN 1 ELSE 0 END) AS proposed_count,
             sum(CASE WHEN ai.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
             sum(CASE WHEN ai.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
      FROM action_packs ap
      LEFT JOIN action_items ai ON ai.pack_id = ap.id
      WHERE ap.project_id = ?
      GROUP BY ap.id
      ORDER BY ap.updated_at DESC
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      title: row.title,
      objective: row.objective,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      itemCount: Number(row.item_count || 0),
      proposedCount: Number(row.proposed_count || 0),
      confirmedCount: Number(row.confirmed_count || 0),
      completedCount: Number(row.completed_count || 0),
    }))
  }

  getActionPack(packId) {
    this.#requireOpen()
    const pack = this.database.prepare(`
      SELECT id, title, objective, scope_json, status, created_by, provider, model,
             generation_run_id, created_at, updated_at, confirmed_at, completed_at
      FROM action_packs
      WHERE id = ? AND project_id = ?
    `).get(String(packId || '').trim(), this.current.projectId)
    if (!pack) throw new Error('当前研究库中找不到这个行动包。')
    const items = this.database.prepare(`
      SELECT id, position, action_type, title, rationale, status, created_at, updated_at
      FROM action_items WHERE pack_id = ? ORDER BY position
    `).all(pack.id).map(row => ({
      id: row.id,
      position: row.position,
      actionType: row.action_type,
      title: row.title,
      rationale: row.rationale,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      evidence: this.#actionEvidenceForItem(row.id),
    }))
    const events = this.database.prepare(`
      SELECT id, item_id, event_type, actor, note, created_at
      FROM action_pack_events WHERE pack_id = ? ORDER BY created_at, rowid
    `).all(pack.id).map(event => ({
      id: event.id,
      itemId: event.item_id ?? undefined,
      eventType: event.event_type,
      actor: event.actor,
      note: event.note,
      createdAt: event.created_at,
    }))
    return {
      id: pack.id,
      title: pack.title,
      objective: pack.objective,
      scope: JSON.parse(pack.scope_json),
      status: pack.status,
      createdBy: pack.created_by,
      provider: pack.provider ?? undefined,
      model: pack.model ?? undefined,
      generationRunId: pack.generation_run_id ?? undefined,
      createdAt: pack.created_at,
      updatedAt: pack.updated_at,
      confirmedAt: pack.confirmed_at ?? undefined,
      completedAt: pack.completed_at ?? undefined,
      items,
      events,
    }
  }

  reviewActionItem(input = {}) {
    this.#requireOpen()
    const itemId = String(input.itemId || '').trim()
    const decision = input.decision === 'confirm' ? 'confirm' : input.decision === 'dismiss' ? 'dismiss' : ''
    if (!itemId || !decision) throw new Error('行动审批请求不完整。')
    const row = this.database.prepare(`
      SELECT ai.id, ai.pack_id, ai.status
      FROM action_items ai
      JOIN action_packs ap ON ap.id = ai.pack_id
      WHERE ai.id = ? AND ap.project_id = ?
    `).get(itemId, this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条行动。')
    if (row.status === 'completed') throw new Error('已完成的行动不能改回待确认状态。')
    const nextStatus = decision === 'confirm' ? 'confirmed' : 'dismissed'
    if (row.status === nextStatus) return this.getActionPack(row.pack_id)
    const timestamp = now()
    const eventType = decision === 'confirm'
      ? row.status === 'dismissed' ? 'item_reopened' : 'item_confirmed'
      : 'item_dismissed'
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE action_items SET status = ?, updated_at = ? WHERE id = ?
      `).run(nextStatus, timestamp, itemId)
      this.#appendActionPackEvent({
        packId: row.pack_id,
        itemId,
        eventType,
        actor: 'user',
        note: String(input.note || '').trim().slice(0, 1000)
          || (decision === 'confirm' ? '用户确认执行这条行动。' : '用户拒绝这条行动建议。'),
        timestamp,
      })
      this.#refreshActionPackStatus(row.pack_id, timestamp)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getActionPack(row.pack_id)
  }

  completeActionItem(input = {}) {
    this.#requireOpen()
    const itemId = String(input.itemId || '').trim()
    const row = this.database.prepare(`
      SELECT ai.id, ai.pack_id, ai.status
      FROM action_items ai
      JOIN action_packs ap ON ap.id = ai.pack_id
      WHERE ai.id = ? AND ap.project_id = ?
    `).get(itemId, this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条行动。')
    if (row.status === 'completed') return this.getActionPack(row.pack_id)
    if (row.status !== 'confirmed') throw new Error('行动必须先由用户确认，才能标记为完成。')
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE action_items SET status = 'completed', updated_at = ? WHERE id = ?
      `).run(timestamp, itemId)
      this.#appendActionPackEvent({
        packId: row.pack_id,
        itemId,
        eventType: 'item_completed',
        actor: 'user',
        note: String(input.note || '').trim().slice(0, 1000) || '用户标记这条行动已完成。',
        timestamp,
      })
      this.#refreshActionPackStatus(row.pack_id, timestamp)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getActionPack(row.pack_id)
  }

  getEvidenceGraph(input = {}) {
    this.#requireOpen()
    const requestedItemIds = uniqueStrings(input.itemIds).slice(0, 200)
    const documentId = String(input.documentId || '').trim()
    let scopeItemIds = requestedItemIds
    if (documentId) {
      const document = this.database.prepare(`
        SELECT id FROM review_documents WHERE id = ? AND project_id = ?
      `).get(documentId, this.current.projectId)
      if (!document) throw new Error('找不到要查看证据关系的复查文档。')
      scopeItemIds = this.database.prepare(`
        SELECT item_id FROM review_document_items WHERE document_id = ? ORDER BY position
      `).all(documentId).map(row => row.item_id)
    }

    if (scopeItemIds.length) {
      const knownItems = new Set(this.database.prepare(`
        SELECT id FROM bibliographic_items
        WHERE project_id = ? AND id IN (${sqlPlaceholders(scopeItemIds.length)})
      `).all(this.current.projectId, ...scopeItemIds).map(row => row.id))
      scopeItemIds = scopeItemIds.filter(id => knownItems.has(id))
      if (!scopeItemIds.length) throw new Error('当前研究库中找不到所选论文。')
    }

    const restrictToItems = Boolean(documentId || requestedItemIds.length)
    const fragmentScopeSql = restrictToItems
      ? scopeItemIds.length
        ? `AND nf.bibliographic_item_id IN (${sqlPlaceholders(scopeItemIds.length)})`
        : 'AND 0'
      : ''
    const fragmentRows = this.database.prepare(`
      SELECT nf.id, nf.bibliographic_item_id, nf.source_id, nf.annotation_id,
             nf.origin, nf.kind, nf.content, nf.anchor_json, nf.ai_provenance_json,
             nf.created_at, bi.title AS item_title, s.name AS source_name,
             a.category
      FROM note_fragments nf
      LEFT JOIN bibliographic_items bi ON bi.id = nf.bibliographic_item_id
      LEFT JOIN sources s ON s.id = nf.source_id
      LEFT JOIN annotations a ON a.id = nf.annotation_id
      WHERE nf.project_id = ?
        AND (
          nf.annotation_id IS NULL
          OR (a.archived_at IS NULL AND (nf.origin != 'user' OR a.current_note_fragment_id = nf.id))
        )
        ${fragmentScopeSql}
      ORDER BY nf.created_at DESC
      LIMIT 1201
    `).all(this.current.projectId, ...scopeItemIds)
    const limited = fragmentRows.length > 1200
    const candidateRows = fragmentRows.slice(0, 1200).map(row => ({
      ...row,
      anchor: safeJson(row.anchor_json, {}),
      provenance: safeJson(row.ai_provenance_json, {}),
    }))
    const latestReadingCardRunByItem = new Map()
    for (const row of candidateRows) {
      if (row.origin !== 'ai' || row.provenance.role !== 'paper-reading-card') continue
      if (!latestReadingCardRunByItem.has(row.bibliographic_item_id)) {
        latestReadingCardRunByItem.set(row.bibliographic_item_id, row.provenance.generationRunId)
      }
    }
    const currentRows = candidateRows.filter(row => {
      if (row.origin !== 'ai' || row.provenance.role !== 'paper-reading-card') return true
      return row.provenance.generationRunId === latestReadingCardRunByItem.get(row.bibliographic_item_id)
    })

    const nodes = currentRows.map(evidenceGraphNodeFromFragment)
    const nodeById = new Map(nodes.map(node => [node.id, node]))
    const fragmentNodeId = fragmentId => `fragment:${fragmentId}`
    const edges = []
    const relationRows = this.database.prepare(`
      SELECT fr.id, fr.from_fragment_id, fr.to_fragment_id, fr.relation,
             fr.created_by, fr.status, fr.rationale, fr.created_at, fr.reviewed_at
      FROM fragment_relations fr
      JOIN note_fragments source ON source.id = fr.from_fragment_id
      JOIN note_fragments target ON target.id = fr.to_fragment_id
      WHERE source.project_id = ? AND target.project_id = ? AND fr.status != 'rejected'
    `).all(this.current.projectId, this.current.projectId)
    for (const relation of relationRows) {
      const fromNode = nodeById.get(fragmentNodeId(relation.from_fragment_id))
      const toNode = nodeById.get(fragmentNodeId(relation.to_fragment_id))
      if (!fromNode || !toNode) continue
      edges.push({
        id: `fragment-relation:${relation.id}`,
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        relation: relation.relation,
        label: evidenceRelationLabel(relation.relation),
        provenance: evidenceRelationProvenance(relation),
        relationId: relation.id,
        status: relation.status,
        createdBy: relation.created_by,
        rationale: relation.rationale || undefined,
        createdAt: relation.created_at,
        reviewedAt: relation.reviewed_at || undefined,
        canAccept: relation.status === 'proposed' && ['supports', 'refutes', 'mentions'].includes(relation.relation),
        canReject: ['supports', 'refutes', 'mentions'].includes(relation.relation),
      })
    }

    const reviewScopeSql = documentId
      ? 'AND rd.id = ?'
      : scopeItemIds.length
        ? `AND rdi.item_id IN (${sqlPlaceholders(scopeItemIds.length)})`
        : ''
    const reviewParameters = documentId ? [documentId] : scopeItemIds
    const reviewRows = this.database.prepare(`
      SELECT DISTINCT rb.id, rb.document_id, rb.content, rb.unsupported,
             rd.title AS document_title, rd.status
      FROM review_blocks rb
      JOIN review_documents rd ON rd.id = rb.document_id
      LEFT JOIN review_document_items rdi ON rdi.document_id = rd.id
      WHERE rd.project_id = ? AND rb.block_type = 'ai_organization'
        ${reviewScopeSql}
      ORDER BY rd.updated_at DESC, rb.position
    `).all(this.current.projectId, ...reviewParameters)
    for (const row of reviewRows) {
      const node = evidenceGraphNodeFromReviewBlock(row)
      nodes.push(node)
      nodeById.set(node.id, node)
    }

    if (reviewRows.length) {
      const reviewNodeIds = reviewRows.map(row => row.id)
      const citationRows = this.database.prepare(`
        SELECT rc.id, rc.block_id, rc.fragment_id
        FROM review_citations rc
        WHERE rc.block_id IN (${sqlPlaceholders(reviewNodeIds.length)})
      `).all(...reviewNodeIds)
      for (const citation of citationRows) {
        const fromNode = nodeById.get(`review-block:${citation.block_id}`)
        const toNode = citation.fragment_id ? nodeById.get(fragmentNodeId(citation.fragment_id)) : undefined
        if (!fromNode || !toNode) continue
        edges.push({
          id: `review-citation:${citation.id}`,
          fromNodeId: fromNode.id,
          toNodeId: toNode.id,
          relation: 'cites',
          label: '引用依据',
          provenance: 'ai_proposed',
          status: 'proposed',
          createdBy: 'ai',
          canAccept: false,
          canReject: false,
        })
      }
    }

    const linkedNodeIds = new Set(edges.flatMap(edge => [edge.fromNodeId, edge.toNodeId]))
    return {
      nodes,
      edges,
      unlinkedNodeIds: nodes.filter(node => !linkedNodeIds.has(node.id)).map(node => node.id),
      limited,
      scope: { ...(documentId ? { documentId } : {}), itemIds: scopeItemIds },
      summary: {
        evidence: nodes.filter(node => node.origin === 'source_evidence').length,
        userNotes: nodes.filter(node => node.origin === 'user').length,
        aiDrafts: nodes.filter(node => node.trust === 'ai_draft').length,
        aiAccepted: nodes.filter(node => node.trust === 'ai_accepted').length,
        reviewConclusions: nodes.filter(node => node.origin === 'review').length,
        unsupported: nodes.filter(node => node.trust === 'unsupported').length,
        relations: edges.length,
      },
    }
  }

  createEvidenceRelation(input = {}) {
    this.#requireOpen()
    const fromFragmentId = String(input.fromFragmentId || '').trim()
    const toFragmentId = String(input.toFragmentId || '').trim()
    const relation = String(input.relation || '').trim()
    const rationale = normalizeEvidenceRationale(input.rationale)
    if (!fromFragmentId || !toFragmentId) throw new Error('请选择要建立关系的两个内容节点。')
    if (fromFragmentId === toFragmentId) throw new Error('不能让一个内容节点与自己建立关系。')
    if (!EDITABLE_EVIDENCE_RELATIONS.has(relation)) throw new Error('只能人工建立支持、反驳或补充关系。')
    const fragments = this.database.prepare(`
      SELECT nf.id
      FROM note_fragments nf
      LEFT JOIN annotations a ON a.id = nf.annotation_id
      WHERE nf.project_id = ? AND nf.id IN (?, ?)
        AND (
          nf.annotation_id IS NULL
          OR (a.archived_at IS NULL AND (nf.origin != 'user' OR a.current_note_fragment_id = nf.id))
        )
    `).all(this.current.projectId, fromFragmentId, toFragmentId)
    if (new Set(fragments.map(fragment => fragment.id)).size !== 2) {
      throw new Error('关系节点不属于当前研究库，或其中一条内容已经归档。')
    }

    const timestamp = now()
    const existing = this.database.prepare(`
      SELECT id, status FROM fragment_relations
      WHERE from_fragment_id = ? AND to_fragment_id = ? AND relation = ?
    `).get(fromFragmentId, toFragmentId, relation)
    let relationId = existing?.id || crypto.randomUUID()
    let change = 'created'
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (!existing) {
        this.#insertFragmentRelation({
          id: relationId,
          fromFragmentId,
          toFragmentId,
          relation,
          createdBy: 'user',
          status: 'confirmed',
          rationale,
          timestamp,
        })
      } else if (existing.status === 'rejected') {
        this.database.prepare(`
          UPDATE fragment_relations
          SET status = 'confirmed', created_by = 'user', rationale = ?, reviewed_at = ?
          WHERE id = ?
        `).run(rationale, timestamp, relationId)
        this.#appendFragmentRelationEvent({
          relationId,
          eventType: 'reopened',
          actor: 'user',
          rationale,
          timestamp,
        })
        change = 'reopened'
      } else if (existing.status === 'proposed') {
        this.database.prepare(`
          UPDATE fragment_relations
          SET status = 'confirmed', created_by = 'user', rationale = ?, reviewed_at = ?
          WHERE id = ?
        `).run(rationale, timestamp, relationId)
        this.#appendFragmentRelationEvent({
          relationId,
          eventType: 'confirmed',
          actor: 'user',
          rationale,
          timestamp,
        })
        change = 'confirmed'
      } else {
        change = 'unchanged'
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { relationId, relation, status: 'confirmed', change }
  }

  reviewEvidenceRelation(input = {}) {
    this.#requireOpen()
    const relationId = String(input.relationId || '').trim()
    const decision = input.decision === 'accept' ? 'accept' : input.decision === 'reject' ? 'reject' : ''
    if (!relationId || !decision) throw new Error('关系审核请求不完整。')
    const row = this.database.prepare(`
      SELECT fr.id, fr.relation, fr.status, fr.rationale
      FROM fragment_relations fr
      JOIN note_fragments source ON source.id = fr.from_fragment_id
      JOIN note_fragments target ON target.id = fr.to_fragment_id
      WHERE fr.id = ? AND source.project_id = ? AND target.project_id = ?
    `).get(relationId, this.current.projectId, this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这条证据关系。')
    if (!EDITABLE_EVIDENCE_RELATIONS.has(row.relation)) {
      throw new Error('原文批注和来源引用关系由对应工作流管理，不能在这里撤销。')
    }
    const nextStatus = decision === 'accept' ? 'confirmed' : 'rejected'
    if (row.status === nextStatus) return { relationId, relation: row.relation, status: nextStatus, changed: false }
    const timestamp = now()
    const rationale = String(input.rationale || '').trim().slice(0, 1000)
      || (decision === 'accept' ? '用户确认这条证据关系。' : '用户在证据关系页撤销这条关系。')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`
        UPDATE fragment_relations SET status = ?, reviewed_at = ? WHERE id = ?
      `).run(nextStatus, timestamp, relationId)
      this.#appendFragmentRelationEvent({
        relationId,
        eventType: decision === 'accept' ? 'confirmed' : 'rejected',
        actor: 'user',
        rationale,
        timestamp,
      })
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { relationId, relation: row.relation, status: nextStatus, changed: true }
  }

  async exportReviewDocument(input = {}) {
    this.#requireOpen()
    const document = this.getReviewDocument(input.documentId)
    const format = input.format === 'docx' ? 'docx' : 'markdown'
    const timestamp = now()
    const baseName = safeFileName(document.title).replace(/\.[^.]+$/, '').slice(0, 100)
    const suffix = timestamp.replace(/[:.]/g, '-')
    const filePath = path.join(this.current.path, 'exports', `${baseName}-${suffix}.${format === 'docx' ? 'docx' : 'md'}`)
    let bytes
    if (format === 'docx') {
      bytes = await renderReviewDocx(document)
    } else {
      bytes = Buffer.from(renderReviewMarkdown(document), 'utf8')
    }
    fs.writeFileSync(filePath, bytes)
    const fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    const revisionHash = crypto.createHash('sha256').update(JSON.stringify(document.blocks)).digest('hex')
    this.database.prepare(`
      INSERT INTO export_records(
        id, document_id, format, revision_hash, file_path, file_sha256, exported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), document.id, format, revisionHash, filePath, fileSha256, timestamp)
    this.database.prepare(`
      UPDATE review_documents
      SET status = CASE WHEN status = 'reviewed' THEN 'exported' ELSE status END, updated_at = ?
      WHERE id = ?
    `).run(timestamp, document.id)
    return { filePath, fileSha256, revisionHash, format, exportedAt: timestamp }
  }

  importSourceFile(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.id || '')
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(sourceId)) throw new Error('资料编号无效。')
    const fileName = safeFileName(input.fileName)
    const bytes = Buffer.from(input.bytes || [])
    if (!bytes.length) throw new Error('不能导入空文件。')
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    if (input.contentSha256 && input.contentSha256 !== actualSha256) {
      throw new Error('文件校验失败，已停止写入研究库。')
    }
    const paperDirectory = path.join(this.current.path, 'papers', sourceId, 'original')
    fs.mkdirSync(paperDirectory, { recursive: true })
    const absolutePath = path.join(paperDirectory, fileName)
    const temporaryPath = `${absolutePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, bytes)
    fs.renameSync(temporaryPath, absolutePath)

    const timestamp = now()
    const itemId = input.kind === 'PDF' ? `item:${sourceId}` : undefined
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (itemId) this.#ensureManualItem(itemId, fileName.replace(/\.pdf$/i, ''), timestamp)
      this.database.prepare(`
        INSERT INTO sources(
          id, project_id, bibliographic_item_id, name, kind, version, status,
          path_relative, content_sha256, source_metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '待解析', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          version = excluded.version,
          path_relative = excluded.path_relative,
          content_sha256 = excluded.content_sha256,
          updated_at = excluded.updated_at
      `).run(
        sourceId,
        this.current.projectId,
        itemId || null,
        fileName,
        String(input.kind || 'PDF'),
        Number.isInteger(input.version) ? input.version : 1,
        path.relative(this.current.path, absolutePath),
        actualSha256,
        JSON.stringify({ fileId: sourceId, updated: '刚刚导入', isDemo: false }),
        timestamp,
        timestamp,
      )
      if (itemId) {
        this.database.prepare(`
          INSERT INTO bibliographic_attachments(
            id, item_id, source_id, role, path_original, path_resolved, exists_state, content_sha256
          ) VALUES (?, ?, ?, 'primary', ?, ?, 'found', ?)
          ON CONFLICT(id) DO UPDATE SET
            path_resolved = excluded.path_resolved,
            exists_state = 'found',
            content_sha256 = excluded.content_sha256
        `).run(`attachment:${sourceId}`, itemId, sourceId, String(input.originalPath || input.fileName || fileName), absolutePath, actualSha256)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { sourceId, fileName, contentSha256: actualSha256, pathRelative: path.relative(this.current.path, absolutePath) }
  }

  importExistingPdfFiles(filePaths = []) {
    this.#requireOpen()
    const imported = []
    const skipped = []
    for (const candidate of Array.isArray(filePaths) ? filePaths.slice(0, 500) : []) {
      const absolutePath = path.resolve(String(candidate || ''))
      if (!/\.pdf$/i.test(absolutePath) || !fs.existsSync(absolutePath)) {
        skipped.push({ filePath: absolutePath, reason: '文件不存在或不是 PDF' })
        continue
      }
      try {
        const bytes = fs.readFileSync(absolutePath)
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
        const duplicate = this.database.prepare(`
          SELECT id FROM sources
          WHERE project_id = ? AND content_sha256 = ? AND archived_at IS NULL
          LIMIT 1
        `).get(this.current.projectId, sha256)
        if (duplicate) {
          skipped.push({ filePath: absolutePath, reason: '内容已经在研究库中' })
          continue
        }
        const sourceId = `source-${crypto.randomUUID()}`
        this.importSourceFile({
          id: sourceId,
          fileName: path.basename(absolutePath),
          kind: 'PDF',
          version: 1,
          bytes,
          contentSha256: sha256,
          originalPath: absolutePath,
        })
        imported.push({ sourceId, fileName: path.basename(absolutePath) })
      } catch (error) {
        skipped.push({
          filePath: absolutePath,
          reason: error instanceof Error ? error.message : '导入失败',
        })
      }
    }
    return { imported, skipped }
  }

  readSourceFile(sourceId) {
    this.#requireOpen()
    const row = this.database.prepare(
      'SELECT name, path_relative FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    ).get(String(sourceId || ''), this.current.projectId)
    if (!row?.path_relative) throw new Error('这份资料没有研究库内的原文件。')
    const absolutePath = path.resolve(this.current.path, row.path_relative)
    const rootWithSeparator = `${path.resolve(this.current.path)}${path.sep}`
    if (!absolutePath.startsWith(rootWithSeparator)) throw new Error('资料路径越过研究库边界，已拒绝读取。')
    return {
      fileName: row.name,
      bytes: fs.readFileSync(absolutePath),
    }
  }

  persistMineruResult(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '')
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(sourceId)) throw new Error('资料编号无效。')
    const sourceRow = this.database.prepare(
      'SELECT source_metadata_json FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    ).get(sourceId, this.current.projectId)
    if (!sourceRow) throw new Error('当前研究库中找不到 MinerU 对应的资料。')
    const outputDirectory = path.resolve(String(input.outputDirectory || ''))
    const markdownPath = path.resolve(String(input.markdownPath || ''))
    const outputPrefix = `${outputDirectory}${path.sep}`
    if (!fs.existsSync(outputDirectory) || !markdownPath.startsWith(outputPrefix) || !fs.existsSync(markdownPath)) {
      throw new Error('MinerU 产物目录或 Markdown 路径无效。')
    }
    const markdown = String(input.markdown || fs.readFileSync(markdownPath, 'utf8'))
    const markdownSha256 = crypto.createHash('sha256').update(markdown).digest('hex')
    const timestamp = now()
    const revision = `${timestamp.replace(/[:.]/g, '-')}-${markdownSha256.slice(0, 10)}`
    const destinationRoot = path.join(this.current.path, 'papers', sourceId, 'derived', 'mineru', revision)
    if (fs.existsSync(destinationRoot)) throw new Error('相同 MinerU 派生版本已经存在。')
    fs.mkdirSync(path.dirname(destinationRoot), { recursive: true })
    fs.cpSync(outputDirectory, destinationRoot, { recursive: true, errorOnExist: true })

    const markdownRelativeToOutput = path.relative(outputDirectory, markdownPath)
    const destinationMarkdown = path.resolve(destinationRoot, markdownRelativeToOutput)
    const destinationPrefix = `${path.resolve(destinationRoot)}${path.sep}`
    if (!destinationMarkdown.startsWith(destinationPrefix) || !fs.existsSync(destinationMarkdown)) {
      throw new Error('MinerU Markdown 在复制后无法定位。')
    }
    const files = listFilesRecursively(destinationRoot)
      .filter(file => path.basename(file) !== 'manifest.json')
      .map(file => {
        const bytes = fs.readFileSync(file)
        return {
          path: path.relative(destinationRoot, file).split(path.sep).join('/'),
          size: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }
      })
    const manifest = {
      version: 1,
      sourceId,
      backend: input.backend || 'pipeline',
      generatedAt: timestamp,
      markdownPath: path.relative(destinationRoot, destinationMarkdown).split(path.sep).join('/'),
      markdownSha256,
      files,
    }
    fs.writeFileSync(
      path.join(destinationRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    )

    const metadata = {
      ...JSON.parse(sourceRow.source_metadata_json || '{}'),
      mineruState: '完成',
      mineruBackend: input.backend || 'pipeline',
      mineruRevision: revision,
      mineruOutputDirectory: path.relative(this.current.path, destinationRoot),
      mineruAssetRootRelative: path.relative(this.current.path, destinationRoot),
      mineruMarkdownFileRelative: path.relative(this.current.path, destinationMarkdown),
      mineruMarkdownSha256: markdownSha256,
      mineruGeneratedAt: timestamp,
    }
    this.database.prepare(`
      UPDATE sources
      SET derived_markdown = ?, source_metadata_json = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `).run(markdown, JSON.stringify(metadata), timestamp, sourceId, this.current.projectId)
    return {
      taskId: input.taskId,
      markdown,
      markdownPath: metadata.mineruMarkdownFileRelative,
      outputDirectory: metadata.mineruOutputDirectory,
      backend: metadata.mineruBackend,
      localOnly: true,
      revision,
      assetRootRelative: metadata.mineruAssetRootRelative,
      markdownSha256,
      generatedAt: timestamp,
      manifest,
    }
  }

  loadMineruAssets(sourceId) {
    this.#requireOpen()
    const row = this.database.prepare(
      'SELECT source_metadata_json FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    ).get(String(sourceId || ''), this.current.projectId)
    if (!row) throw new Error('当前研究库中找不到这份资料。')
    const metadata = JSON.parse(row.source_metadata_json || '{}')
    if (!metadata.mineruAssetRootRelative || !metadata.mineruMarkdownFileRelative) {
      return { revision: undefined, assets: {}, layoutSource: undefined, layoutBlocks: [] }
    }
    const workspaceRoot = path.resolve(this.current.path)
    const workspacePrefix = `${workspaceRoot}${path.sep}`
    const assetRoot = path.resolve(workspaceRoot, metadata.mineruAssetRootRelative)
    const markdownFile = path.resolve(workspaceRoot, metadata.mineruMarkdownFileRelative)
    if (!assetRoot.startsWith(workspacePrefix) || !markdownFile.startsWith(workspacePrefix)) {
      throw new Error('MinerU 资源路径越过研究库边界，已拒绝读取。')
    }
    const assetPrefix = `${assetRoot}${path.sep}`
    if (!markdownFile.startsWith(assetPrefix)) throw new Error('MinerU Markdown 不属于当前派生版本。')
    const markdownDirectory = path.dirname(markdownFile)
    const assets = {}
    let totalBytes = 0
    for (const file of listFilesRecursively(assetRoot)) {
      const mimeType = mineruImageMimeType(file)
      if (!mimeType) continue
      const bytes = fs.readFileSync(file)
      if (bytes.length > 10 * 1024 * 1024 || totalBytes + bytes.length > 40 * 1024 * 1024) continue
      totalBytes += bytes.length
      const relative = path.relative(markdownDirectory, file).split(path.sep).join('/')
      if (relative.startsWith('../')) continue
      const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
      assets[relative] = dataUrl
      assets[`./${relative}`] = dataUrl
      try {
        assets[decodeURIComponent(relative)] = dataUrl
      } catch {
        // Keep the original path when it is not URI encoded.
      }
    }
    const layout = readMineruContentList(assetRoot)
    return {
      revision: metadata.mineruRevision,
      markdownSha256: metadata.mineruMarkdownSha256,
      assets,
      layoutSource: layout.source,
      layoutBlocks: layout.blocks,
    }
  }

  getStructuredReading(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '').trim()
    const source = this.database.prepare(`
      SELECT id, version, derived_markdown
      FROM sources
      WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('当前研究库中找不到这份资料。')
    const sourceFingerprint = source.derived_markdown ? structuredSourceFingerprint(source.derived_markdown) : undefined
    const document = this.database.prepare(`
      SELECT id, source_fingerprint, current_version_id, created_at, updated_at
      FROM structured_reading_documents
      WHERE source_id = ? AND project_id = ?
    `).get(sourceId, this.current.projectId)
    if (!document) {
      return { sourceId, sourceVersion: source.version, sourceFingerprint, stale: false, versions: [] }
    }
    const versions = this.database.prepare(`
      SELECT id, document_id, source_id, version_number, source_fingerprint, source_version,
             created_by, model, blocks_json, toc_json, diagnostics_json, quality_issues_json,
             change_summary_json, note, restored_from_version_id, created_at
      FROM structured_reading_versions
      WHERE document_id = ? AND project_id = ?
      ORDER BY version_number DESC
    `).all(document.id, this.current.projectId).map(structuredReadingVersionFromRow)
    const stale = Boolean(sourceFingerprint && document.source_fingerprint !== sourceFingerprint)
    return {
      documentId: document.id,
      sourceId,
      sourceVersion: source.version,
      sourceFingerprint,
      stale,
      currentVersion: stale ? undefined : versions.find(version => version.id === document.current_version_id),
      versions: versions.map(version => ({
        id: version.id,
        versionNumber: version.versionNumber,
        sourceFingerprint: version.sourceFingerprint,
        sourceVersion: version.sourceVersion,
        createdBy: version.createdBy,
        model: version.model,
        changeSummary: version.changeSummary,
        qualityIssueCount: version.qualityIssues.length,
        note: version.note,
        restoredFromVersionId: version.restoredFromVersionId,
        createdAt: version.createdAt,
      })),
    }
  }

  generateStructuredReading(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '').trim()
    const source = this.database.prepare(`
      SELECT id, version, derived_markdown, source_metadata_json
      FROM sources
      WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(sourceId, this.current.projectId)
    if (!source) throw new Error('当前研究库中找不到这份资料。')
    if (!String(source.derived_markdown || '').trim()) throw new Error('当前资料还没有 MinerU 原始 Markdown。')
    const metadata = JSON.parse(source.source_metadata_json || '{}')
    let layoutBlocks = []
    if (metadata.mineruAssetRootRelative) {
      const workspaceRoot = path.resolve(this.current.path)
      const workspacePrefix = `${workspaceRoot}${path.sep}`
      const assetRoot = path.resolve(workspaceRoot, metadata.mineruAssetRootRelative)
      if (!assetRoot.startsWith(workspacePrefix)) throw new Error('MinerU 资源路径越过研究库边界，已拒绝读取。')
      layoutBlocks = readMineruContentList(assetRoot).blocks
    }
    const createdBy = input.createdBy === 'ai' ? 'ai' : 'rules'
    const draft = buildStructuredReadingDraft({
      markdown: source.derived_markdown,
      layoutBlocks,
      boundaries: Array.isArray(input.boundaries) ? input.boundaries : [],
      sourceVersion: source.version,
      createdBy,
      model: createdBy === 'ai' ? String(input.model || '').trim() : undefined,
    })
    if (Array.isArray(input.boundaries) && input.boundaries.length) {
      const knownOriginalIds = new Set(draft.blocks.flatMap(block => block.originalBlockIds))
      const unknown = input.boundaries.find(boundary => !knownOriginalIds.has(String(boundary?.beforeBlockId || '')))
      if (unknown) throw new Error('章节边界没有对应到当前 MinerU 原始块，已拒绝保存。')
    }
    return this.#storeStructuredReadingVersion(sourceId, draft, {
      note: createdBy === 'ai' ? 'AI 仅识别章节边界；正文来自 MinerU 原始块。' : '本地规则生成；正文来自 MinerU 原始块。',
    })
  }

  saveStructuredReadingAdjustment(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '').trim()
    const baseVersionId = String(input.baseVersionId || '').trim()
    const current = this.getStructuredReading({ sourceId })
    if (current.stale || !current.currentVersion) throw new Error('MinerU 原始 Markdown 已变化，请先重新生成结构化阅读稿。')
    if (current.currentVersion.id !== baseVersionId) throw new Error('结构化阅读稿已经产生新版本，请重新载入后再调整。')
    const adjusted = validateManualAdjustment(current.currentVersion, {
      orderedBlockIds: input.orderedBlockIds,
      headingLevels: input.headingLevels,
    })
    return this.#storeStructuredReadingVersion(sourceId, adjusted, {
      note: String(input.note || '用户手动调整结构块。').trim().slice(0, 500),
    })
  }

  restoreStructuredReadingVersion(input = {}) {
    this.#requireOpen()
    const sourceId = String(input.sourceId || '').trim()
    const versionId = String(input.versionId || '').trim()
    const current = this.getStructuredReading({ sourceId })
    const targetRow = this.database.prepare(`
      SELECT id, document_id, source_id, version_number, source_fingerprint, source_version,
             created_by, model, blocks_json, toc_json, diagnostics_json, quality_issues_json,
             change_summary_json, note, restored_from_version_id, created_at
      FROM structured_reading_versions
      WHERE id = ? AND source_id = ? AND project_id = ?
    `).get(versionId, sourceId, this.current.projectId)
    if (!targetRow) throw new Error('找不到要恢复的结构化阅读稿版本。')
    const target = structuredReadingVersionFromRow(targetRow)
    if (!current.sourceFingerprint || target.sourceFingerprint !== current.sourceFingerprint) {
      throw new Error('该旧版本对应不同的 MinerU 原始 Markdown，不能直接恢复。')
    }
    return this.#storeStructuredReadingVersion(sourceId, { ...target, createdBy: 'restore' }, {
      note: `恢复自 v${target.versionNumber}；旧版本本身未被覆盖。`,
      restoredFromVersionId: target.id,
    })
  }

  #storeStructuredReadingVersion(sourceId, draft, options = {}) {
    const timestamp = now()
    const existing = this.database.prepare(`
      SELECT id FROM structured_reading_documents
      WHERE source_id = ? AND project_id = ?
    `).get(sourceId, this.current.projectId)
    const documentId = existing?.id || crypto.randomUUID()
    const versionId = crypto.randomUUID()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (!existing) {
        this.database.prepare(`
          INSERT INTO structured_reading_documents(
            id, project_id, source_id, source_fingerprint, current_version_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        `).run(documentId, this.current.projectId, sourceId, draft.sourceFingerprint, timestamp, timestamp)
      }
      const versionNumber = this.database.prepare(`
        SELECT COALESCE(max(version_number), 0) + 1 AS next_version
        FROM structured_reading_versions WHERE document_id = ?
      `).get(documentId).next_version
      this.database.prepare(`
        INSERT INTO structured_reading_versions(
          id, document_id, project_id, source_id, version_number, source_fingerprint,
          source_version, created_by, model, blocks_json, toc_json, diagnostics_json,
          quality_issues_json, change_summary_json, note, restored_from_version_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId,
        documentId,
        this.current.projectId,
        sourceId,
        versionNumber,
        draft.sourceFingerprint,
        draft.sourceVersion,
        draft.createdBy,
        draft.model || null,
        JSON.stringify(draft.blocks || []),
        JSON.stringify(draft.toc || []),
        JSON.stringify(draft.diagnostics || []),
        JSON.stringify(draft.qualityIssues || []),
        JSON.stringify(draft.changeSummary || {}),
        String(options.note || '').slice(0, 500),
        options.restoredFromVersionId || null,
        timestamp,
      )
      this.database.prepare(`
        UPDATE structured_reading_documents
        SET source_fingerprint = ?, current_version_id = ?, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(draft.sourceFingerprint, versionId, timestamp, documentId, this.current.projectId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getStructuredReading({ sourceId })
  }

  syncLibraryState(input = {}) {
    this.#requireOpen()
    if (input.workspaceId !== this.current.id) throw new Error('研究库已切换，本次旧状态写入已取消。')
    const sources = Array.isArray(input.sources) ? input.sources.filter(source => !source?.isDemo) : []
    const annotations = Array.isArray(input.annotations) ? input.annotations : []
    const timestamp = now()
    const acceptedSourceIds = new Set()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const source of sources) {
        if (!source?.id || !source?.name || !source?.kind) continue
        const sourceId = String(source.id)
        const currentRow = this.database.prepare('SELECT bibliographic_item_id, path_relative, created_at FROM sources WHERE id = ?').get(sourceId)
        const itemId = currentRow?.bibliographic_item_id || (source.kind === 'PDF' ? `item:${sourceId}` : undefined)
        if (itemId) this.#ensureManualItem(itemId, String(source.name).replace(/\.pdf$/i, ''), timestamp)
        const metadata = {
          fileId: source.fileId || sourceId,
          updated: source.updated,
          isDemo: false,
          error: source.error,
          mineruState: source.mineruState,
          mineruError: source.mineruError,
          mineruProgress: source.mineruProgress,
          mineruOutputDirectory: source.mineruOutputDirectory,
          mineruBackend: source.mineruBackend,
          mineruRevision: source.mineruRevision,
          mineruAssetRootRelative: source.mineruAssetRootRelative,
          mineruMarkdownFileRelative: source.mineruMarkdownFileRelative,
          mineruMarkdownSha256: source.mineruMarkdownSha256,
          mineruGeneratedAt: source.mineruGeneratedAt,
          markdownLayout: source.markdownLayout,
          readerState: normalizeSourceReaderState(source.readerState, source.kind),
        }
        this.database.prepare(`
          INSERT INTO sources(
            id, project_id, bibliographic_item_id, name, kind, version, status, pages,
            path_relative, content_sha256, extracted_text, derived_markdown,
            source_metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            bibliographic_item_id = excluded.bibliographic_item_id,
            name = excluded.name,
            kind = excluded.kind,
            version = excluded.version,
            status = excluded.status,
            pages = excluded.pages,
            content_sha256 = excluded.content_sha256,
            extracted_text = excluded.extracted_text,
            derived_markdown = excluded.derived_markdown,
            source_metadata_json = excluded.source_metadata_json,
            updated_at = excluded.updated_at
        `).run(
          sourceId,
          this.current.projectId,
          itemId || null,
          String(source.name),
          String(source.kind),
          Number.isInteger(source.version) ? source.version : 1,
          String(source.status || '待解析'),
          Number.isInteger(source.pages) ? source.pages : null,
          currentRow?.path_relative || null,
          source.hash || null,
          source.extractedText || null,
          source.mineruMarkdown || null,
          JSON.stringify(metadata),
          currentRow?.created_at || timestamp,
          timestamp,
        )
        acceptedSourceIds.add(sourceId)
      }
      for (const annotation of annotations) {
        if (!annotation?.id || !annotation.sourceId || !acceptedSourceIds.has(String(annotation.sourceId))) continue
        this.#appendAnnotation(annotation, timestamp)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { saved: true, sourceCount: acceptedSourceIds.size }
  }

  importBibliographyFile(filePath) {
    this.#requireOpen()
    const absoluteImportPath = path.resolve(filePath)
    const sourceBytes = fs.readFileSync(absoluteImportPath)
    const text = sourceBytes.toString('utf8').replace(/^\uFEFF/, '')
    const sourceFileName = path.basename(absoluteImportPath)
    const sourceFileSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex')
    const format = detectBibliographyFormat({ fileName: sourceFileName, text })
    if (!format) throw new Error('无法识别题录格式；请选择 EndNote XML、RIS 或 BibTeX 文件。')
    const previous = this.database.prepare(`
      SELECT import_batch_id, count(*) AS count
      FROM bibliographic_items
      WHERE project_id = ? AND import_format = ? AND source_file_sha256 = ?
      GROUP BY import_batch_id
      ORDER BY imported_at DESC
      LIMIT 1
    `).get(this.current.projectId, format, sourceFileSha256)
    if (previous) {
      const itemIds = this.database.prepare(`
        SELECT id FROM bibliographic_items
        WHERE project_id = ? AND import_batch_id = ? AND archived_at IS NULL
        ORDER BY record_ordinal
      `).all(this.current.projectId, previous.import_batch_id).map(row => row.id)
      return {
        batchId: previous.import_batch_id,
        format,
        itemCount: previous.count,
        attachmentCount: 0,
        copiedSourceCount: 0,
        alreadyImported: true,
        warnings: [],
        itemIds,
      }
    }

    const records = parseBibliography({ format, fileName: sourceFileName, text })
    const batchId = crypto.randomUUID()
    const importedAt = now()
    const createdPaths = []
    const warnings = []
    let attachmentCount = 0
    let copiedSourceCount = 0
    const itemIds = []
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        const itemId = crypto.randomUUID()
        itemIds.push(itemId)
        const normalized = record.normalized || {}
        this.database.prepare(`
          INSERT INTO bibliographic_items(
            id, project_id, item_type, title, authors_json, issued, accessed, container_title,
            publisher, publisher_place, volume, issue, pages, abstract, language, keywords_json, identifiers_json,
            needs_metadata_review, import_format, import_batch_id, source_file_name,
            source_file_sha256, record_ordinal, raw_record_id, raw_record_id_field,
            raw_payload, raw_fields_json, parser_name, parser_version, imported_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          itemId,
          this.current.projectId,
          String(normalized.itemType || 'unknown'),
          String(normalized.title || '[无题名记录]'),
          JSON.stringify(normalized.authors || []),
          normalized.issued || null,
          normalized.accessed || null,
          normalized.containerTitle || null,
          normalized.publisher || null,
          normalized.publisherPlace || null,
          normalized.volume || null,
          normalized.issue || null,
          normalized.pages || null,
          normalized.abstract || null,
          normalized.language || null,
          JSON.stringify(normalized.keywords || []),
          JSON.stringify(normalized.identifiers || {}),
          normalized.title && !(record.warnings || []).length ? 0 : 1,
          format,
          batchId,
          sourceFileName,
          sourceFileSha256,
          record.ordinal,
          record.rawRecordId || null,
          record.rawRecordIdField || null,
          record.rawPayload,
          JSON.stringify(record.rawFields || {}),
          record.parserName,
          record.parserVersion,
          importedAt,
          importedAt,
          importedAt,
        )
        warnings.push(...(record.warnings || []).map(warning => ({
          ordinal: record.ordinal,
          ...warning,
        })))

        for (const attachment of record.attachments || []) {
          attachmentCount += 1
          const resolution = resolveAttachment(attachment.pathOriginal, path.dirname(absoluteImportPath))
          let sourceId
          let contentSha256
          if (resolution.existsState === 'found' && resolution.pathResolved && /\.pdf$/i.test(resolution.pathResolved)) {
            sourceId = crypto.randomUUID()
            const sourceFile = fs.readFileSync(resolution.pathResolved)
            contentSha256 = crypto.createHash('sha256').update(sourceFile).digest('hex')
            const paperDirectory = path.join(this.current.path, 'papers', itemId, 'original')
            fs.mkdirSync(paperDirectory, { recursive: true })
            const destination = path.join(paperDirectory, safeFileName(path.basename(resolution.pathResolved)))
            fs.copyFileSync(resolution.pathResolved, destination)
            createdPaths.push(destination)
            this.database.prepare(`
              INSERT INTO sources(
                id, project_id, bibliographic_item_id, name, kind, version, status,
                path_relative, content_sha256, source_metadata_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, 'PDF', 1, '待解析', ?, ?, ?, ?, ?)
            `).run(
              sourceId,
              this.current.projectId,
              itemId,
              path.basename(destination),
              path.relative(this.current.path, destination),
              contentSha256,
              JSON.stringify({ fileId: sourceId, updated: '随题录导入', isDemo: false }),
              importedAt,
              importedAt,
            )
            copiedSourceCount += 1
          }
          this.database.prepare(`
            INSERT INTO bibliographic_attachments(
              id, item_id, source_id, role, path_original, path_resolved, exists_state, content_sha256
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            itemId,
            sourceId || null,
            ['primary', 'supplement', 'snapshot', 'other'].includes(attachment.role) ? attachment.role : 'other',
            String(attachment.pathOriginal),
            resolution.pathResolved || null,
            resolution.existsState,
            contentSha256 || null,
          )
        }
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      const quarantine = path.join(this.current.path, '.reader-cache', 'quarantine', batchId)
      for (const createdPath of createdPaths) {
        try {
          fs.mkdirSync(quarantine, { recursive: true })
          fs.renameSync(createdPath, path.join(quarantine, path.basename(createdPath)))
        } catch {}
      }
      throw error
    }
    return {
      batchId,
      format,
      itemCount: records.length,
      attachmentCount,
      copiedSourceCount,
      alreadyImported: false,
      warnings,
      itemIds,
    }
  }

  importLegacySnapshot(snapshot = {}) {
    this.#requireOpen()
    const safeSnapshot = {
      sources: Array.isArray(snapshot.sources) ? snapshot.sources.filter(source => !source?.isDemo) : [],
      annotations: Array.isArray(snapshot.annotations) ? snapshot.annotations : [],
    }
    const serialized = JSON.stringify(safeSnapshot)
    const fingerprint = crypto.createHash('sha256').update(serialized).digest('hex')
    const previous = this.database.prepare(
      'SELECT id, status FROM migration_runs WHERE source_fingerprint = ?',
    ).get(fingerprint)
    if (previous?.status === 'completed') {
      return { runId: previous.id, alreadyImported: true, ...this.loadLibraryState() }
    }

    const runId = previous?.id || crypto.randomUUID()
    const timestamp = now()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (previous) {
        this.database.prepare(`
          UPDATE migration_runs
          SET status = 'running', snapshot_json = ?, started_at = ?, completed_at = NULL, error = NULL
          WHERE id = ?
        `).run(serialized, timestamp, runId)
      } else {
        this.database.prepare(`
          INSERT INTO migration_runs(id, source_kind, source_fingerprint, status, snapshot_json, started_at)
          VALUES (?, 'renderer-local-storage', ?, 'running', ?, ?)
        `).run(runId, fingerprint, serialized, timestamp)
      }

      const acceptedSourceIds = new Set()
      for (const source of safeSnapshot.sources) {
        if (!source?.id || !source?.name || !source?.kind) continue
        const sourceId = String(source.id)
        const existingSource = this.database.prepare('SELECT bibliographic_item_id FROM sources WHERE id = ?').get(sourceId)
        const itemId = existingSource?.bibliographic_item_id || (source.kind === 'PDF' ? `legacy-item:${sourceId}` : undefined)
        if (itemId) {
          const rawPayload = JSON.stringify(source)
          this.database.prepare(`
            INSERT OR IGNORE INTO bibliographic_items(
              id, project_id, item_type, title, authors_json, keywords_json, identifiers_json,
              needs_metadata_review, import_format, import_batch_id, record_ordinal,
              raw_payload, raw_fields_json, parser_name, parser_version, imported_at,
              created_at, updated_at
            ) VALUES (?, ?, 'journalArticle', ?, '[]', '[]', '{}', 1, 'legacy', ?, 0, ?, '{}',
                      'legacy-renderer-migration', '1', ?, ?, ?)
          `).run(itemId, this.current.projectId, String(source.name).replace(/\.pdf$/i, ''), runId, rawPayload, timestamp, timestamp, timestamp)
        }
        const metadata = {
          fileId: source.fileId,
          updated: source.updated,
          isDemo: false,
          error: source.error,
          mineruState: source.mineruState,
          mineruError: source.mineruError,
          mineruProgress: source.mineruProgress,
          mineruOutputDirectory: source.mineruOutputDirectory,
          mineruBackend: source.mineruBackend,
          mineruRevision: source.mineruRevision,
          mineruAssetRootRelative: source.mineruAssetRootRelative,
          mineruMarkdownFileRelative: source.mineruMarkdownFileRelative,
          mineruMarkdownSha256: source.mineruMarkdownSha256,
          mineruGeneratedAt: source.mineruGeneratedAt,
          markdownLayout: source.markdownLayout,
        }
        this.database.prepare(`
          INSERT OR IGNORE INTO sources(
            id, project_id, bibliographic_item_id, name, kind, version, status, pages,
            content_sha256, extracted_text, derived_markdown, source_metadata_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sourceId,
          this.current.projectId,
          itemId || null,
          String(source.name),
          String(source.kind),
          Number.isInteger(source.version) ? source.version : 1,
          String(source.status || '待解析'),
          Number.isInteger(source.pages) ? source.pages : null,
          source.hash || null,
          source.extractedText || null,
          source.mineruMarkdown || null,
          JSON.stringify(metadata),
          timestamp,
          timestamp,
        )
        acceptedSourceIds.add(sourceId)
        this.database.prepare(`
          INSERT OR IGNORE INTO migration_map(
            run_id, legacy_kind, legacy_id, target_kind, target_id, content_sha256
          ) VALUES (?, 'source', ?, 'source', ?, ?)
        `).run(runId, sourceId, sourceId, source.hash || null)

        if (itemId && source.fileId) {
          this.database.prepare(`
            INSERT OR IGNORE INTO bibliographic_attachments(
              id, item_id, source_id, role, path_original, exists_state, content_sha256
            ) VALUES (?, ?, ?, 'primary', ?, 'unknown', ?)
          `).run(
            `legacy-attachment:${sourceId}`,
            itemId,
            sourceId,
            `browser-indexeddb:${source.fileId}`,
            source.hash || null,
          )
        }
      }

      for (const annotation of safeSnapshot.annotations) {
        if (!annotation?.id || !annotation.sourceId || !acceptedSourceIds.has(String(annotation.sourceId))) continue
        const annotationId = String(annotation.id)
        const sourceId = String(annotation.sourceId)
        const item = this.database.prepare('SELECT bibliographic_item_id FROM sources WHERE id = ?').get(sourceId)
        const pageNumber = parseLegacyPage(annotation.page)
        const anchor = pageNumber
          ? { type: 'pdf', state: 'resolved', pageNumber }
          : { type: 'legacy', state: 'unresolved', legacyLocatorText: String(annotation.page || '') }
        const insertedAnnotation = this.database.prepare(`
          INSERT OR IGNORE INTO annotations(
            id, project_id, source_id, category, anchor_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(annotationId, this.current.projectId, sourceId, String(annotation.category || '待核实'), JSON.stringify(anchor), timestamp, timestamp)

        let quoteFragmentId
        if (String(annotation.text || '').trim()) {
          quoteFragmentId = `legacy-quote:${annotationId}`
          this.#insertLegacyFragment({
            id: quoteFragmentId,
            itemId: item?.bibliographic_item_id,
            sourceId,
            annotationId,
            origin: 'source_evidence',
            kind: 'quote',
            content: String(annotation.text),
            anchor,
            timestamp,
          })
        }
        if (String(annotation.note || '').trim()) {
          const noteFragmentId = `legacy-note:${annotationId}`
          this.#insertLegacyFragment({
            id: noteFragmentId,
            itemId: item?.bibliographic_item_id,
            sourceId,
            annotationId,
            origin: 'user',
            kind: 'note',
            content: String(annotation.note),
            anchor,
            timestamp,
          })
          this.database.prepare(`
            UPDATE annotations
            SET current_note_fragment_id = COALESCE(current_note_fragment_id, ?)
            WHERE id = ? AND project_id = ?
          `).run(noteFragmentId, annotationId, this.current.projectId)
          if (quoteFragmentId) {
            this.#insertFragmentRelation({
              id: `legacy-relation:${annotationId}`,
              fromFragmentId: noteFragmentId,
              toFragmentId: quoteFragmentId,
              relation: 'comments_on',
              createdBy: 'user',
              status: 'confirmed',
              rationale: '旧批注迁移时保留的原文与用户笔记关系。',
              timestamp,
              eventActor: 'system',
            })
          }
        }
        if (insertedAnnotation.changes) this.#appendAnnotationEvent(annotationId, 'created', null, null, timestamp)
        this.database.prepare(`
          INSERT OR IGNORE INTO migration_map(
            run_id, legacy_kind, legacy_id, target_kind, target_id
          ) VALUES (?, 'annotation', ?, 'annotation', ?)
        `).run(runId, annotationId, annotationId)
      }

      this.database.prepare(`
        UPDATE migration_runs SET status = 'completed', completed_at = ? WHERE id = ?
      `).run(now(), runId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      try {
        this.database.prepare(`
          INSERT INTO migration_runs(id, source_kind, source_fingerprint, status, snapshot_json, started_at, completed_at, error)
          VALUES (?, 'renderer-local-storage', ?, 'failed', ?, ?, ?, ?)
          ON CONFLICT(source_fingerprint) DO UPDATE SET
            status = 'failed', completed_at = excluded.completed_at, error = excluded.error
        `).run(runId, fingerprint, serialized, timestamp, now(), error instanceof Error ? error.message : String(error))
      } catch {}
      throw error
    }
    return { runId, alreadyImported: false, ...this.loadLibraryState() }
  }

  #insertLegacyFragment({ id, itemId, sourceId, annotationId, origin, kind, content, anchor, timestamp }) {
    const contentSha256 = crypto.createHash('sha256').update(content).digest('hex')
    this.database.prepare(`
      INSERT OR IGNORE INTO note_fragments(
        id, project_id, bibliographic_item_id, source_id, annotation_id,
        origin, kind, content, content_sha256, purpose_tags_json, anchor_json,
        created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `).run(
      id,
      this.current.projectId,
      itemId || null,
      sourceId,
      annotationId,
      origin,
      kind,
      content,
      contentSha256,
      JSON.stringify(anchor),
      timestamp,
      origin === 'user' ? 'user' : 'system',
    )
  }

  #ensureManualItem(itemId, title, timestamp) {
    this.database.prepare(`
      INSERT OR IGNORE INTO bibliographic_items(
        id, project_id, item_type, title, authors_json, keywords_json, identifiers_json,
        needs_metadata_review, import_format, import_batch_id, record_ordinal,
        raw_payload, raw_fields_json, parser_name, parser_version, imported_at,
        created_at, updated_at
      ) VALUES (?, ?, 'journalArticle', ?, '[]', '[]', '{}', 1, 'manual', ?, 0, '', '{}',
                'desktop-file-import', '1', ?, ?, ?)
    `).run(itemId, this.current.projectId, title, `manual:${itemId}`, timestamp, timestamp, timestamp)
  }

  #appendAnnotation(annotation, timestamp) {
    const annotationId = String(annotation.id)
    const sourceId = String(annotation.sourceId)
    const item = this.database.prepare('SELECT bibliographic_item_id FROM sources WHERE id = ?').get(sourceId)
    const pageNumber = parseLegacyPage(annotation.page)
    const anchor = annotation.anchor && typeof annotation.anchor === 'object'
      ? annotation.anchor
      : pageNumber
        ? { type: 'pdf', state: 'resolved', pageNumber }
        : { type: 'legacy', state: 'unresolved', legacyLocatorText: String(annotation.page || '') }
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO annotations(
        id, project_id, source_id, category, anchor_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      annotationId,
      this.current.projectId,
      sourceId,
      String(annotation.category || '待核实'),
      JSON.stringify(anchor),
      timestamp,
      timestamp,
    )
    let quoteFragmentId
    if (String(annotation.text || '').trim()) {
      quoteFragmentId = `quote:${annotationId}`
      this.#insertLegacyFragment({
        id: quoteFragmentId,
        itemId: item?.bibliographic_item_id,
        sourceId,
        annotationId,
        origin: 'source_evidence',
        kind: 'quote',
        content: String(annotation.text),
        anchor,
        timestamp,
      })
    }
    if (String(annotation.note || '').trim()) {
      const noteFragmentId = `note:${annotationId}`
      this.#insertLegacyFragment({
        id: noteFragmentId,
        itemId: item?.bibliographic_item_id,
        sourceId,
        annotationId,
        origin: 'user',
        kind: 'note',
        content: String(annotation.note),
        anchor,
        timestamp,
      })
      this.database.prepare(`
        UPDATE annotations
        SET current_note_fragment_id = COALESCE(current_note_fragment_id, ?)
        WHERE id = ? AND project_id = ?
      `).run(noteFragmentId, annotationId, this.current.projectId)
      if (quoteFragmentId) {
        this.#insertFragmentRelation({
          id: `relation:${annotationId}`,
          fromFragmentId: noteFragmentId,
          toFragmentId: quoteFragmentId,
          relation: 'comments_on',
          createdBy: 'user',
          status: 'confirmed',
          rationale: '用户笔记来自这段原文摘录。',
          timestamp,
        })
      }
    }
    if (inserted.changes) this.#appendAnnotationEvent(annotationId, 'created', null, null, timestamp)
  }

  #resolveActionEvidence(input = {}) {
    const evidenceType = validateEnum(
      input.evidenceType,
      new Set(['fragment', 'review', 'source', 'bibliography', 'milestone', 'run']),
      '证据类型',
    )
    const entityId = String(input.entityId || '').trim()
    if (!entityId) throw new Error('行动证据缺少内容编号。')
    const suppliedLabel = String(input.label || '').trim().slice(0, 300)
    const suppliedExcerpt = String(input.excerpt || '').trim().slice(0, 4000)
    if (evidenceType === 'fragment') {
      const row = this.database.prepare(`
        SELECT nf.id, nf.source_id, nf.bibliographic_item_id, nf.content, nf.anchor_json,
               bi.title AS item_title, s.name AS source_name
        FROM note_fragments nf
        LEFT JOIN bibliographic_items bi ON bi.id = nf.bibliographic_item_id
        LEFT JOIN sources s ON s.id = nf.source_id
        LEFT JOIN annotations a ON a.id = nf.annotation_id
        WHERE nf.id = ? AND nf.project_id = ?
          AND (
            nf.annotation_id IS NULL
            OR (a.archived_at IS NULL AND (nf.origin != 'user' OR a.current_note_fragment_id = nf.id))
          )
      `).get(entityId, this.current.projectId)
      if (!row) throw new Error('行动引用的笔记片段不属于当前研究库，或已经归档。')
      const anchor = safeJson(row.anchor_json, {})
      return {
        evidenceType,
        entityId,
        fragmentId: row.id,
        sourceId: row.source_id || undefined,
        itemId: row.bibliographic_item_id || undefined,
        label: suppliedLabel || row.item_title || row.source_name || '研究库片段',
        excerpt: String(row.content || '').slice(0, 4000),
        pageNumber: anchor.pageNumber == null ? undefined : positiveIntegerOrUndefined(anchor.pageNumber, '证据页码'),
        anchor,
      }
    }
    if (evidenceType === 'review') {
      const row = this.database.prepare(`
        SELECT rb.id, rb.document_id, rb.content, rd.title
        FROM review_blocks rb
        JOIN review_documents rd ON rd.id = rb.document_id
        WHERE rb.id = ? AND rd.project_id = ?
      `).get(entityId, this.current.projectId)
      if (!row) throw new Error('行动引用的复查区块不属于当前研究库。')
      return {
        evidenceType,
        entityId,
        reviewBlockId: row.id,
        reviewDocumentId: row.document_id,
        label: suppliedLabel || row.title,
        excerpt: String(row.content || '').slice(0, 4000),
      }
    }
    if (evidenceType === 'milestone') {
      const row = this.database.prepare(`
        SELECT id, title, description, status, acceptance_criteria_json
        FROM research_milestones
        WHERE id = ? AND project_id = ? AND status != 'archived'
      `).get(entityId, this.current.projectId)
      if (!row) throw new Error('行动引用的里程碑不属于当前研究库，或已经归档。')
      const criteria = safeJson(row.acceptance_criteria_json, [])
      return {
        evidenceType,
        entityId,
        milestoneId: row.id,
        label: suppliedLabel || row.title,
        excerpt: suppliedExcerpt || [row.description, ...criteria].filter(Boolean).join('；').slice(0, 4000) || `${row.title}（${row.status}）`,
      }
    }
    if (evidenceType === 'run') {
      const row = this.database.prepare(`
        SELECT id, title, purpose, outcome, observations, anomaly, next_step
        FROM research_runs WHERE id = ? AND project_id = ?
      `).get(entityId, this.current.projectId)
      if (!row) throw new Error('行动引用的测试不属于当前研究库。')
      return {
        evidenceType,
        entityId,
        runId: row.id,
        label: suppliedLabel || row.title,
        excerpt: suppliedExcerpt || [row.purpose, row.observations, row.anomaly, row.next_step]
          .filter(Boolean).join('；').slice(0, 4000) || `${row.title}（${row.outcome}）`,
      }
    }
    if (evidenceType === 'source') {
      const sourceId = String(input.sourceId || entityId).trim()
      const row = this.database.prepare(`
        SELECT id, bibliographic_item_id, name, extracted_text, derived_markdown
        FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('行动引用的资料不属于当前研究库，或已经归档。')
      const excerpt = suppliedExcerpt || String(row.derived_markdown || row.extracted_text || row.name).slice(0, 4000)
      return {
        evidenceType,
        entityId,
        sourceId: row.id,
        itemId: row.bibliographic_item_id || undefined,
        label: suppliedLabel || row.name,
        excerpt,
        pageNumber: input.pageNumber == null ? undefined : positiveIntegerOrUndefined(input.pageNumber, '证据页码'),
        anchor: input.anchor && typeof input.anchor === 'object' ? input.anchor : undefined,
      }
    }
    const itemId = String(input.itemId || entityId).trim()
    const row = this.database.prepare(`
      SELECT id, title, abstract FROM bibliographic_items
      WHERE id = ? AND project_id = ? AND archived_at IS NULL
    `).get(itemId, this.current.projectId)
    if (!row) throw new Error('行动引用的题录不属于当前研究库，或已经归档。')
    return {
      evidenceType,
      entityId,
      itemId: row.id,
      label: suppliedLabel || row.title,
      excerpt: suppliedExcerpt || String(row.abstract || row.title).slice(0, 4000),
    }
  }

  #insertActionEvidence(actionItemId, evidence, timestamp) {
    const excerptSha256 = crypto.createHash('sha256').update(evidence.excerpt).digest('hex')
    if (evidence.evidenceType === 'milestone' || evidence.evidenceType === 'run') {
      this.database.prepare(`
        INSERT INTO action_item_research_evidence(
          id, action_item_id, evidence_type, entity_id, milestone_id, run_id,
          label, excerpt, excerpt_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        actionItemId,
        evidence.evidenceType,
        evidence.entityId,
        evidence.milestoneId || null,
        evidence.runId || null,
        evidence.label,
        evidence.excerpt,
        excerptSha256,
        timestamp,
      )
      return
    }
    this.database.prepare(`
      INSERT INTO action_item_evidence(
        id, action_item_id, evidence_type, entity_id, fragment_id, review_block_id,
        review_document_id, source_id, item_id, label, excerpt, excerpt_sha256,
        page_number, anchor_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      actionItemId,
      evidence.evidenceType,
      evidence.entityId,
      evidence.fragmentId || null,
      evidence.reviewBlockId || null,
      evidence.reviewDocumentId || null,
      evidence.sourceId || null,
      evidence.itemId || null,
      evidence.label,
      evidence.excerpt,
      excerptSha256,
      evidence.pageNumber || null,
      evidence.anchor ? JSON.stringify(evidence.anchor) : null,
      timestamp,
    )
  }

  #actionEvidenceForItem(actionItemId) {
    const libraryEvidence = this.database.prepare(`
      SELECT id, evidence_type, entity_id, fragment_id, review_block_id,
             review_document_id, source_id, item_id, label, excerpt,
             page_number, anchor_json, created_at
      FROM action_item_evidence
      WHERE action_item_id = ? ORDER BY rowid
    `).all(actionItemId).map(evidence => ({
      id: evidence.id,
      evidenceType: evidence.evidence_type,
      entityId: evidence.entity_id,
      fragmentId: evidence.fragment_id ?? undefined,
      reviewBlockId: evidence.review_block_id ?? undefined,
      reviewDocumentId: evidence.review_document_id ?? undefined,
      sourceId: evidence.source_id ?? undefined,
      itemId: evidence.item_id ?? undefined,
      label: evidence.label,
      excerpt: evidence.excerpt,
      pageNumber: evidence.page_number ?? undefined,
      anchor: evidence.anchor_json ? JSON.parse(evidence.anchor_json) : undefined,
      createdAt: evidence.created_at,
    }))
    const researchEvidence = this.database.prepare(`
      SELECT id, evidence_type, entity_id, milestone_id, run_id, label, excerpt, created_at
      FROM action_item_research_evidence
      WHERE action_item_id = ? ORDER BY rowid
    `).all(actionItemId).map(evidence => ({
      id: evidence.id,
      evidenceType: evidence.evidence_type,
      entityId: evidence.entity_id,
      milestoneId: evidence.milestone_id ?? undefined,
      runId: evidence.run_id ?? undefined,
      label: evidence.label,
      excerpt: evidence.excerpt,
      createdAt: evidence.created_at,
    }))
    return [...libraryEvidence, ...researchEvidence]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(({ createdAt: _createdAt, ...evidence }) => evidence)
  }

  #appendActionPackEvent({ packId, itemId, eventType, actor, note = '', timestamp = now() }) {
    this.database.prepare(`
      INSERT INTO action_pack_events(id, pack_id, item_id, event_type, actor, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), packId, itemId || null, eventType, actor, String(note || '').slice(0, 1000), timestamp)
  }

  #refreshActionPackStatus(packId, timestamp) {
    const pack = this.database.prepare(`
      SELECT status, confirmed_at, completed_at FROM action_packs WHERE id = ?
    `).get(packId)
    const counts = this.database.prepare(`
      SELECT count(*) AS total,
             sum(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) AS proposed,
             sum(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
             sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM action_items WHERE pack_id = ?
    `).get(packId)
    const total = Number(counts.total || 0)
    const proposed = Number(counts.proposed || 0)
    const dismissed = Number(counts.dismissed || 0)
    const completed = Number(counts.completed || 0)
    const actionable = total - dismissed
    const nextStatus = actionable === 0
      ? 'dismissed'
      : completed === actionable
        ? 'completed'
        : proposed === 0
          ? 'confirmed'
          : 'draft'
    const confirmedAt = ['confirmed', 'completed'].includes(nextStatus) ? pack.confirmed_at || timestamp : pack.confirmed_at
    const completedAt = nextStatus === 'completed' ? pack.completed_at || timestamp : null
    this.database.prepare(`
      UPDATE action_packs
      SET status = ?, updated_at = ?, confirmed_at = ?, completed_at = ?
      WHERE id = ?
    `).run(nextStatus, timestamp, confirmedAt || null, completedAt, packId)
    if (pack.status !== nextStatus) {
      this.#appendActionPackEvent({
        packId,
        eventType: 'pack_status_changed',
        actor: 'system',
        note: `${pack.status} → ${nextStatus}`,
        timestamp,
      })
    }
  }

  #insertReviewBlock({ id, documentId, position, blockType, content, sourceFragmentId, unsupported = false }) {
    const contentSha256 = crypto.createHash('sha256').update(content).digest('hex')
    this.database.prepare(`
      INSERT INTO review_blocks(
        id, document_id, position, block_type, content, content_sha256,
        source_fragment_id, unsupported
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      documentId,
      position,
      blockType,
      content,
      contentSha256,
      sourceFragmentId || null,
      unsupported ? 1 : 0,
    )
  }

  #insertFragmentRelation({
    id,
    fromFragmentId,
    toFragmentId,
    relation,
    createdBy,
    status,
    rationale = '',
    timestamp,
    eventActor,
  }) {
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO fragment_relations(
        id, from_fragment_id, to_fragment_id, relation, created_at,
        created_by, status, rationale, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      fromFragmentId,
      toFragmentId,
      relation,
      timestamp,
      createdBy,
      status,
      String(rationale || '').slice(0, 1000),
      status === 'confirmed' ? timestamp : null,
    )
    if (result.changes) {
      this.#appendFragmentRelationEvent({
        relationId: id,
        eventType: status === 'proposed' ? 'proposed' : 'created',
        actor: eventActor || createdBy,
        rationale,
        timestamp,
      })
    }
    return result
  }

  #appendFragmentRelationEvent({ relationId, eventType, actor, rationale = '', timestamp = now() }) {
    this.database.prepare(`
      INSERT INTO fragment_relation_events(
        id, relation_id, event_type, actor, rationale, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      relationId,
      eventType,
      actor,
      String(rationale || '').slice(0, 1000),
      timestamp,
    )
  }

  #insertReviewCitation(blockId, fragment, itemTitle) {
    const pageNumber = fragment.anchor?.pageNumber
    const label = pageNumber ? `${itemTitle}，第 ${pageNumber} 页` : `${itemTitle}，位置待核对`
    this.database.prepare(`
      INSERT INTO review_citations(
        id, block_id, item_id, source_id, fragment_id, page_number,
        anchor_json, quoted_text_sha256, label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      blockId,
      fragment.bibliographicItemId,
      fragment.sourceId,
      fragment.id,
      pageNumber || null,
      JSON.stringify(fragment.anchor),
      fragment.origin === 'source_evidence' ? fragment.contentSha256 : null,
      label,
    )
  }

  #searchableItems() {
    const items = this.loadLibraryState().bibliographicItems
    const fragmentPurposeRows = this.database.prepare(`
      SELECT bibliographic_item_id, purpose_tags_json
      FROM note_fragments
      WHERE project_id = ? AND bibliographic_item_id IS NOT NULL
    `).all(this.current.projectId)
    const fragmentPurposes = new Map()
    for (const row of fragmentPurposeRows) {
      const current = fragmentPurposes.get(row.bibliographic_item_id) || new Set()
      for (const tag of JSON.parse(row.purpose_tags_json)) current.add(tag)
      fragmentPurposes.set(row.bibliographic_item_id, current)
    }
    return items.map(item => ({
      ...item,
      searchablePurposeTags: [
        ...new Set([
          ...item.readingState.purposeTags,
          ...(fragmentPurposes.get(item.id) || []),
        ]),
      ],
    }))
  }

  #ensureSearchIndex() {
    const state = this.database.prepare(
      'SELECT dirty, indexed_at FROM search_index_state WHERE project_id = ?',
    ).get(this.current.projectId)
    if (state && !state.dirty) return

    const insert = this.database.prepare(`
      INSERT INTO library_search_fts(
        project_id, entity_type, entity_id, source_id, item_id, item_ids_json,
        review_document_id, page_number, anchor_json, origin,
        title, subtitle, body, tags, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const add = row => insert.run(
      this.current.projectId,
      row.entityType,
      row.entityId,
      row.sourceId || '',
      row.itemId || '',
      JSON.stringify(row.itemIds || (row.itemId ? [row.itemId] : [])),
      row.reviewDocumentId || '',
      row.pageNumber ? String(row.pageNumber) : '',
      row.anchor ? JSON.stringify(row.anchor) : '',
      row.origin,
      row.title || '',
      row.subtitle || '',
      row.body || '',
      row.tags || '',
      row.metadata || '',
    )

    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM library_search_fts WHERE project_id = ?').run(this.current.projectId)
      const itemRows = this.database.prepare(`
        SELECT b.id, b.title, b.item_type, b.authors_json, b.issued, b.container_title,
               b.abstract, b.keywords_json, b.identifiers_json,
               rs.reading_status, rs.relevance, rs.idea_state, rs.question_state,
               rs.purpose_tags_json, rs.decision_note,
               (
                 SELECT s.id FROM sources s
                 WHERE s.bibliographic_item_id = b.id AND s.archived_at IS NULL
                 ORDER BY s.updated_at DESC LIMIT 1
               ) AS source_id
        FROM bibliographic_items b
        LEFT JOIN bibliographic_reading_states rs ON rs.item_id = b.id
        WHERE b.project_id = ? AND b.archived_at IS NULL
      `).all(this.current.projectId)
      for (const row of itemRows) {
        const authors = JSON.parse(row.authors_json).map(personNameText).filter(Boolean)
        const keywords = JSON.parse(row.keywords_json)
        const identifiers = JSON.parse(row.identifiers_json)
        const purposeTags = row.purpose_tags_json ? JSON.parse(row.purpose_tags_json) : []
        const readingStatus = row.reading_status || 'unread'
        const relevance = row.relevance || 'undecided'
        const ideaState = row.idea_state || 'undecided'
        const questionState = row.question_state || 'undecided'
        add({
          entityType: 'paper',
          entityId: row.id,
          sourceId: row.source_id,
          itemId: row.id,
          origin: 'bibliography',
          title: row.title,
          subtitle: [authors.join('；'), row.issued, row.container_title].filter(Boolean).join(' · '),
          body: row.abstract,
          tags: [
            ...keywords,
            ...purposeTags,
            readingStatus,
            READING_STATUS_LABELS[readingStatus],
            relevance,
            RELEVANCE_LABELS[relevance],
            ideaState,
            IDEA_STATE_LABELS[ideaState],
            questionState,
            QUESTION_STATE_LABELS[questionState],
            row.decision_note,
          ].filter(Boolean).join(' '),
          metadata: [row.item_type, ...flattenIdentifierValues(identifiers)].filter(Boolean).join(' '),
        })
      }

      const sourceRows = this.database.prepare(`
        SELECT id, bibliographic_item_id, name, kind, status, pages, extracted_text, derived_markdown
        FROM sources
        WHERE project_id = ? AND archived_at IS NULL
      `).all(this.current.projectId)
      for (const row of sourceRows) {
        if (!row.bibliographic_item_id) {
          add({
            entityType: 'source',
            entityId: row.id,
            sourceId: row.id,
            origin: 'source',
            title: row.name,
            subtitle: `${row.kind} · ${row.status}`,
            metadata: row.pages ? `${row.pages} 页` : '',
          })
        }
        if (row.extracted_text) {
          add({
            entityType: 'source',
            entityId: `${row.id}:document`,
            sourceId: row.id,
            itemId: row.bibliographic_item_id,
            origin: 'document',
            title: row.name,
            subtitle: '浏览器解析正文',
            body: row.extracted_text,
            metadata: row.kind,
          })
        }
        if (row.derived_markdown) {
          add({
            entityType: 'source',
            entityId: `${row.id}:mineru`,
            sourceId: row.id,
            itemId: row.bibliographic_item_id,
            origin: 'mineru',
            title: row.name,
            subtitle: '本地 MinerU Markdown',
            body: row.derived_markdown,
            metadata: row.kind,
          })
        }
      }

      const fragmentRows = this.database.prepare(`
        SELECT nf.id, nf.bibliographic_item_id, nf.source_id, nf.origin, nf.kind,
               nf.content, nf.purpose_tags_json, nf.anchor_json,
               bi.title AS item_title, s.name AS source_name, a.category
        FROM note_fragments nf
        LEFT JOIN bibliographic_items bi ON bi.id = nf.bibliographic_item_id
        LEFT JOIN sources s ON s.id = nf.source_id
        LEFT JOIN annotations a ON a.id = nf.annotation_id
        WHERE nf.project_id = ?
          AND (
            nf.annotation_id IS NULL
            OR (a.archived_at IS NULL AND (nf.origin != 'user' OR a.current_note_fragment_id = nf.id))
          )
      `).all(this.current.projectId)
      for (const row of fragmentRows) {
        const anchor = JSON.parse(row.anchor_json)
        add({
          entityType: 'fragment',
          entityId: row.id,
          sourceId: row.source_id,
          itemId: row.bibliographic_item_id,
          pageNumber: anchor.pageNumber,
          anchor,
          origin: row.origin,
          title: row.item_title || row.source_name || '未关联笔记',
          subtitle: [row.category, fragmentKindLabel(row.kind)].filter(Boolean).join(' · '),
          body: row.content,
          tags: JSON.parse(row.purpose_tags_json).join(' '),
          metadata: row.kind,
        })
      }

      const reviewItemRows = this.database.prepare(`
        SELECT document_id, item_id
        FROM review_document_items
      `).all()
      const reviewItems = new Map()
      for (const row of reviewItemRows) {
        const current = reviewItems.get(row.document_id) || []
        current.push(row.item_id)
        reviewItems.set(row.document_id, current)
      }
      const reviewRows = this.database.prepare(`
        SELECT rb.id, rb.document_id, rb.block_type, rb.content, rb.unsupported,
               rd.title, rd.status
        FROM review_blocks rb
        JOIN review_documents rd ON rd.id = rb.document_id
        WHERE rd.project_id = ?
      `).all(this.current.projectId)
      for (const row of reviewRows) {
        add({
          entityType: 'review',
          entityId: row.id,
          itemIds: reviewItems.get(row.document_id) || [],
          reviewDocumentId: row.document_id,
          origin: 'review',
          title: row.title,
          subtitle: reviewBlockTypeLabel(row.block_type),
          body: row.content,
          tags: [row.status, row.unsupported ? '无证据推断' : '可追溯'].join(' '),
          metadata: row.block_type,
        })
      }

      const previousIndexedAt = Date.parse(state?.indexed_at || '')
      const indexedAt = new Date(Math.max(
        Date.now(),
        Number.isFinite(previousIndexedAt) ? previousIndexedAt + 1 : 0,
      )).toISOString()
      this.database.prepare(`
        INSERT INTO search_index_state(project_id, dirty, indexed_at)
        VALUES (?, 0, ?)
        ON CONFLICT(project_id) DO UPDATE SET dirty = 0, indexed_at = excluded.indexed_at
      `).run(this.current.projectId, indexedAt)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  #appendAnnotationEvent(annotationId, eventType, fromValue, toValue, timestamp) {
    this.database.prepare(`
      INSERT INTO annotation_events(id, annotation_id, event_type, from_value, to_value, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      annotationId,
      eventType,
      fromValue == null ? null : String(fromValue),
      toValue == null ? null : String(toValue),
      timestamp,
    )
  }

  #resolveResearchTaskSource(sourceType, sourceId, sourceRole = 'primary') {
    if (sourceType === 'paper') {
      const row = this.database.prepare(`
        SELECT b.id, b.title, rs.reading_status, rs.last_page,
               (SELECT s.id FROM sources s WHERE s.bibliographic_item_id = b.id AND s.archived_at IS NULL ORDER BY s.updated_at DESC LIMIT 1) AS source_id
        FROM bibliographic_items b
        LEFT JOIN bibliographic_reading_states rs ON rs.item_id = b.id
        WHERE b.id = ? AND b.project_id = ? AND b.archived_at IS NULL
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('任务来源论文不存在或不属于当前课题。')
      return {
        title: `继续阅读：${row.title}`,
        detail: row.last_page ? `上次读到第 ${row.last_page} 页。` : '阅读位置尚未形成页码。',
        returnTarget: { view: 'reader', itemId: row.id, sourceId: row.source_id || undefined, pageNumber: row.last_page || undefined },
        sourceSnapshot: { title: row.title, readingStatus: row.reading_status || 'unread', lastPage: row.last_page || undefined },
      }
    }
    if (sourceType === 'annotation') {
      const row = this.database.prepare(`
        SELECT a.id, a.category, a.anchor_json, s.id AS source_id, s.name AS source_name,
               b.id AS item_id, b.title AS paper_title,
               quote.content AS quote_text, note.content AS note_text
        FROM annotations a
        LEFT JOIN sources s ON s.id = a.source_id
        LEFT JOIN bibliographic_items b ON b.id = s.bibliographic_item_id
        LEFT JOIN note_fragments quote ON quote.annotation_id = a.id AND quote.origin = 'source_evidence'
        LEFT JOIN note_fragments note ON note.id = a.current_note_fragment_id AND note.origin = 'user'
        WHERE a.id = ? AND a.project_id = ? AND a.archived_at IS NULL
        ORDER BY quote.created_at LIMIT 1
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('任务来源批注不存在或不属于当前课题。')
      const anchor = safeJson(row.anchor_json, {})
      return {
        title: `处理批注：${compactEvidenceText(row.note_text || row.quote_text || row.category, 160)}`,
        detail: row.note_text || row.quote_text || '',
        returnTarget: { view: 'reader', annotationId: row.id, sourceId: row.source_id || undefined, itemId: row.item_id || undefined, pageNumber: anchor.pageNumber },
        sourceSnapshot: { category: row.category, quote: row.quote_text || '', note: row.note_text || '', anchor },
      }
    }
    if (sourceType === 'run' || sourceType === 'anomaly') {
      const row = this.database.prepare(`
        SELECT id, title, outcome, observations, anomaly, next_step, started_at
        FROM research_runs WHERE id = ? AND project_id = ?
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('任务来源 Run 不存在或不属于当前课题。')
      const anomaly = sourceType === 'anomaly' || sourceRole === 'anomaly'
      return {
        title: anomaly ? `处理异常：${row.title}` : row.next_step || `继续 Run：${row.title}`,
        detail: anomaly ? row.anomaly : row.observations || `来自 Run“${row.title}”的下一步。`,
        returnTarget: { view: 'research-workspace', runId: row.id },
        sourceSnapshot: { title: row.title, outcome: row.outcome, anomaly: row.anomaly, nextStep: row.next_step, startedAt: row.started_at },
      }
    }
    if (sourceType === 'milestone') {
      const row = this.database.prepare(`
        SELECT id, title, description, status, acceptance_criteria_json
        FROM research_milestones WHERE id = ? AND project_id = ?
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('任务来源里程碑不存在或不属于当前课题。')
      return {
        title: row.title,
        detail: row.description || safeJson(row.acceptance_criteria_json, []).join('；'),
        returnTarget: { view: 'research-workspace', milestoneId: row.id },
        sourceSnapshot: { title: row.title, status: row.status, acceptanceCriteria: safeJson(row.acceptance_criteria_json, []) },
      }
    }
    if (sourceType === 'review_document') {
      const row = this.database.prepare(`
        SELECT id, title, status, updated_at FROM review_documents
        WHERE id = ? AND project_id = ?
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('任务来源复查文档不存在或不属于当前课题。')
      return {
        title: `复查文档：${row.title}`,
        detail: '检查证据、用户笔记与 AI 整理后再形成正式记录。',
        returnTarget: { view: 'dashboard', reviewDocumentId: row.id },
        sourceSnapshot: { title: row.title, status: row.status, updatedAt: row.updated_at },
      }
    }
    if (sourceType === 'ai_suggestion') {
      const row = this.database.prepare(`
        SELECT ai.id, ai.title, ai.rationale, ai.status, ai.action_type,
               ap.id AS pack_id, ap.title AS pack_title, ap.created_by
        FROM action_items ai JOIN action_packs ap ON ap.id = ai.pack_id
        WHERE ai.id = ? AND ap.project_id = ?
      `).get(sourceId, this.current.projectId)
      if (!row) throw new Error('任务来源 AI 建议不存在或不属于当前课题。')
      return {
        title: row.title,
        detail: row.rationale,
        returnTarget: { view: 'actions', actionItemId: row.id, actionPackId: row.pack_id },
        sourceSnapshot: { title: row.title, rationale: row.rationale, actionType: row.action_type, status: row.status, packTitle: row.pack_title },
      }
    }
    throw new Error('科研任务来源类型无效。')
  }

  #syncLegacyResearchTasks() {
    const seeds = []
    for (const row of this.database.prepare(`
      SELECT ai.id, ai.title, ai.rationale, ai.status, ai.action_type, ai.created_at, ai.updated_at,
             ap.id AS pack_id, ap.title AS pack_title, ap.created_by
      FROM action_items ai JOIN action_packs ap ON ap.id = ai.pack_id
      WHERE ap.project_id = ?
    `).all(this.current.projectId)) {
      seeds.push({
        sourceType: 'ai_suggestion', sourceId: row.id, sourceRole: 'primary', title: row.title, detail: row.rationale,
        status: taskStatusFromActionItem(row.status), origin: row.created_by, approvalStatus: taskApprovalFromActionItem(row.status),
        isFormal: ['confirmed', 'completed'].includes(row.status), syncStatus: true,
        returnTarget: { view: 'actions', actionItemId: row.id, actionPackId: row.pack_id },
        sourceSnapshot: { title: row.title, rationale: row.rationale, actionType: row.action_type, status: row.status, packTitle: row.pack_title },
        createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    for (const row of this.database.prepare(`
      SELECT id, title, description, status, acceptance_criteria_json, created_at, updated_at
      FROM research_milestones WHERE project_id = ?
    `).all(this.current.projectId)) {
      seeds.push({
        sourceType: 'milestone', sourceId: row.id, sourceRole: 'primary', title: row.title,
        detail: row.description || safeJson(row.acceptance_criteria_json, []).join('；'), status: taskStatusFromMilestone(row.status),
        origin: 'user', approvalStatus: 'not_required', isFormal: true, syncStatus: true,
        returnTarget: { view: 'research-workspace', milestoneId: row.id },
        sourceSnapshot: { title: row.title, status: row.status, acceptanceCriteria: safeJson(row.acceptance_criteria_json, []) },
        createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    for (const row of this.database.prepare(`
      SELECT id, title, outcome, observations, anomaly, next_step, started_at, created_at, updated_at
      FROM research_runs WHERE project_id = ?
    `).all(this.current.projectId)) {
      if (row.next_step) seeds.push({
        sourceType: 'run', sourceId: row.id, sourceRole: 'next_step', title: row.next_step,
        detail: `来自 Run“${row.title}”的下一步。`,
        status: row.outcome === 'running' ? 'today' : row.outcome === 'planned' ? 'later' : 'inbox',
        origin: 'user', approvalStatus: 'not_required', isFormal: true, syncStatus: false,
        returnTarget: { view: 'research-workspace', runId: row.id },
        sourceSnapshot: { title: row.title, outcome: row.outcome, nextStep: row.next_step, startedAt: row.started_at },
        createdAt: row.created_at, updatedAt: row.updated_at,
      })
      if (row.anomaly) seeds.push({
        sourceType: 'anomaly', sourceId: row.id, sourceRole: 'anomaly', title: `处理异常：${row.title}`, detail: row.anomaly,
        status: 'waiting', origin: 'user', approvalStatus: 'not_required', isFormal: true, syncStatus: false,
        waitCondition: '需要人工定位异常原因或记录合法科研结果。',
        returnTarget: { view: 'research-workspace', runId: row.id },
        sourceSnapshot: { title: row.title, outcome: row.outcome, anomaly: row.anomaly, startedAt: row.started_at },
        createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    for (const row of this.database.prepare(`
      SELECT b.id, b.title, b.created_at, b.updated_at, rs.reading_status, rs.last_page,
             (SELECT s.id FROM sources s WHERE s.bibliographic_item_id = b.id AND s.archived_at IS NULL ORDER BY s.updated_at DESC LIMIT 1) AS source_id
      FROM bibliographic_items b
      JOIN bibliographic_reading_states rs ON rs.item_id = b.id
      WHERE b.project_id = ? AND b.archived_at IS NULL AND rs.reading_status != 'unread'
    `).all(this.current.projectId)) {
      seeds.push({
        sourceType: 'paper', sourceId: row.id, sourceRole: 'continue_reading', title: `继续阅读：${row.title}`,
        detail: row.last_page ? `上次读到第 ${row.last_page} 页。` : '阅读位置尚未形成页码。', status: taskStatusFromReading(row.reading_status),
        origin: 'user', approvalStatus: 'not_required', isFormal: true, syncStatus: true,
        returnTarget: { view: 'reader', itemId: row.id, sourceId: row.source_id || undefined, pageNumber: row.last_page || undefined },
        sourceSnapshot: { title: row.title, readingStatus: row.reading_status, lastPage: row.last_page || undefined },
        createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    for (const row of this.database.prepare(`
      SELECT id, title, status, created_at, updated_at FROM review_documents WHERE project_id = ?
    `).all(this.current.projectId)) {
      seeds.push({
        sourceType: 'review_document', sourceId: row.id, sourceRole: 'review', title: `复查文档：${row.title}`,
        detail: '检查证据、用户笔记与 AI 整理后再形成正式记录。', status: row.status === 'draft' ? 'inbox' : 'completed',
        origin: 'user', approvalStatus: 'not_required', isFormal: true, syncStatus: true,
        returnTarget: { view: 'dashboard', reviewDocumentId: row.id },
        sourceSnapshot: { title: row.title, status: row.status }, createdAt: row.created_at, updatedAt: row.updated_at,
      })
    }
    if (!seeds.length) return
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const seed of seeds) this.#upsertLegacyResearchTask(seed)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  #upsertLegacyResearchTask(seed) {
    const existing = this.database.prepare(`
      SELECT * FROM research_tasks
      WHERE project_id = ? AND source_type = ? AND source_id = ? AND source_role = ?
    `).get(this.current.projectId, seed.sourceType, seed.sourceId, seed.sourceRole)
    if (existing) {
      this.database.prepare(`
        UPDATE research_tasks SET
          title = ?, detail = ?, status = ?, origin = ?, approval_status = ?, is_formal = ?,
          wait_condition = CASE WHEN wait_condition = '' THEN ? ELSE wait_condition END,
          return_target_json = ?, source_snapshot_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        seed.title.slice(0, 240), String(seed.detail || '').slice(0, 10000), seed.syncStatus ? seed.status : existing.status,
        seed.origin, seed.approvalStatus, seed.isFormal ? 1 : 0, String(seed.waitCondition || '').slice(0, 4000),
        JSON.stringify(seed.returnTarget || {}), JSON.stringify(seed.sourceSnapshot || {}), seed.updatedAt || now(), existing.id,
      )
      return existing.id
    }
    const taskId = legacyTaskId(seed.sourceType, seed.sourceId, seed.sourceRole)
    this.database.prepare(`
      INSERT INTO research_tasks(
        id, project_id, title, detail, status, source_type, source_id, source_role,
        origin, approval_status, is_formal, wait_condition, deferred_until,
        return_target_json, source_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      taskId, this.current.projectId, seed.title.slice(0, 240), String(seed.detail || '').slice(0, 10000), seed.status,
      seed.sourceType, seed.sourceId, seed.sourceRole, seed.origin, seed.approvalStatus, seed.isFormal ? 1 : 0,
      String(seed.waitCondition || '').slice(0, 4000), JSON.stringify(seed.returnTarget || {}), JSON.stringify(seed.sourceSnapshot || {}),
      seed.createdAt || now(), seed.updatedAt || now(),
    )
    this.#appendResearchTaskEvent({
      taskId, eventType: 'legacy_synced', toStatus: seed.status, actor: 'system',
      note: `兼容映射 ${seed.sourceType}:${seed.sourceId}:${seed.sourceRole}`, timestamp: seed.updatedAt || now(),
    })
    return taskId
  }

  #writeBackResearchTaskSource(task, nextStatus, timestamp) {
    if (!task.source_id || task.source_type === 'manual' || task.source_type === 'annotation' || task.source_type === 'run' || task.source_type === 'anomaly') return
    if (task.source_type === 'ai_suggestion') {
      if (nextStatus === 'completed') {
        this.completeActionItem({ itemId: task.source_id })
      } else if (nextStatus === 'abandoned') {
        const item = this.database.prepare(`
          SELECT ai.pack_id, ai.status FROM action_items ai
          JOIN action_packs ap ON ap.id = ai.pack_id
          WHERE ai.id = ? AND ap.project_id = ?
        `).get(task.source_id, this.current.projectId)
        if (!item) throw new Error('AI 建议来源已不可用。')
        if (item.status !== 'completed') {
          this.database.prepare("UPDATE action_items SET status = 'dismissed', updated_at = ? WHERE id = ?").run(timestamp, task.source_id)
          this.#appendActionPackEvent({ packId: item.pack_id, itemId: task.source_id, eventType: 'item_dismissed', actor: 'user', note: '从统一科研任务标记为已放弃。', timestamp })
          this.#refreshActionPackStatus(item.pack_id, timestamp)
        }
      }
      return
    }
    if (task.source_type === 'milestone') {
      const milestoneStatus = milestoneStatusFromTask(nextStatus)
      this.database.prepare(`
        UPDATE research_milestones
        SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END,
            updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(milestoneStatus, milestoneStatus, timestamp, timestamp, task.source_id, this.current.projectId)
      return
    }
    if (task.source_type === 'paper' && nextStatus === 'completed') {
      this.updateReadingState({ itemId: task.source_id, readingStatus: 'finished' })
      return
    }
    if (task.source_type === 'review_document' && nextStatus === 'completed') {
      this.database.prepare(`
        UPDATE review_documents SET status = CASE WHEN status = 'draft' THEN 'reviewed' ELSE status END, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(timestamp, task.source_id, this.current.projectId)
    }
  }

  #appendResearchTaskEvent({ taskId, eventType, fromStatus, toStatus, actor, note = '', timestamp = now() }) {
    this.database.prepare(`
      INSERT INTO research_task_events(
        id, task_id, project_id, event_type, from_status, to_status, actor, note, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), taskId, this.current.projectId, eventType,
      fromStatus || null, toStatus || null, actor, String(note || '').slice(0, 2000), timestamp,
    )
  }

  #appendResearchResumeEvent(eventType, state, timestamp = now()) {
    this.database.prepare(`
      INSERT INTO research_resume_events(id, project_id, event_type, state_json, occurred_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      this.current.projectId,
      eventType,
      JSON.stringify(state),
      timestamp,
    )
  }

  #requireOpen() {
    if (!this.database || !this.current) throw new Error('请先创建或打开研究库。')
  }

  #readRegistry() {
    try {
      const parsed = readJson(this.registryPath)
      return {
        currentId: typeof parsed.currentId === 'string' ? parsed.currentId : undefined,
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      }
    } catch {
      return { currentId: undefined, recent: [] }
    }
  }

  #writeRegistry(registry) {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true })
    writeJsonAtomic(this.registryPath, registry)
  }

  #remember(vault) {
    const registry = this.#readRegistry()
    const recent = registry.recent.filter(entry => entry.id !== vault.id)
    recent.unshift({
      id: vault.id,
      name: vault.name,
      path: vault.path,
      updatedAt: now(),
    })
    this.#writeRegistry({
      currentId: vault.id,
      recent: recent.slice(0, 12),
    })
  }
}

function buildPaperReadingCardContexts({ paper, sources, fragments }) {
  const contexts = []
  const primarySource = sources[0]
  if (String(paper.abstract || '').trim()) {
    contexts.push({
      contextId: `bibliography:${paper.id}:abstract`,
      origin: 'bibliography',
      label: '题录摘要',
      content: String(paper.abstract).trim().slice(0, 6000),
      sourceId: primarySource?.id,
      anchor: { type: 'text', state: 'unresolved' },
    })
  }
  const state = paper.readingState || defaultReadingState()
  const stateContent = [
    `阅读阶段：${READING_STATUS_LABELS[state.readingStatus] || state.readingStatus}`,
    `相关性：${RELEVANCE_LABELS[state.relevance] || state.relevance}`,
    `想法：${IDEA_STATE_LABELS[state.ideaState] || state.ideaState}`,
    `疑问：${QUESTION_STATE_LABELS[state.questionState] || state.questionState}`,
    `研究用途：${state.purposeTags?.length ? state.purposeTags.join('、') : '未标记'}`,
    `读后判断：${state.decisionNote || '未填写'}`,
  ].join('；')
  contexts.push({
    contextId: `user-state:${paper.id}`,
    origin: 'user_state',
    label: '用户阅读状态',
    content: stateContent,
    sourceId: primarySource?.id,
    anchor: { type: 'text', state: 'unresolved' },
  })
  for (const fragment of fragments) {
    const anchor = JSON.parse(fragment.anchor_json || '{}')
    contexts.push({
      contextId: `fragment:${fragment.id}`,
      origin: fragment.origin,
      label: fragment.origin === 'user' ? '用户笔记' : '原文证据',
      content: String(fragment.content || '').slice(0, 6000),
      sourceId: fragment.source_id ?? undefined,
      fragmentId: fragment.id,
      pageNumber: Number.isInteger(Number(anchor.pageNumber)) ? Number(anchor.pageNumber) : undefined,
      anchor,
    })
  }
  for (const source of sources) {
    const documentText = String(source.derived_markdown || source.extracted_text || '').trim()
    if (!documentText) continue
    const sourceContentSha256 = crypto.createHash('sha256').update(documentText).digest('hex')
    academicTextChunks(documentText).forEach((content, index) => {
      const chunkHash = crypto.createHash('sha256').update(content).digest('hex')
      contexts.push({
        contextId: `document:${source.id}:${chunkHash.slice(0, 20)}`,
        origin: 'document',
        label: `${source.derived_markdown ? 'MinerU Markdown' : '本地解析正文'} · 片段 ${index + 1}`,
        content,
        sourceId: source.id,
        anchor: {
          type: source.derived_markdown ? 'markdown' : 'text',
          state: 'unresolved',
          sourceContentSha256,
        },
      })
    })
  }
  return contexts.slice(0, 36)
}

function readingCardContextAllowedForSection(sectionKey, origin) {
  if (['problem', 'method', 'findings', 'limitations'].includes(sectionKey)) {
    return ['source_evidence', 'document', 'bibliography'].includes(origin)
  }
  if (sectionKey === 'user_notes') return ['user', 'user_state'].includes(origin)
  return true
}

function academicTextChunks(value, maximumLength = 1600, maximumChunks = 24) {
  const blocks = String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
  const chunks = []
  let current = ''
  const flush = () => {
    if (current) chunks.push(current)
    current = ''
  }
  for (const block of blocks) {
    const pieces = block.length > maximumLength
      ? Array.from({ length: Math.ceil(block.length / maximumLength) }, (_, index) => block.slice(index * maximumLength, (index + 1) * maximumLength))
      : [block]
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > maximumLength) flush()
      current = current ? `${current}\n\n${piece}` : piece
      if (chunks.length >= maximumChunks) return chunks
    }
  }
  flush()
  return chunks.slice(0, maximumChunks)
}

function parseLegacyPage(value) {
  const match = String(value || '').match(/(?:第\s*)?(\d+)(?:\s*页)?/)
  const page = match ? Number.parseInt(match[1], 10) : undefined
  return Number.isInteger(page) && page > 0 ? page : undefined
}

function resolveAttachment(pathOriginal, importDirectory) {
  const original = String(pathOriginal || '').trim()
  if (!original) return { existsState: 'unknown' }
  if (/^internal-(?:pdf|image|text):\/\//i.test(original) || /^https?:\/\//i.test(original)) {
    return { existsState: 'unknown' }
  }
  let candidate
  try {
    candidate = /^file:/i.test(original)
      ? fileURLToPath(original)
      : path.isAbsolute(original)
        ? original
        : path.resolve(importDirectory, original)
    fs.accessSync(candidate, fs.constants.R_OK)
    return { pathResolved: candidate, existsState: 'found' }
  } catch (error) {
    return {
      pathResolved: candidate,
      existsState: error?.code === 'EACCES' || error?.code === 'EPERM' ? 'denied' : 'missing',
    }
  }
}

function defaultReadingState() {
  return {
    readingStatus: 'unread',
    relevance: 'undecided',
    ideaState: 'undecided',
    questionState: 'undecided',
    purposeTags: [],
    decisionNote: '',
    lastPage: undefined,
    totalPages: undefined,
  }
}

function readingStateFromRow(row) {
  return {
    readingStatus: row.reading_status,
    relevance: row.relevance,
    ideaState: row.idea_state,
    questionState: row.question_state,
    purposeTags: JSON.parse(row.purpose_tags_json),
    decisionNote: row.decision_note || '',
    lastPage: row.last_page ?? undefined,
    totalPages: row.total_pages ?? undefined,
  }
}

function validateEnum(value, allowed, label) {
  const normalized = String(value)
  if (!allowed.has(normalized)) throw new Error(`${label}取值无效。`)
  return normalized
}

function normalizeActionText(value, label, maximumLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maximumLength) throw new Error(`${label}不能超过 ${maximumLength} 个字符。`)
  return normalized
}

function normalizeActionScope(value) {
  const input = value && typeof value === 'object' ? value : {}
  const kind = ['current', 'selected', 'library'].includes(input.kind) ? input.kind : 'library'
  return {
    kind,
    label: String(input.label || '').trim().slice(0, 200),
    itemIds: uniqueStrings(input.itemIds).slice(0, 200),
  }
}

function normalizePurposeTags(value) {
  if (!Array.isArray(value)) throw new Error('研究用途必须是标签列表。')
  return [...new Set(value.map(tag => String(tag).trim()).filter(Boolean))]
    .map(tag => tag.slice(0, 80))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .slice(0, 30)
}

function positiveIntegerOrUndefined(value, label) {
  if (value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label}必须是正整数。`)
  return number
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item).trim()).filter(Boolean))]
}

function safeJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeEvidenceRationale(value) {
  const rationale = String(value || '').replace(/\s+/g, ' ').trim()
  if (rationale.length < 4) throw new Error('请用至少 4 个字说明为什么建立这条关系。')
  if (rationale.length > 1000) throw new Error('关系说明不能超过 1000 个字符。')
  return rationale
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase()
}

function searchTerms(value) {
  return [...new Set(normalizeSearchText(value).split(/\s+/).map(term => term.trim()).filter(Boolean))]
}

function ftsPhrase(term) {
  return `"${String(term).replaceAll('"', '""')}"`
}

function normalizeEnumFilter(value, allowed, label) {
  const values = uniqueStrings(value)
  for (const candidate of values) {
    if (!allowed.has(candidate)) throw new Error(`${label}筛选值无效。`)
  }
  return values
}

function normalizeSearchFilters(value = {}) {
  const filters = value && typeof value === 'object' ? value : {}
  return {
    itemIds: uniqueStrings(filters.itemIds).slice(0, 200),
    readingStatuses: normalizeEnumFilter(filters.readingStatuses, READING_STATUS_VALUES, '阅读状态'),
    relevances: normalizeEnumFilter(filters.relevances, RELEVANCE_VALUES, '相关性'),
    ideaStates: normalizeEnumFilter(filters.ideaStates, IDEA_STATE_VALUES, '想法状态'),
    questionStates: normalizeEnumFilter(filters.questionStates, QUESTION_STATE_VALUES, '疑问状态'),
    purposeTags: uniqueStrings(filters.purposeTags).map(tag => tag.slice(0, 80)),
    origins: normalizeEnumFilter(filters.origins, SEARCH_ORIGIN_VALUES, '内容来源'),
    hasAnnotations: typeof filters.hasAnnotations === 'boolean' ? filters.hasAnnotations : undefined,
  }
}

function hasItemSearchFilters(filters) {
  return Boolean(
    filters.itemIds.length
    || filters.readingStatuses.length
    || filters.relevances.length
    || filters.ideaStates.length
    || filters.questionStates.length
    || filters.purposeTags.length
    || filters.hasAnnotations !== undefined
  )
}

function itemMatchesSearchFilters(item, filters) {
  const state = item.readingState
  if (filters.itemIds.length && !filters.itemIds.includes(item.id)) return false
  if (filters.readingStatuses.length && !filters.readingStatuses.includes(state.readingStatus)) return false
  if (filters.relevances.length && !filters.relevances.includes(state.relevance)) return false
  if (filters.ideaStates.length && !filters.ideaStates.includes(state.ideaState)) return false
  if (filters.questionStates.length && !filters.questionStates.includes(state.questionState)) return false
  if (filters.purposeTags.length && !filters.purposeTags.some(tag => item.searchablePurposeTags.includes(tag))) return false
  if (filters.hasAnnotations === true && !item.annotationCount) return false
  if (filters.hasAnnotations === false && item.annotationCount) return false
  return true
}

function searchRowItemIds(row) {
  try {
    const ids = JSON.parse(row.item_ids_json || '[]')
    return [...new Set([row.item_id, ...ids].filter(Boolean))]
  } catch {
    return row.item_id ? [row.item_id] : []
  }
}

function excerptAroundSearchTerms(value, terms, radius = 105) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  const normalized = normalizeSearchText(compact)
  const indexes = terms.map(term => normalized.indexOf(term)).filter(index => index >= 0)
  const matchIndex = indexes.length ? Math.min(...indexes) : 0
  const longestTerm = Math.max(...terms.map(term => term.length), 1)
  const start = Math.max(0, matchIndex - radius)
  const end = Math.min(compact.length, matchIndex + longestTerm + radius)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

function searchResultFromRow(row, terms) {
  const pageNumber = Number.parseInt(row.page_number || '', 10)
  let anchor
  try {
    anchor = row.anchor_json ? JSON.parse(row.anchor_json) : undefined
  } catch {
    anchor = undefined
  }
  const excerptSource = row.body || row.metadata || row.subtitle || row.title
  return {
    id: `${row.entity_type}:${row.entity_id}`,
    kind: row.entity_type,
    entityId: row.entity_id,
    origin: row.origin,
    originLabel: SEARCH_ORIGIN_LABELS[row.origin] || row.origin,
    title: row.title,
    subtitle: row.subtitle || undefined,
    excerpt: excerptAroundSearchTerms(excerptSource, terms),
    sourceId: row.source_id || undefined,
    itemId: row.item_id || undefined,
    reviewDocumentId: row.review_document_id || undefined,
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
    anchor,
  }
}

function buildSearchFacets(items) {
  const countValues = selector => {
    const counts = {}
    for (const item of items) {
      for (const value of selector(item)) counts[value] = (counts[value] || 0) + 1
    }
    return counts
  }
  return {
    readingStatuses: countValues(item => [item.readingState.readingStatus]),
    relevances: countValues(item => [item.readingState.relevance]),
    ideaStates: countValues(item => [item.readingState.ideaState]),
    questionStates: countValues(item => [item.readingState.questionState]),
    purposeTags: countValues(item => item.searchablePurposeTags),
    annotations: {
      withAnnotations: items.filter(item => item.annotationCount > 0).length,
      withoutAnnotations: items.filter(item => !item.annotationCount).length,
    },
  }
}

function personNameText(person) {
  if (!person || typeof person !== 'object') return ''
  return String(person.literal || [person.family, person.given].filter(Boolean).join(', ')).trim()
}

function normalizeSourceReaderState(value, kind) {
  const allowedModes = new Set(['original', 'markdown', 'parallel', 'bilingual'])
  const requestedMode = allowedModes.has(value?.viewMode) ? value.viewMode : 'original'
  const viewMode = kind === 'PDF' ? requestedMode : 'markdown'
  const requestedZoom = Number(value?.zoom)
  const zoom = Number.isFinite(requestedZoom)
    ? Math.max(.5, Math.min(3, Math.round(requestedZoom * 100) / 100))
    : 1
  return { viewMode, zoom }
}

function flattenIdentifierValues(identifiers) {
  if (!identifiers || typeof identifiers !== 'object') return []
  return Object.entries(identifiers).flatMap(([key, value]) => [
    key,
    ...(Array.isArray(value) ? value : [value]).map(entry => String(entry || '')).filter(Boolean),
  ])
}

function fragmentKindLabel(kind) {
  return {
    quote: '摘录',
    note: '笔记',
    translation: '翻译',
    question: '问题',
    answer: '回答',
    summary: '总结',
    figure_caption: '图注',
  }[kind] || kind
}

function reviewBlockTypeLabel(type) {
  return {
    heading: '复查结构',
    source_evidence: '复查中的原文证据',
    user_note: '复查中的用户笔记',
    ai_organization: '复查中的 AI 整理',
  }[type] || type
}

function compactEvidenceText(value, limit = 520) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text
}

function evidenceGraphNodeFromFragment(row) {
  const anchor = row.anchor && typeof row.anchor === 'object' ? row.anchor : {}
  const provenance = row.provenance && typeof row.provenance === 'object' ? row.provenance : {}
  const pageNumber = Number(anchor.pageNumber)
  const locationLabel = Number.isInteger(pageNumber) && pageNumber > 0
    ? `第 ${pageNumber} 页`
    : anchor.markdownBlockId
      ? `Markdown 段落 ${anchor.markdownBlockId}`
      : '位置待核对'
  const trust = row.origin === 'source_evidence'
    ? 'source'
    : row.origin === 'user'
      ? 'user'
      : provenance.status === 'accepted'
        ? 'ai_accepted'
        : 'ai_draft'
  const kindLabel = row.origin === 'source_evidence'
    ? '原文摘录'
    : row.origin === 'user'
      ? row.category || fragmentKindLabel(row.kind)
      : provenance.sectionTitle || 'AI 阅读卡'
  const title = row.origin === 'user'
    ? `我的批注 · ${row.item_title || row.source_name || '未关联论文'}`
    : row.origin === 'ai'
      ? `${kindLabel} · ${row.item_title || row.source_name || '未关联论文'}`
      : row.item_title || row.source_name || '原文证据'
  return {
    id: `fragment:${row.id}`,
    entityId: row.id,
    entityType: 'fragment',
    layer: row.origin === 'source_evidence' ? 'evidence' : row.origin === 'user' ? 'interpretation' : 'synthesis',
    origin: row.origin,
    trust,
    title,
    excerpt: compactEvidenceText(row.content),
    kindLabel,
    locationLabel,
    itemId: row.bibliographic_item_id || undefined,
    itemTitle: row.item_title || undefined,
    sourceId: row.source_id || undefined,
    sourceName: row.source_name || undefined,
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
    anchor,
  }
}

function evidenceGraphNodeFromReviewBlock(row) {
  return {
    id: `review-block:${row.id}`,
    entityId: row.id,
    entityType: 'review_block',
    layer: 'synthesis',
    origin: 'review',
    trust: row.unsupported ? 'unsupported' : 'ai_draft',
    title: `复查结论 · ${row.document_title}`,
    excerpt: compactEvidenceText(row.content),
    kindLabel: row.unsupported ? '无证据推断' : 'AI 整理',
    locationLabel: row.document_title,
    documentId: row.document_id,
    documentTitle: row.document_title,
  }
}

function evidenceRelationLabel(relation) {
  return {
    derived_from: '整理依据',
    comments_on: '批注于',
    supports: '支持',
    refutes: '反驳',
    mentions: '补充提及',
    cites: '引用依据',
  }[relation] || relation
}

function evidenceRelationProvenance(relation) {
  if (relation.status === 'proposed') return 'ai_proposed'
  if (relation.created_by === 'user') return 'user_confirmed'
  if (relation.created_by === 'ai') return 'ai_accepted'
  return 'system'
}

function sqlPlaceholders(count) {
  if (!Number.isInteger(count) || count <= 0) throw new Error('查询选择不能为空。')
  return Array.from({ length: count }, () => '?').join(', ')
}

function reviewFragmentFromRow(row) {
  return {
    id: row.id,
    bibliographicItemId: row.bibliographic_item_id,
    sourceId: row.source_id ?? undefined,
    annotationId: row.annotation_id ?? undefined,
    origin: row.origin,
    kind: row.kind,
    content: row.content,
    contentSha256: row.content_sha256,
    purposeTags: JSON.parse(row.purpose_tags_json),
    anchor: JSON.parse(row.anchor_json),
    itemTitle: row.item_title,
  }
}

function reviewDeepLink(citation) {
  const params = new URLSearchParams({
    sourceId: citation.sourceId,
    ...(citation.pageNumber ? { page: String(citation.pageNumber) } : {}),
    ...(citation.fragmentId ? { fragmentId: citation.fragmentId } : {}),
  })
  return `research-reader://open?${params.toString()}`
}

function bibliographicSummaryFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    itemType: row.item_type,
    authors: JSON.parse(row.authors_json || '[]'),
    issued: row.issued ?? undefined,
    accessed: row.accessed ?? undefined,
    containerTitle: row.container_title ?? undefined,
    publisher: row.publisher ?? undefined,
    publisherPlace: row.publisher_place ?? undefined,
    volume: row.volume ?? undefined,
    issue: row.issue ?? undefined,
    pages: row.pages ?? undefined,
    language: row.language ?? undefined,
    identifiers: JSON.parse(row.identifiers_json || '{}'),
  }
}

function structuredReadingVersionFromRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    sourceId: row.source_id,
    versionNumber: row.version_number,
    sourceFingerprint: row.source_fingerprint,
    sourceVersion: row.source_version,
    createdBy: row.created_by,
    model: row.model ?? undefined,
    blocks: JSON.parse(row.blocks_json || '[]'),
    toc: JSON.parse(row.toc_json || '[]'),
    diagnostics: JSON.parse(row.diagnostics_json || '[]'),
    qualityIssues: JSON.parse(row.quality_issues_json || '[]'),
    changeSummary: JSON.parse(row.change_summary_json || '{}'),
    note: row.note || '',
    restoredFromVersionId: row.restored_from_version_id ?? undefined,
    createdAt: row.created_at,
  }
}

function renderReviewMarkdown(document) {
  const labels = {
    heading: '结构',
    source_evidence: '原文证据',
    user_note: '用户笔记',
    ai_organization: 'AI 整理',
  }
  const lines = [
    '---',
    `review_document_id: "${document.id}"`,
    `exported_from: "H’s 科研助手"`,
    '---',
    '',
    `# ${document.title}`,
    '',
    '> 内容来源严格分为原文证据、用户笔记和 AI 整理；原始用户笔记未被改写。',
    '',
  ]
  for (const block of document.blocks) {
    if (block.blockType === 'ai_organization' && block.unsupported) continue
    const label = labels[block.blockType] || block.blockType
    lines.push(`## [${label}]`, '', block.content, '')
    if (block.citations.length) {
      lines.push(...block.citations.map(citation => `- [${citation.label}](${reviewDeepLink(citation)})`), '')
    }
  }
  if (document.items.length) {
    lines.push('## 参考文献', '')
    lines.push(...document.items.map(item => item.citation.text), '')
  }
  return `${lines.join('\n')}\n`
}

async function renderReviewDocx(document) {
  const {
    Document,
    ExternalHyperlink,
    HeadingLevel,
    Packer,
    Paragraph,
    TextRun,
  } = require('docx')
  const labels = {
    heading: { text: '结构', color: '666666' },
    source_evidence: { text: '原文证据', color: '376996' },
    user_note: { text: '用户笔记', color: '555555' },
    ai_organization: { text: 'AI 整理', color: '765D8E' },
  }
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(document.title)] }),
    new Paragraph({
      children: [new TextRun({
        text: '内容来源严格分为原文证据、用户笔记和 AI 整理；原始用户笔记未被改写。',
        italics: true,
        color: '666666',
      })],
    }),
  ]
  for (const block of document.blocks) {
    if (block.blockType === 'ai_organization' && block.unsupported) continue
    const label = labels[block.blockType] || { text: block.blockType, color: '666666' }
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `[${label.text}]`, bold: true, color: label.color })],
    }))
    children.push(new Paragraph({ children: [new TextRun(block.content)] }))
    for (const citation of block.citations) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new ExternalHyperlink({
          link: reviewDeepLink(citation),
          children: [new TextRun({ text: citation.label, style: 'Hyperlink' })],
        })],
      }))
    }
  }
  if (document.items.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '参考文献', bold: true })] }))
    for (const item of document.items) children.push(new Paragraph({ children: [new TextRun(item.citation.text)] }))
  }
  const doc = new Document({ sections: [{ properties: {}, children }] })
  return Packer.toBuffer(doc)
}

function listFilesRecursively(directory) {
  const files = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolutePath)
      else if (entry.isFile()) files.push(absolutePath)
    }
  }
  if (fs.existsSync(directory)) visit(directory)
  return files
}

function mineruImageMimeType(filePath) {
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  }[path.extname(filePath).toLowerCase()]
}

function markdownBlockquote(value) {
  return String(value || '').split(/\r?\n/).map(line => `> ${line}`)
}

function reviewBlockPortableLabel(blockType) {
  return {
    heading: '复查区块', source_evidence: '原文证据', user_note: '用户笔记', ai_organization: 'AI 整理（已确认）',
  }[blockType] || '复查内容'
}

function uniquePortableReferences(references) {
  const seen = new Set()
  return references.filter(reference => {
    const key = `${reference.id || ''}:${reference.pageNumber || ''}:${reference.originalFile || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readMineruContentList(assetRoot) {
  const candidates = listFilesRecursively(assetRoot)
    .filter(file => /_content_list\.json$/i.test(path.basename(file)) && !/_content_list_v2\.json$/i.test(path.basename(file)))
  if (candidates.length !== 1) return { source: undefined, blocks: [] }
  const file = candidates[0]
  const stats = fs.statSync(file)
  if (stats.size > 64 * 1024 * 1024) return { source: undefined, blocks: [] }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { source: undefined, blocks: [] }
  }
  if (!Array.isArray(parsed)) return { source: undefined, blocks: [] }
  const blocks = parsed.slice(0, 200000).flatMap((entry, index) => {
    const text = typeof entry?.text === 'string' ? entry.text.trim() : ''
    const pageIndex = Number(entry?.page_idx)
    if (!text || !Number.isInteger(pageIndex) || pageIndex < 0) return []
    const bbox = normalizedMineruBbox(entry?.bbox)
    return [{
      id: `mineru-content-${String(index + 1).padStart(6, '0')}`,
      type: String(entry.type || 'text').slice(0, 40),
      text: text.slice(0, 200000),
      pageNumber: pageIndex + 1,
      ...(bbox ? { bbox } : {}),
    }]
  })
  return {
    source: path.relative(assetRoot, file).split(path.sep).join('/'),
    blocks,
  }
}

function normalizedMineruBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return undefined
  const [x0, y0, x1, y1] = value.map(Number)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined
  if (x0 < 0 || y0 < 0 || x1 > 1000 || y1 > 1000 || x1 <= x0 || y1 <= y0) return undefined
  return [x0 / 1000, y0 / 1000, x1 / 1000, y1 / 1000]
}

module.exports = {
  WorkspaceService,
  ensureVaultName,
  safeFileName,
  resolveAttachment,
}
