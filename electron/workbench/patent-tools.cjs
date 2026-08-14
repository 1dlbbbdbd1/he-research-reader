const crypto = require('node:crypto')

const text = value => String(value ?? '').trim()
const list = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const stableId = (value, prefix = 'fact') => `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`

const FIELD_HEADINGS = Object.freeze({
  technicalProblem: ['技术问题', '要解决的问题'],
  technicalSolution: ['技术方案', '方案内容'],
  beneficialEffects: ['有益效果', '技术效果'],
  embodiments: ['具体实施方式', '实施方式', '实施例'],
  figureNeeds: ['附图说明', '附图需求'],
})

function sourceDocument(workspace, sourceId) {
  const current = workspace?.getCurrent?.()
  if (!current || !workspace?.database) throw new Error('尚未打开可读取技术报告的科研项目。')
  const row = workspace.database.prepare('SELECT id, name, content_sha256, extracted_text, derived_markdown FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL').get(text(sourceId), current.projectId)
  if (!row) throw new Error('技术报告不存在或不属于当前项目。')
  const content = text(row.derived_markdown || row.extracted_text)
  if (!content) throw new Error('技术报告没有可读取的解析文本。')
  return { id: row.id, name: row.name, sha256: row.content_sha256, content }
}

function headingSections(content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n'); const sections = {}; let current
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/)
    if (heading) {
      current = Object.entries(FIELD_HEADINGS).find(([, aliases]) => aliases.some(alias => heading[1].includes(alias)))?.[0]
      continue
    }
    if (current && line.trim()) (sections[current] ||= []).push(line.trim())
  }
  return sections
}

function suppliedFacts(value, field, source) {
  return list(value).map((item, index) => {
    const entry = typeof item === 'string' ? { text: item, sourceQuote: item } : object(item)
    const factText = text(entry.text)
    const sourceQuote = text(entry.sourceQuote || entry.quote)
    if (!factText) throw new Error(`${field} 第 ${index + 1} 条没有内容。`)
    if (!sourceQuote) throw new Error(`${field} 第 ${index + 1} 条没有报告原文摘录，不能作为专利事实。`)
    if (!source.content.includes(sourceQuote)) throw new Error(`${field} 第 ${index + 1} 条原文摘录在技术报告中找不到。`)
    return { id: text(entry.id) || stableId(`${field}|${sourceQuote}`), field, text: factText, sourceId: source.id, sourceName: source.name, sourceSha256: source.sha256, sourceQuote, location: text(entry.location) || undefined }
  })
}

function extractedFacts(lines, field, source) {
  const paragraphs = list(lines).join('\n').split(/\n\s*\n|(?<=[。；;])\s+/).map(text).filter(Boolean)
  return paragraphs.map((sourceQuote, index) => ({ id: stableId(`${field}|${index}|${sourceQuote}`), field, text: sourceQuote, sourceId: source.id, sourceName: source.name, sourceSha256: source.sha256, sourceQuote, location: `报告“${FIELD_HEADINGS[field][0]}”章节` }))
}

function extractPatentFacts(workspace, input = {}) {
  const source = sourceDocument(workspace, input.sourceId); const supplied = object(input.technicalFacts); const sections = headingSections(source.content); const facts = {}
  for (const field of Object.keys(FIELD_HEADINGS)) facts[field] = list(supplied[field]).length ? suppliedFacts(supplied[field], field, source) : extractedFacts(sections[field], field, source)
  const missing = Object.entries(facts).filter(([, items]) => !items.length).map(([field]) => field)
  if (missing.length) throw new Error(`技术报告缺少可验证的结构化内容：${missing.join('、')}。请补充带报告原文摘录的技术事实，系统不会猜测。`)
  const allFacts = Object.values(facts).flat()
  const markdown = `# 技术事实与来源映射\n\n> 本结果只整理技术事实，用于专利草案辅助，不是法律结论。\n\n${Object.entries(facts).map(([field, items]) => `## ${FIELD_HEADINGS[field][0]}\n\n${items.map(item => `- [${item.id}] ${item.text}\n  - 来源：${item.sourceName}${item.location ? `，${item.location}` : ''}\n  - 原文：${item.sourceQuote}`).join('\n')}`).join('\n\n')}`
  return { source, facts, allFacts, result: { type: 'patent_fact_map', label: '专利技术事实与来源映射', content: markdown, data: { source: { id: source.id, name: source.name, sha256: source.sha256 }, facts }, sourceLinks: allFacts.map(item => ({ kind: 'source', factId: item.id, sourceId: item.sourceId, sha256: item.sourceSha256, location: item.location, quote: item.sourceQuote })), reviewState: 'draft' } }
}

