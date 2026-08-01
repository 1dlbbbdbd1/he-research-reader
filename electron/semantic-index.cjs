const crypto = require('node:crypto')

const DEFAULT_CHUNK_CHARACTERS = 1200
const DEFAULT_CHUNK_OVERLAP = 160
const MAX_SEMANTIC_DOCUMENTS = 50000

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function splitSemanticText(value, maximum = DEFAULT_CHUNK_CHARACTERS, overlap = DEFAULT_CHUNK_OVERLAP) {
  const text = String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n').trim()
  const limit = Math.min(Math.max(Number(maximum) || DEFAULT_CHUNK_CHARACTERS, 320), 4000)
  const shared = Math.min(Math.max(Number(overlap) || 0, 0), Math.floor(limit / 3))
  if (!text) return []
  if (text.length <= limit) return [{ text, start: 0, end: text.length }]
  const chunks = []
  let start = 0
  while (start < text.length && chunks.length < MAX_SEMANTIC_DOCUMENTS) {
    let end = Math.min(text.length, start + limit)
    if (end < text.length) {
      const boundaryWindow = text.slice(Math.max(start + 220, end - 260), end)
      const matches = [...boundaryWindow.matchAll(/[。！？.!?；;\n]\s*/g)]
      if (matches.length) {
        const last = matches[matches.length - 1]
        end = Math.max(start + 220, Math.max(start + 220, end - 260) + last.index + last[0].length)
      }
    }
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push({ text: chunk, start, end })
    if (end >= text.length) break
    const next = Math.max(start + 1, end - shared)
    start = next
  }
  return chunks
}

function semanticDocumentsFromSearchRows(rows, options = {}) {
  const documents = []
  const maximum = Math.min(Math.max(Number(options.maximumCharacters) || DEFAULT_CHUNK_CHARACTERS, 320), 4000)
  const overlap = Math.min(Math.max(Number(options.overlapCharacters) || DEFAULT_CHUNK_OVERLAP, 0), Math.floor(maximum / 3))
  for (const row of Array.isArray(rows) ? rows : []) {
    const body = String(row.body || row.metadata || row.subtitle || row.title || '').trim()
    if (!body) continue
    const chunks = splitSemanticText(body, maximum, overlap)
    chunks.forEach((chunk, chunkIndex) => {
      if (documents.length >= MAX_SEMANTIC_DOCUMENTS) return
      const contentSha256 = sha256(chunk.text)
      const identity = [row.entity_type, row.entity_id, row.source_id, row.item_id, chunkIndex, contentSha256].join(':')
      const title = String(row.title || '').trim()
      const subtitle = String(row.subtitle || '').trim()
      documents.push({
        id: `semantic:${sha256(identity)}`,
        projectId: String(row.project_id || ''),
        entityType: String(row.entity_type || ''),
        entityId: String(row.entity_id || ''),
        sourceId: String(row.source_id || ''),
        itemId: String(row.item_id || ''),
        itemIdsJson: String(row.item_ids_json || '[]'),
        reviewDocumentId: String(row.review_document_id || ''),
        pageNumber: String(row.page_number || ''),
        anchorJson: String(row.anchor_json || ''),
        origin: String(row.origin || ''),
        title,
        subtitle,
        body: chunk.text,
        text: [title, subtitle, chunk.text].filter(Boolean).join('\n'),
        chunkIndex,
        startOffset: chunk.start,
        endOffset: chunk.end,
        contentSha256,
      })
    })
    if (documents.length >= MAX_SEMANTIC_DOCUMENTS) break
  }
  return documents
}

function normalizedVector(values, expectedDimension) {
  if (!Array.isArray(values) && !(values instanceof Float32Array)) throw new Error('向量必须是数值数组。')
  if (expectedDimension && values.length !== expectedDimension) throw new Error(`向量维度必须为 ${expectedDimension}。`)
  if (!values.length || values.length > 4096) throw new Error('向量维度无效。')
  const result = Float32Array.from(values, Number)
  if (![...result].every(Number.isFinite)) throw new Error('向量包含无效数值。')
  let squared = 0
  for (const value of result) squared += value * value
  if (!squared) throw new Error('向量不能为零。')
  const norm = Math.sqrt(squared)
  for (let index = 0; index < result.length; index += 1) result[index] /= norm
  return result
}

function vectorToBuffer(values, expectedDimension) {
  const vector = normalizedVector(values, expectedDimension)
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

function vectorFromBuffer(value, expectedDimension) {
  const bytes = Buffer.from(value || [])
  if (!bytes.length || bytes.length % 4 !== 0) throw new Error('向量缓存字节数无效。')
  const copy = Uint8Array.from(bytes)
  return normalizedVector(new Float32Array(copy.buffer), expectedDimension)
}

function cosineSimilarity(left, right) {
  const a = normalizedVector(left)
  const b = normalizedVector(right, a.length)
  let score = 0
  for (let index = 0; index < a.length; index += 1) score += a[index] * b[index]
  return score
}

function reciprocalRankFusion(lexicalResults, semanticResults, limit = 80) {
  const fused = new Map()
  const add = (result, channel, rank, weight) => {
    const id = String(result?.id || '')
    if (!id) return
    const current = fused.get(id) || { ...result, fusionScore: 0, channels: [] }
    current.fusionScore += weight / (60 + rank)
    if (!current.channels.includes(channel)) current.channels.push(channel)
    if (channel === 'semantic' && Number.isFinite(result.semanticScore)) current.semanticScore = result.semanticScore
    fused.set(id, current)
  }
  ;(Array.isArray(lexicalResults) ? lexicalResults : []).forEach((result, index) => add(result, 'exact', index + 1, 1))
  ;(Array.isArray(semanticResults) ? semanticResults : []).forEach((result, index) => add(result, 'semantic', index + 1, 0.85))
  return [...fused.values()]
    .sort((left, right) => right.fusionScore - left.fusionScore
      || (right.semanticScore || -1) - (left.semanticScore || -1)
      || String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN'))
    .slice(0, Math.min(Math.max(Number(limit) || 80, 1), 200))
}

module.exports = {
  DEFAULT_CHUNK_CHARACTERS,
  DEFAULT_CHUNK_OVERLAP,
  MAX_SEMANTIC_DOCUMENTS,
  cosineSimilarity,
  normalizedVector,
  reciprocalRankFusion,
  semanticDocumentsFromSearchRows,
  splitSemanticText,
  vectorFromBuffer,
  vectorToBuffer,
}
