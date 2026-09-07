// Run with Electron to use Windows safeStorage without exposing credentials.
const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { AppSettingsStore } = require('../electron/settings-service.cjs')
const { LLMService } = require('../electron/llm/llm-service.cjs')
const { WorkspaceService } = require('../electron/workspace-service.cjs')
const { PolicyEngine } = require('../electron/workbench/policy-engine.cjs')
const { ToolRegistry } = require('../electron/workbench/tool-registry.cjs')
const { WorkbenchService } = require('../electron/workbench/workbench-service.cjs')

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaohe-live-research-'))
const settingsPath = argument('settings') || path.join(app.getPath('appData'), '小何的科研助手', 'settings.json')
app.setPath('userData', path.join(root, 'electron-data'))
// Chromium needs the matching encrypted OS key to decrypt saved credentials.
fs.mkdirSync(app.getPath('userData'), { recursive: true })
const localState = path.join(path.dirname(settingsPath), 'Local State')
if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(app.getPath('userData'), 'Local State'))
app.whenReady().then(async () => {
  const workspace = new WorkspaceService({ registryPath: path.join(root, 'registry.json') })
  let exitCode = 1
  try {
    const settings = new AppSettingsStore({ filePath: settingsPath, safeStorage })
    const configuration = settings.load()
    if (!configuration.ai.hasCredential && !Object.values(configuration.modelRoles).some(role => role.hasCredential)) throw new Error('当前设置没有可用的模型凭据。')
    const resumeVault = argument('resume-vault')
    if (resumeVault && (!path.resolve(resumeVault).startsWith(path.join(os.tmpdir(), 'xiaohe-live-research-')) || path.basename(resumeVault) !== '公开科研问题验收')) throw new Error('只能接续本脚本创建的隔离验收项目。')
    const vault = resumeVault ? workspace.open(resumeVault) : workspace.create(root, '公开科研问题验收')
    const policy = new PolicyEngine()
    const tools = new ToolRegistry({ policyEngine: policy, workspaceService: workspace })
    const llm = new LLMService({ settingsStore: settings, timeoutMs: 120000 })
    const modelResponses = []
    const complete = llm.complete.bind(llm)
    llm.complete = async input => { const result = await complete(input); modelResponses.push({ role: input.role, ...result }); return result }
    const service = new WorkbenchService({ workspaceService: workspace, policyEngine: policy, toolRegistry: tools, llmService: llm, settingsStore: settings })
    const objective = 'Investigate semantic exploration for object-goal navigation in embodied AI. Compare baseline methods, evidence from ablations and limitations. Identify one small reproducible follow-up experiment. Use short English search terms and write the report in Chinese.'
    let run = resumeVault ? service.getRun(service.listRuns()[0].id) : service.createRun({ objective, conversationWorkflowId: 'deep-literature-research' })
    if (resumeVault) {
      const decision = run.decisions.find(item => item.status === 'pending')
      if (!decision || !run.steps.some(step => step.kind === 'model' && step.status === 'failed')) throw new Error('接续只用于重试失败的模型步骤。')
      service.resolveDecision({ decisionId: decision.id, approved: true })
    } else service.authorizeRun({ runId: run.id, scope: { readRoots: [vault.path], writeRoots: [vault.path], domains: ['api.crossref.org', 'export.arxiv.org'] } })
    run = service.getRun(run.id)
    while (run.status === 'running') {
      const next = run.steps.find(step => ['queued', 'failed'].includes(step.status))
      process.stdout.write(`STEP ${next?.title || '验收'}\n`)
      run = await service.executeNext(run.id)
    }
    const outputRoot = path.resolve(argument('output') || path.join(__dirname, '..', '.reader-cache', `live-research-${Date.now()}`))
    fs.mkdirSync(outputRoot, { recursive: true })
    const result = run.results.find(item => item.type === 'deep_research')
    const evidence = { createdAt: new Date().toISOString(), objective, status: run.status, result, modelResponses,
      steps: run.steps.map(step => ({ title: step.title, kind: step.kind, toolName: step.toolName, status: step.status, error: step.error, output: step.output })), evaluations: run.evaluations }
    fs.writeFileSync(path.join(outputRoot, 'evidence.json'), JSON.stringify(evidence, null, 2))
    if (result) fs.writeFileSync(path.join(outputRoot, 'report.md'), result.content)
    process.stdout.write(JSON.stringify({ status: run.status, audit: result?.data?.evidenceAudit, candidateCount: result?.data?.searchSession?.candidateCount, outputRoot }) + '\n')
    exitCode = run.status === 'completed' ? 0 : 1
  } catch (error) { process.stderr.write(`${error.message}\n`) }
  finally { workspace.close(); app.exit(exitCode) }
})
