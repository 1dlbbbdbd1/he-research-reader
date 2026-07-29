export function buildReviewAIRequest(fragments) {
  const safeFragments = (Array.isArray(fragments) ? fragments : []).map(fragment => ({
    id: fragment.id,
    origin: fragment.origin,
    kind: fragment.kind,
    itemTitle: fragment.itemTitle,
    pageNumber: fragment.anchor?.pageNumber,
    content: fragment.content,
  }))
  return {
    system: [
      '你是科研复查编辑，只能整理用户给出的碎片。',
      '输出 JSON 数组，每项格式为 {"content":"一条结构化整理","citationFragmentIds":["fragment-id"]}。',
      '每条结论必须引用至少一个输入碎片；信息不足就不要生成。',
      '不要改写或合并原始用户笔记，不要编造页码、作者、实验结果或来源。',
      '优先按研究背景、现状、方法、实验、局限和可复现性组织，控制在 3-8 条。',
      '只输出 JSON，不要 Markdown 代码围栏。',
    ].join('\n'),
    user: JSON.stringify({ fragments: safeFragments }),
  }
}

export function parseReviewAISections(text, allowedFragmentIds) {
  const allowed = new Set(Array.isArray(allowedFragmentIds) ? allowedFragmentIds : [])
  const source = String(text || '').trim()
  const unfenced = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = unfenced.indexOf('[')
  const end = unfenced.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('AI 没有返回 JSON 数组。')
  const parsed = JSON.parse(unfenced.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('AI 返回结构不是数组。')
  return parsed.slice(0, 12).flatMap(section => {
    const content = String(section?.content || '').trim()
    const citationFragmentIds = [...new Set(
      (Array.isArray(section?.citationFragmentIds) ? section.citationFragmentIds : [])
        .map(String)
        .filter(id => allowed.has(id)),
    )]
    if (!content || !citationFragmentIds.length) return []
    return [{ content: content.slice(0, 5000), citationFragmentIds }]
  })
}
