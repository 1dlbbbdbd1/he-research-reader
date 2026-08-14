const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { citationReportMarkdown, extractCitations, verifyWithCrossref } = require('./research-tools.cjs')
const { buildEvidenceMatrix, buildPrisma, deduplicateRecords, importRecords, initializeProtocol, screenRecords, systematicReviewMarkdown, validateReviewDraft } = require('./review-tools.cjs')
const { prepareStructuredReading, prepareTranslationSegments, qaBilingualResult, renderBilingualResult, translateSegments } = require('./reading-tools.cjs')
const { buildResponsePlan, draftResponseLetter, importReviewComments, linkResponseEvidence, validateResponseLetter } = require('./reviewer-response-tools.cjs')
const { normalizeRoadmap, parseEditedRoadmap, qaRoadmap, renderDrawio, renderSvg } = require('./roadmap-tools.cjs')
const { buildPatentDraft, extractPatentFacts, validatePatentDraft } = require('./patent-tools.cjs')
const { buildFigureSpec, cleanFigureData, loadFigureData, parseEditedFigureSpec, qaFigure, renderFigureSvg } = require('./figure-tools.cjs')
const { inspectCausalDesign, parseCausalProcess, qaCausalAnalysis, wrapCausalResult } = require('./causal-tools.cjs')