function draftClaims(facts, suppliedClaims) {
  const factById = new Map(Object.values(facts).flat().map(item => [item.id, item]))
  const supplied = list(suppliedClaims)
  const claims = supplied.length ? supplied.map((item, index) => ({ number: Number(item.number) || index + 1, type: text(item.type) || (index === 0 ? 'independent' : 'dependent'), parent: Number(item.parent) || undefined, text: text(item.text), sourceFactIds: list(item.sourceFactIds).map(text).filter(Boolean) })) : [
    { number: 1, type: 'independent', text: `一种技术方法，其特征在于，包括：${facts.technicalSolution.map(item => item.text).join('；')}。`, sourceFactIds: facts.technicalSolution.map(item => item.id) },
    ...facts.embodiments.slice(0, 4).map((item, index) => ({ number: index + 2, type: 'dependent', parent: 1, text: `根据权利要求1所述的方法，其特征在于：${item.text}。`, sourceFactIds: [item.id] })),
  ]
  for (const claim of claims) {
    if (!claim.text) throw new Error(`权利要求 ${claim.number} 没有文本。`)
    if (!claim.sourceFactIds.length) throw new Error(`权利要求 ${claim.number} 没有来源事实映射。`)
    for (const factId of claim.sourceFactIds) if (!factById.has(factId)) throw new Error(`权利要求 ${claim.number} 引用了不存在的事实：${factId}`)
    if (claim.type === 'dependent' && (!claim.parent || !claims.some(parent => parent.number === claim.parent && parent.number < claim.number))) throw new Error(`从属权利要求 ${claim.number} 的引用关系无效。`)
  }
  return claims
}

function patentDraftMarkdown(data) {
  const { title, facts, claims, risks } = data
  const abstract = [...facts.technicalProblem.slice(0, 1), ...facts.technicalSolution.slice(0, 2), ...facts.beneficialEffects.slice(0, 1)].map(item => item.text).join(' ')
  return `# ${title}\n\n> **重要声明：这是依据已映射技术事实生成的中国发明专利草案辅助材料，不是法律意见、授权结论或新颖性判断。正式申请前必须由用户和专利专业人员复核。**\n\n## 摘要\n\n${abstract}\n\n## 权利要求书草案\n\n${claims.map(claim => `${claim.number}. ${claim.text}\n\n   来源映射：${claim.sourceFactIds.map(id => `[${id}]`).join('、')}`).join('\n\n')}\n\n## 说明书草案\n\n### 技术领域\n\n本草案涉及用户所确认技术事实对应的技术领域，具体领域名称待人工确认。\n\n### 背景技术与技术问题\n\n${facts.technicalProblem.map(item => `- [${item.id}] ${item.text}`).join('\n')}\n\n### 技术方案\n\n${facts.technicalSolution.map(item => `- [${item.id}] ${item.text}`).join('\n')}\n\n### 有益效果\n\n${facts.beneficialEffects.map(item => `- [${item.id}] ${item.text}`).join('\n')}\n\n### 具体实施方式\n\n${facts.embodiments.map(item => `- [${item.id}] ${item.text}`).join('\n')}\n\n### 附图说明与需求\n\n${facts.figureNeeds.map(item => `- [${item.id}] ${item.text}`).join('\n')}\n\n## 人工确认风险清单\n\n${risks.map(item => `- [${item.severity}] ${item.message}`).join('\n')}\n`
}

