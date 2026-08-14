const CONVERSATION_WORKFLOWS = Object.freeze([
  {
    id: 'literature-search',
    name: '查找相应的文献',
    description: '按研究问题检索 Crossref，并整理候选文献与后续核验建议。',
    prompt: '请说明研究主题、关键词或需要解决的问题。',
    taskType: 'research',
    sourceSelection: 'none',
    requiredTools: ['project.inspect', 'web.fetch'],
    permissionRequirements: { domains: ['api.crossref.org'], applications: [], commands: [] },
  },
  {
    id: 'literature-summary',
    name: '文献分析总结',
    description: '读取选中的项目资料，按研究问题、方法、结果与局限形成可追溯总结。',
    prompt: '选择一至三份项目资料，并说明希望重点比较的内容。',
    taskType: 'research',
    sourceSelection: 'required',
    requiredTools: ['project.inspect', 'research.source.read'],
    permissionRequirements: { domains: [], applications: [], commands: [] },
  },
  {
    id: 'method-summary',
    name: '实验方法指定总结',
    description: '结合选中资料，整理实验目标、材料设备、变量、步骤、质控与风险。',
    prompt: '说明实验目标和指定方法；可选择一至三份项目资料作为依据。',
    taskType: 'research',
    sourceSelection: 'optional',
    requiredTools: ['project.inspect'],
    optionalTools: ['research.source.read'],
    permissionRequirements: { domains: [], applications: [], commands: [] },
  },
  {
    id: 'skill-teaching',
    name: '实验技能教学',
    description: '按当前基础与设备条件生成分步教学、检查点、风险提醒与练习。',
    prompt: '说明要学习的技能、当前基础和可用设备；可附项目资料。',
    taskType: 'engineering',
    sourceSelection: 'optional',
    requiredTools: ['project.inspect'],
    optionalTools: ['research.source.read'],
    permissionRequirements: { domains: [], applications: [], commands: [] },
  },
])

function getConversationWorkflow(id) {
  return CONVERSATION_WORKFLOWS.find(workflow => workflow.id === id)
}

function normalizedSourceIds(input = {}) {
  return [...new Set((Array.isArray(input.sourceIds) ? input.sourceIds : [])
    .map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3)
}

function buildConversationWorkflowSteps(workflow, objective, project, input = {}) {
  const root = project.externalRoots[0] || project.vaultPath
  const sourceIds = normalizedSourceIds(input)
  if (workflow.sourceSelection === 'required' && !sourceIds.length) throw new Error(`“${workflow.name}”需要先选择至少一份项目资料。`)
  const steps = [{ kind: 'tool', toolName: 'project.inspect', title: '查看当前项目', rationale: '先确认本次任务正在正确的项目范围内进行。', input: { root, _conversationWorkflowStep: 'inspect-project' } }]
  if (workflow.id === 'literature-search') {
    const query = encodeURIComponent(objective)
    steps.push({
      kind: 'tool', toolName: 'web.fetch', title: '检索候选文献',
      rationale: '只读取 Crossref 的公开书目信息，不把候选记录当作已阅读全文。',
      input: { url: `https://api.crossref.org/works?query.bibliographic=${query}&rows=10&select=DOI,title,author,published,container-title,URL,abstract,type`, _conversationWorkflowStep: 'search-crossref' },
    })
    steps.push({ kind: 'model', title: '整理候选文献', rationale: '按主题匹配度整理题名、作者、年份、来源和 DOI；明确书目信息缺口，并给出下一步全文核验建议。', input: { role: 'executor', _conversationWorkflowStep: 'summarize-candidates' } })
  } else {
    sourceIds.forEach((sourceId, index) => steps.push({
      kind: 'tool', toolName: 'research.source.read', title: `读取项目资料 ${index + 1}`,
      rationale: '读取用户在当前项目中明确选择的资料正文或结构化阅读稿。',
      input: { sourceId, _conversationWorkflowStep: `read-source-${index + 1}` },
    }))
    if (workflow.id === 'literature-summary') steps.push({ kind: 'model', title: '形成文献分析总结', rationale: '逐份提取研究问题、方法、样本、关键结果与局限，再比较一致点和冲突点；每个事实注明资料名称，资料未覆盖处标为待核验。', input: { role: 'executor', _conversationWorkflowStep: 'analyze-literature' } })
    if (workflow.id === 'method-summary') steps.push({ kind: 'model', title: '形成实验方法总结', rationale: '围绕指定方法整理适用目标、材料设备、变量、可复现步骤、质量控制、常见失败与安全风险；区分资料事实、合理推断和仍需确认的条件。', input: { role: 'executor', _conversationWorkflowStep: 'summarize-method' } })
    if (workflow.id === 'skill-teaching') steps.push({ kind: 'model', title: '生成实验技能教学', rationale: '根据用户基础和设备，从准备、示范、跟做、检查、排错到独立练习分段教学；危险步骤只讲安全边界，不声称已操作设备。', input: { role: 'executor', _conversationWorkflowStep: 'teach-skill' } })
  }
  steps.push({ kind: 'verify', title: '核对工作流结果', rationale: '检查每个固定步骤是否完成、结论是否越过证据，并确认没有把建议写成已完成操作。', input: { _conversationWorkflowStep: 'verify-workflow' } })
  return steps
}

module.exports = { CONVERSATION_WORKFLOWS, getConversationWorkflow, buildConversationWorkflowSteps, normalizedSourceIds }