const TOOLS = Object.freeze([
  { name: 'project.inspect', label: '检查项目', readOnly: true },
  { name: 'file.read', label: '读取文件', readOnly: true },
  { name: 'file.writeVersioned', label: '保存新版本', readOnly: false },
  { name: 'file.writeBinaryVersioned', label: '保存二进制新版本', readOnly: false },
  { name: 'web.fetch', label: '读取网页', readOnly: true },
  { name: 'browser.open', label: '打开隔离浏览器', readOnly: false },
  { name: 'browser.read', label: '读取当前网页', readOnly: true },
  { name: 'browser.click', label: '点击网页元素', readOnly: false },
  { name: 'browser.fill', label: '填写网页字段', readOnly: false },
  { name: 'browser.download', label: '下载到项目收件箱', readOnly: false },
  { name: 'browser.close', label: '关闭工作台浏览器', readOnly: false },
  { name: 'command.run', label: '运行受限命令', readOnly: false },
  { name: 'vscode.open', label: '在 VS Code 打开', readOnly: false },
  { name: 'office.createCopy', label: '创建 Office 副本', readOnly: false },
  { name: 'research.source.read', label: '读取科研资料正文', readOnly: true },
  { name: 'citation.extract', label: '提取参考文献', readOnly: true },
  { name: 'citation.crossrefVerify', label: '使用 Crossref 核验引用', readOnly: true },
  { name: 'result.createDraft', label: '建立可编辑结果草稿', readOnly: false },
  { name: 'office.inspectWord', label: '检查 Word 文档结构', readOnly: true },
  { name: 'office.formatWord', label: '生成规范排版 Word 副本', readOnly: false },
  { name: 'office.qaWord', label: '打开并检查 Word 排版结果', readOnly: true },
  { name: 'office.exportTranslationDocuments', label: '真实渲染翻译 Word 与 PDF', readOnly: false },
  { name: 'review.initializeProtocol', label: '建立系统综述协议', readOnly: false },
  { name: 'review.importRecords', label: '导入多来源文献记录', readOnly: true },
  { name: 'review.deduplicate', label: '联合去重文献记录', readOnly: true },
  { name: 'review.screen', label: '执行可追溯筛选', readOnly: false },
  { name: 'review.evidenceMatrix', label: '建立证据与偏倚矩阵', readOnly: false },
  { name: 'review.prisma', label: '生成 PRISMA 统计', readOnly: true },
  { name: 'review.validateDraft', label: '核对综述结论引用映射', readOnly: true },
  { name: 'reading.prepareStructured', label: '读取或生成当前结构化阅读稿', readOnly: false },
  { name: 'translation.prepareSegments', label: '按结构化阅读顺序建立翻译分段', readOnly: true },
  { name: 'translation.translateSegments', label: '逐段翻译并保存缓存', readOnly: false },
  { name: 'translation.renderBilingual', label: '生成带原文锚点的双语结果', readOnly: false },
  { name: 'translation.qaBilingual', label: '检查原文完整性与保护标记', readOnly: true },
  { name: 'reviewer.importComments', label: '拆分并标注审稿意见', readOnly: true },
  { name: 'reviewer.buildPlan', label: '建立逐条处理方案', readOnly: false },
  { name: 'reviewer.linkEvidence', label: '关联修改稿与证据', readOnly: true },
  { name: 'reviewer.draftLetter', label: '生成逐条 Response Letter', readOnly: false },
  { name: 'reviewer.validateLetter', label: '核对回复完整性与修改证据', readOnly: true },
  { name: 'roadmap.normalize', label: '建立可编辑路线图数据', readOnly: false },
  { name: 'roadmap.parseEdited', label: '读取人工编辑后的路线图数据', readOnly: true },
  { name: 'roadmap.qa', label: '检查节点、连线、环路和溢出', readOnly: true },
  { name: 'roadmap.renderDrawio', label: '生成可编辑 Draw.io 文件', readOnly: true },
  { name: 'roadmap.renderSvg', label: '生成投稿用 SVG', readOnly: true },
  { name: 'patent.extractFacts', label: '提取并核对专利技术事实', readOnly: true },
  { name: 'patent.buildDraft', label: '生成专利申请文件草案', readOnly: false },
  { name: 'patent.validateDraft', label: '检查权利要求映射与风险', readOnly: true },
  { name: 'figure.loadData', label: '只读加载绘图数据', readOnly: true },
  { name: 'figure.cleanData', label: '按合同清洗绘图数据', readOnly: true },
  { name: 'figure.buildSpec', label: '建立可编辑多面板图规格', readOnly: false },
  { name: 'figure.parseEditedSpec', label: '读取人工编辑后的图规格', readOnly: true },
  { name: 'figure.render', label: '渲染 SVG 与投稿 PNG', readOnly: false },
  { name: 'figure.qa', label: '检查分辨率、裁切、遮挡与配色', readOnly: true },
  { name: 'causal.inspectDesign', label: '核对因果研究设计与适用方法', readOnly: true },
  { name: 'causal.runPython', label: '在确认的 Python 环境运行因果分析', readOnly: false },
  { name: 'causal.qa', label: '检查方法诊断与结论边界', readOnly: true },
  { name: 'desktop.listWindows', label: '列出可捕获窗口', readOnly: true },
  { name: 'desktop.captureWindow', label: '捕获授权窗口', readOnly: true },
  { name: 'desktop.performAction', label: '验证并操作授权窗口', readOnly: false },
])

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex') }
let cachedWordAutomation
function hasWordAutomation() {
  if (cachedWordAutomation !== undefined) return cachedWordAutomation
  if (process.platform !== 'win32') return false
  const probe = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', "if ([type]::GetTypeFromProgID('Word.Application')) { exit 0 } else { exit 1 }"], { windowsHide: true, timeout: 10000 })
  cachedWordAutomation = probe.status === 0
  return cachedWordAutomation
}
const researchPythonCache = new Map()
function findResearchPython(explicit) {
  const candidates = [explicit, process.env.READER_RESEARCH_PYTHON, process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe') : undefined].filter(Boolean)
  for (const candidate of [...new Set(candidates)]) {
    if (!fs.existsSync(candidate)) continue
    if (!researchPythonCache.has(candidate)) researchPythonCache.set(candidate, spawnSync(candidate, ['-c', 'import numpy,sys;print(numpy.__version__)'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).status === 0)
    if (researchPythonCache.get(candidate)) return candidate
  }
  return undefined
}
function versionedPath(target) {
  const parsed = path.parse(target)
  let index = 1
  let candidate = path.join(parsed.dir, `${parsed.name}.agent-${index}${parsed.ext}`)
  while (fs.existsSync(candidate)) candidate = path.join(parsed.dir, `${parsed.name}.agent-${++index}${parsed.ext}`)
  return candidate
}
function runProcess(executable, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true })
    let stdout = ''; let stderr = ''; let settled = false
    const timer = setTimeout(() => { child.kill(); reject(new Error('命令执行超时。')) }, timeoutMs)
    child.stdout?.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-200000) })
    child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-200000) })
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error) } })
    child.on('close', code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }) } })
  })
}
async function runWordWorkflow(scriptPath, operation, payload, cwd) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  const result = await runProcess('pwsh.exe', ['-NoLogo', '-NoProfile', '-File', scriptPath, '-Operation', operation, '-PayloadBase64', encoded], cwd, 180000)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Word ${operation} 执行失败。`)
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  try { return JSON.parse(line) } catch { throw new Error(`Word ${operation} 没有返回有效结果。`) }
}
function wordChangeMarkdown(result) {
  return `# Word 规范排版变更报告\n\n- 原文件：${result.sourcePath}\n- 新副本：${result.path}\n- 原文件 SHA-256（处理前）：${result.sourceSha256Before}\n- 原文件 SHA-256（处理后）：${result.sourceSha256After}\n- 原文件未变化：${result.originalUnchanged ? '是' : '否'}\n- Word 是否打开过原路径：${result.originalOpenedByWord ? '是' : '否'}\n- 临时工作副本与原件哈希一致：${result.workingCopyHashMatches ? '是' : '否'}\n- 新副本 SHA-256：${result.sha256}\n- 页面数：${result.pageCount}\n\n## 已执行修改\n\n${(result.changes || []).map(change => `- ${change}`).join('\n')}\n`
}
function wordQaMarkdown(result) {
  return `# Word 页面 QA 报告\n\n- 检查文件：${result.path}\n- 文件 SHA-256：${result.sha256}\n- Word 是否打开过检查文件原路径：${result.originalOpenedByWord ? '是' : '否'}\n- 临时检查副本与文件哈希一致：${result.workingCopyHashMatches ? '是' : '否'}\n- 已重新分页：${result.repaginated ? '是' : '否'}\n- 页面数：${result.pageCount}\n- 段落数：${result.paragraphCount}\n- 表格数：${result.tableCount}\n- 域数量：${result.fieldCount}\n- QA 结论：${result.passed ? '通过自动检查' : '存在阻断问题'}\n\n## 异常清单\n\n${result.anomalies?.length ? result.anomalies.map(item => `- [${item.severity}] ${item.message}`).join('\n') : '- 未发现自动检查可识别的异常。'}\n\n> 自动 QA 不能替代人工逐页检查；确认前请在 Word 中查看分页、公式、图表和交叉引用。\n`
}

