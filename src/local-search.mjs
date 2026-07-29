const ORIGIN_LABELS = {
  title: '标题',
  document: '解析正文',
  mineru: 'MinerU Markdown',
  annotation: '用户批注',
}

export function normalizeSearchText(value) {
  return value.normalize('NFKC').toLocaleLowerCase()
}

export function searchTerms(query) {
  return [...new Set(normalizeSearchText(query).split(/\s+/).map(term => term.trim()).filter(Boolean))]
}

function matchesAll(value, terms) {
  const normalized = normalizeSearchText(value)
  return terms.every(term => normalized.includes(term))
}

export function excerptAroundMatch(value, terms, radius = 92) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  const normalized = normalizeSearchText(compact)
  const indexes = terms.map(term => normalized.indexOf(term)).filter(index => index >= 0)
  const matchIndex = indexes.length ? Math.min(...indexes) : 0
  const start = Math.max(0, matchIndex - radius)
  const end = Math.min(compact.length, matchIndex + Math.max(...terms.map(term => term.length), 1) + radius)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

export function pageNumberFromLocation(location) {
  if (!location) return undefined
  const matched = /(?:^|\b)p(?:age)?\.?\s*(\d+)/i.exec(location)
  const pageNumber = matched ? Number(matched[1]) : undefined
  return pageNumber && pageNumber > 0 ? pageNumber : undefined
}

export function searchLocalLibrary(sources, annotations, query, maximumResults = 60) {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const results = []
  const sourceById = new Map(sources.map(source => [source.id, source]))

  for (const source of sources) {
    if (matchesAll(source.name, terms)) {
      results.push({
        id: `title:${source.id}`,
        sourceId: source.id,
        sourceName: source.name,
        origin: 'title',
        originLabel: ORIGIN_LABELS.title,
        excerpt: source.name,
        score: 400,
      })
    }
    if (source.mineruMarkdown && matchesAll(source.mineruMarkdown, terms)) {
      results.push({
        id: `mineru:${source.id}`,
        sourceId: source.id,
        sourceName: source.name,
        origin: 'mineru',
        originLabel: ORIGIN_LABELS.mineru,
        excerpt: excerptAroundMatch(source.mineruMarkdown, terms),
        score: 250,
      })
    }
    if (source.extractedText && matchesAll(source.extractedText, terms)) {
      results.push({
        id: `document:${source.id}`,
        sourceId: source.id,
        sourceName: source.name,
        origin: 'document',
        originLabel: ORIGIN_LABELS.document,
        excerpt: excerptAroundMatch(source.extractedText, terms),
        score: 200,
      })
    }
  }

  for (const annotation of annotations) {
    if (!annotation.sourceId) continue
    const source = sourceById.get(annotation.sourceId)
    if (!source) continue
    const searchable = [annotation.category, annotation.text, annotation.note, annotation.page].filter(Boolean).join(' ')
    if (!matchesAll(searchable, terms)) continue
    results.push({
      id: `annotation:${annotation.id}`,
      sourceId: source.id,
      sourceName: source.name,
      origin: 'annotation',
      originLabel: ORIGIN_LABELS.annotation,
      excerpt: excerptAroundMatch([annotation.text, annotation.note].filter(Boolean).join(' — '), terms),
      location: annotation.page,
      pageNumber: pageNumberFromLocation(annotation.page),
      score: 300,
    })
  }

  return results
    .sort((left, right) => right.score - left.score || left.sourceName.localeCompare(right.sourceName))
    .slice(0, maximumResults)
}
