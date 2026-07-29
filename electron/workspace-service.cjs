const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { openWorkspaceDatabase, SCHEMA_VERSION } = require('./workspace-db.cjs')
const { detectBibliographyFormat, parseBibliography } = require('./bibliography-adapters.cjs')

const VAULT_FILE = 'vault.json'
const DATABASE_FILE = 'library.sqlite'

function now() {
  return new Date().toISOString()
}

const READING_STATUS_VALUES = new Set(['unread', 'title_only', 'skimming', 'reading', 'finished'])
const RELEVANCE_VALUES = new Set(['undecided', 'core', 'relevant', 'supplemental', 'mismatched'])
const IDEA_STATE_VALUES = new Set(['undecided', 'has_ideas', 'no_new_ideas'])
const QUESTION_STATE_VALUES = new Set(['undecided', 'has_questions', 'no_questions'])
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
      SELECT a.id, a.source_id, a.category, a.anchor_json,
             quote.content AS quote_text, note.content AS note_text
      FROM annotations a
      LEFT JOIN note_fragments quote
        ON quote.annotation_id = a.id AND quote.origin = 'source_evidence'
      LEFT JOIN note_fragments note
        ON note.annotation_id = a.id AND note.origin = 'user'
      WHERE a.project_id = ? AND a.archived_at IS NULL
      ORDER BY a.created_at DESC
    `).all(this.current.projectId).map(row => {
      const anchor = JSON.parse(row.anchor_json)
      return {
        id: row.id,
        sourceId: row.source_id ?? undefined,
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
        WHERE nf.project_id = ?
          AND nf.bibliographic_item_id IN (${sqlPlaceholders(itemIds.length)})
          AND nf.annotation_id IN (${sqlPlaceholders(annotationIds.length)})
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
        this.database.prepare(`
          INSERT OR IGNORE INTO annotations(id, project_id, source_id, category, anchor_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(annotationId, this.current.projectId, sourceId, String(annotation.category || '待核实'), JSON.stringify(anchor), timestamp)

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
          if (quoteFragmentId) {
            this.database.prepare(`
              INSERT OR IGNORE INTO fragment_relations(id, from_fragment_id, to_fragment_id, relation, created_at)
              VALUES (?, ?, ?, 'comments_on', ?)
            `).run(`legacy-relation:${annotationId}`, noteFragmentId, quoteFragmentId, timestamp)
          }
        }
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
    this.database.prepare(`
      INSERT OR IGNORE INTO annotations(id, project_id, source_id, category, anchor_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(annotationId, this.current.projectId, sourceId, String(annotation.category || '待核实'), JSON.stringify(anchor), timestamp)
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
      if (quoteFragmentId) {
        this.database.prepare(`
          INSERT OR IGNORE INTO fragment_relations(id, from_fragment_id, to_fragment_id, relation, created_at)
          VALUES (?, ?, ?, 'comments_on', ?)
        `).run(`relation:${annotationId}`, noteFragmentId, quoteFragmentId, timestamp)
      }
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
      'SELECT dirty FROM search_index_state WHERE project_id = ?',
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

      this.database.prepare(`
        INSERT INTO search_index_state(project_id, dirty, indexed_at)
        VALUES (?, 0, ?)
        ON CONFLICT(project_id) DO UPDATE SET dirty = 0, indexed_at = excluded.indexed_at
      `).run(this.current.projectId, now())
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
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
    filters.readingStatuses.length
    || filters.relevances.length
    || filters.ideaStates.length
    || filters.questionStates.length
    || filters.purposeTags.length
    || filters.hasAnnotations !== undefined
  )
}

function itemMatchesSearchFilters(item, filters) {
  const state = item.readingState
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
    `exported_from: "科研阅读闭环"`,
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

module.exports = {
  WorkspaceService,
  ensureVaultName,
  safeFileName,
  resolveAttachment,
}
