function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizedPdfSearchQuery(value) {
  return normalizedText(value).slice(0, 160)
}

export function pdfPageSearchMatches(text, query, excerptRadius = 70) {
  const haystack = normalizedText(text)
  const needle = normalizedPdfSearchQuery(query)
  if (!haystack || !needle) return { count: 0, excerpt: '' }
  const loweredHaystack = haystack.toLocaleLowerCase()
  const loweredNeedle = needle.toLocaleLowerCase()
  let offset = 0
  let first = -1
  let count = 0
  while (offset <= loweredHaystack.length - loweredNeedle.length) {
    const match = loweredHaystack.indexOf(loweredNeedle, offset)
    if (match < 0) break
    if (first < 0) first = match
    count += 1
    offset = match + Math.max(1, loweredNeedle.length)
  }
  if (first < 0) return { count: 0, excerpt: '' }
  const start = Math.max(0, first - excerptRadius)
  const end = Math.min(haystack.length, first + needle.length + excerptRadius)
  return {
    count,
    excerpt: `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}`,
  }
}

export async function searchPdfDocument(document, query, options = {}) {
  const normalizedQuery = normalizedPdfSearchQuery(query)
  if (!normalizedQuery) return []
  const limit = Math.max(1, Math.min(Number(options.limit) || 120, 500))
  const results = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (options.isCancelled?.()) return []
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map(item => item && typeof item.str === 'string' ? item.str : '')
      .filter(Boolean)
      .join(' ')
    const match = pdfPageSearchMatches(text, normalizedQuery)
    if (match.count) {
      results.push({ pageNumber, matchCount: match.count, excerpt: match.excerpt })
      if (results.length >= limit) break
    }
    options.onProgress?.({ pageNumber, totalPages: document.numPages, resultCount: results.length })
  }
  return results
}

async function outlineDestinationPage(document, destination) {
  try {
    const resolved = typeof destination === 'string'
      ? await document.getDestination(destination)
      : destination
    if (!Array.isArray(resolved) || !resolved.length) return undefined
    const target = resolved[0]
    if (Number.isInteger(target)) return Number(target) + 1
    if (!target) return undefined
    return (await document.getPageIndex(target)) + 1
  } catch {
    return undefined
  }
}

export async function loadPdfOutline(document) {
  const root = await document.getOutline()
  if (!Array.isArray(root) || !root.length) return []
  const entries = []
  async function visit(items, depth) {
    for (const item of items) {
      const title = normalizedText(item?.title) || '未命名章节'
      entries.push({
        id: `outline-${entries.length + 1}`,
        title,
        depth,
        pageNumber: await outlineDestinationPage(document, item?.dest),
      })
      if (Array.isArray(item?.items) && item.items.length) await visit(item.items, depth + 1)
    }
  }
  await visit(root, 0)
  return entries
}

export function normalizeReaderSourceState(value, hasStructuredText = true) {
  const allowedModes = new Set(['original', 'markdown', 'parallel', 'bilingual'])
  let viewMode = allowedModes.has(value?.viewMode) ? value.viewMode : 'original'
  if (!hasStructuredText && viewMode !== 'original') viewMode = 'original'
  const numericZoom = Number(value?.zoom)
  const zoom = Number.isFinite(numericZoom)
    ? Math.max(.5, Math.min(3, Math.round(numericZoom * 100) / 100))
    : 1
  return { viewMode, zoom }
}

export function restoredReaderPage(value, totalPages) {
  const page = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 1
  const maximum = Number.isFinite(Number(totalPages)) && Number(totalPages) > 0
    ? Math.floor(Number(totalPages))
    : Number.MAX_SAFE_INTEGER
  return Math.max(1, Math.min(page, maximum))
}
