const crypto = require('node:crypto')
const fs = require('node:fs')

const text = value => String(value ?? '').trim()
const list = value => Array.isArray(value) ? value : []
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

const METHOD_SCHEMAS = Object.freeze({
  DID: { fields: ['outcome', 'unit', 'time', 'treated', 'post'], diagnostics: 'parallelTrends', label: '双重差分 DID' },
  RDD: { fields: ['outcome', 'running', 'cutoff', 'bandwidth'], diagnostics: 'bandwidthSensitivity', label: '回归不连续 RDD' },
  IV: { fields: ['outcome', 'treatment', 'instrument'], diagnostics: 'weakInstrument', label: '工具变量 IV / 2SLS' },
  PSM: { fields: ['outcome', 'treatment', 'covariates'], diagnostics: 'matchingBalance', label: '倾向得分匹配 PSM' },
  SCM: { fields: ['outcome', 'unit', 'time', 'treatedUnit', 'interventionTime'], diagnostics: 'syntheticControl', label: '合成控制 SCM' },
})

function csvHeaders(path) {
  const first = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
  const delimiter = first.includes('\t') ? '\t' : ','
  return first.split(delimiter).map(value => value.replace(/^"|"$/g, '').trim()).filter(Boolean)
}

function inspectMethod(method, design, columns) {
  const schema = METHOD_SCHEMAS[method]; const missingFields = schema.fields.filter(field => design[field] === undefined || design[field] === null || (Array.isArray(design[field]) ? !design[field].length : text(design[field]) === ''))
  const columnFields = schema.fields.filter(field => !['cutoff', 'bandwidth', 'treatedUnit', 'interventionTime'].includes(field))
  const referenced = columnFields.flatMap(field => Array.isArray(design[field]) ? design[field] : [design[field]]).map(text).filter(Boolean)
  const missingColumns = referenced.filter(column => !columns.includes(column))
  return { method, label: schema.label, applicable: !missingFields.length && !missingColumns.length, missingFields, missingColumns, requiredDiagnostic: schema.diagnostics }
}

function inspectCausalDesign(input = {}) {
  const dataPath = text(input.dataPath); const method = text(input.method).toUpperCase(); const design = object(input.design)
  if (!METHOD_SCHEMAS[method]) throw new Error('方法必须是 DID、RDD、IV、PSM 或 SCM。')
  const columns = csvHeaders(dataPath); const dataHash = sha256(fs.readFileSync(dataPath)); const selected = inspectMethod(method, design, columns)
  const alternatives = Object.keys(METHOD_SCHEMAS).map(candidate => inspectMethod(candidate, candidate === method ? design : object(object(design.alternatives)[candidate]), columns))
  if (!selected.applicable) throw new Error(`${METHOD_SCHEMAS[method].label} 研究设计不完整：${[...selected.missingFields.map(value => `缺字段 ${value}`), ...selected.missingColumns.map(value => `缺数据列 ${value}`)].join('；')}`)
  const assumptions = list(input.assumptions).map(text).filter(Boolean)
  if (!assumptions.length) throw new Error('必须先填写本研究对识别假设的研究者说明，不能直接套模型。')
  const record = { method, methodLabel: METHOD_SCHEMAS[method].label, dataPath, dataHash, columns, design, researcherAssumptions: assumptions, applicableMethods: alternatives.filter(item => item.applicable).map(item => item.method), methodChecks: alternatives, requiredDiagnostic: selected.requiredDiagnostic }
  const markdown = `# 因果研究设计记录\n\n- 选择方法：${record.methodLabel}\n- 数据 SHA-256：${dataHash}\n- 数据列：${columns.join('、')}\n- 当前可用方法：${record.applicableMethods.join('、') || '仅当前完整设计'}\n\n## 方法适用性\n\n${alternatives.map(item => `- ${item.label}：${item.applicable ? '输入合同满足' : `不适用/未配置（${[...item.missingFields.map(value => `缺 ${value}`), ...item.missingColumns.map(value => `缺列 ${value}`)].join('；')}）`}`).join('\n')}\n\n## 研究者填写的识别假设\n\n${assumptions.map(item => `- ${item}`).join('\n')}\n\n> 本记录只说明数据与输入合同是否满足，不自动证明识别假设成立。\n`
  return { record, result: { type: 'causal_design', label: '因果研究设计与方法适用性', content: markdown, data: record, sourceLinks: [{ kind: 'file', path: dataPath, sha256: dataHash }], reviewState: 'draft' } }
}

