const crypto = require('node:crypto')

const DEEP_RESEARCH_ID = 'deep-literature-research'
const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

function searchPlan(value, { round, previousQueries = [] } = {}) {
  const maximum = round === 1 ? 3 : 2
  if (!value || !Array.isArray(value.queries) || value.queries.length > maximum) throw new Error(`检索计划需要 queries 数组，本轮最多 ${maximum} 组。`)
  const seen = new Set(previousQueries.map(query => compact(query).toLowerCase()))
  const queries = []
  for (const item of value.queries) {
    if (typeof item !== 'string' || !compact(item) || compact(item).length > 240) throw new Error('每组检索词需要 1–240 个字符。')
    const query = compact(item)
    if (!seen.has(query.toLowerCase())) { seen.add(query.toLowerCase()); queries.push(query) }
  }
  if (round === 1 && !queries.length) throw new Error('首次研究至少需要一组检索词。')
  const reason = compact(value.reason)
  if (!reason) throw new Error('检索计划需要说明本轮查找或停止的原因。')
  return { round, queries, reason: reason.slice(0, 1800), steps: queries.flatMap(query => ['crossref', 'arxiv'].map(provider => ({
    kind: 'tool', toolName: 'literature.search', title: `${provider === 'crossref' ? 'Crossref' : 'arXiv'}：${query}`,
    rationale: reason.slice(0, 1200), input: { provider, query, _conversationWorkflowStep: `deep-search-${round}` },
  }))) }
}

function searchUrl(provider, query) {
  if (!['crossref', 'arxiv'].includes(provider) || typeof query !== 'string' || !compact(query) || query.length > 240) throw new Error('文献检索需要有效数据库和 1–240 字检索词。')
  const url = new URL(provider === 'crossref' ? 'https://api.crossref.org/works' : 'https://export.arxiv.org/api/query')
  if (provider === 'crossref') {
    url.searchParams.set('query.bibliographic', compact(query)); url.searchParams.set('rows', '10')
    url.searchParams.set('select', 'DOI,title,author,published,URL,abstract,type')
  } else {
    // Treat planner text as terms, never as executable arXiv query syntax.
    const words = compact(query).replace(/["():\\]/g, ' ').split(/\s+/).filter(Boolean)
    if (!words.length) throw new Error('arXiv 检索词没有有效内容。')
    url.searchParams.set('search_query', words.map(word => `all:"${word}"`).join(' AND '))
    url.searchParams.set('start', '0'); url.searchParams.set('max_results', '10')
  }
  return url.toString()
}

function evidenceCatalog(searchSession, steps = []) {
  const catalog = searchSession.candidates.map(item => ({ id: item.id, title: item.title, url: item.url, evidenceLevel: item.evidenceLevel, text: compact(item.abstract).slice(0, 3500) }))
  for (const step of steps.filter(item => item.status === 'completed' && item.toolName === 'research.source.read')) {
    const document = step.output?.document
    if (document?.text) catalog.push({ id: `source:${step.id}`, title: document.source?.name || '本次原始材料', evidenceLevel: 'provided_text', text: String(document.text), source: document.source })
  }
  return catalog
}

function evidenceReport(value, catalog, searchSession, plans) {
  if (!value || !Array.isArray(value.claims) || value.claims.length > 20 || !Array.isArray(value.gaps) || !Array.isArray(value.nextSteps)) throw new Error('研究报告需要 claims（最多 20 项）、gaps 和 nextSteps 数组。')
  const byId = new Map(catalog.map(item => [item.id, item]))
  const claims = value.claims.map((claim, index) => {
    const statement = compact(claim?.statement).slice(0, 1600)
    const sourceId = compact(claim?.sourceId); const quote = compact(claim?.quote).slice(0, 2000)
    const source = byId.get(sourceId)
    const matched = Boolean(statement && source && quote.length >= 12 && compact(source.text).includes(quote))
    const relation = ['supports', 'contradicts', 'background'].includes(claim?.relation) ? claim.relation : 'background'
    return { id: `claim-${index + 1}`, statement, sourceId, quote, relation, matched, evidenceLevel: source?.evidenceLevel, title: source?.title, url: source?.url,
      issue: matched ? undefined : !source ? '来源 ID 不在本轮证据中' : quote.length < 12 ? '需要至少 12 字的原文摘录' : !statement ? '缺少主张' : '摘录未在本轮提供的原文中找到' }
  })
  const strings = list => list.slice(0, 12).map(item => compact(item).slice(0, 1200)).filter(Boolean)
  const gaps = strings(value.gaps); const nextSteps = strings(value.nextSteps)
  const hypotheses = strings(Array.isArray(value.hypotheses) ? value.hypotheses : [])
  const passed = claims.length > 0 && claims.every(claim => claim.matched)
  const relationLabels = { supports: '支持（待语义复核）', contradicts: '反对（待语义复核）', background: '背景' }
  const lines = ['# 深度文献研究', '', `检索 ${searchSession.requests.length} 次，去重后 ${searchSession.candidateCount} 篇，数据状态：${searchSession.status}。`, '', '## 检索过程', '']
  for (const plan of plans) lines.push(`- 第 ${plan.round} 轮：${plan.queries.join('；') || '停止补查'}。${plan.reason}`)
  for (const error of searchSession.errors) lines.push(`- 检索问题：${error.provider || '数据库'}：${error.message}`)
  lines.push('', '## 证据与主张', '', '摘录匹配只核对出处；支持或反对关系、方法质量与适用范围需要逐项复核。', '')
  for (const claim of claims) {
    lines.push(`### ${claim.id} · ${claim.matched ? '出处已匹配' : '待修正来源'}`, '', claim.statement || '主张缺失', '', `- 关系：${relationLabels[claim.relation]}`, `- 来源：${claim.title || claim.sourceId}（${claim.sourceId}，${claim.evidenceLevel || '未知'}）`, ...(claim.url ? [`- 链接：${claim.url}`] : []), `- 原文摘录：${claim.quote || '未提供'}`, ...(claim.issue ? [`- 核验问题：${claim.issue}`] : []), '')
  }
  if (!claims.length) lines.push('本轮未形成可核对的证据主张。', '')
  for (const [title, items] of [['待验证假设', hypotheses], ['证据缺口', gaps], ['下一步', nextSteps]]) lines.push(`## ${title}`, '', ...(items.length ? items.map(item => `- ${item}`) : ['本轮未列出。']), '')
  const content = lines.join('\n')
  return { content, data: { searchSession, plans, claims, hypotheses, gaps, nextSteps, evidenceAudit: { passed, matchedCount: claims.filter(item => item.matched).length, claimCount: claims.length, scope: 'source-excerpt-match', contentSha256: hash(content) } } }
}

module.exports = { DEEP_RESEARCH_ID, searchPlan, searchUrl, evidenceCatalog, evidenceReport }
