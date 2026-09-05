function experimentIntakeRecordInput({ run, result, timestamp, recordId, researchProjectId }) {
  const rawInput = String(run.conversationWorkflowInput?.pastedText ?? run.objective ?? '')
  const sourceIds = [...new Set((Array.isArray(run.conversationWorkflowInput?.sourceIds) ? run.conversationWorkflowInput.sourceIds : []).map(value => String(value || '').trim()).filter(Boolean))]
  const content = String(result.content || '')
  if (!rawInput.trim()) throw new Error('实验整理结果缺少原始输入，不能写入科研记录。')
  if (!content.trim()) throw new Error('实验整理草稿为空，不能确认写入科研记录。')
  const title = content.split(/\r?\n/).map(line => line.replace(/^\s*#+\s*/, '').trim()).find(Boolean) || '实验整理'
  return {
    id: recordId,
    projectId: researchProjectId,
    recordType: 'experiment',
    title: title.slice(0, 240),
    status: 'active',
    sourceIds,
    tags: ['实验整理'],
    content: `# 原始输入\n\n${rawInput}\n\n# 整理结果\n\n${content}\n\n# 整理登记\n\n${timestamp}\n\n# 关联运行\n\n- Run：${run.id}\n- 结果：${result.resultId || ''}\n- 版本：${result.version || ''}\n\n# 来源链接\n\n\`\`\`json\n${JSON.stringify(result.sourceLinks || [], null, 2)}\n\`\`\``,
  }
}

module.exports = { experimentIntakeRecordInput }
