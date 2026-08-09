const crypto = require('node:crypto')

const ZOTERO_SYNC_ADAPTER = 'zotero-export-metadata-v1'

function zoteroSyncCapabilities() {
  return {
    adapter: ZOTERO_SYNC_ADAPTER,
    imports: ['ris', 'bibtex', 'endnote-xml'],
    metadata: ['itemKey', 'libraryId', 'version', 'collections', 'attachmentKeys'],
    writesZoteroDatabase: false,
    supports: ['preview', 'incremental-bind', 'collection-metadata', 'attachment-relations'],
    intentionallyUnsupported: ['zotero-database-write', 'word-dynamic-citations', 'group-sync', 'full-csl-engine'],
  }
}

function normalizeZoteroMetadataRecord(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Zotero 元数据记录格式无效。')
  const itemKey = String(input.itemKey || '').trim()
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(itemKey)) throw new Error('Zotero 元数据必须提供明确的 item key。')
  const libraryId = String(input.libraryId || 'personal').trim().slice(0, 160) || 'personal'
  const localItemId = String(input.localItemId || '').trim().slice(0, 160) || undefined
  const rawRecordId = String(input.rawRecordId || '').trim().slice(0, 500) || undefined
  const rawRecordIdField = String(input.rawRecordIdField || '').trim().slice(0, 80) || undefined
  const importFormat = String(input.importFormat || '').trim()
  if (importFormat && !['ris', 'bibtex', 'endnote-xml'].includes(importFormat)) {
    throw new Error('Zotero 元数据只可绑定现有 RIS、BibTeX 或 EndNote XML 题录。')
  }
  const version = input.version === undefined || input.version === null ? undefined : String(input.version).trim().slice(0, 120)
  const collections = normalizedStringList(input.collections, 500, 500)
  const attachmentKeys = normalizedStringList(input.attachmentKeys, 1000, 160)
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    itemKey, libraryId, localItemId, rawRecordId, rawRecordIdField,
    importFormat: importFormat || undefined, version, collections, attachmentKeys,
  })).digest('hex')
  return {
    itemKey, libraryId, localItemId, rawRecordId, rawRecordIdField,
    importFormat: importFormat || undefined, version, collections, attachmentKeys, fingerprint,
  }
}

function planZoteroMetadataSync({ incoming = [], existing = [], resolveLocalItem } = {}) {
  if (!Array.isArray(incoming) || !Array.isArray(existing)) throw new Error('Zotero 增量同步输入格式无效。')
  const normalized = incoming.map(normalizeZoteroMetadataRecord)
  const duplicateKeys = new Set()
  const seen = new Set()
  for (const record of normalized) {
    const key = `${record.libraryId}:${record.itemKey}`
    if (seen.has(key)) duplicateKeys.add(key)
    seen.add(key)
  }
  const existingByKey = new Map(existing.map(record => [`${record.libraryId}:${record.itemKey}`, record]))
  const plan = { added: [], updated: [], unchanged: [], unmatched: [], conflicts: [] }
  for (const record of normalized) {
    const key = `${record.libraryId}:${record.itemKey}`
    if (duplicateKeys.has(key)) {
      plan.conflicts.push({ ...record, reason: 'duplicate-external-key' })
      continue
    }
    const prior = existingByKey.get(key)
    const localItemId = prior?.itemId || (typeof resolveLocalItem === 'function' ? resolveLocalItem(record) : record.localItemId)
    if (!localItemId) {
      plan.unmatched.push({ ...record, reason: 'local-item-not-found' })
      continue
    }
    const entry = { ...record, localItemId }
    if (!prior) plan.added.push(entry)
    else if (prior.itemId !== localItemId) plan.conflicts.push({ ...entry, reason: 'external-key-already-bound' })
    else if (prior.fingerprint === record.fingerprint) plan.unchanged.push(entry)
    else plan.updated.push(entry)
  }
  return {
    adapter: ZOTERO_SYNC_ADAPTER,
    counts: Object.fromEntries(Object.entries(plan).map(([key, value]) => [key, value.length])),
    ...plan,
  }
}

function normalizedStringList(value, limit, itemLimit) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Zotero 集合与附件关系必须是数组。')
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean).map(item => item.slice(0, itemLimit)))].slice(0, limit)
}

module.exports = {
  ZOTERO_SYNC_ADAPTER,
  normalizeZoteroMetadataRecord,
  planZoteroMetadataSync,
  zoteroSyncCapabilities,
}
