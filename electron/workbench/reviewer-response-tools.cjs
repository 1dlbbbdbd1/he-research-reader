const crypto = require('node:crypto')

const text = value => String(value ?? '').trim()
const list = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const stableId = (value, prefix = 'comment') => `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`

const STATUS = Object.freeze({
  already_modified: '已经修改',
  planned: '计划修改',
  disagree: '不同意',
  additional_experiment: '需要补充实验',
  user_decision: '需要用户决定',
})

function inferType(original) {
  const value = text(original).toLowerCase()
  if (/experiment|实验|ablation|消融|sample size|样本量/.test(value)) return '实验与证据'
  if (/statistic|统计|significan|显著|confidence interval|置信区间|method|方法/.test(value)) return '方法与统计'
  if (/novel|创新|contribution|贡献/.test(value)) return '创新性与贡献'
  if (/reference|citation|引用|文献/.test(value)) return '引用与相关工作'
  if (/figure|table|图|表/.test(value)) return '图表与呈现'
  if (/language|grammar|clarity|语言|语法|表述|清晰/.test(value)) return '语言与表达'
  return '其他'
}

function inferSeverity(original) {
  const value = text(original).toLowerCase()
  if (/major|严重|关键|fundamental|invalid|缺少实验|additional experiment/.test(value)) return 'major'
  if (/minor|小问题|typo|拼写|格式/.test(value)) return 'minor'
  return 'unspecified'
}

function inferEvidence(type) {
  if (type === '实验与证据') return ['实验记录或补充实验结果', '修改稿中的对应位置']
  if (type === '方法与统计') return ['分析代码或统计结果', '修改稿中的对应位置']
  if (type === '引用与相关工作') return ['真实文献来源', '修改稿中的对应位置']
  if (type === '图表与呈现') return ['新版图表或数据来源', '修改稿中的对应位置']
  return ['论文原文或修改稿中的对应位置']
}

function paragraphs(value) {
  return text(value).replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map(item => item.trim()).filter(Boolean)
}

