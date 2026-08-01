export function annotationPage(annotation) {
  const page = annotation?.anchor?.state === 'resolved'
    ? annotation.anchor.pageNumber
    : undefined
  if (Number.isInteger(page) && page > 0) return page
  const match = String(annotation?.page || '').match(/(?:p\.|第)\s*(\d+)/i)
  const legacyPage = match ? Number.parseInt(match[1], 10) : undefined
  return Number.isInteger(legacyPage) && legacyPage > 0 ? legacyPage : undefined
}

export function normalizedAnnotationRects(annotation) {
  const rects = Array.isArray(annotation?.anchor?.rects) ? annotation.anchor.rects : []
  return rects.flatMap(rect => {
    const values = [rect?.x, rect?.y, rect?.width, rect?.height].map(Number)
    if (!values.every(Number.isFinite)) return []
    const [x, y, width, height] = values
    if (width <= 0 || height <= 0 || x >= 1 || y >= 1 || x + width <= 0 || y + height <= 0) return []
    const left = Math.max(0, Math.min(1, x))
    const top = Math.max(0, Math.min(1, y))
    const right = Math.max(left, Math.min(1, x + width))
    const bottom = Math.max(top, Math.min(1, y + height))
    if (right === left || bottom === top) return []
    return [{ x: left, y: top, width: right - left, height: bottom - top }]
  })
}

export function annotationHighlightsForPage(annotations, pageNumber) {
  return (Array.isArray(annotations) ? annotations : [])
    .filter(annotation => annotationPage(annotation) === pageNumber)
    .map(annotation => ({
      id: annotation.id,
      rects: normalizedAnnotationRects(annotation),
    }))
    .filter(highlight => highlight.rects.length > 0)
}
