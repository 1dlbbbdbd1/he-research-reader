const sharedPermissions = Object.freeze({ domains: [], applications: [], commands: [] })

const CONVERSATION_WORKFLOWS = Object.freeze([
  {
    id: 'literature-search', name: '查找相应的文献', category: '文献与阅读', featured: true,
    description: '按研究问题检索 Crossref，并整理候选文献与后续核验建议。',
    prompt: '请说明研究主题、关键词或需要解决的问题。', outputHint: '候选文献清单与全文核验建议', keywords: ['检索', '论文', 'Crossref', 'DOI'],
    taskType: 'research', sourceSelection: 'none', minimumSources: 0, maximumSources: 0,
    requiredTools: ['project.inspect', 'web.fetch'], permissionRequirements: { domains: ['api.crossref.org'], applications: [], commands: [] },
  },
  {
    id: 'literature-summary', name: '文献分析总结', category: '文献与阅读', featured: true,
    description: '读取选中的项目资料，按研究问题、方法、结果与局限形成可追溯总结。',
    prompt: '选择一至三份项目资料，并说明希望重点分析的内容。', outputHint: '带资料出处的结构化总结', keywords: ['总结', '精读', '方法', '结果', '局限'],
    taskType: 'research', sourceSelection: 'required', minimumSources: 1, maximumSources: 3,
    requiredTools: ['project.inspect', 'research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '形成文献分析总结', modelRationale: '逐份提取研究问题、方法、样本、关键结果与局限，再比较一致点和冲突点；每个事实注明资料名称，资料未覆盖处标为待核验。',
  },
  {
    id: 'method-summary', name: '实验方法指定总结', category: '实验与方法', featured: true,
    description: '结合选中资料，整理实验目标、材料设备、变量、步骤、质控与风险。',
    prompt: '说明实验目标和指定方法；可选择一至三份项目资料作为依据。', outputHint: '可复核的方法清单与风险提示', keywords: ['实验', '方法', '设备', '步骤', '质控'],
    taskType: 'research', sourceSelection: 'optional', minimumSources: 0, maximumSources: 3,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '形成实验方法总结', modelRationale: '围绕指定方法整理适用目标、材料设备、变量、可复现步骤、质量控制、常见失败与安全风险；区分资料事实、合理推断和仍需确认的条件。',
  },
  {
    id: 'skill-teaching', name: '实验技能教学', category: '实验与方法', featured: true,
    description: '按当前基础与设备条件生成分步教学、检查点、风险提醒与练习。',
    prompt: '说明要学习的技能、当前基础和可用设备；可附项目资料。', outputHint: '分步教程、检查点与排错表', keywords: ['教学', '技能', '操作', '练习', '排错'],
    taskType: 'engineering', sourceSelection: 'optional', minimumSources: 0, maximumSources: 3,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '生成实验技能教学', modelRationale: '根据用户基础和设备，从准备、示范、跟做、检查、排错到独立练习分段教学；危险步骤只讲安全边界，不声称已操作设备。',
  },
  {
    id: 'research-question', name: '研究问题与假设梳理', category: '选题与规划', featured: false,
    description: '把模糊想法拆成研究问题、可检验假设、变量和证据缺口。',
    prompt: '描述研究想法、对象和目前最困惑的地方；可附已有资料。', outputHint: '问题树、假设与待验证清单', keywords: ['选题', '研究问题', '假设', '变量', '创新点'],
    taskType: 'research', sourceSelection: 'optional', minimumSources: 0, maximumSources: 3,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '梳理研究问题与假设', modelRationale: '把背景事实、研究者假设和待验证问题分开，给出核心问题、子问题、可观测变量、替代解释与最小验证路径；不凭空宣称创新。',
  },
  {
    id: 'experiment-design', name: '实验方案设计', category: '实验与方法', featured: false,
    description: '从研究目标形成变量、对照、样本、步骤、质控和验收方案。',
    prompt: '说明研究目标、已有设备、样本条件和不能改变的限制。', outputHint: '实验方案草案与开始前检查表', keywords: ['实验设计', '对照组', '样本量', '变量', '安全'],
    taskType: 'engineering', sourceSelection: 'optional', minimumSources: 0, maximumSources: 3,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '形成实验方案草案', modelRationale: '整理目标、输入输出变量、对照、样本、设备、步骤、质控、停止条件、安全边界和验收证据；把必须由研究者确认的条件单列出来。',
  },
  {
    id: 'multi-paper-comparison', name: '多文献对比矩阵', category: '文献与阅读', featured: false,
    description: '并排比较多篇论文的问题、方法、数据、结果、局限和适用场景。',
    prompt: '至少选择两份项目资料，并说明比较目的。', outputHint: '逐篇证据矩阵与差异结论', keywords: ['对比', '矩阵', '多篇论文', '差异', '综述'],
    taskType: 'research', sourceSelection: 'required', minimumSources: 2, maximumSources: 6,
    requiredTools: ['project.inspect', 'research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '建立多文献对比矩阵', modelRationale: '逐篇记录研究问题、样本或数据、方法、指标、关键结果、局限和适用条件，再总结共识与冲突；所有比较结论指回具体资料。',
  },
  {
    id: 'reproducibility-check', name: '可复现性检查', category: '实验与方法', featured: false,
    description: '检查论文或方案是否交代了复现实验所需的关键条件。',
    prompt: '选择要检查的论文或方案，并说明准备复现的范围。', outputHint: '已知条件、缺失信息与复现风险', keywords: ['复现', '参数', '代码', '数据', '材料'],
    taskType: 'research', sourceSelection: 'required', minimumSources: 1, maximumSources: 3,
    requiredTools: ['project.inspect', 'research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '检查可复现条件', modelRationale: '按材料、设备、软件版本、数据、参数、随机性、步骤、评价指标和统计方法检查信息完整度；缺失处只标待确认，不自行补造参数。',
  },
  {
    id: 'data-analysis-plan', name: '数据分析方案', category: '数据与分析', featured: false,
    description: '根据研究问题规划数据结构、清洗、统计检验、图表和诊断。',
    prompt: '说明研究问题、数据字段、样本规模和希望验证的关系。', outputHint: '分析路线、诊断与结果解释边界', keywords: ['数据分析', '统计', '清洗', '检验', '图表'],
    taskType: 'data', sourceSelection: 'optional', minimumSources: 0, maximumSources: 3,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '制定数据分析方案', modelRationale: '先明确数据合同、缺失值和异常值规则，再选择描述统计、检验或模型、诊断和图表；区分预注册分析、探索分析与不能支持的因果解释。',
  },
  {
    id: 'paper-outline', name: '论文提纲与写作计划', category: '写作与汇报', featured: false,
    description: '按研究证据组织论文结构，并标出每一节还缺什么材料。',
    prompt: '说明论文主题、目标期刊或格式要求；可附已有材料。', outputHint: '章节提纲、证据清单与写作顺序', keywords: ['论文', '提纲', '写作', '章节', '投稿'],
    taskType: 'document', sourceSelection: 'optional', minimumSources: 0, maximumSources: 6,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '形成论文提纲与写作计划', modelRationale: '建立题目、摘要、引言、方法、结果、讨论和结论的论证链，为每一节标出已有证据、缺口和不可越过的结论边界。',
  },
  {
    id: 'research-progress-report', name: '组会汇报与阶段复盘', category: '写作与汇报', featured: false,
    description: '把近期工作整理成进展、证据、问题、决定和下一步。',
    prompt: '说明汇报周期、听众和这段时间做过的工作；可附记录。', outputHint: '可用于组会或周报的结构化草稿', keywords: ['组会', '周报', '汇报', '复盘', '下一步'],
    taskType: 'document', sourceSelection: 'optional', minimumSources: 0, maximumSources: 6,
    requiredTools: ['project.inspect'], optionalTools: ['research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '整理阶段汇报与复盘', modelRationale: '按目标、实际完成、证据、异常、未解决问题、已做决定和下一步组织内容；计划与已完成工作必须分开，不用虚假百分比包装进度。',
  },
  {
    id: 'result-interpretation', name: '结果解读与讨论', category: '数据与分析', featured: false,
    description: '区分观察结果、统计证据、解释、替代原因和结论边界。',
    prompt: '选择结果材料并说明原研究问题，以及你最拿不准的解释。', outputHint: '事实—推断—假设分层讨论', keywords: ['结果', '讨论', '图表', '异常', '结论'],
    taskType: 'research', sourceSelection: 'required', minimumSources: 1, maximumSources: 4,
    requiredTools: ['project.inspect', 'research.source.read'], permissionRequirements: sharedPermissions,
    modelTitle: '形成结果解读与讨论', modelRationale: '先复述可直接观察的结果，再区分统计支持、机制解释、替代解释、异常与局限；没有证据支持的内容标为假设，并提出下一步验证。',
  },
])

function getConversationWorkflow(id) {
  return CONVERSATION_WORKFLOWS.find(workflow => workflow.id === id)
}

function normalizedSourceIds(input = {}, maximum = 6) {
  return [...new Set((Array.isArray(input.sourceIds) ? input.sourceIds : [])
    .map(value => String(value || '').trim()).filter(Boolean))].slice(0, Math.max(0, Number(maximum) || 0))
}

function buildConversationWorkflowSteps(workflow, objective, project, input = {}) {
  const root = project.externalRoots[0] || project.vaultPath
  const sourceIds = normalizedSourceIds(input, workflow.maximumSources ?? 6)
  const minimumSources = workflow.minimumSources ?? (workflow.sourceSelection === 'required' ? 1 : 0)
  if (sourceIds.length < minimumSources) throw new Error(`“${workflow.name}”需要先选择至少 ${minimumSources} 份项目资料。`)
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
    steps.push({ kind: 'model', title: workflow.modelTitle, rationale: workflow.modelRationale, input: { role: 'executor', _conversationWorkflowStep: `complete-${workflow.id}` } })
  }
  steps.push({ kind: 'verify', title: '核对工作流结果', rationale: '检查每个固定步骤是否完成、结论是否越过证据，并确认没有把建议写成已完成操作。', input: { _conversationWorkflowStep: 'verify-workflow' } })
  return steps
}

module.exports = { CONVERSATION_WORKFLOWS, getConversationWorkflow, buildConversationWorkflowSteps, normalizedSourceIds }
