const STOP_WORDS = new Set([
  '请', '请问', '这个', '这些', '论文', '文献', '研究', '当前', '一下',
  '什么', '为什么', '如何', '怎么', '哪些', '是否', '能否', '可以',
  'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'what', 'why', 'how',
  'which', 'does', 'do', 'can', 'paper', 'study', 'research',
])

export function agentQueryTerms(question) {
  const normalized = String(question || '').normalize('NFKC').toLocaleLowerCase()
  let segments = []
  try {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
    segments = [...segmenter.segment(normalized)]
      .filter(segment => segment.isWordLike)
      .map(segment => segment.segment)
  } catch {
    segments = normalized.match(/[\p{L}\p{N}]{2,}/gu) || []
  }
  return [...new Set(segments
    .map(term => term.trim())
    .filter(term => term.length >= 2 && !STOP_WORDS.has(term)))]
    .sort((left, right) => right.length - left.length)
    .slice(0, 8)
}

export function agentRetrievalQuestion(question, priorQuestions = []) {
  const current = String(question || '').replace(/\s+/g, ' ').trim()
  const currentTerms = agentQueryTerms(current)
  if (currentTerms.length >= 2) return current
  const previous = [...(Array.isArray(priorQuestions) ? priorQuestions : [])]
    .reverse()
    .map(value => String(value || '').replace(/\s+/g, ' ').trim())
    .find(value => agentQueryTerms(value).length >= 2)
  return previous ? `${previous}\n追问：${current}` : current
}

export function readerContextEvidence(readerContext, scope) {
  const context = readerContext && typeof readerContext === 'object' ? readerContext : {}
  const sourceId = String(context.sourceId || '').trim()
  if (!sourceId) return []
  const pageNumber = Number.isInteger(context.pageNumber) && context.pageNumber > 0 ? context.pageNumber : undefined
  const common = {
    kind: 'source',
    entityId: sourceId,
    origin: 'source_evidence',
    sourceId,
    itemId: context.itemId || undefined,
    pageNumber,
  }
  if (scope === 'selection') {
    const excerpt = String(context.selection?.text || '').replace(/\s+/g, ' ').trim()
    if (!excerpt) return []
    return [{
      ...common,
      id: `reader-selection:${sourceId}:${pageNumber || 'unknown'}`,
      originLabel: '当前选区',
      title: context.paperTitle || context.sourceName || '当前论文选区',
      subtitle: pageNumber ? `第 ${pageNumber} 页的鼠标选区` : '结构化文本选区',
      excerpt: excerpt.slice(0, 5000),
      anchor: context.selection.anchor || undefined,
    }]
  }
  if (scope === 'page') {
    const excerpt = String(context.pageText || '').replace(/\s+/g, ' ').trim()
    if (!excerpt || !pageNumber) return []
    return [{
      ...common,
      id: `reader-page:${sourceId}:${pageNumber}`,
      originLabel: '当前页原文',
      title: context.paperTitle || context.sourceName || '当前论文',
      subtitle: `第 ${pageNumber} 页`,
      excerpt: excerpt.slice(0, 12000),
      anchor: { type: 'pdf', state: 'resolved', pageNumber },
    }]
  }
  return []
}

function originWeight(origin, pageNumber) {
  if (origin === 'source_evidence') return pageNumber ? 14 : 10
  if (origin === 'user') return pageNumber ? 12 : 9
  if (origin === 'bibliography') return 7
  if (origin === 'mineru') return 6
  if (origin === 'document') return 5
  if (origin === 'review') return 4
  return 2
}

