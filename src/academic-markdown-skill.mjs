export const ACADEMIC_MARKDOWN_SKILL = Object.freeze({
  id: 'academic-paper-layout',
  version: '1.1.0',
  purpose: '把 MinerU 原始 Markdown 转成适合论文阅读的结构层，同时保持原文证据不被改写。',
  inputLayer: 'mineru-raw',
  outputLayer: 'reader-structured',
  invariants: [
    '不覆盖 MinerU 原始 Markdown',
    '不改写、不翻译、不总结原句',
    '规则层只修复标题语法、空行、论文常见章节标识和高置信度页内阅读顺序',
    '阅读顺序修复只生成派生块序列，原始 Markdown 与原始块编号保持不变',
    'AI 只允许返回章节边界，不允许返回替换正文',
    '每次 AI 结果必须记录模型、时间和原文指纹',
  ],
})

const SECTION_LABELS = Object.freeze([
  '摘要', '关键词', '引言', '相关工作', '方法', '实验设置',
  '结果', '讨论', '局限', '结论', '参考文献', '附录', '正文',
])

const SECTION_PATTERN = new RegExp(
  `^(?:(?:\\d+(?:\\.\\d+)*)[.)]?\\s+)?(${[
    'abstract', '摘要',
    'keywords?', 'index terms?', '关键词',
    'introduction', '引言', '前言',
    'related work', 'literature review', '相关工作', '文献综述',
    'materials? and methods?', 'methodology', 'methods?', '方法', '研究方法',
    'experimental setup', 'experiment setup', 'experiments?', '实验设置', '实验',
    'results?', '结果',
    'discussion', '讨论',
    'limitations?', '局限', '局限性',
    'conclusions?', '结论',
    'references?', 'bibliography', '参考文献',
    'appendix', 'appendices', '附录',
  ].join('|')})\\s*[:：]?\\s*$`,
  'i',
)

function normalizeLineEndings(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function normalizedLayoutText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function validLayoutRect(block) {
  if (!Array.isArray(block?.bbox) || block.bbox.length !== 4) return undefined
  const [x0, y0, x1, y1] = block.bbox.map(Number)
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined
  if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x1 <= x0 || y1 <= y0) return undefined
  return { x0, y0, x1, y1, centerX: (x0 + x1) / 2, centerY: (y0 + y1) / 2 }
}

function layoutTextMatchScore(markdownText, layoutText) {
  if (!markdownText || !layoutText || Math.min(markdownText.length, layoutText.length) < 4) return 0
  if (markdownText === layoutText) return 1
  if (markdownText.includes(layoutText) || layoutText.includes(markdownText)) {
    return Math.min(markdownText.length, layoutText.length) / Math.max(markdownText.length, layoutText.length)
  }
  return 0
}

function matchMarkdownLayoutBlocks(blocks, layoutBlocks) {
  const usableLayout = (Array.isArray(layoutBlocks) ? layoutBlocks : []).map((block, index) => {
    const pageNumber = Number(block?.pageNumber)
    const rect = validLayoutRect(block)
    const text = normalizedLayoutText(block?.text)
    return Number.isInteger(pageNumber) && pageNumber > 0 && rect && text.length >= 4
      ? { block, index, pageNumber, rect, text }
      : undefined
  }).filter(Boolean)
  const claimed = new Set()
  return blocks.map((block, sourceIndex) => {
    const markdownText = normalizedLayoutText(block.content)
    const candidates = usableLayout
      .map(layout => ({ layout, score: layoutTextMatchScore(markdownText, layout.text) }))
      .filter(candidate => candidate.score >= .35)
      .sort((a, b) => b.score - a.score || a.layout.index - b.layout.index)
    const best = candidates.find(candidate => !claimed.has(candidate.layout.index))
    if (!best) return { ...block, sourceIndex }
    const sameScore = candidates.filter(candidate => Math.abs(candidate.score - best.score) < .000001)
    const bestIsUnique = sameScore.length === 1 || sameScore.every(candidate => candidate.layout.pageNumber === best.layout.pageNumber)
    if (!bestIsUnique) return { ...block, sourceIndex }
    claimed.add(best.layout.index)
    return {
      ...block,
      sourceIndex,
      layoutMatch: {
        layoutBlockId: String(best.layout.block?.id || `layout-${best.layout.index + 1}`),
        pageNumber: best.layout.pageNumber,
        bbox: best.layout.block.bbox.map(Number),
        score: Number(best.score.toFixed(3)),
        rect: best.layout.rect,
      },
    }
  })
}