function splitReviewerText(value) {
  const blocks = paragraphs(value)
  const comments = []
  let reviewer = 'Reviewer 1'
  let sequence = 0
  for (const block of blocks) {
    const reviewerHeading = block.match(/^(?:reviewer|审稿人)\s*[#：:]?\s*([\w-]+)/i)
    if (reviewerHeading && !/[.!?。！？]\s*$/.test(block)) {
      reviewer = `Reviewer ${reviewerHeading[1]}`
      continue
    }
    const marker = block.match(/^(?:(?:comment|意见)\s*)?[#（(]?([0-9]+)[）).、：:]\s*([\s\S]+)$/i)
    sequence += 1
    comments.push({ reviewer, number: marker?.[1] || String(sequence), original: text(marker?.[2] || block) })
  }
  return comments
}

function importReviewComments(input = {}) {
  const provided = list(input.comments)
  const raw = provided.length ? provided : splitReviewerText(input.reviewerText)
  if (!raw.length) throw new Error('没有识别到审稿意见，请粘贴意见或提供结构化 comments。')
  const seen = new Set()
  const comments = raw.map((item, index) => {
    const value = typeof item === 'string' ? { original: item } : object(item)
    const original = text(value.original || value.text)
    if (!original) throw new Error(`第 ${index + 1} 条审稿意见没有原文。`)
    const reviewer = text(value.reviewer) || 'Reviewer 1'
    const number = text(value.number) || String(index + 1)
    const id = text(value.id) || stableId(`${reviewer}|${number}|${original}`)
    if (seen.has(id)) throw new Error(`审稿意见 ID 重复：${id}`)
    seen.add(id)
    const type = text(value.type) || inferType(original)
    return { id, reviewer, number, original, type, severity: text(value.severity) || inferSeverity(original), requiredEvidence: list(value.requiredEvidence).map(text).filter(Boolean).length ? list(value.requiredEvidence).map(text).filter(Boolean) : inferEvidence(type) }
  })
  const markdown = `# 审稿意见拆解表\n\n${comments.map(item => `## ${item.reviewer} · ${item.number}\n\n- ID：${item.id}\n- 类型：${item.type}\n- 严重程度：${item.severity}\n- 所需证据：${item.requiredEvidence.join('；')}\n\n> ${item.original}`).join('\n\n')}`
  return { comments, count: comments.length, result: { type: 'review_comment_matrix', label: '审稿意见拆解表', content: markdown, data: { comments }, reviewState: 'draft' } }
}

function normalizeStatus(value) {
  const clean = text(value).toLowerCase()
  const aliases = { '已经修改': 'already_modified', modified: 'already_modified', '计划修改': 'planned', plan: 'planned', '不同意': 'disagree', disagree: 'disagree', '需要补充实验': 'additional_experiment', experiment: 'additional_experiment', '需要用户决定': 'user_decision', undecided: 'user_decision' }
  return STATUS[clean] ? clean : aliases[clean] || 'user_decision'
}

function indexByCommentId(items) {
  const indexed = new Map()
  for (const item of list(items)) {
    const value = object(item)
    const key = text(value.commentId || value.id || value.number)
    if (key) indexed.set(key, value)
  }
  return indexed
}

function buildResponsePlan(input = {}) {
  const comments = list(input.comments)
  if (!comments.length) throw new Error('没有可规划的 ReviewComment。')
  const plans = indexByCommentId(input.handlingPlans)
  const records = comments.map(comment => {
    const provided = plans.get(comment.id) || plans.get(text(comment.number)) || {}
    const status = normalizeStatus(provided.status)
    return {
      ...comment,
      status,
      statusLabel: STATUS[status],
      strategy: text(provided.strategy),
      targetLocations: list(provided.targetLocations).map(text).filter(Boolean),
      responseDraft: text(provided.responseDraft),
      evidenceLinks: [],
    }
  })
  const markdown = `# 审稿意见处理方案\n\n${records.map(item => `## ${item.reviewer} · ${item.number}\n\n- 状态：${item.statusLabel}\n- 处理策略：${item.strategy || '待用户填写'}\n- 拟修改位置：${item.targetLocations.join('；') || '待用户填写'}\n- 所需证据：${item.requiredEvidence.join('；')}`).join('\n\n')}`
  return { records, result: { type: 'review_response_plan', label: '审稿意见处理方案', content: markdown, data: { records }, reviewState: 'draft' } }
}

function sourceRows(workspace, sourceIds) {
  if (!workspace?.database) throw new Error('尚未打开可核对证据的科研项目。')
  const current = workspace.getCurrent?.()
  if (!current) throw new Error('尚未打开可核对证据的科研项目。')
  const query = workspace.database.prepare('SELECT id, name, content_sha256, extracted_text, derived_markdown FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL')
  const rows = new Map()
  for (const sourceId of new Set(sourceIds.filter(Boolean))) {
    const row = query.get(sourceId, current.projectId)
    if (!row) throw new Error(`证据资料不存在或不属于当前项目：${sourceId}`)
    rows.set(sourceId, row)
  }
  return rows
}

function linkResponseEvidence(workspace, input = {}) {
  const records = list(input.records)
  const links = indexByCommentId(input.evidenceLinks)
  const flattened = []
  for (const record of records) {
    const group = links.get(record.id) || links.get(text(record.number)) || {}
    for (const item of list(group.links || group.evidenceLinks)) flattened.push({ commentId: record.id, ...object(item) })
  }
  const sources = sourceRows(workspace, flattened.map(item => text(item.sourceId)))
  const linked = records.map(record => {
    const evidenceLinks = flattened.filter(item => item.commentId === record.id).map(item => {
      const sourceId = text(item.sourceId)
      const row = sources.get(sourceId)
      const quote = text(item.quote)
      const corpus = text(row?.derived_markdown || row?.extracted_text)
      if (quote && !corpus.includes(quote)) throw new Error(`意见 ${record.number} 的证据摘录在资料 ${sourceId} 中找不到。`)
      return { sourceId, sourceName: row.name, sourceSha256: row.content_sha256, role: text(item.role) || 'supporting_evidence', blockId: text(item.blockId) || undefined, pageNumber: Number(item.pageNumber) || undefined, location: text(item.location) || undefined, quote: quote || undefined }
    })
    return { ...record, evidenceLinks }
  })
  const markdown = `# 审稿回复证据矩阵\n\n${linked.map(item => `## ${item.reviewer} · ${item.number}\n\n- 状态：${item.statusLabel}\n- 证据：${item.evidenceLinks.length ? item.evidenceLinks.map(link => `${link.role} → ${link.sourceName}${link.location ? `（${link.location}）` : ''}`).join('；') : '尚未关联'}`).join('\n\n')}`
  return { records: linked, result: { type: 'review_response_evidence_matrix', label: '审稿回复证据矩阵', content: markdown, data: { records: linked }, sourceLinks: linked.flatMap(item => item.evidenceLinks.map(link => ({ kind: 'source', commentId: item.id, ...link }))), reviewState: 'draft' } }
}

function assertRecordReady(record) {
  if (!record.strategy) throw new Error(`意见 ${record.number} 尚未填写处理策略。`)
  if (record.status === 'planned' && !record.targetLocations.length) throw new Error(`意见 ${record.number} 标记为计划修改，但没有拟修改位置。`)
  if (record.status === 'already_modified') {
    const revised = record.evidenceLinks.some(link => link.role === 'revised_manuscript' && (link.quote || link.location || link.blockId || link.pageNumber))
    if (!revised) throw new Error(`意见 ${record.number} 声称已经修改，但没有修改稿位置证据。`)
  }
  if (record.status === 'disagree' && !record.evidenceLinks.length) throw new Error(`意见 ${record.number} 选择不同意，但没有支持证据。`)
  if (record.status === 'additional_experiment' && !record.targetLocations.length) throw new Error(`意见 ${record.number} 需要补充实验，但没有实验计划或拟写入位置。`)
}

function draftResponseLetter(input = {}) {
  const records = list(input.records)
  if (!records.length) throw new Error('没有可生成回复信的意见记录。')
  records.forEach(assertRecordReady)
  const salutation = text(input.salutation) || 'Dear Editor and Reviewers,'
  const opening = text(input.opening) || 'Thank you for the careful review. We respond to every comment below. Statements about completed revisions are backed by linked evidence.'
  const sections = records.map(item => {
    const evidence = item.evidenceLinks.length ? item.evidenceLinks.map(link => `- ${link.role}: ${link.sourceName}${link.location ? ` — ${link.location}` : ''}${link.quote ? ` — “${link.quote}”` : ''}`).join('\n') : '- 尚无证据链接；当前状态不声称已完成修改。'
    const statusSentence = item.status === 'already_modified' ? 'We have revised the manuscript at the evidence-linked location.' : item.status === 'planned' ? 'We plan to make this revision at the location listed below.' : item.status === 'disagree' ? 'We respectfully disagree for the evidence-based reason below.' : item.status === 'additional_experiment' ? 'Additional experiment is required before this point can be closed.' : 'A user decision is required before committing to a response.'
    return `## ${item.reviewer} · Comment ${item.number}\n\n**Comment**\n\n> ${item.original}\n\n**Status**: ${item.statusLabel}\n\n**Response**\n\n${item.responseDraft || `${statusSentence} ${item.strategy}`}\n\n**Planned or revised location**: ${item.targetLocations.join('；') || 'Not applicable / pending decision'}\n\n**Evidence**\n\n${evidence}`
  })
  const markdown = `# Response Letter\n\n${salutation}\n\n${opening}\n\n${sections.join('\n\n')}\n`
  return { records, markdown, result: { type: 'review_response_letter', label: 'Response Letter 草稿', content: markdown, data: { records }, sourceLinks: records.flatMap(item => item.evidenceLinks.map(link => ({ kind: 'source', commentId: item.id, ...link }))), reviewState: 'draft' } }
}

function validateResponseLetter(input = {}) {
  const records = list(input.records)
  const content = text(input.content)
  if (!content) throw new Error('回复信内容为空。')
  records.forEach(record => {
    assertRecordReady(record)
    if (!content.includes(record.original)) throw new Error(`回复信缺少意见 ${record.number} 的审稿原文。`)
  })
  const modifiedRecords = records.filter(item => item.status === 'already_modified')
  const sectionFor = item => {
    const heading = `## ${item.reviewer} · Comment ${item.number}`
    const start = content.indexOf(heading)
    if (start < 0) return ''
    const end = content.indexOf('\n## ', start + heading.length)
    return content.slice(start, end < 0 ? content.length : end)
  }
  const ungrounded = records.filter(item => item.status !== 'already_modified' && item.status !== 'planned' && item.status !== 'additional_experiment').filter(item => /we have revised|已经修改/i.test(sectionFor(item)))
  if (ungrounded.length) throw new Error(`回复信对未标记完成的意见声称已经修改：${ungrounded.map(item => item.number).join('、')}`)
  const qa = { passed: true, commentCount: records.length, completedModificationCount: modifiedRecords.length, evidenceLinkCount: records.reduce((sum, item) => sum + item.evidenceLinks.length, 0), checkedAt: new Date().toISOString() }
  const markdown = `# Response Letter QA\n\n- 意见总数：${qa.commentCount}\n- 有证据的已修改项：${qa.completedModificationCount}\n- 证据链接：${qa.evidenceLinkCount}\n- 结论：通过逐条完整性和“已修改”证据检查\n`
  return { qa, result: { type: 'review_response_qa', label: 'Response Letter QA', content: markdown, data: qa, reviewState: 'draft' } }
}

module.exports = { STATUS, buildResponsePlan, draftResponseLetter, importReviewComments, linkResponseEvidence, validateResponseLetter }
