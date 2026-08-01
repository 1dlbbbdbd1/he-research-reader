const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { openWorkspaceDatabase, SCHEMA_VERSION } = require('./workspace-db.cjs')
const { detectBibliographyFormat, parseBibliography } = require('./bibliography-adapters.cjs')
const {
  semanticDocumentsFromSearchRows,
  vectorFromBuffer,
  vectorToBuffer,
} = require('./semantic-index.cjs')

const VAULT_FILE = 'vault.json'
const DATABASE_FILE = 'library.sqlite'

function now() {
  return new Date().toISOString()
}

const READING_STATUS_VALUES = new Set(['unread', 'title_only', 'skimming', 'reading', 'finished'])
const RELEVANCE_VALUES = new Set(['undecided', 'core', 'relevant', 'supplemental', 'mismatched'])
const IDEA_STATE_VALUES = new Set(['undecided', 'has_ideas', 'no_new_ideas'])
const QUESTION_STATE_VALUES = new Set(['undecided', 'has_questions', 'no_questions'])
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
             note.content AS note_text
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
      }
    })
    const bibliographicItems = this.database.prepare(`
      SELECT b.id, b.title, b.item_type, b.authors_json, b.issued,
             b.container_title, b.abstract, b.keywords_json, b.identifiers_json,
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
    `).all(this.current.projectId).map(row => ({
      id: row.id,
      title: row.title,
      itemType: row.item_type,
      authors: JSON.parse(row.authors_json),
      issued: row.issued ?? undefined,
      containerTitle: row.container_title ?? undefined,
      abstract: row.abstract ?? undefined,
      keywords: JSON.parse(row.keywords_json),
      identifiers: JSON.parse(row.identifiers_json),
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
    }))
    return { sources, annotations, bibliographicItems }
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
      SELECT bi.id, bi.title, rdi.position
      FROM review_document_items rdi
      JOIN bibliographic_items bi ON bi.id = rdi.item_id
      WHERE rdi.document_id = ?
      ORDER BY rdi.position
    `).all(document.id)
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
      evidence: this.database.prepare(`
        SELECT id, evidence_type, entity_id, fragment_id, review_block_id,
               review_document_id, source_id, item_id, label, excerpt,
               page_number, anchor_json
        FROM action_item_evidence
        WHERE action_item_id = ? ORDER BY rowid
      `).all(row.id).map(evidence => ({
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
      })),
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
      UPDATE review_documents SET status = 'exported', updated_at = ? WHERE id = ?
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
        `).run(`attachment:${sourceId}`, itemId, sourceId, String(input.fileName || fileName), absolutePath, actualSha256)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return { sourceId, fileName, contentSha256: actualSha256, pathRelative: path.relative(this.current.path, absolutePath) }
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
      return {
        batchId: previous.import_batch_id,
        format,
        itemCount: previous.count,
        attachmentCount: 0,
        copiedSourceCount: 0,
        alreadyImported: true,
        warnings: [],
      }
    }

    const records = parseBibliography({ format, fileName: sourceFileName, text })
    const batchId = crypto.randomUUID()
    const importedAt = now()
    const createdPaths = []
    const warnings = []
    let attachmentCount = 0
    let copiedSourceCount = 0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        const itemId = crypto.randomUUID()
        const normalized = record.normalized || {}
        this.database.prepare(`
          INSERT INTO bibliographic_items(
            id, project_id, item_type, title, authors_json, issued, container_title,
            volume, issue, pages, abstract, language, keywords_json, identifiers_json,
            needs_metadata_review, import_format, import_batch_id, source_file_name,
            source_file_sha256, record_ordinal, raw_record_id, raw_record_id_field,
            raw_payload, raw_fields_json, parser_name, parser_version, imported_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          itemId,
          this.current.projectId,
          String(normalized.itemType || 'unknown'),
          String(normalized.title || '[无题名记录]'),
          JSON.stringify(normalized.authors || []),
          normalized.issued || null,
          normalized.containerTitle || null,
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
    const evidenceType = validateEnum(input.evidenceType, new Set(['fragment', 'review', 'source', 'bibliography']), '证据类型')
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
  const allowedModes = new Set(['original', 'markdown', 'parallel'])
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
    `exported_from: "小何的科研阅读助手"`,
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
