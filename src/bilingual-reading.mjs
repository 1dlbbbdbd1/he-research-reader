const DEFAULT_MAX_SEGMENT_CHARACTERS = 1800
const DEFAULT_BATCH_SIZE = 4
const DEFAULT_BATCH_CHARACTERS = 5200

function normalizeLineEndings(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function fnv1a(value) {
  const input = String(value ?? '')
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function bilingualContentHash(content) {
  const normalized = normalizeLineEndings(content)
  return `fnv1a-${fnv1a(normalized)}-${normalized.length}`
}

export function bilingualDocumentFingerprint(markdown) {
  return bilingualContentHash(normalizeLineEndings(markdown))
}

export function smartMergeTranslationProse(content) {
  return normalizeLineEndings(content)
    .split(/(\n\s*\n)/)
    .map(part => {
      if (/^\n\s*\n$/.test(part)) return part
      const lines = part.split('\n')
      let merged = ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (!merged) {
          merged = line
          continue
        }
        if (/-$/.test(merged) && /^[a-z]/.test(line)) merged = `${merged.slice(0, -1)}${line}`
        else merged = `${merged} ${line}`
      }
      return merged
    })
    .join('')
}

export function prepareTranslationSelection(text, startPageNumber, endPageNumber) {
  const start = Number.isInteger(Number(startPageNumber)) && Number(startPageNumber) > 0 ? Number(startPageNumber) : undefined
  const end = Number.isInteger(Number(endPageNumber)) && Number(endPageNumber) > 0 ? Number(endPageNumber) : start
  const firstPage = start && end ? Math.min(start, end) : start || end
  const lastPage = start && end ? Math.max(start, end) : start || end
  const mergedText = smartMergeTranslationProse(text).trim()
  return {
    originalText: String(text ?? '').trim(),
    mergedText,
    startPageNumber: firstPage,
    endPageNumber: lastPage,
    crossesPages: Boolean(firstPage && lastPage && firstPage !== lastPage),
    characterCount: mergedText.length,
  }
}

function isBlank(line) {
  return /^\s*$/.test(line)
}

function isFenceStart(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
  return match ? { marker: match[1][0], length: match[1].length } : undefined
}

function isFenceEnd(line, fence) {
  if (!fence) return false
  const pattern = fence.marker === '`' ? '`' : '~'
  return new RegExp(`^\\s*${pattern}{${fence.length},}\\s*$`).test(line)
}

function isMathBoundary(line) {
  return /^\s*\$\$\s*$/.test(line) || /^\s*\\\[\s*$/.test(line) || /^\s*\\\]\s*$/.test(line)
}

function isTableDelimiter(line) {
  const value = line.trim()
  if (!value.includes('|')) return false
  const cells = value.replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 0 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell))
}

function isImageOnly(line) {
  return /^\s*(?:!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>)\s*$/i.test(line)
}

function isStructuralLine(line) {
  const value = line.trim()
  return /^(?:-{3,}|_{3,}|\*{3,})$/.test(value)
    || /^<!--(?:.|\n)*-->$/.test(value)
    || /^\[[^\]]+\]:\s+\S+/.test(value)
}

function classifySingleLine(line) {
  if (/^\s{0,3}#{1,6}(?:\s+|$)/.test(line) || /^\s*(?:Abstract|Keywords?|Introduction|Methods?|Results?|Discussion|Conclusions?|References?)\s*[:：]?\s*$/i.test(line)) return 'heading'
  if (isImageOnly(line)) return 'image'
  if (isStructuralLine(line)) return 'structure'
  if (/^(?: {4}|\t)/.test(line)) return 'code'
  return undefined
}

function looksLikeSpecialStart(lines, index) {
  const line = lines[index] ?? ''
  if (isBlank(line) || isFenceStart(line) || isMathBoundary(line) || classifySingleLine(line)) return true
  if (index + 1 < lines.length && line.includes('|') && isTableDelimiter(lines[index + 1])) return true
  if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) return true
  return false
}

