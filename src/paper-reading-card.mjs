export const READING_CARD_SECTIONS = [
  { key: 'problem', title: '文献解决的问题' },
  { key: 'contribution', title: '核心贡献' },
  { key: 'method', title: '研究对象与方法' },
  { key: 'experiment', title: '实验设计与数据' },
  { key: 'findings', title: '主要结论' },
  { key: 'strengths', title: '优点与可复用之处' },
  { key: 'limitations', title: '作者局限与适用边界' },
  { key: 'user_notes', title: '我的观点、批注与疑问' },
  { key: 'related_papers', title: '相关论文线索' },
  { key: 'relevance', title: '与当前研究的关系' },
  { key: 'reuse', title: '可用于论文的位置' },
  { key: 'next_steps', title: '待核验问题与下一步' },
]

export function buildPaperReadingCardRequest({ paper, contexts }) {
  const safeContexts = (Array.isArray(contexts) ? contexts : [])
    .map(context => ({
      contextId: String(context?.contextId || ''),
      origin: String(context?.origin || ''),
      label: String(context?.label || ''),
      pageNumber: Number.isInteger(context?.pageNumber) ? context.pageNumber : null,
      content: String(context?.content || '').slice(0, 5000),
    }))
    .filter(context => context.contextId && context.content)
  if (!safeContexts.length) throw new Error('当前论文没有可用于生成阅读卡的本地证据。')
  return {
    contexts: safeContexts,
    system: [
      '你是科研阅读卡整理助手，只能整理给定 contexts，不能补充外部事实。',
      'source_evidence/document/bibliography 是论文或派生证据；user/user_state 是用户笔记或用户选择，二者不能混写。',
      '每个区块必须引用至少一个 contextId。没有证据的区块不要输出，不得捏造页码、实验条件、结论或用户感受。',
      '只输出 JSON：{"sections":[{"key":"problem","content":"...","citationIds":["C1"]}]}。',
      `key 只能是：${READING_CARD_SECTIONS.map(section => section.key).join(', ')}。`,
    ].join('\n'),
    user: JSON.stringify({
      paper: {
        title: paper?.title || '',
        authors: paper?.authors || [],
        issued: paper?.issued || null,
        containerTitle: paper?.containerTitle || null,
      },
      requestedSections: READING_CARD_SECTIONS,
      contexts: safeContexts,
    }),
  }
}

export function parsePaperReadingCardAnswer(content, contexts) {
  const normalized = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error('AI 没有返回合法的阅读卡 JSON。')
  }
  const contextById = new Map((Array.isArray(contexts) ? contexts : []).map(context => [context.contextId, context]))
  const sectionTitles = new Map(READING_CARD_SECTIONS.map(section => [section.key, section.title]))
  const seenKeys = new Set()
  const sections = []
  for (const section of Array.isArray(parsed?.sections) ? parsed.sections : []) {
    const key = String(section?.key || '')
    const text = String(section?.content || '').trim()
    const citationIds = [...new Set((Array.isArray(section?.citationIds) ? section.citationIds : [])
      .map(id => String(id))
      .filter(id => contextById.has(id))
      .filter(id => contextAllowedForSection(key, contextById.get(id)?.origin)))]
    if (!sectionTitles.has(key) || seenKeys.has(key) || !text || !citationIds.length) continue
    seenKeys.add(key)
    sections.push({ key, title: sectionTitles.get(key), content: text, citationIds })
  }
  if (!sections.length) throw new Error('AI 阅读卡没有任何可验证引用，因此未保存。')
  return sections
}

function contextAllowedForSection(sectionKey, origin) {
  if (['problem', 'contribution', 'method', 'experiment', 'findings', 'strengths', 'limitations', 'related_papers'].includes(sectionKey)) {
    return ['source_evidence', 'document', 'bibliography'].includes(origin)
  }
  if (sectionKey === 'user_notes') return ['user', 'user_state'].includes(origin)
  return true
}
