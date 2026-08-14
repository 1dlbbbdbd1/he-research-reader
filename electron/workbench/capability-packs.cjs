const { getCapabilityContract } = require('./capability-contracts.cjs')

const CAPABILITY_PACKS = Object.freeze([
  {
    id: 'research-paper-reading', name: '证据化论文精读', category: '阅读', maturity: 'available',
    description: '中英对照阅读、图表原位查看、逐段回到原文证据。',
    requiredTools: ['file.read', 'web.fetch'], outputs: ['阅读卡', '证据卡', '术语表'], highRisk: [],
    ...getCapabilityContract('research-paper-reading'),
  },
  {
    id: 'research-reference-check', name: '引用真实性核查', category: '核查', maturity: 'foundation',
    description: '解析正文引用，跨来源查重与核对题录，标记找不到或信息冲突的条目；不把搜索不到直接判为虚假。',
    requiredTools: ['file.read', 'web.fetch'], outputs: ['引用核查表', '待人工复核清单'], highRisk: ['external_search'],
    ...getCapabilityContract('research-reference-check'),
  },
  {
    id: 'research-reviewer-response', name: '审稿意见与回复信', category: '写作', maturity: 'foundation',
    description: '逐条拆解审稿意见、关联修改证据并生成可编辑回复信；投稿前必须人工确认。',
    requiredTools: ['file.read', 'file.writeVersioned', 'office.createCopy'], outputs: ['意见矩阵', 'Response Letter 草稿'], highRisk: ['formal_record', 'external_submit'],
    ...getCapabilityContract('research-reviewer-response'),
  },
  {
    id: 'research-patent-draft', name: '技术材料转专利草案', category: '转化', maturity: 'foundation',
    description: '从论文或技术报告整理权利要求、说明书结构与附图说明草稿，不替代专利代理与新颖性检索。',
    requiredTools: ['file.read', 'file.writeVersioned'], outputs: ['权利要求草稿', '说明书草稿', '附图清单'], highRisk: ['formal_record'],
    ...getCapabilityContract('research-patent-draft'),
  },
  {
    id: 'research-roadmap', name: '研究路线图', category: '规划', maturity: 'foundation',
    description: '把研究目标、阶段、依赖和验证门整理为可编辑路线图数据及图片。',
    requiredTools: ['file.writeVersioned'], outputs: ['路线图数据', 'SVG/图片'], highRisk: [],
    ...getCapabilityContract('research-roadmap'),
  },
  {
    id: 'research-academic-translation', name: '学术翻译', category: '语言', maturity: 'available',
    description: '中英互译、术语一致性和逐段对照，导出新版本 Word/PDF 材料，不覆盖原文。',
    requiredTools: ['file.read', 'file.writeVersioned', 'office.createCopy'], outputs: ['双语稿', '术语表'], highRisk: [],
    ...getCapabilityContract('research-academic-translation'),
  },
  {
    id: 'research-literature-review', name: '系统文献综述', category: '综述', maturity: 'foundation',
    description: '形成检索式、筛选记录、证据矩阵和带来源综述草稿；数据库结果与纳排决定均保留。',
    requiredTools: ['web.fetch', 'file.writeVersioned'], outputs: ['检索记录', '证据矩阵', '综述草稿'], highRisk: ['external_search', 'formal_record'],
    ...getCapabilityContract('research-literature-review'),
  },
  {
    id: 'research-paper-figure', name: '科研图表工作流', category: '可视化', maturity: 'foundation',
    description: '先固定数据、定义和图注，再生成可编辑图表与投稿图片，并保留数据到图片的来源链。',
    requiredTools: ['file.read', 'command.run', 'file.writeVersioned'], outputs: ['绘图数据', '可编辑图', '投稿图片', 'QA 报告'], highRisk: ['command'],
    ...getCapabilityContract('research-paper-figure'),
  },
  {
    id: 'research-causal-inference', name: '因果推断分析', category: '分析', maturity: 'foundation',
    description: '根据研究设计选择 DID、RDD、IV、PSM 或 SCM，先做识别假设和诊断，不把相关性包装为因果。',
    requiredTools: ['file.read', 'command.run', 'file.writeVersioned'], outputs: ['方法选择记录', '诊断结果', '分析报告'], highRisk: ['command', 'formal_record'],
    ...getCapabilityContract('research-causal-inference'),
  },
  {
    id: 'research-document-formatting', name: '学术文档规范排版', category: '排版', maturity: 'foundation',
    description: '按用户指定模板检查并生成 Word 新版本，处理样式、题注、目录和参考文献格式，不覆盖原件。',
    requiredTools: ['office.createCopy'], outputs: ['规范排版副本', '格式问题清单'], highRisk: [],
    ...getCapabilityContract('research-document-formatting'),
  },
])

function getCapabilityPack(id) { return CAPABILITY_PACKS.find(pack => pack.id === id) }

module.exports = { CAPABILITY_PACKS, getCapabilityPack }
