const crypto = require('node:crypto')

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function normalize(value) { return clean(value).normalize('NFKD').toLowerCase().replace(/https?:\/\/(?:dx\.)?doi\.org\//g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function unique(values) { return [...new Set(values.filter(Boolean))] }
function stableId(value, prefix = 'ref') { return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}` }
function doiFrom(value) { return clean(value).match(/\b10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0]?.replace(/[),.;\]}]+$/, '').toLowerCase() }
function yearFrom(value) { return clean(value).match(/\b(?:18|19|20)\d{2}\b/)?.[0] }
function titleFromCitation(value) {
  const text = clean(value).replace(/^\[?\d+\]?[.、\s]*/, '')
  const quoted = text.match(/[“"]([^”"]{8,300})[”"]/)
  if (quoted) return clean(quoted[1])
  const parts = text.split(/\.\s+/).map(clean).filter(Boolean)
  return parts.find(part => part.length >= 12 && !/^https?:|^doi\b/i.test(part)) || parts[0] || text
}
function authorTokens(value) {
  const beforeYear = clean(value).split(/\b(?:18|19|20)\d{2}\b/)[0]
  return unique((beforeYear.match(/[\p{L}][\p{L}'-]{1,40}/gu) || []).map(normalize)).slice(0, 8)
}
function tokenSimilarity(left, right) {
  const a = new Set(normalize(left).split(' ').filter(Boolean)); const b = new Set(normalize(right).split(' ').filter(Boolean))
  if (!a.size || !b.size) return 0
  const intersection = [...a].filter(item => b.has(item)).length
  return (2 * intersection) / (a.size + b.size)
}
function referenceLines(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean)
  const heading = lines.findIndex(line => /^(references|参考文献|bibliography)\s*[:：]?$/i.test(line))
  const candidates = (heading >= 0 ? lines.slice(heading + 1) : lines).filter(line => (
    /^\[?\d{1,4}\]?[.、\s]/.test(line)
    || /\b10\.\d{4,9}\//i.test(line)
    || (/\b(?:18|19|20)\d{2}\b/.test(line) && line.length >= 30)
  ))
  const joined = []
  for (const line of candidates) {
    if (joined.length && !/^\[?\d{1,4}\]?[.、\s]/.test(line) && !/\b10\.\d{4,9}\//i.test(line) && line.length < 80) joined[joined.length - 1] += ` ${line}`
    else joined.push(line)
  }
  return unique(joined.map(clean)).slice(0, 200)
}

function extractCitations(document = {}) {
  const text = String(document.text ?? document.content ?? '')
  const source = document.source || { kind: 'pasted_text' }
  const references = referenceLines(text).map((raw, index) => {
    const doi = doiFrom(raw); const year = yearFrom(raw); const title = titleFromCitation(raw)
    return {
      id: stableId(`${index}:${raw}`), ordinal: index + 1, raw, doi, title, year,
      authorTokens: authorTokens(raw),
      classification: doi ? 'doi' : title && year ? 'title_author_year' : title ? 'title_or_incomplete' : 'incomplete',
      source: { ...source, lineHint: index + 1 },
    }
  })
  return { references, count: references.length, source, warnings: references.length ? [] : ['未识别到可核验的参考文献条目；请确认文本包含参考文献列表。'] }
}

function crossrefMetadata(item = {}) {
  const dateParts = item.published?.['date-parts']?.[0] || item.issued?.['date-parts']?.[0] || []
  return {
    doi: clean(item.DOI).toLowerCase() || undefined,
    title: clean(Array.isArray(item.title) ? item.title[0] : item.title),
    authors: Array.isArray(item.author) ? item.author.map(author => clean([author.given, author.family].filter(Boolean).join(' '))).filter(Boolean) : [],
    year: dateParts[0] ? String(dateParts[0]) : undefined,
    journal: clean(Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title']),
    volume: clean(item.volume) || undefined, issue: clean(item.issue) || undefined, pages: clean(item.page) || undefined,
    type: clean(item.type) || undefined, url: clean(item.URL) || undefined, score: Number(item.score) || undefined,
  }
}
function compareReference(reference, metadata, directDoi) {
  const title = tokenSimilarity(reference.title, metadata.title)
  const expectedAuthors = new Set(reference.authorTokens)
  const actualAuthors = new Set(metadata.authors.flatMap(author => normalize(author).split(' ')).filter(Boolean))
  const author = expectedAuthors.size ? [...expectedAuthors].some(token => actualAuthors.has(token)) : undefined
  const year = reference.year && metadata.year ? reference.year === metadata.year : undefined
  const doi = reference.doi && metadata.doi ? reference.doi === metadata.doi : undefined
  const conflicts = [doi === false ? 'DOI' : '', year === false ? '年份' : '', title > 0 && title < 0.45 ? '题名' : ''].filter(Boolean)
  let status = 'suspected_match'
  if (conflicts.length && (directDoi || title >= 0.72)) status = 'metadata_conflict'
  else if ((directDoi && !conflicts.length) || (title >= 0.82 && author !== false && year !== false)) status = 'confirmed'
  else if (title < 0.45 && !directDoi) status = 'not_found'
  return { status, comparison: { titleSimilarity: Number(title.toFixed(3)), author, year, doi, conflicts } }
}

async function crossrefRequest(fetchImpl, url, contactEmail) {
  const requestUrl = new URL(url)
  if (contactEmail) requestUrl.searchParams.set('mailto', contactEmail)
  const response = await fetchImpl(requestUrl, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': `Hs-Research-Assistant/1.1 (citation-verification${contactEmail ? `; mailto:${contactEmail}` : ''})` } })
  if (!response.ok) {
    const error = new Error(`Crossref 请求失败：HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.json()
}

async function verifyWithCrossref(references, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const contactEmail = clean(options.contactEmail)
  const queriedAt = new Date().toISOString(); const entries = []
  for (const reference of Array.isArray(references) ? references.slice(0, 200) : []) {
    try {
      let payload; let candidates; let queryUrl; const directDoi = Boolean(reference.doi)
      if (reference.doi) {
        queryUrl = `https://api.crossref.org/works/${encodeURIComponent(reference.doi)}`
        payload = await crossrefRequest(fetchImpl, queryUrl, contactEmail)
        candidates = payload?.message ? [payload.message] : []
      } else {
        queryUrl = 'https://api.crossref.org/works'
        const url = new URL(queryUrl)
        url.searchParams.set('query.bibliographic', reference.raw)
        url.searchParams.set('rows', '3')
        payload = await crossrefRequest(fetchImpl, url, contactEmail)
        candidates = payload?.message?.items || []
      }
      if (!candidates.length) {
        entries.push({ reference, status: 'not_found', candidates: [], evidence: { provider: 'Crossref', queriedAt, queryUrl }, note: 'Crossref 未返回候选；这不证明文献不存在。' })
        continue
      }
      const ranked = candidates.map(item => crossrefMetadata(item)).map(metadata => ({ metadata, ...compareReference(reference, metadata, directDoi) })).sort((a, b) => b.comparison.titleSimilarity - a.comparison.titleSimilarity)
      const best = ranked[0]
      entries.push({ reference, status: best.status, match: best.metadata, comparison: best.comparison, candidates: ranked.slice(0, 3).map(item => item.metadata), evidence: { provider: 'Crossref', queriedAt, queryUrl }, note: best.status === 'not_found' ? '候选相似度不足；这不证明文献不存在。' : undefined })
    } catch (error) {
      entries.push({ reference, status: 'unverifiable', candidates: [], evidence: { provider: 'Crossref', queriedAt }, error: error instanceof Error ? error.message : 'Crossref 查询失败', note: '当前无法核验，保留为待人工复核。' })
    }
  }
  const summary = entries.reduce((result, entry) => { result[entry.status] = (result[entry.status] || 0) + 1; return result }, {})
  return { entries, summary, sources: [{ provider: 'Crossref REST API', endpoint: 'https://api.crossref.org/works', queriedAt, identified: Boolean(contactEmail), interpretation: '查询不到或低相似度不能证明文献不存在。' }] }
}

function citationReportMarkdown(data = {}) {
  const labels = { confirmed: '确认存在', suspected_match: '疑似匹配', metadata_conflict: '信息冲突', not_found: '未找到', unverifiable: '无法核验' }
  const rows = (data.entries || []).map(entry => {
    const match = entry.match || {}; const conflicts = entry.comparison?.conflicts?.join('、') || ''
    return `| ${entry.reference?.ordinal || ''} | ${labels[entry.status] || entry.status} | ${String(entry.reference?.raw || '').replace(/\|/g, '\\|')} | ${String(match.title || '').replace(/\|/g, '\\|')} | ${match.doi || ''} | ${conflicts || entry.note || ''} |`
  })
  return `# 引用真实性核验报告\n\n> 本报告使用 Crossref 公开元数据进行辅助核验。“未找到”只表示本次查询没有得到可靠候选，不等于文献不存在。原参考文献未被覆盖。\n\n## 汇总\n\n- 确认存在：${data.summary?.confirmed || 0}\n- 疑似匹配：${data.summary?.suspected_match || 0}\n- 信息冲突：${data.summary?.metadata_conflict || 0}\n- 未找到：${data.summary?.not_found || 0}\n- 无法核验：${data.summary?.unverifiable || 0}\n\n## 逐条结果\n\n| # | 结论 | 原始条目 | 匹配题名 | DOI | 冲突或说明 |\n|---:|---|---|---|---|---|\n${rows.join('\n')}\n\n## 查询来源\n\n${(data.sources || []).map(source => `- ${source.provider} · ${source.queriedAt} · ${source.endpoint}`).join('\n')}\n`
}

module.exports = { citationReportMarkdown, compareReference, crossrefMetadata, extractCitations, referenceLines, tokenSimilarity, verifyWithCrossref }
