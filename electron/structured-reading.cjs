const crypto = require('node:crypto')

const SECTION_PATTERN = /^(?:(\d+(?:\.\d+)*)[.)]?\s+)?(abstract|摘要|keywords?|index terms?|关键词|introduction|引言|前言|related work|literature review|相关工作|文献综述|materials? and methods?|methodology|methods?|方法|研究方法|experimental setup|experiment setup|experiments?|实验设置|实验|results?|结果|discussion|讨论|limitations?|局限|局限性|conclusions?|结论|references?|bibliography|参考文献|appendix|appendices|附录)\s*[:：]?\s*$/i
const CAPTION_PATTERN = /^(?:fig(?:ure)?\.?\s*\d+|图\s*\d+|table\s*\d+|表\s*\d+)\s*[.:：]?/i

function normalizeLineEndings(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function contentFingerprint(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function structuredSourceFingerprint(markdown) {
  return contentFingerprint(normalizeLineEndings(markdown))
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function specialKind(content) {
  const trimmed = content.trim()
  if (/^(?:```|~~~)/.test(trimmed)) return 'code'
  if (/^\$\$[\s\S]*\$\$$/.test(trimmed) || /^\\\[[\s\S]*\\\]$/.test(trimmed)) return 'formula'
  if (/^\|.+\|\s*\n\|?\s*:?-{3,}/.test(trimmed)) return 'table'
  if (/^!\[[^\]]*\]\([^)]+\)/.test(trimmed) || /^<img\b/i.test(trimmed)) return 'figure'
  if (CAPTION_PATTERN.test(trimmed)) return 'figure_caption'
  if (/^#{1,6}\s*/.test(trimmed) || SECTION_PATTERN.test(trimmed)) return 'heading'
  return 'paragraph'
}

function headingLevel(content) {
  const trimmed = content.trim()
  const hashes = trimmed.match(/^(#{1,6})\s*/)?.[1]
  if (hashes) return hashes.length
  const numbered = trimmed.match(SECTION_PATTERN)?.[1]
  if (numbered) return Math.min(6, numbered.split('.').length + 1)
  return SECTION_PATTERN.test(trimmed) ? 2 : undefined
}

function splitHighConfidenceParagraph(content) {
  if (specialKind(content) !== 'paragraph' || !content.includes('\n')) return [content]
  const lines = content.split('\n')
  const parts = []
  let current = []
  for (const line of lines) {
    if (current.length) {
      const previous = current.at(-1).trimEnd()
      const next = line.trimStart()
      if (/[.!?。！？][”’"']?$/.test(previous) && /^(?:[A-Z\u3400-\u9fff]|\d+[.)]\s)/u.test(next)) {
        parts.push(current.join('\n'))
        current = []
      }
    }
    current.push(line)
  }
  if (current.length) parts.push(current.join('\n'))
  return parts
}

function splitMarkdownBlocks(markdown) {
  const normalized = normalizeLineEndings(markdown)
  const chunks = []
  let current = []
  let fence = ''
  const flush = () => {
    if (!current.length) return
    chunks.push(current.join('\n'))
    current = []
  }
  for (const line of normalized.split('\n')) {
    const trimmed = line.trim()
    const token = /^(?:```|~~~)/.test(trimmed) ? trimmed.slice(0, 3) : trimmed === '$$' ? '$$' : ''
    if (token) {
      current.push(line)
      if (!fence) fence = token
      else if (fence === token) fence = ''
      continue
    }
    if (!fence && !trimmed) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()

  const blocks = []
  let rawOrdinal = 0
  for (const chunk of chunks) {
    rawOrdinal += 1
    const originalBlockId = `block-${String(rawOrdinal).padStart(4, '0')}`
    const pieces = splitHighConfidenceParagraph(chunk)
    for (const [pieceIndex, content] of pieces.entries()) {
      const kind = specialKind(content)
      blocks.push({
        id: pieces.length === 1 ? originalBlockId : `${originalBlockId}.${pieceIndex + 1}`,
        originalBlockIds: [originalBlockId],
        content,
        sourceSlices: [{ originalBlockId, content }],
        contentFingerprint: contentFingerprint(content),
        kind,
        ...(kind === 'heading' ? { headingLevel: headingLevel(content) || 2 } : {}),
      })
    }
  }
  return { normalized, blocks, splitCount: blocks.length - chunks.length }
}

function validRect(block) {
  if (!Array.isArray(block?.bbox) || block.bbox.length !== 4) return undefined
  const values = block.bbox.map(Number)
  if (!values.every(Number.isFinite)) return undefined
  const [x0, y0, x1, y1] = values
  if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x1 <= x0 || y1 <= y0) return undefined
  return { bbox: values, x0, y0, x1, y1, centerX: (x0 + x1) / 2, centerY: (y0 + y1) / 2 }
}

function matchLayout(blocks, layoutBlocks) {
  const candidates = (Array.isArray(layoutBlocks) ? layoutBlocks : []).map((layout, index) => {
    const rect = validRect(layout)
    const pageNumber = Number(layout?.pageNumber)
    const text = normalizedText(layout?.text)
    return rect && Number.isInteger(pageNumber) && pageNumber > 0 && text.length >= 4
      ? { layout, index, rect, pageNumber, text }
      : undefined
  }).filter(Boolean)
  const exactByText = new Map()
  for (const candidate of candidates) {
    if (!exactByText.has(candidate.text)) exactByText.set(candidate.text, [])
    exactByText.get(candidate.text).push(candidate)
  }
  const claimed = new Set()
  return blocks.map(block => {
    const text = normalizedText(block.content)
    const exact = exactByText.get(text)
    const candidatePool = exact?.length ? exact : candidates
    const matches = candidatePool.map(candidate => {
      const score = text === candidate.text
        ? 1
        : text.includes(candidate.text) || candidate.text.includes(text)
          ? Math.min(text.length, candidate.text.length) / Math.max(text.length, candidate.text.length)
          : 0
      return { candidate, score }
    }).filter(match => match.score >= .4 && !claimed.has(match.candidate.index))
      .sort((left, right) => right.score - left.score || left.candidate.index - right.candidate.index)
    if (!matches.length || (matches[1] && Math.abs(matches[0].score - matches[1].score) < .000001)) return block
    const best = matches[0]
    claimed.add(best.candidate.index)
    return {
      ...block,
      pageNumber: best.candidate.pageNumber,
      bbox: best.candidate.rect.bbox,
      layoutBlockId: String(best.candidate.layout.id || `layout-${best.candidate.index + 1}`),
      confidence: Number(best.score.toFixed(3)),
    }
  })
}

function pageLayoutDiagnostics(layoutBlocks, matchedBlocks) {
  const pages = new Map()
  for (const layout of Array.isArray(layoutBlocks) ? layoutBlocks : []) {
    const pageNumber = Number(layout?.pageNumber)
    const rect = validRect(layout)
    if (!Number.isInteger(pageNumber) || pageNumber <= 0 || !rect) continue
    if (!pages.has(pageNumber)) pages.set(pageNumber, [])
    pages.get(pageNumber).push(rect)
  }
  return [...pages.entries()].map(([pageNumber, rects]) => {
    const narrow = rects.filter(rect => rect.x1 - rect.x0 <= .68)
    const left = narrow.filter(rect => rect.centerX < .48)
    const right = narrow.filter(rect => rect.centerX > .52)
    const gutter = left.length && right.length ? Math.min(...right.map(rect => rect.x0)) - Math.max(...left.map(rect => rect.x1)) : 0
    const twoColumn = left.length >= 2 && right.length >= 2 && gutter >= .015
    const matched = matchedBlocks.filter(block => block.pageNumber === pageNumber)
    const coverage = matched.length / Math.max(1, rects.length)
    const confidence = twoColumn ? Math.min(.99, .58 + Math.min(.18, gutter) + Math.min(.18, coverage)) : Math.min(.65, .25 + coverage * .35)
    return {
      pageNumber,
      layout: twoColumn ? 'two-column' : rects.filter(rect => rect.x1 - rect.x0 > .68).length >= 2 ? 'single-column' : 'uncertain',
      confidence: Number(confidence.toFixed(2)),
      coverage: Number(coverage.toFixed(2)),
      reordered: false,
    }
  }).sort((left, right) => left.pageNumber - right.pageNumber)
}

function reorderTwoColumns(blocks, diagnostics) {
  const ordered = [...blocks]
  let reorderedCount = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.layout !== 'two-column' || diagnostic.confidence < .7) continue
    const indexes = ordered.map((block, index) => block.pageNumber === diagnostic.pageNumber && block.bbox ? index : -1).filter(index => index >= 0)
    const sorted = indexes.map(index => ordered[index]).sort((left, right) => {
      const leftWidth = left.bbox[2] - left.bbox[0]
      const rightWidth = right.bbox[2] - right.bbox[0]
      const leftRank = leftWidth > .68 ? [0, left.bbox[1], left.bbox[0]] : [1, left.bbox[0] < .5 ? 0 : 1, left.bbox[1]]
      const rightRank = rightWidth > .68 ? [0, right.bbox[1], right.bbox[0]] : [1, right.bbox[0] < .5 ? 0 : 1, right.bbox[1]]
      for (let index = 0; index < leftRank.length; index += 1) if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index]
      return 0
    })
    const changed = sorted.some((block, index) => block.id !== ordered[indexes[index]].id)
    if (changed) {
      indexes.forEach((slot, index) => { ordered[slot] = sorted[index] })
      reorderedCount += indexes.length
      diagnostic.reordered = true
    }
  }
  return { blocks: ordered, reorderedCount }
}

