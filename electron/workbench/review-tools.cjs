const crypto = require('node:crypto')

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function normalized(value) { return clean(value).normalize('NFKD').toLowerCase().replace(/https?:\/\/(?:dx\.)?doi\.org\//g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function stableId(value, prefix = 'review') { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}` }
function json(value, fallback) { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '')) } catch { return fallback } }
function array(value) { const parsed = json(value, value); return Array.isArray(parsed) ? parsed : [] }
function doi(value) { return clean(value).match(/\b10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0]?.replace(/[),.;\]}]+$/, '').toLowerCase() }
function year(value) { return clean(value).match(/\b(?:18|19|20)\d{2}\b/)?.[0] }
function authors(value) { return array(value).map(item => typeof item === 'string' ? clean(item) : clean([item?.given, item?.family, item?.name].filter(Boolean).join(' '))).filter(Boolean) }

function normalizeRecord(item = {}, index = 0, source = 'manual') {
  const identifiers = json(item.identifiers || item.identifiers_json, {})
  const title = clean(item.title || item.name)
  const recordDoi = doi(item.doi || identifiers.doi || item.DOI || item.raw || '')
  const recordAuthors = authors(item.authors || item.author || item.authors_json)
  const issued = clean(item.year || item.issued || item.date)
  const recordYear = year(issued)
  const rawIdentity = recordDoi || `${normalized(title)}|${recordYear || ''}|${normalized(recordAuthors[0] || '')}` || `${source}:${index}`
  return {
    id: clean(item.id) || stableId(rawIdentity, 'study'), source, sourceRecordId: clean(item.sourceRecordId || item.raw_record_id) || undefined,
    title, abstract: clean(item.abstract), doi: recordDoi, authors: recordAuthors, year: recordYear,
    journal: clean(item.journal || item.containerTitle || item.container_title), url: clean(item.url || item.URL) || undefined,
    fullTextAvailable: item.fullTextAvailable !== false, importedOrdinal: index + 1,
  }
}

function initializeProtocol(input = {}) {
  const question = clean(input.question); const inclusionCriteria = clean(input.inclusionCriteria); const exclusionCriteria = clean(input.exclusionCriteria)
  if (!question || !inclusionCriteria || !exclusionCriteria) throw new Error('综述问题、纳入标准和排除标准都不能为空。')
  const createdAt = new Date().toISOString()
  const protocol = { id: stableId(`${question}|${createdAt}`, 'protocol'), version: 1, question, inclusionCriteria, exclusionCriteria, searchStrategy: clean(input.searchStrategy), createdAt, status: 'draft' }
  const markdown = `# 系统文献综述协议 v1\n\n- 建立时间：${createdAt}\n- 状态：草稿，需人工确认\n\n## 综述问题\n\n${question}\n\n## 纳入标准\n\n${inclusionCriteria}\n\n## 排除标准\n\n${exclusionCriteria}\n\n## 检索式与来源\n\n${protocol.searchStrategy || '尚未填写；正式检索前必须补充。'}\n`
  return { protocol, result: { type: 'systematic_review_protocol', label: '系统综述协议', content: markdown, data: protocol, reviewState: 'draft' } }
}

function importRecords(input = {}, workspace) {
  const supplied = array(input.records).slice(0, 5000).map((item, index) => normalizeRecord(item, index, clean(item?.source) || 'manual'))
  const sourceIds = [...new Set(array(input.sourceIds).map(clean).filter(Boolean))].slice(0, 1000)
  const project = workspace?.getCurrent?.(); const database = workspace?.database
  let fromVault = []
  if (sourceIds.length) {
    if (!project || !database) throw new Error('尚未打开可读取的科研项目。')
    const placeholders = sourceIds.map(() => '?').join(',')
    const rows = database.prepare(`SELECT s.id, s.name, s.kind, s.source_metadata_json, b.id bibliographic_id, b.title, b.authors_json, b.issued, b.container_title, b.abstract, b.identifiers_json, b.raw_record_id
      FROM sources s LEFT JOIN bibliographic_items b ON b.id = s.bibliographic_item_id
      WHERE s.project_id = ? AND s.archived_at IS NULL AND s.id IN (${placeholders})`).all(project.projectId, ...sourceIds)
    fromVault = rows.map((row, index) => normalizeRecord({ id: row.bibliographic_id || row.id, title: row.title || row.name, authors_json: row.authors_json, issued: row.issued, container_title: row.container_title, abstract: row.abstract, identifiers_json: row.identifiers_json, raw_record_id: row.raw_record_id, fullTextAvailable: true }, index, `vault:${row.id}`))
  }
  const records = [...supplied, ...fromVault].filter(record => record.title || record.doi)
  if (!records.length) throw new Error('没有可导入的文献记录；请选择资料或粘贴结构化记录。')
  return { records, importedCount: records.length, sourceCounts: records.reduce((counts, record) => { counts[record.source] = (counts[record.source] || 0) + 1; return counts }, {}), importedAt: new Date().toISOString() }
}

