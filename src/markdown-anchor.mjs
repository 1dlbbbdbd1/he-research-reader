import { repairAcademicMarkdownReadingOrder } from './academic-markdown-skill.mjs'

const EXPLICIT_PAGE_PATTERN = /^#{1,6}\s+(?:page|p\.?|第)\s*(\d{1,6})\s*(?:页)?\s*$/i

export function normalizedAnchorText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function comparableMarkdownText(value) {
  return normalizedAnchorText(String(value || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, ''))
}

function mineruCandidates(value, mineruLayoutBlocks) {
  const targetText = normalizedAnchorText(value)
  if (targetText.length < 4) return []
  const candidates = (Array.isArray(mineruLayoutBlocks) ? mineruLayoutBlocks : []).filter(layoutBlock => {
    const layoutText = normalizedAnchorText(layoutBlock?.text)
    const pageNumber = Number(layoutBlock?.pageNumber)
    if (layoutText.length < 4 || !Number.isInteger(pageNumber) || pageNumber <= 0) return false
    return targetText.includes(layoutText) || layoutText.includes(targetText)
  })
  const exact = candidates.filter(candidate => normalizedAnchorText(candidate.text) === targetText)
  return exact.length ? exact : candidates
}

function normalizedMineruRect(layoutBlock) {
  if (!Array.isArray(layoutBlock?.bbox) || layoutBlock.bbox.length !== 4) return undefined
  const [x0, y0, x1, y1] = layoutBlock.bbox.map(Number)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined
  if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x1 <= x0 || y1 <= y0) return undefined
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function mineruTarget(value, mineruLayoutBlocks) {
  const candidates = mineruCandidates(value, mineruLayoutBlocks)
  const pages = new Set(candidates.map(candidate => Number(candidate.pageNumber)))
  if (pages.size !== 1) return {}
  const pageNumber = [...pages][0]
  const rect = candidates.length === 1 ? normalizedMineruRect(candidates[0]) : undefined
  return { pageNumber, ...(rect ? { rects: [rect] } : {}) }
}

export function markdownReadingBlocks(markdown, mineruLayoutBlocks = []) {
  const repaired = repairAcademicMarkdownReadingOrder(markdown, mineruLayoutBlocks)
  const { blocks } = repaired
  let currentPage
  return {
    fingerprint: repaired.sourceFingerprint,
    diagnostics: repaired.diagnostics,
    readingOrderChanged: repaired.changed,
    blocks: blocks.map(block => {
      const firstLine = block.content.split('\n', 1)[0].trim()
      const explicitPage = Number(EXPLICIT_PAGE_PATTERN.exec(firstLine)?.[1])
      if (Number.isInteger(explicitPage) && explicitPage > 0) currentPage = explicitPage
      const blockText = comparableMarkdownText(block.content)
      const mineru = mineruTarget(blockText, mineruLayoutBlocks)
      return {
        ...block,
        pageNumber: block.pageNumber ?? mineru.pageNumber ?? currentPage,
        ...(mineru.rects ? { rects: mineru.rects } : {}),
      }
    }),
  }
}

export function locateQuoteInMarkdown(markdown, quote, mineruLayoutBlocks = []) {
  const needle = normalizedAnchorText(quote)
  if (!needle) return { state: 'unresolved', reason: 'empty-quote' }
  const matches = markdownReadingBlocks(markdown, mineruLayoutBlocks).blocks.filter(block =>
    normalizedAnchorText(block.content).includes(needle),
  )
  if (matches.length !== 1) {
    return {
      state: 'unresolved',
      reason: matches.length ? 'ambiguous' : 'not-found',
      matchCount: matches.length,
    }
  }
  const mineru = mineruTarget(needle, mineruLayoutBlocks)
  return {
    state: 'resolved',
    markdownBlockId: matches[0].id,
    pageNumber: matches[0].pageNumber,
    ...(mineru.rects
      ? { rects: mineru.rects }
      : matches[0].rects ? { rects: matches[0].rects } : {}),
    matchCount: 1,
  }
}

export function markdownSelectionAnchor(markdown, markdownBlockId, quote, mineruLayoutBlocks = []) {
  const target = markdownReadingBlocks(markdown, mineruLayoutBlocks).blocks.find(block => block.id === markdownBlockId)
  if (!target || !normalizedAnchorText(target.content).includes(normalizedAnchorText(quote))) {
    return {
      type: 'markdown',
      state: 'unresolved',
      markdownBlockId,
      quote: { exact: String(quote || '') },
    }
  }
  const mineru = mineruTarget(quote, mineruLayoutBlocks)
  return {
    type: 'markdown',
    state: 'resolved',
    markdownBlockId,
    ...(target.pageNumber ? { pageNumber: target.pageNumber } : {}),
    ...(mineru.rects
      ? { rects: mineru.rects }
      : target.rects ? { rects: target.rects } : {}),
    quote: { exact: String(quote || '') },
  }
}
