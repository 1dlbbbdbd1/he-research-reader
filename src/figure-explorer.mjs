function normalized(value) {
  return String(value || '').normalize('NFKC').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()
}

function pageFor(text, layoutBlocks) {
  const target = normalized(text).toLocaleLowerCase()
  if (!target) return undefined
  const matches = (Array.isArray(layoutBlocks) ? layoutBlocks : []).filter(block => {
    const content = normalized(block?.text).toLocaleLowerCase()
    return content.length >= 3 && (content.includes(target) || target.includes(content))
  })
  const pages = [...new Set(matches.map(block => Number(block.pageNumber)).filter(page => Number.isInteger(page) && page > 0))]
  return pages.length === 1 ? pages[0] : undefined
}

function captionLabel(kind, caption, fallbackIndex) {
  const patterns = kind === 'figure'
    ? /(?:fig(?:ure)?\.?|图)\s*([A-Za-z]?\d+(?:[.-]\d+)*)/i
    : kind === 'table'
      ? /(?:table|表)\s*([A-Za-z]?\d+(?:[.-]\d+)*)/i
      : /(?:algorithm|alg\.?|算法)\s*([A-Za-z]?\d+(?:[.-]\d+)*)/i
  const number = patterns.exec(caption)?.[1]
  const prefix = kind === 'figure' ? 'Figure' : kind === 'table' ? 'Table' : 'Algorithm'
  return `${prefix} ${number || fallbackIndex}`
}

export function extractFigureExplorerItems(markdown, layoutBlocks = []) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return []
  const lines = source.split('\n')
  const items = []
  let figureIndex = 0
  let tableIndex = 0
  let algorithmIndex = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
    let image
    while ((image = imagePattern.exec(line))) {
      figureIndex += 1
      const neighborCaption = [lines[index - 1], lines[index + 1]].map(normalized).find(value => /(?:fig(?:ure)?\.?|图)\s*[A-Za-z]?\d+/i.test(value))
      const caption = neighborCaption || normalized(image[1]) || `未命名图 ${figureIndex}`
      items.push({
        id: `figure-${index}-${figureIndex}`,
        kind: 'figure',
        label: captionLabel('figure', caption, figureIndex),
        caption,
        assetPath: decodeURIComponent(image[2]),
        pageNumber: pageFor(caption, layoutBlocks),
        markdownLine: index + 1,
      })
    }

    if (index + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const start = index
      const tableLines = [line, lines[index + 1]]
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        tableLines.push(lines[index])
        index += 1
      }
      index -= 1
      tableIndex += 1
      const neighborCaption = [lines[start - 1], lines[index + 1]].map(normalized).find(value => /(?:table|表)\s*[A-Za-z]?\d+/i.test(value))
      const caption = neighborCaption || normalized(line).split('|').filter(Boolean).slice(0, 3).join(' · ') || `未命名表 ${tableIndex}`
      items.push({
        id: `table-${start}-${tableIndex}`,
        kind: 'table',
        label: captionLabel('table', caption, tableIndex),
        caption,
        preview: tableLines.slice(0, 6).join('\n'),
        pageNumber: pageFor(neighborCaption || line, layoutBlocks),
        markdownLine: start + 1,
      })
    }

    const fence = /^\s*```\s*([^\s]*)/.exec(line)
    if (fence) {
      const start = index
      const body = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      const previous = normalized(lines[start - 1])
      const content = body.join('\n')
      const looksLikeAlgorithm = /(?:algorithm|alg\.?|算法)\s*[A-Za-z]?\d*/i.test(previous)
        || /^(?:algorithm|pseudocode|algorithm2e)$/i.test(fence[1])
        || /^(?:Require|Ensure|Input|Output):/m.test(content)
      if (looksLikeAlgorithm) {
        algorithmIndex += 1
        const caption = previous || normalized(body[0]) || `未命名算法 ${algorithmIndex}`
        items.push({
          id: `algorithm-${start}-${algorithmIndex}`,
          kind: 'algorithm',
          label: captionLabel('algorithm', caption, algorithmIndex),
          caption,
          preview: content.slice(0, 1800),
          pageNumber: pageFor(caption, layoutBlocks),
          markdownLine: start + 1,
        })
      }
    }
  }
  return items
}
