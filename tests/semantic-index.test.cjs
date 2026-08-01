const assert = require('node:assert/strict')
const test = require('node:test')

const {
  cosineSimilarity,
  reciprocalRankFusion,
  semanticDocumentsFromSearchRows,
  splitSemanticText,
  vectorFromBuffer,
  vectorToBuffer,
} = require('../electron/semantic-index.cjs')

test('语义分块有受控重叠且不会丢失长文本尾部', () => {
  const text = `${'装配接触力。'.repeat(90)}\n${'在线辨识刚度。'.repeat(90)}`
  const chunks = splitSemanticText(text, 520, 80)
  assert.ok(chunks.length > 2)
  assert.equal(chunks[0].start, 0)
  assert.equal(chunks.at(-1).end, text.length)
  assert.ok(chunks[1].start < chunks[0].end)
  assert.ok(chunks.every(chunk => chunk.text.length <= 520))
})

test('语义文档继承原实体、论文、页码和锚点而不是生成孤立向量', () => {
  const documents = semanticDocumentsFromSearchRows([{
    project_id: 'project-1',
    entity_type: 'fragment',
    entity_id: 'fragment-1',
    source_id: 'source-1',
    item_id: 'item-1',
    item_ids_json: '["item-1"]',
    page_number: '7',
    anchor_json: '{"type":"pdf","pageNumber":7}',
    origin: 'source_evidence',
    title: '阻抗控制',
    subtitle: '原文证据 · p. 7',
    body: '在线辨识接触刚度可以降低峰值接触力。',
  }])
  assert.equal(documents.length, 1)
  assert.deepEqual({
    entityType: documents[0].entityType,
    entityId: documents[0].entityId,
    sourceId: documents[0].sourceId,
    itemId: documents[0].itemId,
    pageNumber: documents[0].pageNumber,
    origin: documents[0].origin,
  }, {
    entityType: 'fragment',
    entityId: 'fragment-1',
    sourceId: 'source-1',
    itemId: 'item-1',
    pageNumber: '7',
    origin: 'source_evidence',
  })
  assert.match(documents[0].text, /阻抗控制/)
})

test('Float32 向量缓存往返后仍可做余弦排序并拒绝错误维度', () => {
  const buffer = vectorToBuffer([3, 4], 2)
  const restored = vectorFromBuffer(buffer, 2)
  assert.ok(Math.abs(restored[0] - 0.6) < 1e-6)
  assert.ok(Math.abs(restored[1] - 0.8) < 1e-6)
  assert.ok(cosineSimilarity([1, 0], [0.8, 0.2]) > cosineSimilarity([1, 0], [0.1, 0.9]))
  assert.throws(() => vectorToBuffer([1, 2, 3], 2), /维度必须为 2/)
})

test('混合排序保留精确与语义两个通道，重复证据只展示一次', () => {
  const fused = reciprocalRankFusion([
    { id: 'fragment:1', title: '精确且语义相关' },
    { id: 'fragment:2', title: '只精确命中' },
  ], [
    { id: 'fragment:1', title: '精确且语义相关', semanticScore: 0.82 },
    { id: 'fragment:3', title: '只语义相关', semanticScore: 0.79 },
  ])
  assert.deepEqual(fused.map(result => result.id), ['fragment:1', 'fragment:2', 'fragment:3'])
  assert.deepEqual(fused[0].channels, ['exact', 'semantic'])
})