function parseCausalProcess(stdout) {
  const line = String(stdout || '').split(/\r?\n/).reverse().find(value => value.startsWith('READER_CAUSAL_RESULT:'))
  if (!line) throw new Error('Python 因果分析没有返回结构化结果。')
  const result = JSON.parse(line.slice('READER_CAUSAL_RESULT:'.length))
  if (result.error) throw new Error(result.error)
  return result
}

function causalReport(result) {
  const diagnostic = Object.values(object(result.diagnostics))[0] || {}
  const reliable = result.reliable === true
  return `# ${result.method} 因果推断分析报告\n\n## 统计结果\n\n- 估计量：${result.estimate.name}\n- 估计值：${result.estimate.value}\n- 标准误：${result.estimate.standardError ?? '当前实现不提供'}\n- 分析样本量：${result.estimate.n}\n- 数据 SHA-256：${result.dataSha256}\n\n## 对应诊断\n\n\`\`\`json\n${JSON.stringify(result.diagnostics, null, 2)}\n\`\`\`\n\n- 诊断是否通过：${diagnostic.passed === true ? '是' : '否'}\n\n## 方法假设\n\n${list(result.assumptions).map(item => `- ${item}`).join('\n')}\n\n## 研究者解释边界\n\n${result.interpretationBoundary}\n\n${reliable ? '> 对应自动诊断通过，但识别假设仍需研究者与同行复核后才能形成正式因果结论。' : '> **对应诊断未通过：当前结果只能报告为统计估计，不得表述成可靠因果结论。**'}\n\n## 运行环境与参数\n\n\`\`\`json\n${JSON.stringify({ runtime: result.runtime, modelParameters: result.modelParameters }, null, 2)}\n\`\`\`\n`
}

function wrapCausalResult(result, scriptContent) {
  const markdown = causalReport(result)
  return { analysis: result, analysisJson: JSON.stringify(result, null, 2), code: scriptContent, markdown, result: { type: 'causal_analysis', label: `${result.method} 因果分析结果与诊断`, content: markdown, data: result, sourceLinks: [{ kind: 'file', path: result.dataPath, sha256: result.dataSha256 }], reviewState: 'draft' } }
}

function qaCausalAnalysis(input = {}) {
  const analysis = object(input.analysis); const record = object(input.record); const content = text(input.content); const currentHash = sha256(fs.readFileSync(record.dataPath)); const expectedDiagnostic = METHOD_SCHEMAS[analysis.method]?.diagnostics
  if (!expectedDiagnostic || !object(analysis.diagnostics)[expectedDiagnostic]) throw new Error(`${analysis.method} 缺少对应诊断 ${expectedDiagnostic}。`)
  if (currentHash !== record.dataHash || currentHash !== analysis.dataSha256) throw new Error('因果分析前后数据哈希不一致。')
  if (!content.includes('统计结果') || !content.includes('方法假设') || !content.includes('研究者解释边界')) throw new Error('分析报告没有分开统计结果、方法假设和研究者解释。')
  const reliable = analysis.reliable === true
  if (!reliable && !content.includes('不得表述成可靠因果结论')) throw new Error('诊断未通过的报告没有阻止可靠因果结论。')
  const qa = { passed: true, method: analysis.method, diagnostic: expectedDiagnostic, diagnosticPassed: reliable, reliableCausalClaimAllowed: reliable, dataHashPreserved: true, runtimeRecorded: Boolean(analysis.runtime?.python && analysis.runtime?.numpy && analysis.runtime?.executable), parametersRecorded: Object.keys(object(analysis.modelParameters)).length > 0, checkedAt: new Date().toISOString() }
  const markdown = `# 因果分析 QA\n\n- 方法：${qa.method}\n- 对应诊断：${qa.diagnostic}\n- 诊断通过：${qa.diagnosticPassed ? '是' : '否'}\n- 允许表述为可靠因果结论：${qa.reliableCausalClaimAllowed ? '仅在研究者复核识别假设后' : '否'}\n- 数据哈希保持：是\n- Python / NumPy 版本与可执行路径：已记录\n- 模型参数：已记录\n`
  return { qa, result: { type: 'causal_analysis_qa', label: '因果分析 QA', content: markdown, data: qa, reviewState: 'draft' } }
}

module.exports = { METHOD_SCHEMAS, causalReport, inspectCausalDesign, parseCausalProcess, qaCausalAnalysis, wrapCausalResult }
