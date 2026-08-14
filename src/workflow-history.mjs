export function rankFrequentWorkflows(runs, workflows, capabilityPacks, limit = 4) {
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 4))
  const workflowIds = new Set((Array.isArray(workflows) ? workflows : []).map(item => item?.id).filter(Boolean))
  const capabilityIds = new Set((Array.isArray(capabilityPacks) ? capabilityPacks : []).map(item => item?.id).filter(Boolean))
  const usage = new Map()

  for (const run of Array.isArray(runs) ? runs : []) {
    const kind = run?.conversationWorkflowId ? 'workflow' : run?.capabilityPackId ? 'capability' : undefined
    const id = run?.conversationWorkflowId || run?.capabilityPackId
    if (!kind || !id || (kind === 'workflow' ? !workflowIds.has(id) : !capabilityIds.has(id))) continue
    const key = `${kind}:${id}`
    const previous = usage.get(key) || { kind, id, useCount: 0, lastUsedAt: '' }
    const usedAt = String(run.updatedAt || run.createdAt || '')
    usage.set(key, {
      ...previous,
      useCount: previous.useCount + 1,
      lastUsedAt: usedAt > previous.lastUsedAt ? usedAt : previous.lastUsedAt,
    })
  }

  const ranked = [...usage.values()].sort((left, right) => (
    right.useCount - left.useCount
    || right.lastUsedAt.localeCompare(left.lastUsedAt)
    || left.id.localeCompare(right.id, 'zh-CN')
  ))
  const seen = new Set(ranked.map(item => `${item.kind}:${item.id}`))
  const fallbacks = (Array.isArray(workflows) ? workflows : [])
    .filter(item => item?.featured && !seen.has(`workflow:${item.id}`))
    .map(item => ({ kind: 'workflow', id: item.id, useCount: 0, lastUsedAt: '' }))

  return [...ranked, ...fallbacks].slice(0, safeLimit)
}