function hasEnglishProse(content) {
  const prose = String(content ?? '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\$[^$\n]+\$/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
  return /[A-Za-z]{2,}/.test(prose)
}

function sentenceBreakIndex(content, limit) {
  const floor = Math.max(1, Math.floor(limit * 0.55))
  const window = content.slice(0, limit + 1)
  const patterns = [/[.!?]["')\]]?\s+/g, /[;:]\s+/g, /\s+/g]
  for (const pattern of patterns) {
    let match
    let candidate = -1
    while ((match = pattern.exec(window))) {
      const end = match.index + match[0].length
      if (end >= floor && end <= limit) candidate = end
    }
    if (candidate > 0) return candidate
  }
  return limit
}

function splitLongProse(content, limit) {
  if (content.length <= limit) return [content]
  const chunks = []
  let remaining = content
  while (remaining.length > limit) {
    const breakAt = sentenceBreakIndex(remaining, limit)
    chunks.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt)
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function scanMarkdownBlocks(markdown) {
  const source = normalizeLineEndings(markdown)
  if (!source) return []
  const lines = source.split('\n')
  const logicalBlocks = []
  let index = 0

  const take = (kind, start, end) => {
    logicalBlocks.push({ kind, start, end })
    index = end
  }

  while (index < lines.length) {
    const start = index
    const line = lines[index]
    if (isBlank(line)) {
      while (index < lines.length && isBlank(lines[index])) index += 1
      continue
    }

    const fence = isFenceStart(line)
    if (fence) {
      index += 1
      while (index < lines.length && !isFenceEnd(lines[index], fence)) index += 1
      if (index < lines.length) index += 1
      take('code', start, index)
      continue
    }

    if (/^\s*\$\$\s*$/.test(line) || /^\s*\\\[\s*$/.test(line)) {
      const closing = /^\s*\$\$\s*$/.test(line) ? /^\s*\$\$\s*$/ : /^\s*\\\]\s*$/
      index += 1
      while (index < lines.length && !closing.test(lines[index])) index += 1
      if (index < lines.length) index += 1
      take('math', start, index)
      continue
    }

    const singleKind = classifySingleLine(line)
    if (singleKind) {
      take(singleKind, start, index + 1)
      continue
    }

    if (index + 1 < lines.length && line.includes('|') && isTableDelimiter(lines[index + 1])) {
      index += 2
      while (index < lines.length && !isBlank(lines[index]) && lines[index].includes('|')) index += 1
      take('table', start, index)
      continue
    }

    if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) {
      index += 1
      while (index < lines.length && !isBlank(lines[index]) && !isFenceStart(lines[index]) && !isMathBoundary(lines[index])) index += 1
      take('list', start, index)
      continue
    }

    index += 1
    while (index < lines.length && !looksLikeSpecialStart(lines, index)) index += 1
    take('paragraph', start, index)
  }

  const lineStarts = []
  let offset = 0
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    lineStarts.push(offset)
    offset += lines[lineIndex].length
    if (lineIndex < lines.length - 1) offset += 1
  }
  const blocks = []
  let cursor = 0
  for (const block of logicalBlocks) {
    const startOffset = lineStarts[block.start]
    const lastLine = block.end - 1
    const endOffset = lineStarts[lastLine] + lines[lastLine].length
    if (startOffset > cursor) blocks.push({ kind: 'whitespace', content: source.slice(cursor, startOffset) })
    blocks.push({ kind: block.kind, content: source.slice(startOffset, endOffset) })
    cursor = endOffset
  }
  if (cursor < source.length) blocks.push({ kind: 'whitespace', content: source.slice(cursor) })
  return blocks
}

function statusFromCache(cacheEntry, defaultSource, defaultSourceHash) {
  const translation = String(cacheEntry?.translation ?? '')
  if (!translation.trim() && !cacheEntry?.sourceText && !cacheEntry?.translationSource) return undefined
  const translationSource = String(cacheEntry?.sourceText ?? cacheEntry?.translationSource ?? defaultSource)
  const cachedStatus = ['pending', 'failed', 'translated'].includes(cacheEntry?.status) ? cacheEntry.status : undefined
  return {
    status: translation.trim() ? 'translated' : cachedStatus || 'pending',
    translation,
    translationSource,
    translationSourceHash: String(cacheEntry?.sourceHash ?? cacheEntry?.translationSourceHash ?? bilingualContentHash(translationSource) ?? defaultSourceHash),
    attempts: Math.max(0, Number(cacheEntry?.attempts) || 0),
    locked: Boolean(cacheEntry?.locked),
    provider: cacheEntry?.provider ? String(cacheEntry.provider) : undefined,
    model: cacheEntry?.model ? String(cacheEntry.model) : undefined,
    error: cachedStatus === 'failed' ? String(cacheEntry?.error || '翻译失败') : undefined,
  }
}

export function segmentBilingualMarkdown(markdown, options = {}) {
  const maxCharacters = Math.max(240, Number(options.maxSegmentCharacters) || DEFAULT_MAX_SEGMENT_CHARACTERS)
  const cached = Array.isArray(options.cachedSegments) ? options.cachedSegments : []
  const cacheById = new Map(cached.map(item => [String(item?.id || ''), item]))
  const cacheByHash = new Map(cached.filter(item => item?.contentHash).map(item => [String(item.contentHash), item]))
  const cacheByBaseHash = new Map(cached.filter(item => item?.baseSourceHash).map(item => [String(item.baseSourceHash), item]))
  const rawBlocks = scanMarkdownBlocks(markdown).flatMap(block => {
    if ((block.kind === 'paragraph' || block.kind === 'list') && block.content.length > maxCharacters) {
      return splitLongProse(block.content, maxCharacters).map(content => ({ ...block, content }))
    }
    return [block]
  })
  const occurrences = new Map()
  return rawBlocks.map((block, sourceIndex) => {
    const contentHash = bilingualContentHash(block.content)
    const occurrence = (occurrences.get(contentHash) || 0) + 1
    occurrences.set(contentHash, occurrence)
    const id = `segment-${contentHash.replace(/^fnv1a-/, '')}-${occurrence}`
    const translatable = !['whitespace', 'code', 'math', 'image', 'structure'].includes(block.kind) && hasEnglishProse(block.content)
    const defaultTranslationSource = block.kind === 'paragraph' ? smartMergeTranslationProse(block.content) : block.content
    const defaultTranslationSourceHash = bilingualContentHash(defaultTranslationSource)
    const cachedState = translatable
      ? statusFromCache(cacheById.get(id) || cacheByBaseHash.get(contentHash) || cacheByHash.get(defaultTranslationSourceHash) || cacheByHash.get(contentHash), defaultTranslationSource, defaultTranslationSourceHash)
      : undefined
    return {
      id,
      contentHash,
      sourceIndex,
      kind: block.kind,
      source: block.content,
      translationSource: cachedState?.translationSource || defaultTranslationSource,
      translationSourceHash: cachedState?.translationSourceHash || defaultTranslationSourceHash,
      translatable,
      status: translatable ? cachedState?.status || 'pending' : 'skipped',
      translation: cachedState?.translation || '',
      attempts: cachedState?.attempts || 0,
      locked: cachedState?.locked || false,
      provider: cachedState?.provider,
      model: cachedState?.model,
      error: undefined,
    }
  })
}

export function createBilingualReadingDocument(markdown, options = {}) {
  const sourceMarkdown = normalizeLineEndings(markdown)
  return {
    version: 1,
    sourceFingerprint: bilingualDocumentFingerprint(sourceMarkdown),
    sourceMarkdown,
    segments: segmentBilingualMarkdown(sourceMarkdown, options),
  }
}

export function updateBilingualSegment(segments, segmentId, patch = {}) {
  const allowedStatuses = new Set(['pending', 'translating', 'translated', 'failed', 'skipped'])
  let matched = false
  const next = (Array.isArray(segments) ? segments : []).map(segment => {
    if (segment.id !== segmentId) return segment
    matched = true
    if (!segment.translatable) return segment
    const changesProtectedContent = patch.translation !== undefined || patch.translationSource !== undefined || patch.status !== undefined
    if (segment.locked && changesProtectedContent && !patch.unlock && patch.locked !== false) {
      throw new Error('这段译文已锁定；请先解锁再修改或重试。')
    }
    const status = allowedStatuses.has(patch.status) ? patch.status : segment.status
    const attempts = patch.incrementAttempts ? segment.attempts + 1 : Math.max(0, Number(patch.attempts ?? segment.attempts) || 0)
    const translationSource = patch.translationSource === undefined ? segment.translationSource : String(patch.translationSource).trim()
    if (!translationSource) throw new Error('用于翻译的提取文本不能为空。')
    const sourceChanged = translationSource !== segment.translationSource
    const translation = sourceChanged ? '' : patch.translation === undefined ? segment.translation : String(patch.translation)
    const nextStatus = sourceChanged ? 'pending' : status === 'translated' && !translation.trim() ? 'failed' : status
    return {
      ...segment,
      status: nextStatus,
      translation,
      translationSource,
      translationSourceHash: bilingualContentHash(translationSource),
      attempts,
      locked: patch.locked === undefined ? segment.locked : Boolean(patch.locked),
      provider: patch.provider === undefined ? segment.provider : String(patch.provider || ''),
      model: patch.model === undefined ? segment.model : String(patch.model || ''),
      error: nextStatus === 'failed' ? String(patch.error || segment.error || '翻译失败') : undefined,
    }
  })
  if (!matched) throw new Error(`未知的对照翻译段落：${segmentId}`)
  return next
}

export function selectBilingualTranslationBatch(segments, options = {}) {
  const limit = Math.max(1, Number(options.limit) || DEFAULT_BATCH_SIZE)
  const maxCharacters = Math.max(240, Number(options.maxCharacters) || DEFAULT_BATCH_CHARACTERS)
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3)
  const retryFailed = options.retryFailed !== false
  const candidates = (Array.isArray(segments) ? segments : [])
    .filter(segment => segment.translatable && !segment.locked && (
      segment.status === 'pending'
      || (retryFailed && segment.status === 'failed' && segment.attempts < maxAttempts)
    ))
    .sort((left, right) => {
      const statusRank = status => status === 'pending' ? 0 : 1
      return statusRank(left.status) - statusRank(right.status) || left.sourceIndex - right.sourceIndex
    })
  const selected = []
  let totalCharacters = 0
  for (const segment of candidates) {
    if (selected.length >= limit) break
    if (selected.length && totalCharacters + segment.source.length > maxCharacters) break
    selected.push(segment)
    totalCharacters += segment.translationSource.length
    if (totalCharacters >= maxCharacters) break
  }
  return selected
}

export function markBilingualBatchTranslating(segments, batch) {
  const selectedIds = new Set((Array.isArray(batch) ? batch : []).map(segment => segment.id))
  return (Array.isArray(segments) ? segments : []).map(segment => selectedIds.has(segment.id) && segment.translatable
    ? { ...segment, status: 'translating', attempts: segment.attempts + 1, error: undefined }
    : segment)
}

export function retryFailedBilingualSegments(segments, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3)
  return (Array.isArray(segments) ? segments : []).map(segment => segment.translatable && segment.status === 'failed' && segment.attempts < maxAttempts
    ? { ...segment, status: 'pending', error: undefined }
    : segment)
}

export function buildBilingualReadingPairs(segments) {
  return (Array.isArray(segments) ? segments : []).map(segment => ({
    segmentId: segment.id,
    contentHash: segment.contentHash,
    kind: segment.kind,
    sourceMarkdown: segment.source,
    translationSource: segment.translationSource,
    sourceWasAdjusted: segment.translationSource !== segment.source,
    translatedMarkdown: segment.status === 'translated' ? segment.translation : '',
    status: segment.status,
    translatable: segment.translatable,
    error: segment.error,
    locked: segment.locked,
    provider: segment.provider,
    model: segment.model,
  }))
}

export function reconstructBilingualSource(segments) {
  return (Array.isArray(segments) ? segments : []).map(segment => segment.source).join('')
}

export const BILINGUAL_READING_DEFAULTS = Object.freeze({
  maxSegmentCharacters: DEFAULT_MAX_SEGMENT_CHARACTERS,
  batchSize: DEFAULT_BATCH_SIZE,
  batchCharacters: DEFAULT_BATCH_CHARACTERS,
})