function canMergeAcrossPage(left, right) {
  return left?.kind === 'paragraph'
    && right?.kind === 'paragraph'
    && Number.isInteger(left.pageNumber)
    && right.pageNumber === left.pageNumber + 1
    && !/[.!?。！？:：;；][”’"']?$/.test(left.content.trim())
    && /^[a-z,(\[]/.test(right.content.trim())
    && (left.confidence || 0) >= .75
    && (right.confidence || 0) >= .75
}

function mergeAcrossPages(blocks) {
  const result = []
  let merges = 0
  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index]
    const next = blocks[index + 1]
    if (!canMergeAcrossPage(current, next)) {
      result.push(current)
      continue
    }
    result.push({
      ...current,
      id: `${current.id}+${next.id}`,
      originalBlockIds: [...new Set([...current.originalBlockIds, ...next.originalBlockIds])],
      content: `${current.content.trimEnd()} ${next.content.trimStart()}`,
      sourceSlices: [...current.sourceSlices, ...next.sourceSlices],
      contentFingerprint: contentFingerprint(`${current.content}\n${next.content}`),
      pageRange: [current.pageNumber, next.pageNumber],
      transformation: 'cross-page-merge',
      confidence: Math.min(current.confidence, next.confidence),
    })
    merges += 1
    index += 1
  }
  return { blocks: result, mergeCount: merges }
}

function attachFigures(blocks) {
  let linked = 0
  const result = blocks.map((block, index) => {
    if (block.kind !== 'figure_caption') return block
    const previousFigure = [...blocks.slice(0, index)].reverse().find(candidate => candidate.kind === 'figure' && (!block.pageNumber || !candidate.pageNumber || candidate.pageNumber === block.pageNumber))
    if (!previousFigure) return block
    linked += 1
    return { ...block, relation: { type: 'caption-of', targetBlockId: previousFigure.id } }
  })
  return { blocks: result, linked }
}

function applyBoundaries(blocks, boundaries) {
  const sectionByBlock = new Map((Array.isArray(boundaries) ? boundaries : []).map(boundary => [String(boundary.beforeBlockId || ''), String(boundary.section || '')]))
  return blocks.map(block => {
    const matchedId = block.originalBlockIds.find(id => sectionByBlock.has(id))
    const section = matchedId ? sectionByBlock.get(matchedId) : undefined
    return section && block.kind !== 'heading' ? { ...block, inferredHeading: section } : block
  })
}

function qualityIssues(markdown, blocks, diagnostics) {
  const issues = []
  const replacementCharacters = (String(markdown || '').match(/�/g) || []).length
  if (replacementCharacters) issues.push({ code: 'suspected-garbled-text', severity: 'warning', message: `检测到 ${replacementCharacters} 个替换字符，请对照 PDF 核查。` })
  const inlineDollars = (String(markdown || '').match(/(?<!\\)\$/g) || []).length
  if (inlineDollars % 2) issues.push({ code: 'possibly-damaged-formula', severity: 'warning', message: '检测到未配对的公式定界符，请对照 PDF 核查。' })
  for (const diagnostic of diagnostics.filter(entry => entry.layout === 'uncertain' || entry.coverage < .25)) {
    issues.push({ code: 'uncertain-reading-order', severity: 'info', pageNumber: diagnostic.pageNumber, message: `第 ${diagnostic.pageNumber} 页版面证据不足，已保持保守顺序。` })
  }
  for (const block of blocks.filter(entry => entry.kind === 'figure_caption' && !entry.relation)) {
    issues.push({ code: 'unlinked-caption', severity: 'info', blockId: block.id, pageNumber: block.pageNumber, message: '图表标题未能高置信度关联图片，请人工检查位置。' })
  }
  return issues
}

function buildToc(blocks) {
  return blocks.flatMap(block => {
    const title = block.inferredHeading || (block.kind === 'heading' ? normalizedText(block.content) : '')
    return title ? [{ blockId: block.id, title, level: block.headingLevel || 2, pageNumber: block.pageNumber }] : []
  })
}

function buildStructuredReadingDraft({ markdown, layoutBlocks = [], boundaries = [], sourceVersion = 1, createdBy = 'rules', model } = {}) {
  if (!String(markdown || '').trim()) throw new Error('MinerU 原始 Markdown 为空，不能生成结构化阅读稿。')
  const split = splitMarkdownBlocks(markdown)
  const matched = matchLayout(split.blocks, layoutBlocks)
  const diagnostics = pageLayoutDiagnostics(layoutBlocks, matched)
  const reordered = reorderTwoColumns(matched, diagnostics)
  const merged = mergeAcrossPages(reordered.blocks)
  const figures = attachFigures(merged.blocks)
  const blocks = applyBoundaries(figures.blocks, boundaries).map(block => ({ ...block, sourceVersion }))
  const issues = qualityIssues(markdown, blocks, diagnostics)
  const inferredHeadings = blocks.filter(block => block.inferredHeading).length
  return {
    sourceFingerprint: structuredSourceFingerprint(markdown),
    sourceVersion,
    createdBy: ['rules', 'ai', 'user', 'restore'].includes(createdBy) ? createdBy : 'rules',
    ...(model ? { model: String(model).slice(0, 200) } : {}),
    blocks,
    toc: buildToc(blocks),
    diagnostics,
    qualityIssues: issues,
    changeSummary: {
      headingsRecognized: blocks.filter(block => block.kind === 'heading').length,
      headingsInferred: inferredHeadings,
      paragraphsSplit: split.splitCount,
      crossPageMerges: merged.mergeCount,
      reorderedBlocks: reordered.reorderedCount,
      figuresLinked: figures.linked,
      qualityIssueCount: issues.length,
    },
  }
}

function validateManualAdjustment(version, adjustment = {}) {
  if (!version || !Array.isArray(version.blocks)) throw new Error('找不到要调整的结构化阅读稿版本。')
  const orderedIds = Array.isArray(adjustment.orderedBlockIds) ? adjustment.orderedBlockIds.map(String) : []
  const currentIds = version.blocks.map(block => block.id)
  if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== currentIds.length || currentIds.some(id => !orderedIds.includes(id))) {
    throw new Error('手动调整必须保留全部结构块，不能删除、重复或编造内容。')
  }
  const headingLevels = adjustment.headingLevels && typeof adjustment.headingLevels === 'object' ? adjustment.headingLevels : {}
  const byId = new Map(version.blocks.map(block => [block.id, block]))
  const blocks = orderedIds.map(id => {
    const block = byId.get(id)
    const requested = headingLevels[id]
    if (requested == null || requested === '') return { ...block }
    const level = Number(requested)
    if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error('标题层级只能是正文或 1–6 级标题。')
    if (level === 0) {
      const { headingLevel: _headingLevel, inferredHeading: _inferredHeading, ...plain } = block
      return { ...plain, kind: block.kind === 'heading' ? 'paragraph' : block.kind }
    }
    return { ...block, kind: 'heading', headingLevel: level }
  })
  const originalById = new Map(version.blocks.map(block => [block.id, block]))
  return {
    ...version,
    createdBy: 'user',
    blocks,
    toc: buildToc(blocks),
    changeSummary: {
      ...version.changeSummary,
      manualReorder: orderedIds.some((id, index) => id !== currentIds[index]),
      manualHeadingChanges: blocks.filter(block => block.headingLevel !== originalById.get(block.id)?.headingLevel).length,
    },
  }
}

module.exports = {
  buildStructuredReadingDraft,
  contentFingerprint,
  splitMarkdownBlocks,
  structuredSourceFingerprint,
  validateManualAdjustment,
}