function deduplicateRecords(input = {}) {
  const records = array(input.records); const retained = []; const duplicates = []; const keyOwners = new Map()
  for (const raw of records) {
    const record = normalizeRecord(raw, retained.length + duplicates.length, raw.source)
    const titleKey = normalized(record.title); const authorKey = normalized(record.authors[0] || '')
    const keys = [record.doi ? `doi:${record.doi}` : '', titleKey ? `title:${titleKey}` : '', titleKey && record.year && authorKey ? `aya:${authorKey}|${record.year}|${titleKey}` : ''].filter(Boolean)
    const ownerId = keys.map(key => keyOwners.get(key)).find(Boolean)
    if (ownerId) duplicates.push({ record, duplicateOf: ownerId, matchedBy: keys.find(key => keyOwners.get(key) === ownerId)?.split(':')[0] || 'combined' })
    else { retained.push(record); for (const key of keys) keyOwners.set(key, record.id) }
  }
  return { records: retained, duplicates, importedCount: records.length, retainedCount: retained.length, duplicateCount: duplicates.length, method: 'DOI 精确匹配；规范化题名；作者-年份-题名联合键' }
}

function decisionMap(value) {
  const map = new Map()
  for (const item of array(value)) for (const key of [item.recordId, item.id, item.doi, item.title].map(clean).filter(Boolean)) map.set(normalized(key), item)
  return map
}
function screenRecords(input = {}) {
  const phase = input.phase === 'full_text' ? 'full_text' : 'title_abstract'; const decisions = decisionMap(input.decisions)
  const records = array(input.records).filter(record => phase === 'title_abstract' || record.screening?.titleAbstract?.decision === 'include')
  const screened = records.map(raw => {
    const record = normalizeRecord(raw, 0, raw.source); record.screening = json(raw.screening, {})
    const decision = decisions.get(normalized(record.id)) || decisions.get(normalized(record.doi)) || decisions.get(normalized(record.title))
    const outcome = ['include', 'exclude'].includes(decision?.decision) ? decision.decision : 'undecided'; const reason = clean(decision?.reason)
    if (outcome === 'exclude' && !reason) throw new Error(`排除“${record.title || record.id}”时必须填写理由。`)
    record.screening[phase === 'title_abstract' ? 'titleAbstract' : 'fullText'] = { decision: outcome, reason: reason || undefined, decidedAt: outcome === 'undecided' ? undefined : new Date().toISOString(), decidedBy: outcome === 'undecided' ? undefined : 'user_input' }
    return record
  })
  const counts = screened.reduce((result, record) => { const decision = record.screening[phase === 'title_abstract' ? 'titleAbstract' : 'fullText'].decision; result[decision] = (result[decision] || 0) + 1; return result }, { include: 0, exclude: 0, undecided: 0 })
  const label = phase === 'title_abstract' ? '标题摘要筛选记录' : '全文筛选记录'
  const rows = screened.map(record => `| ${record.id} | ${String(record.title).replace(/\|/g, '\\|')} | ${record.screening[phase === 'title_abstract' ? 'titleAbstract' : 'fullText'].decision} | ${record.screening[phase === 'title_abstract' ? 'titleAbstract' : 'fullText'].reason || '待人工决定'} |`)
  const markdown = `# ${label}\n\n- 纳入：${counts.include}\n- 排除：${counts.exclude}\n- 未决定：${counts.undecided}\n\n| 文献 ID | 题名 | 决定 | 排除理由 |\n|---|---|---|---|\n${rows.join('\n')}\n`
  return { phase, records: screened, counts, complete: counts.undecided === 0, result: { type: `systematic_review_screening_${phase}`, label, content: markdown, data: { phase, records: screened, counts }, reviewState: 'draft' } }
}

function buildEvidenceMatrix(input = {}) {
  const evidence = json(input.evidenceData, {}); const records = array(input.records).filter(record => record.screening?.fullText?.decision === 'include')
  const fields = ['studyDesign', 'population', 'intervention', 'comparator', 'outcomes', 'findings', 'quality', 'biasRisk']
  const matrix = records.map(record => { const supplied = json(evidence[record.id] || evidence[record.doi] || evidence[record.title], {}); return { recordId: record.id, title: record.title, doi: record.doi, ...Object.fromEntries(fields.map(field => [field, clean(supplied[field]) || '待提取'])) } })
  const missingCells = matrix.reduce((count, row) => count + fields.filter(field => row[field] === '待提取').length, 0)
  const rows = matrix.map(row => `| ${row.recordId} | ${String(row.title).replace(/\|/g, '\\|')} | ${row.studyDesign} | ${row.outcomes} | ${row.findings} | ${row.quality} | ${row.biasRisk} |`)
  const markdown = `# 系统综述证据矩阵\n\n- 纳入文献：${matrix.length}\n- 待提取字段：${missingCells}\n\n| 文献 ID | 题名 | 研究设计 | 结局 | 主要发现 | 质量 | 偏倚风险 |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`
  return { matrix, includedCount: matrix.length, missingCells, result: { type: 'systematic_review_evidence_matrix', label: '系统综述证据矩阵', content: markdown, data: { matrix, missingCells }, reviewState: 'draft' } }
}

