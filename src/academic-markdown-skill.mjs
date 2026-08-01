export const ACADEMIC_MARKDOWN_SKILL = Object.freeze({
  id: 'academic-paper-layout',
  version: '1.0.0',
  purpose: '把 MinerU 原始 Markdown 转成适合论文阅读的结构层，同时保持原文证据不被改写。',
  inputLayer: 'mineru-raw',
  outputLayer: 'reader-structured',
  invariants: [
    '不覆盖 MinerU 原始 Markdown',
    '不改写、不翻译、不总结原句',
    '规则层只修复标题语法、空行和论文常见章节标识',
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