class ToolRegistry {
  constructor({ policyEngine, fetchImpl = globalThis.fetch, desktopAdapter, browserAdapter, officeScriptPath, wordWorkflowScriptPath, translationExportScriptPath, desktopInputScriptPath, workspaceService, wordProbe = hasWordAutomation, translationAdapter, translationDocumentAdapter, imageAdapter, analysisScriptPath, researchPython }) {
    this.policy = policyEngine
    this.fetchImpl = fetchImpl
    this.desktop = desktopAdapter
    this.browser = browserAdapter
    this.officeScriptPath = officeScriptPath
    this.wordWorkflowScriptPath = wordWorkflowScriptPath
    this.translationExportScriptPath = translationExportScriptPath
    this.wordProbe = wordProbe
    this.desktopInputScriptPath = desktopInputScriptPath
    this.workspace = workspaceService
    this.translation = translationAdapter
    this.translationDocuments = translationDocumentAdapter
    this.image = imageAdapter
    this.analysisScriptPath = analysisScriptPath
    this.researchPython = researchPython
  }
  list() { return TOOLS.map(tool => ({ ...tool })) }

  availability(name) {
    if (!TOOLS.some(tool => tool.name === name)) return { available: false, reason: '当前版本没有注册这个工具。' }
    if (name === 'research.source.read' && (!this.workspace || !this.workspace.database)) return { available: false, reason: '尚未打开可读取的科研项目。' }
    if (name === 'review.importRecords' && (!this.workspace || !this.workspace.database)) return { available: false, reason: '尚未打开可读取的科研项目。' }
    if (name === 'reviewer.linkEvidence' && (!this.workspace || !this.workspace.database)) return { available: false, reason: '尚未打开可核对证据的科研项目。' }
    if (name === 'patent.extractFacts' && (!this.workspace || !this.workspace.database)) return { available: false, reason: '尚未打开可读取技术报告的科研项目。' }
    if ((name.startsWith('reading.') || name.startsWith('translation.')) && (!this.workspace || !this.workspace.database)) return { available: false, reason: '尚未打开可读取的科研项目。' }
    if (name === 'translation.translateSegments') {
      if (!this.translation?.translate) return { available: false, reason: '翻译执行器没有接入。' }
      const state = this.translation.availability?.()
      if (state && state.available === false) return { available: false, reason: state.reason || '本地翻译组件尚未就绪。' }
    }
    if (name === 'figure.render' && (!this.image?.svgToPng || !this.image?.svgToJpeg)) return { available: false, reason: '投稿 PNG/JPG 渲染器没有完整接入。' }
    if (name === 'causal.runPython') {
      if (!this.analysisScriptPath || !fs.existsSync(this.analysisScriptPath)) return { available: false, reason: '因果分析脚本没有接入。' }
      if (!findResearchPython(this.researchPython)) return { available: false, reason: '没有找到已安装 NumPy 的确认 Python 环境。' }
    }
    if (name === 'office.createCopy' && (!this.officeScriptPath || !fs.existsSync(this.officeScriptPath))) return { available: false, reason: 'Office 副本执行器不存在。' }
    if (name.startsWith('office.') && name !== 'office.createCopy') {
      if (name === 'office.exportTranslationDocuments' && this.translationDocuments?.export) return { available: true }
      const scriptPath = name === 'office.exportTranslationDocuments' ? this.translationExportScriptPath : this.wordWorkflowScriptPath
      if (!scriptPath || !fs.existsSync(scriptPath)) return { available: false, reason: 'Word 文档执行器不存在。' }
      if (!this.wordProbe()) return { available: false, reason: '这台电脑没有可调用的 Microsoft Word。' }
    }
    if (name.startsWith('browser.') && !this.browser) return { available: false, reason: '隔离浏览器适配器不可用。' }
    if (name.startsWith('desktop.') && !this.desktop) return { available: false, reason: '桌面适配器不可用。' }
    return { available: true }
  }