function buildPrisma(input = {}) {
  const imported = Number(input.importedCount || 0); const duplicates = Number(input.duplicateCount || 0); const title = json(input.titleAbstractCounts, {}); const full = json(input.fullTextCounts, {})
  const undecided = Number(title.undecided || 0) + Number(full.undecided || 0)
  if (undecided) throw new Error(`筛选尚未完成：还有 ${undecided} 条记录未决定，不能生成完成态 PRISMA 统计。`)
  const prisma = { identified: imported, duplicatesRemoved: duplicates, screened: imported - duplicates, titleAbstractExcluded: Number(title.exclude || 0), fullTextAssessed: Number(title.include || 0), fullTextExcluded: Number(full.exclude || 0), included: Number(full.include || 0), complete: true, generatedAt: new Date().toISOString() }
  return { prisma, markdown: `# PRISMA 流程统计\n\n- 识别记录：${prisma.identified}\n- 去重移除：${prisma.duplicatesRemoved}\n- 标题摘要筛选：${prisma.screened}\n- 标题摘要排除：${prisma.titleAbstractExcluded}\n- 全文评估：${prisma.fullTextAssessed}\n- 全文排除：${prisma.fullTextExcluded}\n- 最终纳入：${prisma.included}\n` }
}

function systematicReviewMarkdown(data = {}) {
  const prisma = data.prisma || {}; const matrix = array(data.matrix)
  return `# 系统文献综述草稿\n\n> 这是可编辑草稿。综合性结论必须引用下列稳定文献 ID；未填写的证据字段不能由 AI 猜测。\n\n## 综述问题\n\n${data.protocol?.question || ''}\n\n## PRISMA 统计\n\n- 识别 ${prisma.identified || 0} 条，去重后筛选 ${prisma.screened || 0} 条，最终纳入 ${prisma.included || 0} 条。\n\n## 证据索引\n\n${matrix.map(row => `- [${row.recordId}] ${row.title}${row.doi ? ` · DOI ${row.doi}` : ''} · 质量：${row.quality} · 偏倚风险：${row.biasRisk}`).join('\n')}\n\n## 综合结论（待人工撰写与确认）\n\n- 每句综合性结论后添加支持文献 ID，例如：[study-xxxx]。\n`
}

function validateReviewDraft(input = {}) {
  const content = String(input.content || ''); const matrix = array(input.matrix); const allowedIds = new Set(matrix.map(row => clean(row.recordId)).filter(Boolean))
  const synthesis = content.split(/^##\s+综合结论[^\n]*$/m)[1] || ''
  const claims = synthesis.split(/\r?\n/).map(line => line.replace(/^[-*\d.、\s]+/, '').trim()).filter(line => line && !line.startsWith('#') && !line.includes('每句综合性结论') && !line.includes('待人工'))
  if (!claims.length) throw new Error('综述草稿还没有人工撰写的综合性结论，不能导出完成稿。')
  const checks = claims.map(claim => {
    const citedIds = [...claim.matchAll(/\[([^\]]+)\]/g)].map(match => clean(match[1])).filter(id => allowedIds.has(id))
    return { claim, citedIds, passed: citedIds.length > 0 }
  })
  const failed = checks.filter(check => !check.passed)
  if (failed.length) throw new Error(`有 ${failed.length} 条综合性结论没有映射到实际纳入文献 ID，不能导出完成稿。`)
  const checkedAt = new Date().toISOString()
  const markdown = `# 系统综述结论追溯 QA\n\n- 检查时间：${checkedAt}\n- 综合性结论：${checks.length}\n- 全部可追溯：是\n\n${checks.map(check => `- ${check.claim} → ${check.citedIds.join('、')}`).join('\n')}\n`
  return { checkedAt, claimCount: checks.length, passed: true, checks, result: { type: 'systematic_review_traceability_qa', label: '系统综述结论追溯 QA', content: markdown, data: { checkedAt, checks }, reviewState: 'draft' } }
}

module.exports = { buildEvidenceMatrix, buildPrisma, deduplicateRecords, importRecords, initializeProtocol, normalizeRecord, screenRecords, systematicReviewMarkdown, validateReviewDraft }
