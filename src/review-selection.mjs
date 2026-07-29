export function reviewItemIdBySourceId(sources, items) {
  const mapping = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id && item?.sourceId) mapping.set(item.sourceId, item.id)
  }
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.id && source?.bibliographicItemId) mapping.set(source.id, source.bibliographicItemId)
  }
  return mapping
}

export function reviewAnnotationsForItems(annotations, sources, items, selectedItemIds) {
  const selected = new Set(Array.isArray(selectedItemIds) ? selectedItemIds : [])
  const itemIdBySourceId = reviewItemIdBySourceId(sources, items)
  return (Array.isArray(annotations) ? annotations : []).filter(annotation => {
    const itemId = annotation?.sourceId ? itemIdBySourceId.get(annotation.sourceId) : undefined
    return Boolean(itemId && selected.has(itemId))
  })
}

export function reviewAnnotationCounts(annotations, sources, items) {
  const counts = new Map()
  const itemIdBySourceId = reviewItemIdBySourceId(sources, items)
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    const itemId = annotation?.sourceId ? itemIdBySourceId.get(annotation.sourceId) : undefined
    if (itemId) counts.set(itemId, (counts.get(itemId) || 0) + 1)
  }
  return counts
}

export function readingProgressLabel(readingState) {
  const lastPage = Number(readingState?.lastPage)
  const totalPages = Number(readingState?.totalPages)
  if (Number.isInteger(lastPage) && lastPage > 0 && Number.isInteger(totalPages) && totalPages > 0) {
    const boundedPage = Math.min(lastPage, totalPages)
    const percent = Math.min(100, Math.max(1, Math.round((boundedPage / totalPages) * 100)))
    return `${boundedPage}/${totalPages} 页 · ${percent}%`
  }
  if (Number.isInteger(lastPage) && lastPage > 0) return `读到第 ${lastPage} 页`
  if (readingState?.readingStatus === 'finished') return '已标记读完'
  return '进度未记录'
}