  async execute(name, input = {}, grant = {}, execution = {}) {
    if (name === 'project.inspect') {
      const root = this.policy.requirePath(grant, input.root, 'read')
      const entries = fs.readdirSync(root, { withFileTypes: true }).slice(0, 300).map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' }))
      return { root, entries, count: entries.length }
    }
    if (name === 'file.read') {
      const filePath = this.policy.requirePath(grant, input.path, 'read')
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error('只能读取普通文件。')
      if (stat.size > 2_000_000) throw new Error('单次读取文件不能超过 2 MB。')
      const buffer = fs.readFileSync(filePath)
      return { path: filePath, content: buffer.toString('utf8'), size: buffer.length, sha256: sha256(buffer) }
    }
    if (name === 'file.writeVersioned') {
      const requested = this.policy.requirePath(grant, input.path, 'write')
      const target = fs.existsSync(requested) ? versionedPath(requested) : requested
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const temporary = `${target}.${process.pid}.tmp`
      const content = String(input.content ?? '')
      fs.writeFileSync(temporary, content, 'utf8')
      fs.renameSync(temporary, target)
      return { path: target, size: Buffer.byteLength(content), sha256: sha256(Buffer.from(content)) }
    }
    if (name === 'file.writeBinaryVersioned') {
      const requested = this.policy.requirePath(grant, input.path, 'write')
      const target = fs.existsSync(requested) ? versionedPath(requested) : requested
      const buffer = Buffer.from(String(input.base64 || ''), 'base64')
      if (!buffer.length) throw new Error('二进制输出为空。')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const temporary = `${target}.${process.pid}.tmp`
      fs.writeFileSync(temporary, buffer); fs.renameSync(temporary, target)
      return { path: target, size: buffer.length, sha256: sha256(buffer) }
    }
    if (name === 'web.fetch') {
      const url = this.policy.requireUrl(grant, input.url)
      const response = await this.fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'Hs-Agent-Workbench/2' } })
      if (!response.ok) throw new Error(`网页请求失败：HTTP ${response.status}`)
      const contentType = String(response.headers.get('content-type') || '')
      const text = (await response.text()).slice(0, 500000)
      return { url: response.url, contentType, text, truncated: text.length >= 500000 }
    }
    if (name === 'browser.open') {
      const url = this.policy.requireUrl(grant, input.url)
      return this.browser.open(url.toString())
    }
    if (name === 'browser.read') {
      this.policy.requireUrl(grant, await this.browser.currentUrl())
      return this.browser.read(input.maxCharacters)
    }
    if (name === 'browser.click') {
      this.policy.requireUrl(grant, await this.browser.currentUrl())
      const risk = this.policy.classify({ kind: input.intent, summary: input.summary })
      if (risk.highRisk && execution.highRiskApproved !== true) return { requiresHighRiskConfirmation: true, summary: String(input.summary || '网页提交动作') }
      const result = await this.browser.click(input.selector)
      this.policy.requireUrl(grant, result.url)
      return result
    }
    if (name === 'browser.fill') {
      this.policy.requireUrl(grant, await this.browser.currentUrl())
      return this.browser.fill(input.selector, input.value)
    }
    if (name === 'browser.download') {
      this.policy.requireUrl(grant, await this.browser.currentUrl())
      const output = this.policy.requirePath(grant, input.outputPath, 'write')
      if (fs.existsSync(output)) throw new Error('下载目标已存在，请使用新文件名。')
      fs.mkdirSync(path.dirname(output), { recursive: true })
      return this.browser.download(input.selector, output)
    }
    if (name === 'browser.close') return this.browser.close()
    if (name === 'command.run') {
      const command = this.policy.requireCommand(grant, input.executable, input.args, input.cwd)
      if (command.highRisk && execution.highRiskApproved !== true) return { requiresHighRiskConfirmation: true, summary: [command.executable, ...command.args].join(' ') }
      return { ...await runProcess(command.executable, command.args, command.cwd, Math.min(300000, Math.max(1000, Number(input.timeoutMs) || 120000))), command: [command.executable, ...command.args] }
    }
    if (name === 'vscode.open') {
      this.policy.requireApplication(grant, 'vscode')
      const target = this.policy.requirePath(grant, input.path, 'read')
      return { ...await runProcess('code.cmd', ['--reuse-window', '--goto', input.line ? `${target}:${Math.max(1, Number(input.line))}` : target], path.dirname(target), 30000), path: target }
    }
    if (name === 'office.createCopy') {
      const application = this.policy.requireApplication(grant, String(input.application || '').toLowerCase())
      if (!['word', 'excel', 'powerpoint'].includes(application)) throw new Error('Office 适配器只支持 Word、Excel 和 PowerPoint。')
      const source = this.policy.requirePath(grant, input.path, 'read')
      const output = this.policy.requirePath(grant, input.outputPath || versionedPath(source), 'write')
      const payload = Buffer.from(JSON.stringify({ application, source, output }), 'utf8').toString('base64')
      return { ...await runProcess('pwsh.exe', ['-NoLogo', '-NoProfile', '-File', this.officeScriptPath, '-PayloadBase64', payload], path.dirname(output), 120000), path: output }
    }
    if (name === 'office.inspectWord') {
      this.policy.requireApplication(grant, 'word')
      const source = this.policy.requirePath(grant, input.path, 'read')
      return runWordWorkflow(this.wordWorkflowScriptPath, 'inspect', { path: source }, path.dirname(source))
    }
    if (name === 'office.formatWord') {
      this.policy.requireApplication(grant, 'word')
      const source = this.policy.requirePath(grant, input.path, 'read')
      const requestedOutput = this.policy.requirePath(grant, input.outputPath || versionedPath(source), 'write')
      const output = fs.existsSync(requestedOutput) ? versionedPath(requestedOutput) : requestedOutput
      fs.mkdirSync(path.dirname(output), { recursive: true })
      const formatted = await runWordWorkflow(this.wordWorkflowScriptPath, 'format', { path: source, outputPath: output, template: input.template && typeof input.template === 'object' ? input.template : {} }, path.dirname(output))
      const markdown = wordChangeMarkdown(formatted)
      return { ...formatted, result: { type: 'word_format_change_report', label: 'Word 排版变更报告', content: markdown, data: formatted, sourceLinks: [{ kind: 'file', path: source, sha256: formatted.sourceSha256Before }, { kind: 'file', path: formatted.path, sha256: formatted.sha256 }], reviewState: 'draft' }, markdown }
    }
    if (name === 'office.qaWord') {
      this.policy.requireApplication(grant, 'word')
      const source = this.policy.requirePath(grant, input.path, 'read')
      const qa = await runWordWorkflow(this.wordWorkflowScriptPath, 'qa', { path: source }, path.dirname(source))
      const markdown = wordQaMarkdown(qa)
      const defaultReport = path.join(path.dirname(source), `${path.parse(source).name}.qa.md`)
      const requestedReport = this.policy.requirePath(grant, input.reportPath || defaultReport, 'write')
      const reportPath = fs.existsSync(requestedReport) ? versionedPath(requestedReport) : requestedReport
      fs.mkdirSync(path.dirname(reportPath), { recursive: true })
      const temporary = `${reportPath}.${process.pid}.tmp`
      fs.writeFileSync(temporary, markdown, 'utf8')
      fs.renameSync(temporary, reportPath)
      const reportSha256 = sha256(Buffer.from(markdown))
      return { ...qa, path: reportPath, wordPath: source, sha256: reportSha256, result: { type: 'word_format_qa', label: 'Word 页面 QA 报告', content: markdown, data: qa, sourceLinks: [{ kind: 'file', path: source, sha256: qa.sha256 }], reviewState: 'draft' }, markdown }
    }
    if (name === 'office.exportTranslationDocuments') {
      this.policy.requireApplication(grant, 'word')
      const requestedDocx = this.policy.requirePath(grant, input.docxPath, 'write')
      const requestedPdf = this.policy.requirePath(grant, input.pdfPath, 'write')
      const docxPath = fs.existsSync(requestedDocx) ? versionedPath(requestedDocx) : requestedDocx
      const pdfPath = fs.existsSync(requestedPdf) ? versionedPath(requestedPdf) : requestedPdf
      let exported
      if (this.translationDocuments?.export) exported = await this.translationDocuments.export({ content: String(input.content || ''), docxPath, pdfPath })
      else {
        const encoded = Buffer.from(JSON.stringify({ content: String(input.content || ''), docxPath, pdfPath }), 'utf8').toString('base64')
        const processResult = await runProcess('pwsh.exe', ['-NoLogo', '-NoProfile', '-File', this.translationExportScriptPath, '-PayloadBase64', encoded], path.dirname(docxPath), 180000)
        if (processResult.exitCode !== 0) throw new Error(processResult.stderr.trim() || '翻译 Word/PDF 导出失败。')
        const line = processResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
        try { exported = JSON.parse(line) } catch { throw new Error('翻译 Word/PDF 导出没有返回有效结果。') }
      }
      if (!exported.passed || !exported.pageCount || !fs.existsSync(exported.docxPath) || !fs.existsSync(exported.pdfPath)) throw new Error('翻译 Word/PDF 没有通过真实渲染检查。')
      const markdown = `# 学术翻译 Word / PDF 渲染 QA\n\n- Word：${exported.docxPath}\n- PDF：${exported.pdfPath}\n- PDF 页数：${exported.pageCount}\n- 段落数：${exported.paragraphCount}\n- 渲染器：${exported.renderedBy}\n- 已重新分页：${exported.repaginated ? '是' : '否'}\n- 版面异常：${exported.anomalies?.length ? exported.anomalies.map(item => item.message || item).join('；') : '未发现自动检查异常'}\n`
      return { ...exported, path: exported.docxPath, sha256: exported.docxSha256, markdown, result: { type: 'academic_translation_document_qa', label: '学术翻译 Word / PDF 渲染 QA', content: markdown, data: exported, sourceLinks: [{ kind: 'file', path: exported.docxPath, sha256: exported.docxSha256 }, { kind: 'file', path: exported.pdfPath, sha256: exported.pdfSha256 }], reviewState: 'draft' } }
    }
    if (name === 'research.source.read') {
      const pastedText = String(input.pastedText || '').trim()
      if (pastedText) return { document: { text: pastedText, source: { kind: 'pasted_text', characterCount: pastedText.length } } }
      const sourceId = String(input.sourceId || '').trim()
      if (!sourceId) throw new Error('请选择资料库文档或粘贴待核验内容。')
      const current = this.workspace?.getCurrent()
      if (!current || !this.workspace.database) throw new Error('尚未打开科研项目。')
      this.policy.requirePath(grant, current.path, 'read')
      const row = this.workspace.database.prepare(`SELECT id, name, kind, content_sha256, extracted_text, derived_markdown
        FROM sources WHERE id = ? AND project_id = ? AND archived_at IS NULL`).get(sourceId, current.projectId)
      if (!row) throw new Error('资料不存在或不属于当前项目。')
      const sourceText = String(row.derived_markdown || row.extracted_text || '').trim()
      if (!sourceText) throw new Error('这份资料还没有可读取的解析文本，请先在科研资产中心完成解析。')
      return { document: { text: sourceText, source: { kind: 'workspace_source', sourceId: row.id, name: row.name, sourceKind: row.kind, sha256: row.content_sha256 } } }
    }
    if (name === 'citation.extract') return extractCitations(input.document)
    if (name === 'citation.crossrefVerify') {
      const references = Array.isArray(input.references) ? input.references : []
      if (execution.highRiskApproved !== true) return { requiresHighRiskConfirmation: true, summary: `把 ${references.length} 条提取后的参考文献字符串发送到 api.crossref.org 核验；不发送论文全文` }
      this.policy.requireUrl(grant, 'https://api.crossref.org/works')
      return verifyWithCrossref(references, { fetchImpl: this.fetchImpl, contactEmail: input.contactEmail })
    }
    if (name === 'review.initializeProtocol') return initializeProtocol(input)
    if (name === 'review.importRecords') return importRecords(input, this.workspace)
    if (name === 'review.deduplicate') return deduplicateRecords(input)
    if (name === 'review.screen') return screenRecords(input)
    if (name === 'review.evidenceMatrix') return buildEvidenceMatrix(input)
    if (name === 'review.prisma') return buildPrisma(input)
    if (name === 'review.validateDraft') return validateReviewDraft(input)
    if (name === 'reading.prepareStructured') return prepareStructuredReading(this.workspace, input)
    if (name === 'translation.prepareSegments') return prepareTranslationSegments(this.workspace, input)
    if (name === 'translation.translateSegments') return translateSegments(this.workspace, this.translation, input)
    if (name === 'translation.renderBilingual') return renderBilingualResult(input)
    if (name === 'translation.qaBilingual') return qaBilingualResult(input)
    if (name === 'reviewer.importComments') return importReviewComments(input)
    if (name === 'reviewer.buildPlan') return buildResponsePlan(input)
    if (name === 'reviewer.linkEvidence') return linkResponseEvidence(this.workspace, input)
    if (name === 'reviewer.draftLetter') return draftResponseLetter(input)
    if (name === 'reviewer.validateLetter') return validateResponseLetter(input)
    if (name === 'roadmap.normalize') return normalizeRoadmap(input)
    if (name === 'roadmap.parseEdited') return parseEditedRoadmap(input)
    if (name === 'roadmap.qa') return qaRoadmap(input)
    if (name === 'roadmap.renderDrawio') return renderDrawio(input)
    if (name === 'roadmap.renderSvg') return renderSvg(input)
    if (name === 'patent.extractFacts') return extractPatentFacts(this.workspace, input)
    if (name === 'patent.buildDraft') return buildPatentDraft(input)
    if (name === 'patent.validateDraft') return validatePatentDraft(input)
    if (name === 'figure.loadData') {
      const source = this.policy.requirePath(grant, input.path, 'read')
      return loadFigureData({ ...input, path: source })
    }
    if (name === 'figure.cleanData') return cleanFigureData(input)
    if (name === 'figure.buildSpec') return buildFigureSpec(input)
    if (name === 'figure.parseEditedSpec') return parseEditedFigureSpec(input)
    if (name === 'figure.render') {
      const rendered = renderFigureSvg(input)
      const png = await this.image.svgToPng(rendered.svg, { width: rendered.width, height: rendered.height })
      const jpeg = await this.image.svgToJpeg(rendered.svg, { width: rendered.width, height: rendered.height })
      if (!Buffer.isBuffer(png) || !png.length || !Buffer.isBuffer(jpeg) || !jpeg.length) throw new Error('投稿 PNG/JPG 渲染失败。')
      return { ...rendered, pngBase64: png.toString('base64'), pngByteLength: png.length, jpgBase64: jpeg.toString('base64'), jpgByteLength: jpeg.length }
    }
    if (name === 'figure.qa') {
      const rawPath = this.policy.requirePath(grant, input.rawPath, 'read')
      return qaFigure({ ...input, rawPath })
    }
    if (name === 'causal.inspectDesign') {
      const dataPath = this.policy.requirePath(grant, input.dataPath, 'read')
      return inspectCausalDesign({ ...input, dataPath })
    }
    if (name === 'causal.runPython') {
      const dataPath = this.policy.requirePath(grant, input.dataPath, 'read')
      const python = findResearchPython(input.pythonPath || this.researchPython)
      if (!python) throw new Error('没有找到已安装 NumPy 的确认 Python 环境。')
      const payload = Buffer.from(JSON.stringify({ dataPath, method: input.method, design: input.design }), 'utf8').toString('base64')
      const args = [this.analysisScriptPath, '--payload-base64', payload]
      const command = this.policy.requireCommand(grant, python, args, path.dirname(dataPath))
      const processResult = await runProcess(command.executable, command.args, command.cwd, 180000)
      let analysis
      try { analysis = parseCausalProcess(processResult.stdout) } catch (error) { throw new Error(processResult.stderr.trim() || error.message) }
      if (processResult.exitCode !== 0) throw new Error('Python 因果分析执行失败。')
      return { ...wrapCausalResult(analysis, fs.readFileSync(this.analysisScriptPath, 'utf8')), pythonExecutable: python, exitCode: processResult.exitCode }
    }
    if (name === 'causal.qa') {
      const record = input.record && typeof input.record === 'object' && !Array.isArray(input.record) ? input.record : {}
      this.policy.requirePath(grant, record.dataPath, 'read')
      return qaCausalAnalysis(input)
    }
    if (name === 'result.createDraft') {
      const resultType = String(input.resultType || 'structured_result')
      const data = input.data && typeof input.data === 'object' ? input.data : {}
      const markdown = resultType === 'citation_verification' ? citationReportMarkdown(data) : resultType === 'systematic_review' ? systematicReviewMarkdown(data) : `# ${String(input.title || '科研结果草稿')}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
      const label = resultType === 'citation_verification' ? '引用真实性核验报告' : resultType === 'systematic_review' ? '系统文献综述草稿' : '科研结果草稿'
      return { result: { type: resultType, label, content: markdown, data, reviewState: 'draft' }, markdown }
    }
    if (name === 'desktop.listWindows') {
      return { windows: await this.desktop.listWindows() }
    }
    if (name === 'desktop.captureWindow') {
      this.policy.requireApplication(grant, input.application)
      if (!grant.allowScreenshots) throw new Error('本次任务没有授权局部截图。')
      return this.desktop.captureWindow(input)
    }
    if (name === 'desktop.performAction') {
      this.policy.requireApplication(grant, input.application)
      if (!grant.allowScreenshots) throw new Error('桌面动作前后验证需要授权局部截图。')
      const action = input.action && typeof input.action === 'object' ? input.action : {}
      if (!['click', 'text', 'key'].includes(action.type)) throw new Error('桌面动作类型无效。')
      if (execution.highRiskApproved !== true) return { requiresHighRiskConfirmation: true, summary: `在“${String(input.expectedTitle || '')}”中执行 ${action.type} 动作` }
      const before = await this.desktop.captureWindow(input)
      const handle = String(input.sourceId || '').match(/^window:(\d+):/)?.[1]
      if (!handle || before.title !== String(input.expectedTitle || '')) throw new Error('窗口句柄或标题与授权目标不一致。')
      const payload = Buffer.from(JSON.stringify({ windowHandle: handle, expectedTitle: before.title, action }), 'utf8').toString('base64')
      if (!this.desktopInputScriptPath || !fs.existsSync(this.desktopInputScriptPath)) throw new Error('桌面输入执行器不可用。')
      const executionResult = await runProcess('pwsh.exe', ['-NoLogo', '-NoProfile', '-File', this.desktopInputScriptPath, '-PayloadBase64', payload], path.dirname(this.desktopInputScriptPath), 30000)
      if (executionResult.exitCode !== 0) throw new Error(executionResult.stderr.trim() || '桌面动作执行失败。')
      const after = await this.desktop.captureWindow(input)
      if (after.title !== before.title) throw new Error('窗口在动作后发生变化，桌面控制已暂停。')
      const beforeHash = sha256(Buffer.from(before.imageDataUrl))
      const afterHash = sha256(Buffer.from(after.imageDataUrl))
      return { performed: true, actionType: action.type, title: before.title, beforeHash, afterHash, visualChanged: beforeHash !== afterHash, screenshotsPersisted: false }
    }
    throw new Error('未知的工作台工具。')
  }
}

module.exports = { ToolRegistry, TOOLS, findResearchPython, runProcess, versionedPath }
