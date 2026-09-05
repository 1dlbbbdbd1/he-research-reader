const { XMLParser, XMLValidator } = require('fast-xml-parser')

function clean(value) { return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
function year(value) { const number = Number(value); return Number.isInteger(number) && number > 1000 && number < 3000 ? number : undefined }
function crossrefItem(item) {
  const doi = clean(item.DOI).toLowerCase(); const title = clean(Array.isArray(item.title) ? item.title[0] : item.title)
  if (!doi || !title) return undefined
  const dateParts = item.published?.['date-parts'] || item.issued?.['date-parts'] || item.created?.['date-parts']
  return { id: `doi:${doi}`, title, doi, year: year(dateParts?.[0]?.[0]), abstract: clean(item.abstract) || undefined, evidenceLevel: 'metadata', provider: 'crossref', url: clean(item.URL) || `https://doi.org/${doi}` }
}
function arxivItem(entry) {
  const url = clean(entry.id); const arxivId = (url.match(/(?:abs\/|arxiv:)([^\s?#]+)/i) || [])[1]
  const title = clean(entry.title); if (!arxivId || !title) return undefined
  return { id: `arxiv:${arxivId.replace(/v\d+$/i, '')}`, title, arxivId, year: year(clean(entry.published).slice(0, 4)), abstract: clean(entry.summary) || undefined, evidenceLevel: 'preprint_metadata', provider: 'arxiv', url }
}
function providerFor(url) { try { const host = new URL(url).hostname; return host === 'api.crossref.org' ? 'crossref' : host === 'export.arxiv.org' ? 'arxiv' : undefined } catch { return undefined } }
function scopeFor(url) { try { const parsed = new URL(url); return Object.fromEntries([...parsed.searchParams.entries()].filter(([key]) => ['query.bibliographic', 'search_query', 'rows', 'max_results', 'start'].includes(key))) } catch { return {} } }

function parseLiteratureSearch(fetchSteps, { objective = '', queriedAt } = {}) {
  const requests = []; const candidates = []; const errors = []; const duplicates = []; const seen = new Map()
  for (const step of fetchSteps) {
    const output = step.output || {}; const url = String(output.url || step.input?.url || ''); const provider = providerFor(url)
    if (!provider) continue
    requests.push({ provider, url, queriedAt: step.completedAt || queriedAt || null, scope: scopeFor(url) })
    try {
      if (output.truncated) throw new Error('检索响应被截断，请缩小本轮检索范围。')
      const body = String(output.text || '')
      const records = provider === 'crossref'
        ? (() => { const payload = JSON.parse(body); if (!Array.isArray(payload.message?.items)) throw new Error('Crossref 响应缺少文献列表。'); return payload.message.items.map(crossrefItem).filter(Boolean) })()
        : (() => { if (XMLValidator.validate(body) !== true) throw new Error('arXiv 响应不是有效 XML。'); const feed = new XMLParser({ ignoreAttributes: false }).parse(body).feed; if (!feed || typeof feed !== 'object') throw new Error('arXiv 响应缺少 feed。'); const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []; return entries.map(arxivItem).filter(Boolean) })()
      for (const record of records) {
        if (seen.has(record.id)) { duplicates.push({ id: record.id, provider, url }); continue }
        seen.set(record.id, record); candidates.push(record)
      }
    } catch (error) { errors.push({ provider, url, message: error instanceof Error ? error.message : '解析检索响应失败。' }) }
  }
  if (!requests.length) errors.push({ message: '本次运行没有可识别的文献检索响应。' })
  return { query: String(objective), requests, candidateCount: candidates.length, duplicateSources: duplicates, errors, status: errors.length ? candidates.length ? 'partial' : 'error' : 'ok', candidates }
}

module.exports = { parseLiteratureSearch }