function analyzePageColumns(pageNumber, pageLayouts, matchedBlocks) {
  const rects = pageLayouts.map(block => validLayoutRect(block)).filter(Boolean)
  const columnRects = rects.filter(rect => (rect.x1 - rect.x0) <= .68)
  const left = columnRects.filter(rect => rect.centerX < .48)
  const right = columnRects.filter(rect => rect.centerX > .52)
  const fullWidth = rects.filter(rect => (rect.x1 - rect.x0) > .68)
  const leftEdge = left.length ? Math.max(...left.map(rect => rect.x1)) : 1
  const rightEdge = right.length ? Math.min(...right.map(rect => rect.x0)) : 0
  const gutter = rightEdge - leftEdge
  const balanced = Math.min(left.length, right.length) / Math.max(1, Math.max(left.length, right.length))
  const twoColumnEvidence = left.length >= 2 && right.length >= 2 && gutter >= .015
  const singleColumnEvidence = fullWidth.length >= 2 && columnRects.length < fullWidth.length
  const layout = twoColumnEvidence ? 'two-column' : singleColumnEvidence ? 'single-column' : 'uncertain'
  const confidence = layout === 'two-column'
    ? Math.min(.99, .55 + Math.min(.2, gutter) + Math.min(.2, balanced * .2) + Math.min(.04, rects.length / 100))
    : layout === 'single-column'
      ? Math.min(.95, .55 + Math.min(.35, fullWidth.length / Math.max(1, rects.length) * .35))
      : Math.min(.49, .2 + Math.min(.25, rects.length / 40))
  const matchedWithRects = matchedBlocks.filter(block => block.layoutMatch)
  return {
    pageNumber,
    layout,
    confidence: Number(confidence.toFixed(2)),
    layoutBlockCount: rects.length,
    matchedBlockCount: matchedWithRects.length,
    matchCoverage: Number((matchedWithRects.length / Math.max(1, rects.length)).toFixed(2)),
    gutter: gutter > 0 ? Number(gutter.toFixed(3)) : undefined,
    reordered: false,
    reason: layout === 'two-column'
      ? '检测到左右栏及稳定栏间距。'
      : layout === 'single-column'
        ? '页面以跨页宽文本块为主。'
        : '栏数证据不足，保持 MinerU Markdown 原顺序。',
  }
}

function twoColumnReadingOrder(blocks) {
  const spanning = blocks.filter(block => {
    const rect = block.layoutMatch?.rect
    return rect && (rect.x1 - rect.x0) > .68
  }).sort((a, b) => a.layoutMatch.rect.centerY - b.layoutMatch.rect.centerY)
  const rank = block => {
    const rect = block.layoutMatch.rect
    const isSpanning = (rect.x1 - rect.x0) > .68
    const spanningIndex = isSpanning ? spanning.findIndex(span => span.id === block.id) : -1
    const spansAbove = spanning.filter(span => span.layoutMatch.rect.centerY < rect.centerY).length
    const band = isSpanning ? spanningIndex : spansAbove - 1
    const column = isSpanning ? 0 : rect.centerX < .5 ? 1 : 2
    return [band, isSpanning ? 0 : 1, column, rect.y0, rect.x0, block.sourceIndex]
  }
  const ranked = [...blocks].sort((a, b) => {
    const left = rank(a)
    const right = rank(b)
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index]
    }
    return 0
  })
  return ranked
}

