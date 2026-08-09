const crypto = require('node:crypto')

const NODE_TYPES = new Set(['paper', 'author', 'concept', 'method', 'experiment', 'dataset', 'code', 'idea', 'claim', 'evidence'])
const EDGE_TYPES = new Set(['authored_by', 'mentions', 'proposes', 'uses', 'validated_by', 'derived_from', 'supports', 'contradicts', 'related_to'])
const REVIEW_STATES = new Set(['draft', 'confirmed', 'rejected', 'archived'])

function now() { return new Date().toISOString() }
function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex') }
function parseJson(value, fallback) { try { return JSON.parse(value) } catch { return fallback } }
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
function stringList(value, label, maximumItems = 100, maximumLength = 160) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表。`)
  if (value.length > maximumItems) throw new Error(`${label}不能超过 ${maximumItems} 项。`)
  return [...new Set(value.map(item => text(item, `${label}项目`, maximumLength)))]
}

function nodeView(row) {
  return {
    id: row.id, type: row.node_type, entityId: row.entity_id, label: row.label,
    description: row.description, properties: parseJson(row.properties_json, {}), origin: row.origin,
    reviewState: row.review_state, createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at, reviewedAt: row.reviewed_at ?? undefined,
  }
}
function edgeView(row) {
  return {
    id: row.id, fromNodeId: row.from_node_id, toNodeId: row.to_node_id, type: row.edge_type,
    evidenceRefs: parseJson(row.evidence_refs_json, []), rationale: row.rationale, origin: row.origin,
    reviewState: row.review_state, createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at, reviewedAt: row.reviewed_at ?? undefined,
  }
}
function evidenceCardView(row) {
  return {
    id: row.id, paperId: row.paper_id ?? undefined, sourceId: row.source_id,
    sourceFragmentId: row.source_fragment_id, understandingFragmentId: row.understanding_fragment_id ?? undefined,
    original: row.original, understanding: row.understanding ?? '', sourceName: row.source_name,
    pageNumber: row.page_number ?? undefined, figureLabel: row.figure_label ?? undefined,
    tableLabel: row.table_label ?? undefined, algorithmLabel: row.algorithm_label ?? undefined,
    originalSha256: row.original_sha256, tags: parseJson(row.tags_json, []),
    relatedExperimentIds: parseJson(row.related_experiment_ids_json, []), origin: row.origin,
    reviewState: row.review_state, createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at, reviewedAt: row.reviewed_at ?? undefined,
  }
}

class KnowledgeGraphService {
  constructor({ workspaceService }) {
    if (!workspaceService) throw new Error('KnowledgeGraphService 需要研究库服务。')
    this.workspace = workspaceService
  }

  #context() {
    const current = this.workspace.getCurrent()
    if (!current || !this.workspace.database) throw new Error('请先创建或打开研究库。')
    return { current, database: this.workspace.database }
  }

  #event(database, projectId, entityKind, entityId, eventType, actor, snapshot = {}) {
    database.prepare(`
      INSERT INTO knowledge_graph_events(id, project_id, entity_kind, entity_id, event_type, actor, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), projectId, entityKind, entityId, eventType, actor, JSON.stringify(snapshot), now())
  }

  #ensureNode(database, projectId, input, eventType = 'bootstrapped') {
    const existing = database.prepare('SELECT * FROM knowledge_nodes WHERE project_id = ? AND node_type = ? AND entity_id = ?').get(projectId, input.type, input.entityId)
    if (existing) return { node: nodeView(existing), created: false }
    const id = crypto.randomUUID()
    const timestamp = now()
    database.prepare(`
      INSERT INTO knowledge_nodes(id, project_id, node_type, entity_id, label, description, properties_json, origin, review_state, created_by, created_at, updated_at, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, input.type, input.entityId, input.label, input.description || '', JSON.stringify(input.properties || {}), input.origin || 'system', input.reviewState || 'confirmed', input.createdBy || 'system', timestamp, timestamp, input.reviewState === 'draft' ? null : timestamp)
    this.#event(database, projectId, 'node', id, eventType, input.createdBy || 'system', { type: input.type, entityId: input.entityId, label: input.label })
    return { node: nodeView(database.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id)), created: true }
  }

  #ensureEdge(database, projectId, input, eventType = 'bootstrapped') {
    const existing = database.prepare('SELECT * FROM knowledge_edges WHERE project_id = ? AND from_node_id = ? AND to_node_id = ? AND edge_type = ?').get(projectId, input.fromNodeId, input.toNodeId, input.type)
    if (existing) return { edge: edgeView(existing), created: false }
    const id = crypto.randomUUID()
    const timestamp = now()
    database.prepare(`
      INSERT INTO knowledge_edges(id, project_id, from_node_id, to_node_id, edge_type, evidence_refs_json, rationale, origin, review_state, created_by, created_at, updated_at, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, input.fromNodeId, input.toNodeId, input.type, JSON.stringify(input.evidenceRefs || []), input.rationale || '', input.origin || 'system', input.reviewState || 'confirmed', input.createdBy || 'system', timestamp, timestamp, input.reviewState === 'draft' ? null : timestamp)
    this.#event(database, projectId, 'edge', id, eventType, input.createdBy || 'system', { type: input.type, fromNodeId: input.fromNodeId, toNodeId: input.toNodeId, evidenceRefs: input.evidenceRefs || [] })
    return { edge: edgeView(database.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get(id)), created: true }
  }

  bootstrap() {
    const { current, database } = this.#context()
    let createdNodes = 0
    let createdEdges = 0
    let createdCards = 0
    database.exec('BEGIN IMMEDIATE')
    try {
      const papers = database.prepare('SELECT id, title, authors_json, issued, identifiers_json FROM bibliographic_items WHERE project_id = ? AND archived_at IS NULL').all(current.projectId)
      for (const paper of papers) {
        const paperResult = this.#ensureNode(database, current.projectId, { type: 'paper', entityId: paper.id, label: paper.title, properties: { issued: paper.issued, identifiers: parseJson(paper.identifiers_json, {}) }, origin: 'source' })
        if (paperResult.created) createdNodes += 1
        for (const author of parseJson(paper.authors_json, [])) {
          const label = text(author.literal || [author.family, author.given].filter(Boolean).join(' '), '作者姓名', 500, false)
          if (!label) continue
          const authorEntityId = `author:${sha256(label.normalize('NFKC').toLocaleLowerCase()).slice(0, 24)}`
          const authorResult = this.#ensureNode(database, current.projectId, { type: 'author', entityId: authorEntityId, label, properties: author, origin: 'source' })
          if (authorResult.created) createdNodes += 1
          const edgeResult = this.#ensureEdge(database, current.projectId, { fromNodeId: paperResult.node.id, toNodeId: authorResult.node.id, type: 'authored_by', evidenceRefs: [{ type: 'bibliography', id: paper.id, label: paper.title }], rationale: '来自导入题录的作者字段。', origin: 'source' })
          if (edgeResult.created) createdEdges += 1
        }
      }
      for (const run of database.prepare('SELECT id, title, outcome, started_at FROM research_runs WHERE project_id = ?').all(current.projectId)) {
        if (this.#ensureNode(database, current.projectId, { type: 'experiment', entityId: run.id, label: run.title, properties: { outcome: run.outcome, startedAt: run.started_at }, origin: 'source' }).created) createdNodes += 1
      }
      for (const record of database.prepare("SELECT id, record_type, title, status FROM research_records WHERE project_id = ? AND record_type IN ('dataset', 'decision')").all(current.projectId)) {
        const type = record.record_type === 'dataset' ? 'dataset' : 'idea'
        if (this.#ensureNode(database, current.projectId, { type, entityId: record.id, label: record.title, properties: { status: record.status }, origin: 'source' }).created) createdNodes += 1
      }
      for (const artifact of database.prepare("SELECT id, label, role, path_original, content_sha256 FROM research_artifacts WHERE project_id = ? AND role IN ('raw_data', 'processed_data', 'script', 'config', 'model')").all(current.projectId)) {
        const type = ['raw_data', 'processed_data'].includes(artifact.role) ? 'dataset' : 'code'
        if (this.#ensureNode(database, current.projectId, { type, entityId: artifact.id, label: artifact.label, properties: { role: artifact.role, path: artifact.path_original, sha256: artifact.content_sha256 }, origin: 'source' }).created) createdNodes += 1
      }
      for (const claim of database.prepare('SELECT id, text, section, status FROM research_claims WHERE project_id = ? AND archived_at IS NULL').all(current.projectId)) {
        if (this.#ensureNode(database, current.projectId, { type: 'claim', entityId: claim.id, label: claim.text.slice(0, 240), description: claim.section, properties: { status: claim.status }, origin: 'source', reviewState: claim.status === 'confirmed' ? 'confirmed' : 'draft' }).created) createdNodes += 1
      }
      const fragments = database.prepare(`
        SELECT nf.id, nf.bibliographic_item_id, nf.source_id, nf.content, nf.content_sha256, nf.anchor_json, nf.created_at, s.name AS source_name
        FROM note_fragments nf JOIN sources s ON s.id = nf.source_id
        WHERE nf.project_id = ? AND nf.origin = 'source_evidence'
      `).all(current.projectId)
      for (const fragment of fragments) {
        const anchor = parseJson(fragment.anchor_json, {})
        const cardId = crypto.randomUUID()
        const timestamp = now()
        const inserted = database.prepare(`
          INSERT OR IGNORE INTO evidence_cards(
            id, project_id, paper_id, source_id, source_fragment_id, page_number, figure_label, table_label, algorithm_label,
            original_sha256, tags_json, related_experiment_ids_json, origin, review_state, created_by, created_at, updated_at, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'system', 'confirmed', 'system', ?, ?, ?)
        `).run(cardId, current.projectId, fragment.bibliographic_item_id || null, fragment.source_id, fragment.id, anchor.pageNumber || null, anchor.figureLabel || null, anchor.tableLabel || null, anchor.algorithmLabel || null, fragment.content_sha256, timestamp, timestamp, timestamp)
        const card = database.prepare('SELECT id FROM evidence_cards WHERE project_id = ? AND source_fragment_id = ?').get(current.projectId, fragment.id)
        if (inserted.changes) {
          createdCards += 1
          database.prepare("INSERT INTO evidence_card_events(id, card_id, project_id, event_type, actor, snapshot_json, created_at) VALUES (?, ?, ?, 'created', 'system', ?, ?)").run(crypto.randomUUID(), card.id, current.projectId, JSON.stringify({ sourceFragmentId: fragment.id }), timestamp)
        }
        const evidenceNode = this.#ensureNode(database, current.projectId, { type: 'evidence', entityId: card.id, label: `${fragment.source_name}${anchor.pageNumber ? ` · p.${anchor.pageNumber}` : ''}`, description: fragment.content.slice(0, 500), properties: { sourceId: fragment.source_id, fragmentId: fragment.id, pageNumber: anchor.pageNumber }, origin: 'source' })
        if (evidenceNode.created) createdNodes += 1
        if (fragment.bibliographic_item_id) {
          const paperNode = database.prepare("SELECT * FROM knowledge_nodes WHERE project_id = ? AND node_type = 'paper' AND entity_id = ?").get(current.projectId, fragment.bibliographic_item_id)
          if (paperNode) {
            const edge = this.#ensureEdge(database, current.projectId, { fromNodeId: evidenceNode.node.id, toNodeId: paperNode.id, type: 'derived_from', evidenceRefs: [{ type: 'fragment', id: fragment.id, label: fragment.source_name }], rationale: '证据卡来源于该论文原文。', origin: 'source' })
            if (edge.created) createdEdges += 1
          }
        }
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return { createdNodes, createdEdges, createdCards, graph: this.getGraph() }
  }

  getGraph(input = {}) {
    const { current, database } = this.#context()
    const includeArchived = Boolean(input.includeArchived)
    const states = Array.isArray(input.reviewStates) ? input.reviewStates.filter(state => REVIEW_STATES.has(state)) : []
    const stateSql = states.length ? `AND review_state IN (${states.map(() => '?').join(',')})` : includeArchived ? '' : "AND review_state != 'archived'"
    const nodes = database.prepare(`SELECT * FROM knowledge_nodes WHERE project_id = ? ${stateSql} ORDER BY node_type, label`).all(current.projectId, ...states).map(nodeView)
    const nodeIds = new Set(nodes.map(node => node.id))
    const edges = database.prepare(`SELECT * FROM knowledge_edges WHERE project_id = ? ${stateSql} ORDER BY edge_type, created_at`).all(current.projectId, ...states).map(edgeView).filter(edge => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
    return { nodes, edges, summary: { nodes: nodes.length, edges: edges.length, draftNodes: nodes.filter(node => node.reviewState === 'draft').length, draftEdges: edges.filter(edge => edge.reviewState === 'draft').length } }
  }

  proposeNode(input = {}) {
    const { current, database } = this.#context()
    const type = text(input.type, '知识节点类型', 40)
    if (!NODE_TYPES.has(type)) throw new Error('知识节点类型无效。')
    const label = text(input.label, '知识节点名称', 500)
    const description = text(input.description, '知识节点说明', 10000, false)
    const properties = object(input.properties, '知识节点属性')
    const createdBy = input.createdBy === 'user' ? 'user' : 'ai'
    const origin = createdBy === 'user' ? 'user' : 'ai_suggestion'
    const entityId = text(input.entityId || `${type}:${crypto.randomUUID()}`, '知识实体 ID', 200)
    const result = this.#ensureNode(database, current.projectId, { type, entityId, label, description, properties, origin, reviewState: createdBy === 'user' ? 'confirmed' : 'draft', createdBy }, 'created')
    return result.node
  }

  proposeEdge(input = {}) {
    const { current, database } = this.#context()
    const fromNodeId = text(input.fromNodeId, '起点节点 ID', 160)
    const toNodeId = text(input.toNodeId, '终点节点 ID', 160)
    if (fromNodeId === toNodeId) throw new Error('知识关系不能连接节点自身。')
    const type = text(input.type, '知识关系类型', 40)
    if (!EDGE_TYPES.has(type)) throw new Error('知识关系类型无效。')
    const nodes = database.prepare('SELECT id FROM knowledge_nodes WHERE project_id = ? AND id IN (?, ?)').all(current.projectId, fromNodeId, toNodeId)
    if (nodes.length !== 2) throw new Error('知识关系节点不存在或不属于当前研究库。')
    const evidenceRefs = this.#validatedEvidenceRefs(input.evidenceRefs)
    const rationale = text(input.rationale, '知识关系依据', 10000, false)
    const createdBy = input.createdBy === 'user' ? 'user' : 'ai'
    const result = this.#ensureEdge(database, current.projectId, { fromNodeId, toNodeId, type, evidenceRefs, rationale, origin: createdBy === 'user' ? 'user' : 'ai_suggestion', reviewState: 'draft', createdBy }, 'created')
    return result.edge
  }

  #validatedEvidenceRefs(value) {
    const { current, database } = this.#context()
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > 500) throw new Error('知识关系证据必须是最多 500 项的列表。')
    const allowed = new Set(['bibliography', 'source', 'fragment', 'evidence', 'run', 'artifact', 'claim'])
    const refs = value.map((ref, index) => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw new Error(`第 ${index + 1} 个证据引用无效。`)
      const type = text(ref.type, '证据引用类型', 40)
      if (!allowed.has(type)) throw new Error('证据引用类型无效。')
      return { type, id: text(ref.id, '证据引用 ID', 160), label: text(ref.label, '证据引用名称', 500, false) }
    })
    const tables = { bibliography: 'bibliographic_items', source: 'sources', fragment: 'note_fragments', evidence: 'evidence_cards', run: 'research_runs', artifact: 'research_artifacts', claim: 'research_claims' }
    for (const ref of refs) {
      const exists = database.prepare(`SELECT id FROM ${tables[ref.type]} WHERE id = ? AND project_id = ?`).get(ref.id, current.projectId)
      if (!exists) throw new Error(`证据引用不存在或不属于当前研究库：${ref.type}:${ref.id}`)
    }
    return refs
  }

  reviewNode(input = {}) {
    const { current, database } = this.#context()
    const id = text(input.id, '知识节点 ID', 160)
    const decision = input.decision === 'confirm' ? 'confirmed' : input.decision === 'reject' ? 'rejected' : input.decision === 'archive' ? 'archived' : ''
    if (!decision) throw new Error('知识节点复核决定无效。')
    const row = database.prepare('SELECT * FROM knowledge_nodes WHERE id = ? AND project_id = ?').get(id, current.projectId)
    if (!row) throw new Error('知识节点不存在或不属于当前研究库。')
    const timestamp = now()
    database.prepare('UPDATE knowledge_nodes SET review_state = ?, updated_at = ?, reviewed_at = ? WHERE id = ? AND project_id = ?').run(decision, timestamp, timestamp, id, current.projectId)
    this.#event(database, current.projectId, 'node', id, decision === 'confirmed' ? 'confirmed' : decision === 'rejected' ? 'rejected' : 'archived', 'user', { previous: row.review_state })
    return nodeView(database.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id))
  }

  reviewEdge(input = {}) {
    const { current, database } = this.#context()
    const id = text(input.id, '知识关系 ID', 160)
    const decision = input.decision === 'confirm' ? 'confirmed' : input.decision === 'reject' ? 'rejected' : input.decision === 'archive' ? 'archived' : ''
    if (!decision) throw new Error('知识关系复核决定无效。')
    const row = database.prepare('SELECT * FROM knowledge_edges WHERE id = ? AND project_id = ?').get(id, current.projectId)
    if (!row) throw new Error('知识关系不存在或不属于当前研究库。')
    const evidenceRefs = input.evidenceRefs === undefined ? parseJson(row.evidence_refs_json, []) : this.#validatedEvidenceRefs(input.evidenceRefs)
    if (decision === 'confirmed' && !evidenceRefs.length) throw new Error('确认知识关系前必须关联至少一条证据。')
    const timestamp = now()
    database.prepare('UPDATE knowledge_edges SET review_state = ?, evidence_refs_json = ?, updated_at = ?, reviewed_at = ? WHERE id = ? AND project_id = ?').run(decision, JSON.stringify(evidenceRefs), timestamp, timestamp, id, current.projectId)
    this.#event(database, current.projectId, 'edge', id, decision === 'confirmed' ? 'confirmed' : decision === 'rejected' ? 'rejected' : 'archived', 'user', { previous: row.review_state, evidenceRefs })
    return edgeView(database.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get(id))
  }

  listEvidenceCards(input = {}) {
    const { current, database } = this.#context()
    const state = input.reviewState && REVIEW_STATES.has(input.reviewState) ? input.reviewState : undefined
    return database.prepare(`
      SELECT ec.*, source.content AS original, understanding.content AS understanding, s.name AS source_name
      FROM evidence_cards ec
      JOIN note_fragments source ON source.id = ec.source_fragment_id
      LEFT JOIN note_fragments understanding ON understanding.id = ec.understanding_fragment_id
      JOIN sources s ON s.id = ec.source_id
      WHERE ec.project_id = ? ${state ? 'AND ec.review_state = ?' : "AND ec.review_state != 'archived'"}
      ORDER BY ec.updated_at DESC
    `).all(...(state ? [current.projectId, state] : [current.projectId])).map(evidenceCardView)
  }

  createEvidenceCard(input = {}) {
    const { current, database } = this.#context()
    const sourceFragmentId = text(input.sourceFragmentId, '原文证据片段 ID', 160)
    const fragment = database.prepare(`
      SELECT nf.*, s.name AS source_name FROM note_fragments nf JOIN sources s ON s.id = nf.source_id
      WHERE nf.id = ? AND nf.project_id = ? AND nf.origin = 'source_evidence'
    `).get(sourceFragmentId, current.projectId)
    if (!fragment) throw new Error('Evidence Card 必须关联当前研究库的原文证据片段。')
    const existing = database.prepare('SELECT id FROM evidence_cards WHERE project_id = ? AND source_fragment_id = ?').get(current.projectId, sourceFragmentId)
    if (existing) {
      const hasEditableContent = input.understanding !== undefined || input.tags !== undefined || input.relatedExperimentIds !== undefined
      return hasEditableContent ? this.updateEvidenceCard({ ...input, id: existing.id }) : this.listEvidenceCards().find(card => card.id === existing.id)
    }
    const createdBy = input.createdBy === 'ai' ? 'ai' : 'user'
    const origin = createdBy === 'ai' ? 'ai' : 'user'
    const understanding = text(input.understanding, '我的理解', 100000, false)
    const tags = stringList(input.tags, 'Evidence Card 标签', 100, 120)
    const relatedExperimentIds = stringList(input.relatedExperimentIds, '关联实验', 100, 160)
    if (relatedExperimentIds.length) {
      const placeholders = relatedExperimentIds.map(() => '?').join(',')
      const found = database.prepare(`SELECT id FROM research_runs WHERE project_id = ? AND id IN (${placeholders})`).all(current.projectId, ...relatedExperimentIds)
      if (found.length !== relatedExperimentIds.length) throw new Error('关联实验不存在或不属于当前研究库。')
    }
    const anchor = parseJson(fragment.anchor_json, {})
    const cardId = crypto.randomUUID()
    const timestamp = now()
    let understandingFragmentId
    database.exec('BEGIN IMMEDIATE')
    try {
      if (understanding) {
        understandingFragmentId = crypto.randomUUID()
        const provenance = createdBy === 'ai' ? object(input.aiProvenance, 'AI 来源') : undefined
        if (createdBy === 'ai' && !Object.keys(provenance).length) throw new Error('AI 理解必须记录供应商、模型和生成来源。')
        database.prepare(`
          INSERT INTO note_fragments(id, project_id, bibliographic_item_id, source_id, origin, kind, content, content_sha256, purpose_tags_json, anchor_json, ai_provenance_json, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, 'note', ?, ?, ?, ?, ?, ?, ?)
        `).run(understandingFragmentId, current.projectId, fragment.bibliographic_item_id || null, fragment.source_id, createdBy === 'ai' ? 'ai' : 'user', understanding, sha256(understanding), JSON.stringify(tags), fragment.anchor_json, createdBy === 'ai' ? JSON.stringify(input.aiProvenance) : null, timestamp, createdBy)
        database.prepare("INSERT INTO fragment_relations(id, from_fragment_id, to_fragment_id, relation, created_at, created_by, status, rationale, reviewed_at) VALUES (?, ?, ?, 'comments_on', ?, ?, ?, ?, ?)").run(crypto.randomUUID(), understandingFragmentId, sourceFragmentId, timestamp, createdBy, createdBy === 'user' ? 'confirmed' : 'proposed', 'Evidence Card 中的理解关联原文。', createdBy === 'user' ? timestamp : null)
      }
      database.prepare(`
        INSERT INTO evidence_cards(
          id, project_id, paper_id, source_id, source_fragment_id, understanding_fragment_id,
          page_number, figure_label, table_label, algorithm_label, original_sha256,
          tags_json, related_experiment_ids_json, origin, review_state, created_by, created_at, updated_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cardId, current.projectId, fragment.bibliographic_item_id || null, fragment.source_id, sourceFragmentId, understandingFragmentId || null, anchor.pageNumber || input.pageNumber || null, anchor.figureLabel || input.figureLabel || null, anchor.tableLabel || input.tableLabel || null, anchor.algorithmLabel || input.algorithmLabel || null, fragment.content_sha256, JSON.stringify(tags), JSON.stringify(relatedExperimentIds), origin, createdBy === 'user' ? 'confirmed' : 'draft', createdBy, timestamp, timestamp, createdBy === 'user' ? timestamp : null)
      database.prepare("INSERT INTO evidence_card_events(id, card_id, project_id, event_type, actor, snapshot_json, created_at) VALUES (?, ?, ?, 'created', ?, ?, ?)").run(crypto.randomUUID(), cardId, current.projectId, createdBy, JSON.stringify({ sourceFragmentId, understandingFragmentId, tags, relatedExperimentIds }), timestamp)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.listEvidenceCards().find(card => card.id === cardId)
  }

  updateEvidenceCard(input = {}) {
    const { current, database } = this.#context()
    const id = text(input.id, 'Evidence Card ID', 160)
    const card = database.prepare(`
      SELECT ec.*, source.content AS original, source.anchor_json, source.bibliographic_item_id
      FROM evidence_cards ec
      JOIN note_fragments source ON source.id = ec.source_fragment_id
      WHERE ec.id = ? AND ec.project_id = ?
    `).get(id, current.projectId)
    if (!card) throw new Error('Evidence Card 不存在或不属于当前研究库。')
    const createdBy = input.createdBy === 'ai' ? 'ai' : 'user'
    const understanding = input.understanding === undefined
      ? undefined
      : text(input.understanding, '我的理解', 100000, false)
    const tags = input.tags === undefined ? parseJson(card.tags_json, []) : stringList(input.tags, 'Evidence Card 标签', 100, 120)
    const relatedExperimentIds = input.relatedExperimentIds === undefined
      ? parseJson(card.related_experiment_ids_json, [])
      : stringList(input.relatedExperimentIds, '关联实验', 100, 160)
    if (relatedExperimentIds.length) {
      const placeholders = relatedExperimentIds.map(() => '?').join(',')
      const found = database.prepare(`SELECT id FROM research_runs WHERE project_id = ? AND id IN (${placeholders})`).all(current.projectId, ...relatedExperimentIds)
      if (found.length !== relatedExperimentIds.length) throw new Error('关联实验不存在或不属于当前研究库。')
    }
    let understandingFragmentId = card.understanding_fragment_id
    const timestamp = now()
    const aiProvenance = createdBy === 'ai' && understanding !== undefined ? object(input.aiProvenance, 'AI 来源') : undefined
    const reviewState = createdBy === 'ai' && understanding !== undefined ? 'draft' : 'confirmed'
    if (createdBy === 'ai' && understanding !== undefined && understanding && !Object.keys(aiProvenance).length) throw new Error('AI 理解必须记录供应商、模型和生成来源。')
    database.exec('BEGIN IMMEDIATE')
    try {
      if (understanding !== undefined) {
        if (understanding) {
          understandingFragmentId = crypto.randomUUID()
          database.prepare(`
            INSERT INTO note_fragments(
              id, project_id, bibliographic_item_id, source_id, origin, kind, content, content_sha256,
              purpose_tags_json, anchor_json, ai_provenance_json, supersedes_id, created_at, created_by
            ) VALUES (?, ?, ?, ?, ?, 'note', ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            understandingFragmentId,
            current.projectId,
            card.bibliographic_item_id || null,
            card.source_id,
            createdBy === 'ai' ? 'ai' : 'user',
            understanding,
            sha256(understanding),
            JSON.stringify(tags),
            card.anchor_json,
            createdBy === 'ai' ? JSON.stringify(aiProvenance) : null,
            card.understanding_fragment_id || null,
            timestamp,
            createdBy,
          )
          database.prepare("INSERT INTO fragment_relations(id, from_fragment_id, to_fragment_id, relation, created_at, created_by, status, rationale, reviewed_at) VALUES (?, ?, ?, 'comments_on', ?, ?, ?, ?, ?)").run(
            crypto.randomUUID(), understandingFragmentId, card.source_fragment_id, timestamp, createdBy,
            createdBy === 'user' ? 'confirmed' : 'proposed', 'Evidence Card 中的理解关联原文。', createdBy === 'user' ? timestamp : null,
          )
        } else {
          understandingFragmentId = null
        }
      }
      database.prepare(`
        UPDATE evidence_cards
        SET understanding_fragment_id = ?, tags_json = ?, related_experiment_ids_json = ?, origin = ?,
            review_state = ?, updated_at = ?, reviewed_at = ?
        WHERE id = ? AND project_id = ?
      `).run(
        understandingFragmentId || null,
        JSON.stringify(tags),
        JSON.stringify(relatedExperimentIds),
        createdBy === 'ai' ? 'ai' : 'user',
        reviewState,
        timestamp,
        reviewState === 'confirmed' ? timestamp : null,
        id,
        current.projectId,
      )
      database.prepare("INSERT INTO evidence_card_events(id, card_id, project_id, event_type, actor, snapshot_json, created_at) VALUES (?, ?, ?, 'updated', ?, ?, ?)").run(
        crypto.randomUUID(), id, current.projectId, createdBy,
        JSON.stringify({ previousUnderstandingFragmentId: card.understanding_fragment_id, understandingFragmentId, tags, relatedExperimentIds, reviewState }),
        timestamp,
      )
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return this.listEvidenceCards({ reviewState }).find(item => item.id === id)
  }

  reviewEvidenceCard(input = {}) {
    const { current, database } = this.#context()
    const id = text(input.id, 'Evidence Card ID', 160)
    const decision = input.decision === 'confirm' ? 'confirmed' : input.decision === 'reject' ? 'rejected' : input.decision === 'archive' ? 'archived' : ''
    if (!decision) throw new Error('Evidence Card 复核决定无效。')
    const card = database.prepare('SELECT * FROM evidence_cards WHERE id = ? AND project_id = ?').get(id, current.projectId)
    if (!card) throw new Error('Evidence Card 不存在或不属于当前研究库。')
    const timestamp = now()
    database.prepare('UPDATE evidence_cards SET review_state = ?, updated_at = ?, reviewed_at = ? WHERE id = ? AND project_id = ?').run(decision, timestamp, timestamp, id, current.projectId)
    database.prepare('INSERT INTO evidence_card_events(id, card_id, project_id, event_type, actor, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), id, current.projectId, decision === 'confirmed' ? 'confirmed' : decision === 'rejected' ? 'rejected' : 'archived', 'user', JSON.stringify({ previous: card.review_state }), timestamp)
    return this.listEvidenceCards({ reviewState: decision }).find(item => item.id === id)
  }
}

module.exports = { EDGE_TYPES, KnowledgeGraphService, NODE_TYPES }