export function mergeAgentSearchResponses(responses, terms, limit = 12) {
  const merged = new Map()
  for (const response of Array.isArray(responses) ? responses : []) {
    for (const result of Array.isArray(response?.results) ? response.results : []) {
      const id = String(result?.id || '')
      if (!id) continue
      const haystack = `${result.title || ''} ${result.subtitle || ''} ${result.excerpt || ''}`
        .normalize('NFKC')
        .toLocaleLowerCase()
      const termHits = (Array.isArray(terms) ? terms : []).filter(term => haystack.includes(term)).length
      const score = originWeight(result.origin, result.pageNumber) + termHits * 3
      const current = merged.get(id)
      if (!current || score > current.score) merged.set(id, { ...result, score })
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.score - left.score || String(left.title).localeCompare(String(right.title), 'zh-CN'))
    .slice(0, Math.max(1, limit))
}

export function buildResearchAgentRequest({ question, evidence, scopeLabel, readerContext, history = [] }) {
  const contexts = (Array.isArray(evidence) ? evidence : []).map((entry, index) => ({
    evidenceId: `E${index + 1}`,
    title: entry.title,
    subtitle: entry.subtitle || '',
    origin: entry.origin,
    pageNumber: entry.pageNumber || null,
    excerpt: String(entry.excerpt || '').slice(0, 1400),
  }))
  if (!contexts.length) throw new Error('本地研究库没有找到可用于回答的证据。')
  return {
    contexts,
    system: [
      '你是本地科研证据助手，只能依据给定 evidence 回答。',
      '把原文证据、用户笔记和题录信息区分开；用户笔记不能冒充论文结论。',
      '会话历史只用于理解追问，不能作为证据；本轮结论仍必须引用本轮 evidence。',
      '阅读进度、当前页和当前视图只是上下文元数据，除非对应内容已列入 evidence，否则不能据此推断论文结论。',
      '每个回答区块至少引用一个 evidenceId；没有证据支持的内容不要输出。',
      '行动建议只能是 read、compare、verify、experiment、review、note 六类，每条都必须解释原因并引用 evidenceId。',
      '不得捏造页码、DOI、实验条件或论文结论。',
      '只输出 JSON：{"sections":[{"content":"结论或说明","citationIds":["E1"]}],"actions":[{"actionType":"verify","title":"要做什么","rationale":"为什么要做","citationIds":["E1"]}]}。',
    ].join('\n'),
    user: JSON.stringify({
      scope: scopeLabel,
      question,
      readerContext: readerContext ? {
        paperTitle: readerContext.paperTitle || '',
        pageNumber: readerContext.pageNumber || null,
        viewMode: readerContext.viewMode || '',
        readingStatus: readerContext.readingStatus || '',
        annotationCount: Number(readerContext.annotationCount) || 0,
        hasSelection: Boolean(readerContext.selection?.text),
      } : null,
      history: (Array.isArray(history) ? history : []).slice(-6).map(turn => ({
        role: turn?.role === 'assistant' ? 'assistant' : 'user',
        content: String(turn?.content || '').slice(0, 2400),
      })),
      evidence: contexts,
    }),
  }
}

export function parseResearchAgentAnswer(content, contexts) {
  const parsed = parseAgentPayload(content)
  const allowed = new Set((Array.isArray(contexts) ? contexts : []).map(context => context.evidenceId))
  const sections = []
  for (const section of Array.isArray(parsed?.sections) ? parsed.sections : []) {
    const text = String(section?.content || '').trim()
    const citationIds = allowedCitationIds(section?.citationIds, allowed)
    if (text && citationIds.length) sections.push({ content: text, citationIds })
  }
  if (!sections.length) throw new Error('AI 回答没有任何可验证引用，因此未采用。')
  return sections
}

export function parseResearchAgentActions(content, contexts) {
  const parsed = parseAgentPayload(content)
  const allowed = new Set((Array.isArray(contexts) ? contexts : []).map(context => context.evidenceId))
  const actionTypes = new Set(['read', 'compare', 'verify', 'experiment', 'review', 'note'])
  const actions = []
  const seen = new Set()
  for (const action of Array.isArray(parsed?.actions) ? parsed.actions : []) {
    const actionType = String(action?.actionType || '')
    const title = String(action?.title || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    const rationale = String(action?.rationale || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
    const citationIds = allowedCitationIds(action?.citationIds, allowed)
    const fingerprint = `${actionType}\u0000${title}`
    if (!actionTypes.has(actionType) || !title || !rationale || !citationIds.length || seen.has(fingerprint)) continue
    seen.add(fingerprint)
    actions.push({ actionType, title, rationale, citationIds })
    if (actions.length >= 8) break
  }
  return actions
}

function parseAgentPayload(content) {
  const normalized = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(normalized)
  } catch {
    throw new Error('AI 没有返回合法的可追溯回答 JSON。')
  }
}

function allowedCitationIds(value, allowed) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(id => String(id))
    .filter(id => allowed.has(id)))]
}