function isFenceBoundary(line) {
  return /^(?:```|~~~)/.test(line.trim()) || line.trim() === '$$'
}

export function academicMarkdownFingerprint(markdown) {
  const input = normalizeLineEndings(markdown)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${input.length}`
}

export function normalizeAcademicMarkdown(markdown) {
  const sourceLines = normalizeLineEndings(markdown).split('\n')
  const output = []
  let inFence = false
  let fenceToken = ''

  for (const sourceLine of sourceLines) {
    const line = sourceLine.replace(/[ \t]+$/g, '')
    const trimmed = line.trim()

    if (/^(?:```|~~~)/.test(trimmed)) {
      const token = trimmed.slice(0, 3)
      if (!inFence) {
        inFence = true
        fenceToken = token
      } else if (token === fenceToken) {
        inFence = false
        fenceToken = ''
      }
      output.push(line)
      continue
    }
    if (trimmed === '$$') {
      inFence = !inFence
      fenceToken = inFence ? '$$' : ''
      output.push(line)
      continue
    }
    if (inFence) {
      output.push(line)
      continue
    }

    let normalized = line
    if (/^#{1,6}(?![#\s])/.test(trimmed)) {
      normalized = trimmed.replace(/^(#{1,6})(.+)$/, '$1 $2')
    } else if (!trimmed.startsWith('#') && trimmed.length <= 80 && SECTION_PATTERN.test(trimmed)) {
      normalized = `## ${trimmed.replace(/[:：]\s*$/, '')}`
    }

    if (/^#{1,6}\s+/.test(normalized.trim()) && output.length && output[output.length - 1] !== '') {
      output.push('')
    }
    output.push(normalized)
    if (/^#{1,6}\s+/.test(normalized.trim())) output.push('')
  }

  const collapsed = []
  for (const line of output) {
    if (line === '' && collapsed[collapsed.length - 1] === '') continue
    collapsed.push(line)
  }
  while (collapsed[0] === '') collapsed.shift()
  while (collapsed[collapsed.length - 1] === '') collapsed.pop()
  return collapsed.join('\n')
}

export function splitAcademicMarkdownBlocks(markdown) {
  const normalized = normalizeAcademicMarkdown(markdown)
  const parts = normalized ? normalized.split(/\n{2,}/) : []
  return {
    fingerprint: academicMarkdownFingerprint(markdown),
    blocks: parts.map((content, index) => ({
      id: `block-${String(index + 1).padStart(4, '0')}`,
      content,
    })),
  }
}

export function repairAcademicMarkdownReadingOrder(markdown, mineruLayoutBlocks = []) {
  const split = splitAcademicMarkdownBlocks(markdown)
  const matched = matchMarkdownLayoutBlocks(split.blocks, mineruLayoutBlocks)
  const byPage = new Map()
  for (const block of matched) {
    const pageNumber = block.layoutMatch?.pageNumber
    if (!pageNumber) continue
    if (!byPage.has(pageNumber)) byPage.set(pageNumber, [])
    byPage.get(pageNumber).push(block)
  }
  const layoutByPage = new Map()
  for (const layoutBlock of Array.isArray(mineruLayoutBlocks) ? mineruLayoutBlocks : []) {
    const pageNumber = Number(layoutBlock?.pageNumber)
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) continue
    if (!layoutByPage.has(pageNumber)) layoutByPage.set(pageNumber, [])
    layoutByPage.get(pageNumber).push(layoutBlock)
  }

  const reorderedById = new Map()
  const diagnostics = []
  const pageNumbers = new Set([...layoutByPage.keys(), ...byPage.keys()])
  for (const pageNumber of pageNumbers) {
    const pageBlocks = byPage.get(pageNumber) || []
    const diagnostic = analyzePageColumns(pageNumber, layoutByPage.get(pageNumber) || [], pageBlocks)
    if (diagnostic.layout === 'two-column' && diagnostic.confidence >= .7 && pageBlocks.length >= 2) {
      const sorted = twoColumnReadingOrder(pageBlocks)
      const changed = sorted.some((block, index) => block.id !== pageBlocks[index].id)
      pageBlocks.forEach((slot, index) => reorderedById.set(slot.id, sorted[index]))
      diagnostic.reordered = changed
      diagnostic.reason = changed
        ? '已按左栏从上到下、再右栏从上到下重排可匹配块。'
        : '原 Markdown 顺序已符合检测到的双栏阅读顺序。'
    }
    diagnostics.push(diagnostic)
  }

  const ordered = matched.map(block => reorderedById.get(block.id) || block).map(block => ({
    id: block.id,
    content: block.content,
    ...(block.layoutMatch ? {
      pageNumber: block.layoutMatch.pageNumber,
      bbox: block.layoutMatch.bbox,
      layoutBlockId: block.layoutMatch.layoutBlockId,
      matchConfidence: block.layoutMatch.score,
    } : {}),
  }))
  return {
    sourceFingerprint: split.fingerprint,
    sourceMarkdown: String(markdown || ''),
    markdown: ordered.map(block => block.content).join('\n\n'),
    changed: ordered.some((block, index) => block.id !== split.blocks[index]?.id),
    blocks: ordered,
    diagnostics: diagnostics.sort((a, b) => a.pageNumber - b.pageNumber),
  }
}

export function buildAcademicMarkdown(markdown, boundaries = []) {
  const { blocks } = splitAcademicMarkdownBlocks(markdown)
  const boundaryByBlock = new Map(
    (Array.isArray(boundaries) ? boundaries : []).map(boundary => [boundary.beforeBlockId, boundary.section]),
  )
  const output = []
  for (const block of blocks) {
    const section = boundaryByBlock.get(block.id)
    if (section && section !== '正文' && !block.content.trimStart().startsWith('#')) {
      output.push(`## ${section}`)
    }
    output.push(block.content)
  }
  return output.join('\n\n')
}

export function buildAcademicMarkdownAIRequest({ markdown, paper }) {
  const { fingerprint, blocks } = splitAcademicMarkdownBlocks(markdown)
  if (!blocks.length) throw new Error('当前 Markdown 没有可识别的正文块。')
  const payload = JSON.stringify({
    paper: {
      title: paper?.title || '',
      authors: Array.isArray(paper?.authors) ? paper.authors : [],
      year: paper?.issued || '',
      abstract: paper?.abstract || '',
      keywords: Array.isArray(paper?.keywords) ? paper.keywords : [],
    },
    blocks,
  })
  if (payload.length > 160000) {
    throw new Error('当前 Markdown 超过首版 AI 章节识别上限，请先使用规则排版；后续将接入分块识别。')
  }
  return {
    fingerprint,
    system: [
      '你是学术论文结构识别器，不是改写器。',
      '只能识别已有文本块从哪里开始属于哪个章节，绝不能返回、改写、翻译或总结正文。',
      `section 只能取：${SECTION_LABELS.join('、')}。`,
      '按 block 在输入中的原顺序返回少量章节边界。',
      '只输出 JSON：{"boundaries":[{"beforeBlockId":"block-0001","section":"摘要"}]}。',
    ].join('\n'),
    user: payload,
  }
}

export function parseAcademicMarkdownBoundaries(content, markdown) {
  const normalized = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error('AI 没有返回合法的章节边界 JSON。')
  }
  const { blocks } = splitAcademicMarkdownBlocks(markdown)
  const blockIndex = new Map(blocks.map((block, index) => [block.id, index]))
  const seen = new Set()
  const boundaries = []
  let previousIndex = -1
  for (const candidate of Array.isArray(parsed?.boundaries) ? parsed.boundaries : []) {
    const beforeBlockId = String(candidate?.beforeBlockId || '')
    const section = String(candidate?.section || '')
    const index = blockIndex.get(beforeBlockId)
    if (index === undefined || seen.has(beforeBlockId) || index <= previousIndex || !SECTION_LABELS.includes(section)) {
      throw new Error('AI 返回了未知、重复、乱序或不允许的章节边界。')
    }
    seen.add(beforeBlockId)
    previousIndex = index
    boundaries.push({ beforeBlockId, section })
  }
  if (!boundaries.length) throw new Error('AI 没有识别出可用的论文章节。')
  return boundaries
}

export function validAcademicMarkdownLayout(layout, markdown) {
  return Boolean(
    layout
    && layout.version === ACADEMIC_MARKDOWN_SKILL.version
    && layout.sourceFingerprint === academicMarkdownFingerprint(markdown),
  )
}
