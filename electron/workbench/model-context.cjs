const MAX_CONTEXT_CHARS = 48000
const MIN_CONTEXT_CHARS = 512

function firstLast(value, maximum) {
  const original = String(value ?? '')
  if (original.length <= maximum) return { content: original, originalChars: original.length, shownChars: original.length, truncated: false }
  if (maximum < 16) return { content: '', originalChars: original.length, shownChars: 0, truncated: true }
  const marker = '\n[内容已截断，保留首尾]\n'; const room = Math.max(0, maximum - marker.length)
  const tailLength = Math.floor(room / 2)
  const content = `${original.slice(0, Math.ceil(room / 2))}${marker}${tailLength ? original.slice(-tailLength) : ''}`
  return { content, originalChars: original.length, shownChars: content.length, truncated: true }
}
function short(value, maximum) { return firstLast(value, maximum).content }
function compactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, typeof item === 'string' ? short(item, 240) : typeof item === 'number' || typeof item === 'boolean' || item === null ? item : short(JSON.stringify(item), 240)]))
}
function observation(step) {
  const document = step.output?.document; const body = typeof document?.text === 'string' ? document.text : JSON.stringify(step.output ?? {})
  return { stepId: String(step.id || ''), title: short(step.title, 160), toolName: step.toolName || undefined, source: compactObject(document?.source), body: '', originalChars: String(body).length, shownChars: 0, bodyTruncated: false, _body: String(body) }
}
function publicObservation(item) { const { _body, ...publicItem } = item; return publicItem }

function buildModelContext({ project, session, memories = [], recentConfirmedResults = [], observations = [], maximumChars = MAX_CONTEXT_CHARS }) {
  if (!Number.isInteger(maximumChars) || maximumChars < MIN_CONTEXT_CHARS) throw new RangeError(`模型上下文预算至少需要 ${MIN_CONTEXT_CHARS} 个字符。`)
  const context = {
    project: { id: String(project.id || ''), name: short(project.name, 120) },
    session: session ? { id: String(session.id || ''), title: short(session.title, 160), turns: session.turns.map(turn => ({ role: turn.role, ...firstLast(turn.content, 700) })), omittedTurnCount: session.omittedTurnCount || 0 } : { id: null, turns: [], omittedTurnCount: 0 },
    confirmedMemories: memories.map(memory => ({ id: String(memory.id || ''), kind: short(memory.kind, 40), importance: Number(memory.importance || 0), source: { type: short(memory.sourceType, 40), id: memory.sourceId ? String(memory.sourceId) : null }, ...firstLast(memory.content, 600) })),
    recentConfirmedResults: recentConfirmedResults.map(result => ({ resultId: String(result.resultId || ''), type: short(result.type, 80), sourceLinks: (result.sourceLinks || []).slice(0, 20).map(compactObject), ...firstLast(result.content, 800) })),
    completedStepObservations: observations.map(observation),
    boundary: '仅使用当前项目、同一会话和已确认项目记忆。模型输出是待复核建议，不构成事实或已确认记忆。',
  }
  const serialize = () => JSON.stringify({ ...context, completedStepObservations: context.completedStepObservations.map(publicObservation) })
  const baseline = serialize()
  if (baseline.length > maximumChars) throw new RangeError('模型上下文元数据超过预算，无法在不丢失来源记录的情况下构造上下文。')
  const count = context.completedStepObservations.length
  if (count) for (const item of context.completedStepObservations) {
    const clipped = firstLast(item._body, Math.floor((maximumChars - baseline.length) / count))
    item.body = clipped.content; item.originalChars = clipped.originalChars; item.shownChars = clipped.shownChars; item.bodyTruncated = clipped.truncated
  }
  let serialized = serialize()
  while (serialized.length > maximumChars) {
    const candidates = context.completedStepObservations.filter(item => item.body.length > 0)
    if (!candidates.length) throw new RangeError('模型上下文无法在预算内保留每份来源。')
    const largest = candidates.reduce((best, item) => item.body.length > best.body.length ? item : best)
    const clipped = firstLast(largest._body, Math.max(0, largest.body.length - Math.max(1, Math.ceil((serialized.length - maximumChars) / candidates.length))))
    largest.body = clipped.content; largest.shownChars = clipped.shownChars; largest.bodyTruncated = true; serialized = serialize()
  }
  return { context: JSON.parse(serialized), serialized, truncated: context.completedStepObservations.some(item => item.bodyTruncated) || [...context.session.turns, ...context.confirmedMemories, ...context.recentConfirmedResults].some(item => item.truncated) }
}

module.exports = { MAX_CONTEXT_CHARS, MIN_CONTEXT_CHARS, buildModelContext }