function buildPatentDraft(input = {}) {
  const facts = object(input.facts); const title = text(input.title) || '中国发明专利申请文件草案'
  const claims = draftClaims(facts, input.claims)
  const terms = list(input.terms).map(text).filter(Boolean)
  const allText = [...Object.values(facts).flat().map(item => item.text), ...claims.map(item => item.text)].join('\n')
  const risks = [
    { id: 'novelty-search', severity: 'blocking', status: 'not_performed', message: '未接入真实专利数据库，新颖性检索未完成。' },
    { id: 'legal-opinion', severity: 'blocking', status: 'not_performed', message: '法律判断未完成；本草案不构成可专利性、侵权或授权意见。' },
    { id: 'technical-field', severity: 'review', status: 'pending_human', message: '技术领域名称需要人工确认。' },
    ...terms.filter(term => !allText.includes(term)).map(term => ({ id: `term-${stableId(term, 'risk')}`, severity: 'review', status: 'pending_human', message: `指定术语“${term}”没有贯穿草案。` })),
  ]
  const data = { title, facts, claims, terms, noveltySearch: { status: 'not_performed', source: null }, legalAssessment: { status: 'not_performed' }, risks }
  const markdown = patentDraftMarkdown(data)
  return { data, markdown, result: { type: 'patent_draft', label: '中国发明专利申请文件草案', content: markdown, data, sourceLinks: Object.values(facts).flat().map(item => ({ kind: 'source', factId: item.id, sourceId: item.sourceId, sha256: item.sourceSha256, location: item.location, quote: item.sourceQuote })), reviewState: 'draft' } }
}

function validatePatentDraft(input = {}) {
  const data = object(input.data); const content = text(input.content); const facts = object(data.facts); const factsById = new Map(Object.values(facts).flat().map(item => [item.id, item])); const claims = list(data.claims)
  if (!content.includes('不是法律意见') || !content.includes('新颖性检索未完成')) throw new Error('专利草案缺少法律边界或未完成的新颖性状态。')
  for (const claim of claims) {
    if (!content.includes(claim.text)) throw new Error(`草案缺少权利要求 ${claim.number}。`)
    for (const factId of claim.sourceFactIds) if (!factsById.has(factId) || !content.includes(`[${factId}]`)) throw new Error(`权利要求 ${claim.number} 的来源映射不完整。`)
  }
  const figureMarks = [...content.matchAll(/附图\s*([0-9]+)/g)].map(match => match[1]); const unknownFigureMarks = figureMarks.filter(mark => !Object.values(facts).flat().some(item => item.field === 'figureNeeds' && item.text.includes(mark)))
  if (unknownFigureMarks.length) throw new Error(`草案出现没有报告支持的附图标记：${[...new Set(unknownFigureMarks)].join('、')}`)
  const qa = { passed: true, claimCount: claims.length, mappedClaimCount: claims.length, unsupportedClaimCount: 0, terminologyRisks: list(data.risks).filter(item => String(item.id).startsWith('term-')).length, noveltySearchStatus: data.noveltySearch?.status || 'not_performed', legalAssessmentStatus: data.legalAssessment?.status || 'not_performed', checkedAt: new Date().toISOString() }
  const markdown = `# 专利草案 QA\n\n- 权利要求：${qa.claimCount}\n- 有来源映射：${qa.mappedClaimCount}\n- 无来源技术特征：${qa.unsupportedClaimCount}\n- 术语风险：${qa.terminologyRisks}\n- 新颖性检索：${qa.noveltySearchStatus}\n- 法律判断：${qa.legalAssessmentStatus}\n- 结论：草案事实追溯检查通过；法律与新颖性事项仍需人工处理。\n`
  return { qa, result: { type: 'patent_draft_qa', label: '专利草案 QA 与风险清单', content: markdown, data: { qa, risks: data.risks }, reviewState: 'draft' } }
}

module.exports = { buildPatentDraft, extractPatentFacts, patentDraftMarkdown, validatePatentDraft }
