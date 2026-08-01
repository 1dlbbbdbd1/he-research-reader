function itemIdBySourceId(items, sources) {
  const mapping = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id && item?.sourceId) mapping.set(item.sourceId, item.id)
  }
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.id && source?.bibliographicItemId) mapping.set(source.id, source.bibliographicItemId)
  }
  return mapping
}

export function buildPaperLibraryRows(items, sources, annotations) {
  const safeItems = Array.isArray(items) ? items : []
  const safeSources = Array.isArray(sources) ? sources : []
  const sourceById = new Map(safeSources.filter(source => source?.id).map(source => [source.id, source]))
  const sourceByItemId = new Map(
    safeSources
      .filter(source => source?.id && source?.bibliographicItemId)
      .map(source => [source.bibliographicItemId, source]),
  )
  const mappedItemId = itemIdBySourceId(safeItems, safeSources)
  const annotationCounts = new Map()

  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const itemId = annotation?.bibliographicItemId
      || (annotation?.sourceId ? mappedItemId.get(annotation.sourceId) : undefined)
    if (itemId) annotationCounts.set(itemId, (annotationCounts.get(itemId) || 0) + 1)
  }

  return safeItems.map(item => {
    const source = (item?.sourceId ? sourceById.get(item.sourceId) : undefined)
      || sourceByItemId.get(item?.id)
    return {
      item,
      source,
      annotationCount: annotationCounts.has(item?.id)
        ? annotationCounts.get(item.id)
        : Number(item?.annotationCount) || 0,
    }
  })
}

export function unboundLibrarySources(items, sources) {
  const boundSourceIds = new Set()
  const itemIds = new Set((Array.isArray(items) ? items : []).map(item => item?.id).filter(Boolean))
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.sourceId) boundSourceIds.add(item.sourceId)
  }
  return (Array.isArray(sources) ? sources : []).filter(source => {
    if (!source?.id || boundSourceIds.has(source.id)) return false
    return !source.bibliographicItemId || !itemIds.has(source.bibliographicItemId)
  })
}

export function paperLibrarySummary(rows) {
  const summary = {
    total: 0,
    unread: 0,
    inProgress: 0,
    finished: 0,
    mismatched: 0,
    annotationTotal: 0,
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    summary.total += 1
    summary.annotationTotal += Number(row?.annotationCount) || 0
    const state = row?.item?.readingState || {}
    if (state.readingStatus === 'finished') summary.finished += 1
    else if (state.readingStatus === 'unread' || !state.readingStatus) summary.unread += 1
    else summary.inProgress += 1
    if (state.relevance === 'mismatched') summary.mismatched += 1
  }
  return summary
}

export function readingProgressPercent(readingState) {
  if (readingState?.readingStatus === 'finished') return 100
  const lastPage = Number(readingState?.lastPage)
  const totalPages = Number(readingState?.totalPages)
  if (!Number.isFinite(lastPage) || lastPage <= 0 || !Number.isFinite(totalPages) || totalPages <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((lastPage / totalPages) * 100)))
}
