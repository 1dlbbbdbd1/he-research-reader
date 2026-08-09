const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { KnowledgeGraphService } = require('../electron/knowledge/knowledge-graph-service.cjs')
const { WorkspaceService } = require('../electron/workspace-service.cjs')

function withKnowledge(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-graph-service-'))
  const workspace = new WorkspaceService({ registryPath: path.join(root, 'app-data', 'workspaces.json') })
  const vault = workspace.create(root, '知识图谱测试研究库')
  const knowledge = new KnowledgeGraphService({ workspaceService: workspace })
  try { return run({ root, vault, workspace, knowledge }) } finally {
    workspace.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function seedPaperEvidence(workspace) {
  const projectId = workspace.getCurrent().projectId
  const timestamp = new Date().toISOString()
  workspace.database.prepare(`
    INSERT INTO bibliographic_items(
      id, project_id, item_type, title, authors_json, issued, keywords_json, identifiers_json,
      needs_metadata_review, import_format, import_batch_id, record_ordinal, raw_payload,
      raw_fields_json, parser_name, parser_version, imported_at, created_at, updated_at
    ) VALUES (?, ?, 'article-journal', ?, ?, '2026', '[]', '{}', 0, 'manual', 'kg-test', 1, '', '{}', 'test', '1', ?, ?, ?)
  `).run('paper-kg-1', projectId, '柔顺装配控制研究', JSON.stringify([{ family: '何', given: '研究者' }]), timestamp, timestamp, timestamp)
  workspace.database.prepare(`
    INSERT INTO sources(id, project_id, name, kind, status, pages, content_sha256, extracted_text, source_metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, 'PDF', '已解析', 12, ?, ?, '{}', ?, ?)
  `).run('source-kg-1', projectId, '柔顺装配控制研究.pdf', 'source-hash', '论文正文', timestamp, timestamp)
  workspace.database.prepare(`
    INSERT INTO note_fragments(
      id, project_id, bibliographic_item_id, source_id, origin, kind, content, content_sha256,
      purpose_tags_json, anchor_json, created_at, created_by
    ) VALUES (?, ?, ?, ?, 'source_evidence', 'quote', ?, ?, '[]', ?, ?, 'user')
  `).run(
    'fragment-kg-1', projectId, 'paper-kg-1', 'source-kg-1',
    '变刚度策略将装配成功率提高到 92%。', crypto.createHash('sha256').update('变刚度策略将装配成功率提高到 92%。').digest('hex'),
    JSON.stringify({ pageNumber: 6, figureLabel: 'Figure 3' }), timestamp,
  )
  return { projectId }
}

test('知识图谱从既有论文与原文证据幂等构建，并保留可追溯关系', () => withKnowledge(({ workspace, knowledge }) => {
  seedPaperEvidence(workspace)
  const first = knowledge.bootstrap()
  assert.equal(first.createdCards, 1)
  assert.ok(first.createdNodes >= 3)
  assert.ok(first.createdEdges >= 2)
  const second = knowledge.bootstrap()
  assert.deepEqual({ nodes: second.createdNodes, edges: second.createdEdges, cards: second.createdCards }, { nodes: 0, edges: 0, cards: 0 })

  const graph = knowledge.getGraph()
  assert.ok(graph.nodes.some(node => node.type === 'paper' && node.label === '柔顺装配控制研究'))
  assert.ok(graph.nodes.some(node => node.type === 'author' && node.label === '何 研究者'))
  assert.ok(graph.nodes.some(node => node.type === 'evidence'))
  assert.ok(graph.edges.some(edge => edge.type === 'authored_by' && edge.evidenceRefs[0].id === 'paper-kg-1'))
  assert.ok(graph.edges.some(edge => edge.type === 'derived_from' && edge.evidenceRefs[0].id === 'fragment-kg-1'))
  assert.throws(() => workspace.database.prepare("UPDATE knowledge_graph_events SET actor = 'ai' WHERE event_type = 'bootstrapped'").run(), /append-only/)
}))

test('AI 节点与关系保持草稿，关系没有证据时不得人工确认', () => withKnowledge(({ workspace, knowledge }) => {
  seedPaperEvidence(workspace)
  knowledge.bootstrap()
  const method = knowledge.proposeNode({ type: 'method', label: '变刚度控制', description: 'AI 提议的方法节点。', createdBy: 'ai' })
  const paper = knowledge.getGraph().nodes.find(node => node.type === 'paper')
  assert.equal(method.reviewState, 'draft')
  const edge = knowledge.proposeEdge({ fromNodeId: paper.id, toNodeId: method.id, type: 'proposes', rationale: '待核对。', createdBy: 'ai' })
  assert.equal(edge.reviewState, 'draft')
  assert.throws(() => knowledge.reviewEdge({ id: edge.id, decision: 'confirm' }), /必须关联至少一条证据/)
  const confirmed = knowledge.reviewEdge({
    id: edge.id,
    decision: 'confirm',
    evidenceRefs: [{ type: 'fragment', id: 'fragment-kg-1', label: '第 6 页原文' }],
  })
  assert.equal(confirmed.reviewState, 'confirmed')
  assert.equal(confirmed.evidenceRefs[0].id, 'fragment-kg-1')
  assert.equal(knowledge.reviewNode({ id: method.id, decision: 'confirm' }).reviewState, 'confirmed')
}))

test('自动 Evidence Card 可继续填写理解，原文不变且理解按版本追加', () => withKnowledge(({ workspace, knowledge }) => {
  seedPaperEvidence(workspace)
  knowledge.bootstrap()
  const original = knowledge.listEvidenceCards()[0]
  assert.equal(original.original, '变刚度策略将装配成功率提高到 92%。')
  const updated = knowledge.createEvidenceCard({
    sourceFragmentId: 'fragment-kg-1',
    understanding: '需要在相同接触刚度下复现。',
    tags: ['复现', '变刚度'],
    createdBy: 'user',
  })
  assert.equal(updated.id, original.id)
  assert.equal(updated.original, original.original)
  assert.equal(updated.understanding, '需要在相同接触刚度下复现。')
  assert.deepEqual(updated.tags, ['复现', '变刚度'])
  const revised = knowledge.updateEvidenceCard({ id: original.id, understanding: '先核对接触刚度，再复现实验。', createdBy: 'user' })
  assert.notEqual(revised.understandingFragmentId, updated.understandingFragmentId)
  const revision = workspace.database.prepare('SELECT supersedes_id FROM note_fragments WHERE id = ?').get(revised.understandingFragmentId)
  assert.equal(revision.supersedes_id, updated.understandingFragmentId)
  assert.equal(workspace.database.prepare('SELECT content FROM note_fragments WHERE id = ?').get('fragment-kg-1').content, original.original)
  assert.equal(workspace.database.prepare("SELECT COUNT(*) AS count FROM evidence_card_events WHERE card_id = ? AND event_type = 'updated'").get(original.id).count, 2)
}))
