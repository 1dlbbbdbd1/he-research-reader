const { app, BrowserWindow, clipboard, dialog, ipcMain, shell, Menu, safeStorage, desktopCapturer, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const earlyPackagedSmokeRoot = process.argv.find(value => value.startsWith('--research-reader-test-root='))?.slice('--research-reader-test-root='.length) || ''
function earlyPackagedSmokeTrace(stage, detail = {}) {
  if (!earlyPackagedSmokeRoot) return
  try {
    fs.mkdirSync(earlyPackagedSmokeRoot, { recursive: true })
    fs.appendFileSync(path.join(earlyPackagedSmokeRoot, 'desktop-smoke-trace.jsonl'), `${JSON.stringify({ stage, at: new Date().toISOString(), ...detail })}\n`, 'utf8')
  } catch {}
}
earlyPackagedSmokeTrace('main-module:start', { argv: process.argv })
const { mineruStatus, parseWithMineru } = require('./mineru.cjs')
const { MineruLocalService } = require('./mineru-service.cjs')
const { installMineruRuntime } = require('./mineru-install.cjs')
const { findPythonExecutable, localTranslationStatus, translateLocally } = require('./local-translation.cjs')
const { installTranslationRuntime } = require('./translation-install.cjs')
const { embedLocally, localEmbeddingStatus } = require('./local-embedding.cjs')
const { installEmbeddingRuntime } = require('./embedding-install.cjs')
const { reciprocalRankFusion } = require('./semantic-index.cjs')
earlyPackagedSmokeTrace('main-module:local-runtimes-loaded')
const { WorkspaceService } = require('./workspace-service.cjs')
earlyPackagedSmokeTrace('main-module:workspace-loaded')
const { AppSettingsStore } = require('./settings-service.cjs')
const { LLMService } = require('./llm/llm-service.cjs')
const { ResearchAgentService } = require('./agent/agent-service.cjs')
const { PolicyEngine } = require('./workbench/policy-engine.cjs')
const { ToolRegistry } = require('./workbench/tool-registry.cjs')
const { BrowserAdapter } = require('./workbench/browser-adapter.cjs')
const { applyRedactions } = require('./workbench/desktop-capture.cjs')
const { WorkbenchService } = require('./workbench/workbench-service.cjs')
const { KnowledgeGraphService } = require('./knowledge/knowledge-graph-service.cjs')
const { PluginService } = require('./plugins/plugin-service.cjs')
const { findResearchReaderLink, parseResearchReaderLink } = require('./deep-link.cjs')
const { configureDesktopRuntime } = require('./desktop-runtime.cjs')
const { writeClipboardText } = require('./clipboard-service.cjs')
earlyPackagedSmokeTrace('main-module:services-loaded')
const projectRoot = path.join(__dirname, '..')
const packagedSmokeArgument = process.argv.includes('--research-reader-packaged-smoke')
const packagedSmokeTestRootArgument = process.argv.find(value => value.startsWith('--research-reader-test-root='))?.slice('--research-reader-test-root='.length) || ''
const packagedSmokeUserDataArgument = process.argv.find(value => value.startsWith('--research-reader-test-user-data='))?.slice('--research-reader-test-user-data='.length) || ''

const { isDesktopSmoke, managedCodexSession } = configureDesktopRuntime(app)
earlyPackagedSmokeTrace('main-module:runtime-configured', { isDesktopSmoke, managedCodexSession })

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

const codexThreadId = String(process.env.CODEX_THREAD_ID || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
const managedCodexUserData = managedCodexSession && codexThreadId
  ? path.join(projectRoot, '.reader-cache', `codex-${codexThreadId}`, 'user-data')
  : ''
const requestedDevelopmentUserData = String(
  process.env.RESEARCH_READER_DEV_USER_DATA || packagedSmokeUserDataArgument || managedCodexUserData,
).trim()
if ((!app.isPackaged || process.env.RESEARCH_READER_PACKAGED_SMOKE === '1' || packagedSmokeArgument) && requestedDevelopmentUserData) {
  const resolvedUserData = path.resolve(requestedDevelopmentUserData)
  const allowedRoot = `${path.resolve(packagedSmokeArgument ? packagedSmokeTestRootArgument : path.join(projectRoot, '.reader-cache'))}${path.sep}`
  if (!resolvedUserData.startsWith(allowedRoot)) {
    throw new Error('开发隔离用户目录只能位于项目 .reader-cache 内。')
  }
  fs.mkdirSync(resolvedUserData, { recursive: true })
  app.setPath('userData', resolvedUserData)
}

let mainWindow
let mineruService
let mineruInstallation
let translationInstallation
let embeddingInstallation
let workspaceService
let appSettingsStore
let llmService
let researchAgentService
let workbenchService
let workbenchBrowser
let knowledgeGraphService
let pluginService
let pendingWorkspaceCreation
let pendingDeepLink = findResearchReaderLink(process.argv)
let desktopSmokeFinished = false

function desktopSmokeTrace(stage, detail = {}) {
  const testRoot = String(process.env.RESEARCH_READER_DESKTOP_TEST_ROOT || packagedSmokeTestRootArgument).trim()
  if (!isDesktopSmoke || !testRoot) return
  try {
    fs.mkdirSync(testRoot, { recursive: true })
    fs.appendFileSync(path.join(testRoot, 'desktop-smoke-trace.jsonl'), `${JSON.stringify({ stage, at: new Date().toISOString(), ...detail })}\n`, 'utf8')
  } catch {}
}

function finishDesktopSmoke(payload, failed = false) {
  if (!isDesktopSmoke || desktopSmokeFinished) return
  desktopSmokeFinished = true
  const marker = failed ? 'RESEARCH_READER_DESKTOP_SMOKE_FAILED' : 'RESEARCH_READER_DESKTOP_SMOKE'
  const serialized = JSON.stringify(payload)
  const testRoot = String(process.env.RESEARCH_READER_DESKTOP_TEST_ROOT || packagedSmokeTestRootArgument).trim()
  if (testRoot) {
    try { fs.writeFileSync(path.join(testRoot, 'desktop-smoke-result.json'), JSON.stringify({ failed, payload }, null, 2), 'utf8') } catch {}
  }
  if (failed) {
    process.exitCode = 1
    console.error(`${marker}=${serialized}`)
  } else {
    console.log(`${marker}=${serialized}`)
  }
  setImmediate(() => app.quit())
}

function mineruRuntimeRoot() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'mineru-runtime')
    : path.join(projectRoot, '.runtime')
}

function mineruSetupScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'setup-mineru.ps1')
    : path.join(projectRoot, 'scripts', 'setup-mineru.ps1')
}

function userTranslationRuntimeRoot() {
  return path.join(app.getPath('userData'), 'translation-runtime')
}

function bundledTranslationRuntimeRoot() {
  return path.join(process.resourcesPath, 'translation-runtime')
}

function hasTranslationRuntime(runtimeRoot) {
  return fs.existsSync(path.join(runtimeRoot, 'argos', '.venv', 'Scripts', 'python.exe'))
}

function translationRuntimeRoot() {
  if (!app.isPackaged) return path.join(projectRoot, '.runtime', 'translation')
  const userRuntime = userTranslationRuntimeRoot()
  if (hasTranslationRuntime(userRuntime)) return userRuntime
  const bundledRuntime = bundledTranslationRuntimeRoot()
  if (hasTranslationRuntime(bundledRuntime)) return bundledRuntime
  return userRuntime
}

function translationStateRoot(runtimeRoot) {
  return runtimeRoot === bundledTranslationRuntimeRoot()
    ? path.join(app.getPath('userData'), 'translation-state')
    : runtimeRoot
}

function translationSetupScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'setup-argos.ps1')
    : path.join(projectRoot, 'scripts', 'setup-argos.ps1')
}

function translationBridgeScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'argos-bridge.py')
    : path.join(projectRoot, 'scripts', 'argos-bridge.py')
}

function translationOptions(input = {}) {
  const runtimeRoot = translationRuntimeRoot()
  return {
    projectRoot: app.isPackaged ? undefined : projectRoot,
    runtimeRoot,
    stateRoot: translationStateRoot(runtimeRoot),
    userDataPath: app.getPath('userData'),
    bridgeScript: translationBridgeScript(),
    from: input.from,
    to: input.to,
  }
}

function userEmbeddingRuntimeRoot() {
  return path.join(app.getPath('userData'), 'embedding-runtime')
}

function embeddingRuntimeRoot() {
  return app.isPackaged
    ? userEmbeddingRuntimeRoot()
    : path.join(projectRoot, '.runtime', 'embedding')
}

function embeddingSetupScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'setup-embedding.ps1')
    : path.join(projectRoot, 'scripts', 'setup-embedding.ps1')
}

function embeddingBridgeScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'embedding-bridge.py')
    : path.join(projectRoot, 'scripts', 'embedding-bridge.py')
}

function embeddingOptions() {
  return {
    projectRoot: app.isPackaged ? undefined : projectRoot,
    runtimeRoot: embeddingRuntimeRoot(),
    userDataPath: app.getPath('userData'),
    bridgeScript: embeddingBridgeScript(),
  }
}

function sendSemanticProgress(event, taskId, progress) {
  event.sender.send('semantic:progress', { taskId, ...progress })
}

async function rebuildSemanticIndex(event, input = {}) {
  const taskId = input.taskId
  const status = await localEmbeddingStatus(embeddingOptions())
  if (!status.available || !status.dimension) throw new Error(status.message || '本地语义模型尚未就绪。')
  const prepared = workspaceService.prepareSemanticIndex({ model: status.model })
  sendSemanticProgress(event, taskId, {
    phase: 'preparing',
    completed: 0,
    total: prepared.documents.length,
    text: `已整理 ${prepared.documents.length} 个可追溯内容分块。`,
  })
  const vectors = []
  const batchSize = 64
  for (let offset = 0; offset < prepared.documents.length; offset += batchSize) {
    const batch = prepared.documents.slice(offset, offset + batchSize)
    const result = await embedLocally({
      ...embeddingOptions(),
      texts: batch.map(document => document.text),
      kind: 'passage',
    })
    if (result.model !== status.model || result.dimension !== status.dimension || result.vectors.length !== batch.length) {
      throw new Error('本地语义模型返回的维度或分块数量不一致。')
    }
    vectors.push(...result.vectors)
    sendSemanticProgress(event, taskId, {
      phase: 'embedding',
      completed: Math.min(offset + batch.length, prepared.documents.length),
      total: prepared.documents.length,
      text: `正在本机建立语义索引：${Math.min(offset + batch.length, prepared.documents.length)}/${prepared.documents.length}`,
    })
  }
  const committed = workspaceService.commitSemanticIndex({
    model: status.model,
    dimension: status.dimension,
    sourceIndexedAt: prepared.sourceIndexedAt,
    documents: prepared.documents,
    vectors,
  })
  sendSemanticProgress(event, taskId, {
    phase: 'complete',
    completed: prepared.documents.length,
    total: prepared.documents.length,
    text: `研究库语义索引已更新，共 ${prepared.documents.length} 个分块。`,
  })
  return { ...committed, available: true, localOnly: true }
}

function mineruOptions() {
  return {
    projectRoot: app.isPackaged ? undefined : projectRoot,
    resourcesPath: process.resourcesPath,
    runtimeRoot: mineruRuntimeRoot(),
    userDataPath: app.getPath('userData'),
  }
}

ipcMain.handle('mineru:status', () => mineruStatus(mineruOptions()))

ipcMain.handle('mineru:install', async (event, input) => {
  const onProgress = progress => event.sender.send('mineru:progress', {
    taskId: input?.taskId,
    ...progress,
  })
  if (!mineruInstallation) {
    mineruInstallation = installMineruRuntime({
      scriptPath: mineruSetupScript(),
      runtimeRoot: mineruRuntimeRoot(),
      onProgress,
    }).finally(() => {
      mineruInstallation = undefined
    })
  }
  return mineruInstallation
})

ipcMain.handle('mineru:parse', async (event, input) => {
  const onProgress = progress => event.sender.send('mineru:progress', {
    taskId: input?.taskId,
    ...progress,
  })
  if (!mineruService) {
    mineruService = new MineruLocalService({
      ...mineruOptions(),
    })
  }
  const apiUrl = await mineruService.start(onProgress)
  const result = await parseWithMineru({
    app,
    ...mineruOptions(),
    input,
    onProgress,
    apiUrl,
  })
  return workspaceService.persistMineruResult({
    sourceId: input?.sourceId,
    ...result,
  })
})

ipcMain.handle('translation:status', (_event, input) => {
  pluginService.requireCapability('translation', 'translation.selection')
  return localTranslationStatus(translationOptions(input))
})

ipcMain.handle('translation:install', async (event, input) => {
  pluginService.requireCapability('translation', 'translation.selection')
  const onProgress = progress => event.sender.send('translation:progress', {
    taskId: input?.taskId,
    ...progress,
  })
  if (!translationInstallation) {
    translationInstallation = installTranslationRuntime({
      scriptPath: translationSetupScript(),
      runtimeRoot: userTranslationRuntimeRoot(),
      from: input?.from || 'en',
      to: input?.to || 'zh',
      onProgress,
    }).finally(() => {
      translationInstallation = undefined
    })
  }
  return translationInstallation
})

ipcMain.handle('translation:translate', async (event, input) => {
  pluginService.requireCapability('translation', 'translation.selection')
  const onProgress = progress => event.sender.send('translation:progress', {
    taskId: input?.taskId,
    ...progress,
  })
  return translateLocally({
    ...translationOptions(input),
    text: input?.text,
    onProgress,
  })
})

ipcMain.handle('embedding:status', () => localEmbeddingStatus(embeddingOptions()))

ipcMain.handle('embedding:install', async (event, input) => {
  const onProgress = progress => event.sender.send('embedding:progress', {
    taskId: input?.taskId,
    ...progress,
  })
  if (!embeddingInstallation) {
    embeddingInstallation = installEmbeddingRuntime({
      scriptPath: embeddingSetupScript(),
      runtimeRoot: embeddingRuntimeRoot(),
      onProgress,
    }).finally(() => {
      embeddingInstallation = undefined
    })
  }
  return embeddingInstallation
})

ipcMain.handle('embedding:embed', (_event, input) => embedLocally({
  ...embeddingOptions(),
  texts: input?.texts,
  kind: input?.kind,
}))

ipcMain.handle('settings:load', () => appSettingsStore.load())
ipcMain.handle('settings:save', (_event, input) => appSettingsStore.save(input))
ipcMain.handle('llm:list-providers', () => llmService.listProviders())
ipcMain.handle('llm:test-connection', (_event, input) => {
  pluginService.requireCapability('llm', 'llm.test-connection')
  return llmService.testConnection(input)
})
ipcMain.handle('llm:complete', (_event, input) => {
  pluginService.requireCapability('llm', 'llm.complete')
  return llmService.complete(input)
})
ipcMain.handle('agent:list-tools', () => researchAgentService.listTools())
ipcMain.handle('agent:list-memory', () => researchAgentService.listMemory())
ipcMain.handle('agent:save-memory', (_event, input) => researchAgentService.saveMemory(input))
ipcMain.handle('agent:review-memory', (_event, input) => researchAgentService.reviewMemory(input))
ipcMain.handle('agent:create-session', (_event, input) => researchAgentService.createSession(input))
ipcMain.handle('agent:list-sessions', () => researchAgentService.listSessions())
ipcMain.handle('agent:get-session', (_event, input) => researchAgentService.getSession(input?.sessionId))
ipcMain.handle('agent:append-turn', (_event, input) => researchAgentService.appendTurn(input))
ipcMain.handle('agent:propose-plan', (_event, input) => researchAgentService.proposePlan(input))
ipcMain.handle('agent:get-plan', (_event, input) => researchAgentService.getPlan(input?.planId))
ipcMain.handle('agent:review-step', (_event, input) => researchAgentService.reviewStep(input))
ipcMain.handle('agent:execute-plan', (_event, input) => researchAgentService.executePlan(input))
ipcMain.handle('agent:execute-step', (_event, input) => researchAgentService.executeStep(input))
ipcMain.handle('workbench:dashboard', () => workbenchService.getDashboard())
ipcMain.handle('workbench:project-update', (_event, input) => workbenchService.updateProject(input))
ipcMain.handle('workbench:project-files', (_event, input) => workbenchService.listProjectFiles(input))
ipcMain.handle('workbench:project-preview', (_event, input) => workbenchService.previewProjectFile(input))
ipcMain.handle('workbench:conversation-workflow-list', () => workbenchService.listConversationWorkflows())
ipcMain.handle('workbench:capability-list', () => workbenchService.listCapabilityPacks())
ipcMain.handle('workbench:capability-set', (_event, input) => workbenchService.setCapabilityPack(input))
ipcMain.handle('workbench:run-create', (_event, input) => workbenchService.createRun(input))
ipcMain.handle('workbench:run-list', (_event, input) => workbenchService.listRuns(input))
ipcMain.handle('workbench:run-get', (_event, input) => workbenchService.getRun(input?.runId))
ipcMain.handle('workbench:run-authorize', (_event, input) => workbenchService.authorizeRun(input))
ipcMain.handle('workbench:run-execute-next', (_event, input) => workbenchService.executeNext(input?.runId))
ipcMain.handle('workbench:run-start', (_event, input) => workbenchService.executeUntilBlocked(input?.runId))
ipcMain.handle('workbench:run-pause', (_event, input) => workbenchService.pauseRun(input?.runId))
ipcMain.handle('workbench:run-resume', (_event, input) => workbenchService.resumeRun(input?.runId))
ipcMain.handle('workbench:run-cancel', (_event, input) => workbenchService.cancelRun(input?.runId))
ipcMain.handle('workbench:decision-resolve', (_event, input) => workbenchService.resolveDecision(input))
ipcMain.handle('workbench:result-save', (_event, input) => workbenchService.saveResult(input))
ipcMain.handle('workbench:run-verify', (_event, input) => workbenchService.verifyRun(input?.runId))
ipcMain.handle('knowledge:bootstrap', () => knowledgeGraphService.bootstrap())
ipcMain.handle('knowledge:get-graph', (_event, input) => knowledgeGraphService.getGraph(input))
ipcMain.handle('knowledge:propose-node', (_event, input) => knowledgeGraphService.proposeNode(input))
ipcMain.handle('knowledge:propose-edge', (_event, input) => knowledgeGraphService.proposeEdge(input))
ipcMain.handle('knowledge:review-node', (_event, input) => knowledgeGraphService.reviewNode(input))
ipcMain.handle('knowledge:review-edge', (_event, input) => knowledgeGraphService.reviewEdge(input))
ipcMain.handle('evidence-card:list', (_event, input) => knowledgeGraphService.listEvidenceCards(input))
ipcMain.handle('evidence-card:create', (_event, input) => knowledgeGraphService.createEvidenceCard(input))
ipcMain.handle('evidence-card:update', (_event, input) => knowledgeGraphService.updateEvidenceCard(input))
ipcMain.handle('evidence-card:review', (_event, input) => knowledgeGraphService.reviewEvidenceCard(input))
ipcMain.handle('clipboard:write-text', (_event, input) => writeClipboardText(clipboard, input))
ipcMain.handle('citation:list-styles', () => workspaceService.listCitationStyles())
ipcMain.handle('citation:format', (_event, input) => workspaceService.formatCitation(input))
ipcMain.handle('plugin:list', () => pluginService.list())
ipcMain.handle('plugin:install', (_event, input) => pluginService.install(input))
ipcMain.handle('plugin:uninstall', (_event, input) => pluginService.uninstall(input))

ipcMain.handle('workspace:list-recent', () => workspaceService.listRecent())
ipcMain.handle('workspace:get-current', () => workspaceService.getCurrent())
ipcMain.handle('workspace:load-library', () => workspaceService.loadLibraryState())
ipcMain.handle('workspace:discover-project-pdfs', (_event, input) => workspaceService.discoverProjectPdfSources(input))
ipcMain.handle('workspace:rebuild-portable-vault', () => workspaceService.rebuildVaultProjections())
ipcMain.handle('workspace:list-migration-backups', () => workspaceService.listMigrationBackups())
ipcMain.handle('workspace:open-vault-folder', async () => {
  const current = workspaceService.getCurrent()
  if (!current?.path) throw new Error('请先创建或打开研究库。')
  const message = await shell.openPath(current.path)
  if (message) throw new Error(`无法打开研究库文件夹：${message}`)
  return { opened: true }
})
ipcMain.handle('structured-reading:get', (_event, input) => workspaceService.getStructuredReading(input))
ipcMain.handle('structured-reading:generate', (_event, input) => workspaceService.generateStructuredReading(input))
ipcMain.handle('structured-reading:save-adjustment', (_event, input) => workspaceService.saveStructuredReadingAdjustment(input))
ipcMain.handle('structured-reading:restore', (_event, input) => workspaceService.restoreStructuredReadingVersion(input))
ipcMain.handle('research-resume:get', () => workspaceService.getResearchResume())
ipcMain.handle('research-resume:begin', () => workspaceService.beginResearchSession())
ipcMain.handle('research-resume:save', (_event, input) => workspaceService.saveResearchResume(input))
ipcMain.handle('research-task:list', (_event, input) => workspaceService.listResearchTasks(input))
ipcMain.handle('research-task:create', (_event, input) => workspaceService.createResearchTask(input))
ipcMain.handle('research-task:update', (_event, input) => workspaceService.updateResearchTask(input))
ipcMain.handle('research-workspace:get', () => workspaceService.getResearchWorkspace())
ipcMain.handle('research-workspace:save', (_event, input) => workspaceService.saveResearchWorkspace(input))
ipcMain.handle('research-project:save', (_event, input) => workspaceService.saveResearchWorkspace(input))
ipcMain.handle('research-record:save', (_event, input) => workspaceService.saveResearchRecord(input))
ipcMain.handle('research-milestone:save', (_event, input) => workspaceService.saveResearchMilestone(input))
ipcMain.handle('research-run:save', (_event, input) => workspaceService.saveResearchRun(input))
ipcMain.handle('research-run-template:save', (_event, input) => workspaceService.saveResearchRunTemplate(input))
ipcMain.handle('research-artifact:save', (_event, input) => workspaceService.saveResearchArtifact(input))
ipcMain.handle('research-artifact:select-path', async (_event, input = {}) => {
  const kind = input?.kind === 'directory' ? 'directory' : 'file'
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'directory' ? '选择要登记的成果目录' : '选择要登记的成果文件',
    properties: kind === 'directory' ? ['openDirectory'] : ['openFile'],
  })
  return { canceled: choice.canceled, filePath: choice.filePaths[0] }
})
ipcMain.handle('research-report:list', () => workspaceService.listResearchReports())
ipcMain.handle('research-report:get', (_event, input) => workspaceService.getResearchReport(input?.id))
ipcMain.handle('research-report:save', (_event, input) => workspaceService.saveResearchReport(input))
ipcMain.handle('research-report:confirm', (_event, input) => workspaceService.confirmResearchReport(input))
ipcMain.handle('research-report:export', async (_event, input = {}) => {
  if (input?.destination !== 'save_as') return workspaceService.exportResearchReport(input)
  const report = workspaceService.getResearchReport(input?.id)
  const choice = await dialog.showSaveDialog(mainWindow, {
    title: '导出科研报告 Markdown',
    defaultPath: `${report.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (choice.canceled || !choice.filePath) return { canceled: true }
  return { canceled: false, ...workspaceService.exportResearchReport({ ...input, filePath: choice.filePath }) }
})
ipcMain.handle('zotero-sync:capabilities', () => {
  pluginService.requireCapability('zotero', 'bibliography.preview')
  return workspaceService.getZoteroSyncCapabilities()
})
ipcMain.handle('zotero-sync:preview', (_event, input) => {
  pluginService.requireCapability('zotero', 'bibliography.preview')
  return workspaceService.previewZoteroMetadataSync(input)
})
ipcMain.handle('zotero-sync:apply', (_event, input) => {
  pluginService.requireCapability('zotero', 'bibliography.apply-confirmed')
  return workspaceService.applyZoteroMetadataSync(input)
})
ipcMain.handle('portable-markdown:export', async (_event, input = {}) => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '选择可迁移 Markdown 目录',
    buttonLabel: '导出到这里',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (choice.canceled || !choice.filePaths[0]) return { canceled: true }
  return { canceled: false, ...workspaceService.exportPortableMarkdown({ ...input, directory: choice.filePaths[0] }) }
})
ipcMain.handle('research-claim:list', (_event, input) => workspaceService.listResearchClaims(input))
ipcMain.handle('research-claim:save', (_event, input) => workspaceService.saveResearchClaim(input))
ipcMain.handle('research-claim:archive', (_event, input) => workspaceService.archiveResearchClaim(input))
ipcMain.handle('reading-translation-cache:get', (_event, input) => workspaceService.getReadingTranslationSegments(input))
ipcMain.handle('reading-translation-cache:save', (_event, input) => workspaceService.saveReadingTranslationSegment(input))
ipcMain.handle('reading-translation-terms:list', (_event, input) => workspaceService.listReadingTranslationTerms(input))
ipcMain.handle('reading-translation-terms:save', (_event, input) => workspaceService.saveReadingTranslationTerm(input))
ipcMain.handle('reading-translation-terms:delete', (_event, input) => workspaceService.deleteReadingTranslationTerm(input))
ipcMain.handle('workspace:search-library', (_event, input) => workspaceService.searchLibrary(input))
ipcMain.handle('workspace:semantic-status', async () => {
  const engine = await localEmbeddingStatus(embeddingOptions())
  if (!engine.available) return { ...engine, ready: false, stale: false, chunkCount: 0 }
  return { ...engine, ...workspaceService.semanticIndexStatus({ model: engine.model }) }
})
ipcMain.handle('workspace:semantic-rebuild', (event, input) => rebuildSemanticIndex(event, input))
ipcMain.handle('workspace:hybrid-search', async (event, input = {}) => {
  const exact = workspaceService.searchLibrary(input)
  const engine = await localEmbeddingStatus(embeddingOptions())
  const exactResults = exact.results.map(result => ({ ...result, channels: ['exact'] }))
  if (!engine.available || !engine.dimension || !String(input.query || '').trim()) {
    return {
      ...exact,
      results: exactResults,
      mode: 'exact',
      semantic: { ...engine, ready: false, stale: false, chunkCount: 0 },
    }
  }
  try {
    let semanticState = workspaceService.semanticIndexStatus({ model: engine.model })
    if (!semanticState.ready && input.rebuildIfNeeded !== false) {
      semanticState = await rebuildSemanticIndex(event, input)
    }
    if (!semanticState.ready) {
      return { ...exact, results: exactResults, mode: 'exact', semantic: { ...engine, ...semanticState } }
    }
    const embedded = await embedLocally({
      ...embeddingOptions(),
      texts: [String(input.query).trim()],
      kind: 'query',
    })
    const semantic = workspaceService.searchSemanticIndex({
      model: engine.model,
      vector: embedded.vectors[0],
      filters: input.filters,
      limit: input.limit,
    })
    return {
      ...exact,
      results: reciprocalRankFusion(exact.results, semantic.results, input.limit),
      mode: 'hybrid',
      semantic: { ...engine, ...semantic },
    }
  } catch (error) {
    return {
      ...exact,
      results: exactResults,
      mode: 'exact',
      semantic: {
        ...engine,
        ready: false,
        stale: true,
        chunkCount: 0,
        message: error instanceof Error ? error.message : '本地语义检索失败，已回退到精确检索。',
      },
    }
  }
})
ipcMain.handle('workspace:import-legacy', (_event, input) => workspaceService.importLegacySnapshot(input))
ipcMain.handle('workspace:sync-library', (_event, input) => workspaceService.syncLibraryState(input))
ipcMain.handle('workspace:update-reading-state', (_event, input) => workspaceService.updateReadingState(input))
ipcMain.handle('annotation:revise', (_event, input) => workspaceService.reviseAnnotation(input))
ipcMain.handle('annotation:archive', (_event, input) => workspaceService.archiveAnnotation(input))
ipcMain.handle('annotation:restore', (_event, input) => workspaceService.restoreAnnotation(input))
ipcMain.handle('annotation:export', (_event, input) => workspaceService.exportAnnotations(input))
ipcMain.handle('reading-card:get', (_event, input) => workspaceService.getPaperReadingCard(input?.itemId))
ipcMain.handle('reading-card:save-draft', (_event, input) => workspaceService.savePaperReadingCardDraft(input))
ipcMain.handle('reading-card:accept', (_event, input) => workspaceService.acceptPaperReadingCard(input))
ipcMain.handle('review:get-inputs', (_event, input) => workspaceService.getReviewInputs(input))
ipcMain.handle('review:create', (_event, input) => workspaceService.createReviewDocument(input))
ipcMain.handle('review:list', () => workspaceService.listReviewDocuments())
ipcMain.handle('review:get', (_event, input) => workspaceService.getReviewDocument(input?.documentId))
ipcMain.handle('review:confirm', (_event, input) => workspaceService.confirmReviewDocument(input))
ipcMain.handle('evidence-graph:get', (_event, input) => workspaceService.getEvidenceGraph(input))
ipcMain.handle('evidence-relation:create', (_event, input) => workspaceService.createEvidenceRelation(input))
ipcMain.handle('evidence-relation:review', (_event, input) => workspaceService.reviewEvidenceRelation(input))
ipcMain.handle('action-pack:create', (_event, input) => workspaceService.createActionPack(input))
ipcMain.handle('action-pack:list', () => workspaceService.listActionPacks())
ipcMain.handle('action-pack:get', (_event, input) => workspaceService.getActionPack(input?.packId))
ipcMain.handle('action-pack:review-item', (_event, input) => workspaceService.reviewActionItem(input))
ipcMain.handle('action-pack:complete-item', (_event, input) => workspaceService.completeActionItem(input))
ipcMain.handle('review:export', (_event, input) => workspaceService.exportReviewDocument(input))
ipcMain.handle('review:export-latex', (_event, input) => {
  pluginService.requireCapability('latex', 'writing.latex-package')
  return workspaceService.exportReviewLatexPackage(input)
})
ipcMain.handle('review:show-export', (_event, input) => {
  if (typeof input?.filePath === 'string') shell.showItemInFolder(input.filePath)
})
ipcMain.handle('app:resolve-deep-link', (_event, input) => workspaceService.resolveDeepLink(input))
ipcMain.handle('workspace:import-source-file', (_event, input) => workspaceService.importSourceFile(input))
ipcMain.handle('workspace:read-source-file', (_event, input) => workspaceService.readSourceFile(input?.sourceId))
ipcMain.handle('workspace:load-mineru-assets', (_event, input) => workspaceService.loadMineruAssets(input?.sourceId))
ipcMain.handle('workspace:import-bibliography', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '导入 EndNote XML、RIS 或 BibTeX',
    buttonLabel: '导入题录',
    properties: ['openFile'],
    filters: [
      { name: '支持的题录格式', extensions: ['xml', 'ris', 'bib'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (choice.canceled || !choice.filePaths[0]) return { canceled: true }
  return {
    canceled: false,
    result: workspaceService.importBibliographyFile(choice.filePaths[0]),
  }
})
ipcMain.handle('workspace:switch', (_event, input) => workspaceService.switch(input?.id))

ipcMain.handle('workspace:create', async (_event, input) => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '选择新研究库的保存位置',
    buttonLabel: '在这里创建',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (choice.canceled || !choice.filePaths[0]) return { canceled: true }
  return {
    canceled: false,
    vault: workspaceService.create(choice.filePaths[0], input?.name),
  }
})

ipcMain.handle('workspace:open', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '打开科研阅读研究库',
    buttonLabel: '打开研究库',
    properties: ['openDirectory'],
  })
  if (choice.canceled || !choice.filePaths[0]) return { canceled: true }
  const directory = path.resolve(choice.filePaths[0])
  if (!fs.existsSync(path.join(directory, 'vault.json'))) {
    const existingPapers = listExistingPdfFiles(directory)
    pendingWorkspaceCreation = {
      requestId: crypto.randomUUID(),
      directory,
      existingPapers,
    }
    return {
      canceled: false,
      needsCreation: true,
      creationRequestId: pendingWorkspaceCreation.requestId,
      directory,
      suggestedName: path.basename(directory) || '我的研究库',
      existingPaperCount: existingPapers.length,
      existingPaperNames: existingPapers.slice(0, 8).map(filePath => path.basename(filePath)),
    }
  }
  return {
    canceled: false,
    vault: workspaceService.open(directory),
  }
})

ipcMain.handle('workspace:create-selected', (_event, input) => {
  if (!pendingWorkspaceCreation || input?.creationRequestId !== pendingWorkspaceCreation.requestId) {
    throw new Error('创建请求已经失效，请重新选择文件夹。')
  }
  const { directory, existingPapers = [] } = pendingWorkspaceCreation
  pendingWorkspaceCreation = undefined
  const vault = workspaceService.createAt(directory, input?.name)
  const importResult = input?.manageExistingPapers
    ? workspaceService.importExistingPdfFiles(existingPapers)
    : { imported: [], skipped: [] }
  return {
    canceled: false,
    vault,
    importedPaperCount: importResult.imported.length,
    skippedPaperCount: importResult.skipped.length,
  }
})

function listExistingPdfFiles(directory) {
  const ignored = new Set(['papers', 'exports', 'cache', '.git', 'node_modules'])
  const found = []
  const visit = (current, depth) => {
    if (depth > 4 || found.length >= 500) return
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= 500) break
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name.toLowerCase())) visit(target, depth + 1)
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        found.push(target)
      }
    }
  }
  visit(directory, 0)
  return found
}

function createWindow() {
  desktopSmokeTrace('create-window:start')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: '#f7f8f4',
    title: '小何的科研助手',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'brand', 'icon.ico')
      : path.join(__dirname, '..', 'build', 'icon.ico'),
    show: !isDesktopSmoke,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.removeMenu()
  if (isDesktopSmoke) {
    const smokeTimeout = setTimeout(() => {
      finishDesktopSmoke({ reason: 'renderer-timeout', userData: app.getPath('userData') }, true)
    }, 15000)
    mainWindow.webContents.once('render-process-gone', (_event, details) => {
      clearTimeout(smokeTimeout)
      finishDesktopSmoke({ reason: 'renderer-process-gone', details }, true)
    })
    mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      clearTimeout(smokeTimeout)
      finishDesktopSmoke({ reason: 'load-failed', errorCode, errorDescription }, true)
    })
    mainWindow.webContents.once('did-finish-load', () => clearTimeout(smokeTimeout))
  }
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  mainWindow.webContents.once('did-finish-load', () => {
    desktopSmokeTrace('renderer:did-finish-load')
    if (isDesktopSmoke) {
      mainWindow.setContentSize(1024, 768)
      const previousClipboardText = clipboard.readText()
      const smokeCitation = `小何的科研助手 GB/T 7714—2015 剪贴板验收 ${Date.now()}`
      const expectedLongBlocks = Array.from({ length: 220 }, (_, index) => `Long-form evidence block ${index + 1} remains in deterministic reading order and keeps the desktop reader scrollable.`)
      const expectedRawMarkdown = ['Abstract', '', 'This is the first evidence sentence.\nSecond glued paragraph begins here.', '', 'Methods', '', 'Raw evidence remains traceable.', '', ...expectedLongBlocks.flatMap(block => [block, ''])].join('\n').trim()
      const script = `(async () => {
        const waitFor = async (read, timeout = 12000, label = 'unknown') => {
          const started = Date.now()
          while (Date.now() - started < timeout) {
            const value = read()
            if (value) return value
            await new Promise(resolve => setTimeout(resolve, 80))
          }
          throw new Error('structured-ui-timeout:' + label)
        }
        const setValue = (element, value) => {
          const prototype = element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : element instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLTextAreaElement.prototype
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
          setter.call(element, value)
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
        }
        let researchAssetEntriesVisible = false
        const openResearchAsset = async title => {
          const hubNav = [...document.querySelectorAll('.nav-item')].find(button => button.textContent.includes('科研工作区'))
          if (!hubNav) throw new Error('research-hub-nav-missing')
          hubNav.click()
          const hub = await waitFor(() => document.querySelector('.research-hub'), 12000, 'research-hub')
          researchAssetEntriesVisible = researchAssetEntriesVisible || [...hub.querySelectorAll('button')].some(button => button.textContent.includes('课题与实验'))
          const target = [...hub.querySelectorAll('button')].find(button => button.textContent.includes(title))
          if (!target) throw new Error('research-hub-entry-missing:' + title)
          target.click()
        }
        const onboarding = await waitFor(() => document.querySelector('.settings-modal'))
        const onboardingInputs = onboarding.querySelectorAll('input')
        setValue(onboardingInputs[0], 'https://api.example.invalid/v1')
        setValue(onboardingInputs[1], 'desktop-smoke-model')
        setValue(onboardingInputs[2], 'desktop-smoke-secret')
        const finishOnboarding = [...onboarding.querySelectorAll('button')].find(button => button.textContent.includes('保存并进入'))
        finishOnboarding.click()
        await waitFor(() => !document.querySelector('.settings-modal'), 12000, 'onboarding-close')
        const clipboardResult = await window.readerDesktop.writeClipboardText({ text: ${JSON.stringify(smokeCitation)} })
        const greeting = await waitFor(() => document.querySelector('.research-return-dialog'))
        const greetingVisible = greeting.textContent.includes('终于回来了')
        const dismissGreeting = [...greeting.querySelectorAll('button')].find(button => button.textContent.includes('先看今日科研'))
        dismissGreeting.click()
        await openResearchAsset('今日科研')
        const todayRoot = await waitFor(() => document.querySelector('.today-research'), 12000, 'today-from-research-hub')
        const appShell = document.querySelector('.app-shell')
        const uiScale10Applied = parseFloat(getComputedStyle(appShell).getPropertyValue('--ui-text-xs')) >= 14.2
        const desktop1024NoOverflow = document.documentElement.scrollWidth === document.documentElement.clientWidth
          && [...document.querySelectorAll('button')].every(button => {
            const rect = button.getBoundingClientRect()
            return rect.width === 0 || (rect.left >= 0 && rect.right <= innerWidth + 1)
          })
        const todayAnswerCount = todayRoot.querySelectorAll('[data-today-answer]').length
        const todayContextRestored = todayRoot.textContent.includes('只改变接触刚度后复测')
          && todayRoot.textContent.includes('读到第 2 / 4 页')
          && todayRoot.textContent.includes('传感器零点漂移待定位')
          && todayRoot.textContent.includes('核对实验工况')
        const recordAction = [...todayRoot.querySelectorAll('button')].find(button => button.textContent.includes('记录进展/问题'))
        recordAction.focus()
        recordAction.click()
        await waitFor(() => document.querySelector('.today-record-dialog'))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await waitFor(() => !document.querySelector('.today-record-dialog'))
        const escapeClosedAndRestoredFocus = document.activeElement === recordAction
        recordAction.click()
        const recordDialog = await waitFor(() => document.querySelector('.today-record-dialog'))
        const problemKind = [...recordDialog.querySelectorAll('.today-record-kinds button')].find(button => button.textContent.includes('问题/阻塞'))
        problemKind.click()
        const recordInput = recordDialog.querySelector('input')
        const recordText = recordDialog.querySelector('textarea')
        setValue(recordInput, '桌面烟测记录的真实阻塞')
        setValue(recordText, '这条记录通过今日科研主要动作写入隔离研究库。')
        const saveRecord = [...recordDialog.querySelectorAll('button')].find(button => button.textContent.includes('保存到当前研究库'))
        saveRecord.click()
        await waitFor(() => !document.querySelector('.today-record-dialog'))
        const recordSaved = await waitFor(() => todayRoot.textContent.includes('桌面烟测记录的真实阻塞'))
        const openTasks = [...todayRoot.querySelectorAll('button')].find(button => button.textContent.includes('查看今日研究任务'))
        openTasks.click()
        const tasksRoot = await waitFor(() => document.querySelector('.research-tasks-workspace'))
        const taskBucketCount = tasksRoot.querySelectorAll('.research-task-buckets button').length
        const waitingBucket = [...tasksRoot.querySelectorAll('.research-task-buckets button')].find(button => button.textContent.includes('等待条件'))
        waitingBucket.click()
        const aiProposal = await waitFor(() => [...document.querySelectorAll('.research-task-card.proposed')].find(card => card.textContent.includes('核对刚度范围')))
        const aiProposalVisible = aiProposal.textContent.includes('等待人工确认')
        const confirmTask = [...aiProposal.querySelectorAll('button')].find(button => button.textContent.includes('确认进入任务'))
        confirmTask.click()
        await waitFor(() => ![...document.querySelectorAll('.research-task-card.proposed')].some(card => card.textContent.includes('核对刚度范围')))
        const todayBucket = [...document.querySelectorAll('.research-task-buckets button')].find(button => button.textContent.includes('今日任务'))
        todayBucket.click()
        const confirmedTask = await waitFor(() => [...document.querySelectorAll('.research-task-card')].find(card => card.textContent.includes('核对刚度范围')))
        const aiTaskConfirmed = confirmedTask.textContent.includes('正式任务')
        const quickInput = document.querySelector('.research-quick-inbox input')
        setValue(quickInput, '桌面烟测快速收件箱')
        const quickSave = [...document.querySelectorAll('.research-quick-inbox button')].find(button => button.textContent.includes('收下'))
        quickSave.click()
        const quickInboxSaved = Boolean(await waitFor(() => [...document.querySelectorAll('.research-task-card')].find(card => card.textContent.includes('桌面烟测快速收件箱'))))
        await openResearchAsset('复盘与写作')
        const reviewRoot = await waitFor(() => document.querySelector('.research-review-workspace'), 12000, 'review-after-ui-scale')
        const reviewTypeSamples = [...reviewRoot.querySelectorAll('.section-kicker, .research-report-controls label, .research-report-studio > header > span')]
        const reviewMinimumTypeReadable = reviewTypeSamples.length >= 4 && reviewTypeSamples.every(node => parseFloat(getComputedStyle(node).fontSize) >= 14.2)
        const reportControls = reviewRoot.querySelector('.research-report-controls')
        const reportControlRects = [...reportControls.children].map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0)
        const reportControlsDoNotOverlap = reportControlRects.every((rect, index) => reportControlRects.slice(index + 1).every(other => rect.right <= other.left + 1 || other.right <= rect.left + 1 || rect.bottom <= other.top + 1 || other.bottom <= rect.top + 1))
          && reportControls.scrollWidth <= reportControls.clientWidth + 1
        await openResearchAsset('今日科研')
        const returnedTodayRoot = await waitFor(() => document.querySelector('.today-research'), 12000, 'today-after-ui-scale')
        const workspaceNavVisible = researchAssetEntriesVisible
        const continueResearch = returnedTodayRoot.querySelector('.today-continue')
        continueResearch.click()
        const structuredView = await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '整理稿'), 12000, 'structured-switch-after-ui-scale')
        const readerModeRestored = structuredView.classList.contains('active')
        structuredView.click()
        const structuredRoot = await waitFor(() => document.querySelector('.versioned-structured-reader'), 12000, 'structured-root-after-ui-scale')
        await waitFor(() => structuredRoot.querySelectorAll('.structured-version-block').length >= 3, 12000, 'structured-blocks-after-ui-scale')
        const versionVisible = /v1/.test(structuredRoot.textContent) && structuredRoot.textContent.includes('本版变化')
        const structuredInitialBlockCount = structuredRoot.querySelectorAll('.structured-version-block').length
        const rawSwitch = [...structuredRoot.querySelectorAll('button')].find(button => button.textContent.trim() === '原始 MD')
        rawSwitch.click()
        const raw = await waitFor(() => structuredRoot.querySelector('.structured-raw-markdown'))
        const rawMarkdownPreserved = raw.textContent === ${JSON.stringify(expectedRawMarkdown)}
        const organizedSwitch = [...structuredRoot.querySelectorAll('button')].find(button => button.textContent.trim() === '整理稿')
        organizedSwitch.click()
        await waitFor(() => structuredRoot.querySelector('.structured-version-block'))
        const structuredScrollable = structuredRoot.scrollHeight > structuredRoot.clientHeight && structuredRoot.clientHeight > 0
        for (let attempt = 0; attempt < 12 && structuredRoot.querySelector('.structured-render-more'); attempt += 1) {
          structuredRoot.scrollTop = structuredRoot.scrollHeight
          structuredRoot.dispatchEvent(new Event('scroll'))
          await new Promise(resolve => setTimeout(resolve, 120))
          structuredRoot.querySelector('.structured-render-more button')?.click()
        }
        await waitFor(() => structuredRoot.textContent.includes('Long-form evidence block 220'), 12000, 'structured-last-block')
        structuredRoot.scrollTop = structuredRoot.scrollHeight
        const structuredReachedEnd = structuredRoot.scrollTop + structuredRoot.clientHeight >= structuredRoot.scrollHeight - 4
        const structuredBlockCount = structuredRoot.querySelectorAll('.structured-version-block').length
        const parallelSwitch = [...document.querySelectorAll('.reader-view-switch button')].find(button => button.textContent.includes('版面对照'))
        if (!parallelSwitch || parallelSwitch.disabled) throw new Error('parallel-switch-unavailable')
        parallelSwitch.click()
        await new Promise(resolve => setTimeout(resolve, 300))
        const activeReaderView = [...document.querySelectorAll('.reader-view-switch button')].find(button => button.classList.contains('active'))?.textContent.trim()
        if (activeReaderView !== '版面对照') throw new Error('parallel-state-not-active:' + String(activeReaderView))
        const parallelOutcome = await waitFor(() => document.querySelector('.reader-parallel') || document.querySelector('.reader-view-failure'), 12000, 'parallel-root')
        if (parallelOutcome.classList.contains('reader-view-failure')) throw new Error('parallel-view-failed:' + parallelOutcome.textContent)
        const parallelRoot = parallelOutcome
        const parallelPdf = parallelRoot.querySelector('.pdf-scroll')
        const parallelStructured = parallelRoot.querySelector('.versioned-structured-reader')
        const parallelPanesVisible = Boolean(parallelPdf && parallelStructured && parallelPdf.getBoundingClientRect().width > 0 && parallelStructured.getBoundingClientRect().width > 0)
        const parallelStructuredScrollable = Boolean(parallelStructured && parallelStructured.scrollHeight > parallelStructured.clientHeight && parallelStructured.clientHeight > 0)
        const parallelSeparatorAccessible = Boolean(parallelRoot.querySelector('[role="separator"]')?.getBoundingClientRect().width >= 8)
        const parallelTocInitiallyHidden = !parallelRoot.querySelector('.structured-toc')
        const showParallelToc = [...parallelRoot.querySelectorAll('button')].find(button => button.textContent.includes('显示目录'))
        showParallelToc.click()
        const parallelTocCanToggle = Boolean(await waitFor(() => parallelRoot.querySelector('.structured-toc'), 12000, 'parallel-toc'))
        const hideParallelToc = [...parallelRoot.querySelectorAll('button')].find(button => button.textContent.includes('隐藏目录'))
        hideParallelToc.click()
        await waitFor(() => !parallelRoot.querySelector('.structured-toc'), 12000, 'parallel-toc-hidden')
        const pdfWiderButton = [...parallelRoot.querySelectorAll('button')].find(button => button.textContent.includes('PDF 更宽'))
        pdfWiderButton.click()
        await new Promise(resolve => setTimeout(resolve, 180))
        const parallelPdfPanel = parallelRoot.querySelector('[data-panel][id="parallel-pdf"]')
        const parallelDraftPanel = parallelRoot.querySelector('[data-panel][id="parallel-draft"]')
        const parallelPanelMetrics = {
          pdf: parallelPdfPanel?.getBoundingClientRect().width || 0,
          draft: parallelDraftPanel?.getBoundingClientRect().width || 0,
          panelCount: parallelRoot.querySelectorAll('[data-panel]').length,
        }
        const parallelLayoutAdjustable = parallelPanelMetrics.pdf > parallelPanelMetrics.draft
        const bilingualSwitch = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '中英对照')
        bilingualSwitch.click()
        const bilingualRoot = await waitFor(() => document.querySelector('.bilingual-reader'), 12000, 'bilingual-root')
        const bilingualUsesStructuredOrder = bilingualRoot.textContent.includes('翻译顺序来自：本地整理 v1')
        const bilingualScrollable = bilingualRoot.scrollHeight > bilingualRoot.clientHeight && bilingualRoot.clientHeight > 0
        const translationEngineCount = bilingualRoot.querySelectorAll('.bilingual-engine-switch button').length
        const translationViewCount = bilingualRoot.querySelectorAll('.bilingual-view-switch button').length
        const translatedSegment = await waitFor(() => [...bilingualRoot.querySelectorAll('.bilingual-segment.translated')].find(segment => segment.textContent.includes('这是第一句证据')), 12000, 'translated-cache')
        const failedRetryVisible = Boolean(await waitFor(() => [...bilingualRoot.querySelectorAll('.bilingual-segment.failed button')].find(button => button.textContent.includes('单独重试')), 12000, 'failed-retry'))
        const lockTranslation = [...translatedSegment.querySelectorAll('button')].find(button => button.textContent.includes('锁定译文'))
        lockTranslation.click()
        const translationLocked = Boolean(await waitFor(() => [...document.querySelectorAll('.bilingual-segment.translated button')].find(button => button.textContent.includes('解锁译文')), 12000, 'translation-lock'))
        const glossaryToggle = [...bilingualRoot.querySelectorAll('button')].find(button => button.textContent.includes('术语表'))
        glossaryToggle.click()
        const glossary = await waitFor(() => document.querySelector('.bilingual-glossary'), 12000, 'glossary-open')
        const termInputs = glossary.querySelectorAll('input')
        setValue(termInputs[0], 'stiffness')
        setValue(termInputs[1], '刚度')
        setValue(termInputs[2], '隔离桌面烟测术语')
        const saveTerm = [...glossary.querySelectorAll('button')].find(button => button.textContent.includes('保存'))
        saveTerm.click()
        const glossarySaved = Boolean(await waitFor(() => glossary.textContent.includes('stiffness') && glossary.textContent.includes('刚度'), 12000, 'glossary-save'))
        const cloudEngine = [...bilingualRoot.querySelectorAll('.bilingual-engine-switch button')].find(button => button.textContent.includes('云端 AI'))
        cloudEngine.click()
        await waitFor(() => [...document.querySelectorAll('.bilingual-engine-switch button.active')].find(button => button.textContent.includes('云端 AI')), 12000, 'cloud-engine-active')
        const startCloud = [...document.querySelectorAll('.bilingual-actions button')].find(button => button.textContent.includes('继续翻译'))
        startCloud.click()
        const cloudConfirm = await waitFor(() => document.querySelector('.bilingual-cloud-confirm'), 12000, 'cloud-confirm')
        const cloudScopeVisible = cloudConfirm.textContent.includes('Provider') && cloudConfirm.textContent.includes('字符') && cloudConfirm.textContent.includes('模型')
        for (let attempt = 0; attempt < 12 && bilingualRoot.querySelector('.bilingual-render-more'); attempt += 1) {
          bilingualRoot.scrollTop = bilingualRoot.scrollHeight
          bilingualRoot.dispatchEvent(new Event('scroll'))
          await new Promise(resolve => setTimeout(resolve, 120))
          bilingualRoot.querySelector('.bilingual-render-more button')?.click()
        }
        await waitFor(() => bilingualRoot.textContent.includes('Long-form evidence block 220'), 12000, 'bilingual-last-block')
        bilingualRoot.scrollTop = bilingualRoot.scrollHeight
        const bilingualReachedEnd = bilingualRoot.scrollTop + bilingualRoot.clientHeight >= bilingualRoot.scrollHeight - 4
        cloudConfirm.querySelector('button')?.click()
        const viewExpectations = [
          ['PDF 原文', '.pdf-scroll'],
          ['整理稿', '.versioned-structured-reader'],
          ['版面对照', '.reader-parallel'],
          ['中英对照', '.bilingual-reader'],
          ['PDF 原文', '.pdf-scroll'],
          ['版面对照', '.reader-parallel'],
          ['整理稿', '.versioned-structured-reader'],
          ['中英对照', '.bilingual-reader'],
          ['PDF 原文', '.pdf-scroll'],
          ['中英对照', '.bilingual-reader'],
        ]
        let switchStressPassed = true
        for (const [label, selector] of viewExpectations) {
          const button = [...document.querySelectorAll('.reader-view-switch button')].find(item => item.textContent.trim() === label)
          if (!button || button.disabled) { switchStressPassed = false; break }
          button.click()
          const outcome = await waitFor(() => document.querySelector(selector) || document.querySelector('.reader-view-failure'), 12000, 'switch-' + label)
          if (outcome.classList.contains('reader-view-failure')) { switchStressPassed = false; break }
        }
        const libraryToggle = document.querySelector('.reader-title-group button[title="文献与 PDF 导航"]')
        libraryToggle.click()
        const readerLibrary = await waitFor(() => document.querySelector('.reader-paper-list'))
        const errorPaper = [...readerLibrary.querySelectorAll('button')].find(button => button.textContent.includes('reader-error-recovery.pdf'))
        errorPaper.click()
        const errorFallback = await waitFor(() => document.querySelector('.reader-view-failure'), 12000, 'reader-error-fallback')
        const errorFallbackVisible = errorFallback.textContent.includes('整理稿没有成功打开')
          && errorFallback.textContent.includes('重试当前视图')
          && errorFallback.textContent.includes('返回 PDF 原文')
        const returnToPdf = [...errorFallback.querySelectorAll('button')].find(button => button.textContent.includes('返回 PDF 原文'))
        returnToPdf.click()
        const errorBoundaryRecovered = Boolean(await waitFor(() => document.querySelector('.pdf-scroll'), 12000, 'reader-error-return-pdf'))
        const mainPaper = [...document.querySelectorAll('.reader-paper-list button')].find(button => button.textContent.includes('structured-smoke.pdf'))
        mainPaper.click()
        await waitFor(() => [...document.querySelectorAll('.reader-view-switch button')].find(button => button.textContent.trim() === '中英对照' && !button.disabled), 12000, 'main-reader-return')
        const finalBilingualSwitch = [...document.querySelectorAll('.reader-view-switch button')].find(button => button.textContent.trim() === '中英对照')
        finalBilingualSwitch.click()
        await waitFor(() => document.querySelector('.bilingual-reader'), 12000, 'final-bilingual-return')
        const readerRoot = document.querySelector('.research-reader')
        const reader1024FillsViewport = readerRoot?.getBoundingClientRect().bottom === innerHeight
          && readerRoot?.getBoundingClientRect().height === innerHeight
          && readerRoot?.scrollWidth === readerRoot?.clientWidth
        return {
          title: document.title,
          clipboardResult,
          desktop1024NoOverflow,
          escapeClosedAndRestoredFocus,
          greetingVisible,
          todayAnswerCount,
          todayContextRestored,
          recordSaved: Boolean(recordSaved),
          taskBucketCount,
          aiProposalVisible,
          aiTaskConfirmed,
          quickInboxSaved,
          uiScale10Applied,
          workspaceNavVisible,
          readerModeRestored,
          versionVisible,
          structuredInitialBlockCount,
          structuredBlockCount,
          rawMarkdownPreserved,
          structuredScrollable,
          structuredReachedEnd,
          parallelPanesVisible,
          parallelStructuredScrollable,
          parallelSeparatorAccessible,
          parallelTocInitiallyHidden,
          parallelTocCanToggle,
          parallelLayoutAdjustable,
          parallelPanelMetrics,
          reviewMinimumTypeReadable,
          reportControlsDoNotOverlap,
          bilingualUsesStructuredOrder,
          bilingualScrollable,
          bilingualReachedEnd,
          switchStressPassed,
          errorFallbackVisible,
          errorBoundaryRecovered,
          translationEngineCount,
          translationViewCount,
          failedRetryVisible,
          translationLocked,
          glossarySaved,
          cloudScopeVisible,
          reader1024FillsViewport,
        }
      })()`
      void mainWindow.webContents.executeJavaScript(script, true)
        .then(async result => {
          const { title, clipboardResult, desktop1024NoOverflow, escapeClosedAndRestoredFocus, greetingVisible, todayAnswerCount, todayContextRestored, recordSaved, taskBucketCount, aiProposalVisible, aiTaskConfirmed, quickInboxSaved, uiScale10Applied, workspaceNavVisible, readerModeRestored, versionVisible, structuredInitialBlockCount, structuredBlockCount, rawMarkdownPreserved, structuredScrollable, structuredReachedEnd, parallelPanesVisible, parallelStructuredScrollable, parallelSeparatorAccessible, parallelTocInitiallyHidden, parallelTocCanToggle, parallelLayoutAdjustable, parallelPanelMetrics, reviewMinimumTypeReadable, reportControlsDoNotOverlap, bilingualUsesStructuredOrder, bilingualScrollable, bilingualReachedEnd, switchStressPassed, errorFallbackVisible, errorBoundaryRecovered, translationEngineCount, translationViewCount, failedRetryVisible, translationLocked, glossarySaved, cloudScopeVisible, reader1024FillsViewport } = result
          mainWindow.setContentSize(1600, 900)
          await new Promise(resolve => setTimeout(resolve, 160))
          const desktop1600 = await mainWindow.webContents.executeJavaScript(`(() => {
            const readerRoot = document.querySelector('.research-reader')
            const bilingualRoot = document.querySelector('.bilingual-reader')
            if (bilingualRoot) bilingualRoot.scrollTop = 0
            return {
              noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
              readerFillsViewport: readerRoot?.getBoundingClientRect().bottom === innerHeight
                && readerRoot?.getBoundingClientRect().height === innerHeight
                && readerRoot?.scrollWidth === readerRoot?.clientWidth,
            }
          })()`, true)
          const measureLargeViewport = () => mainWindow.webContents.executeJavaScript(`(() => ({
            actualWidth: innerWidth,
            actualHeight: innerHeight,
            noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
            shellFillsViewport: document.querySelector('.app-shell')?.getBoundingClientRect().width === innerWidth,
          }))()`, true)
          const largeViewportChecks = []
          mainWindow.webContents.debugger.attach('1.3')
          try {
            for (const [label, width, height] of [['2k', 2560, 1440], ['4k', 3840, 2160]]) {
              await mainWindow.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
                width,
                height,
                deviceScaleFactor: 1,
                mobile: false,
              })
              await new Promise(resolve => setTimeout(resolve, 160))
              largeViewportChecks.push({
                label, requestedWidth: width, requestedHeight: height, mode: 'chromium-device-metrics',
                ...(await measureLargeViewport()),
              })
            }
            await mainWindow.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
          } finally {
            mainWindow.webContents.debugger.detach()
          }
          mainWindow.setContentSize(1600, 900)
          await new Promise(resolve => setTimeout(resolve, 120))
          const screenshotRoot = process.env.RESEARCH_READER_DESKTOP_TEST_ROOT
          const screenshotPath = screenshotRoot ? path.join(screenshotRoot, 'reader-long-document-1600x900.png') : undefined
          if (screenshotPath) fs.writeFileSync(screenshotPath, (await mainWindow.capturePage()).toPNG())
          const reviewScreenshotPath = screenshotRoot ? path.join(screenshotRoot, 'research-review-ergonomic-1600x900.png') : undefined
          const parallelScreenshotPath = screenshotRoot ? path.join(screenshotRoot, 'reader-parallel-1600x900.png') : undefined
          const commandScreenshotPath = screenshotRoot ? path.join(screenshotRoot, 'research-command-empty-layout-1600x900.png') : undefined
          const workbenchScreenshotPath = screenshotRoot ? path.join(screenshotRoot, 'agent-workbench-home-1600x900.png') : undefined
          const workflowLibraryScreenshotPath = screenshotRoot ? path.join(screenshotRoot, 'research-workflow-library-1600x900.png') : undefined
          let emptyStateLayoutMetrics = { reviewConverged: false, commandConverged: false }
          if (reviewScreenshotPath && parallelScreenshotPath && commandScreenshotPath) {
            await mainWindow.webContents.executeJavaScript(`(async () => {
              const waitForElement = async selector => {
                const started = Date.now()
                while (Date.now() - started < 12000) {
                  const node = document.querySelector(selector)
                  if (node) return node
                  await new Promise(resolve => setTimeout(resolve, 40))
                }
                throw new Error('visual-wait:' + selector)
              }
              const waitForStableParallel = async () => {
                const started = Date.now()
                while (Date.now() - started < 12000) {
                  const ready = document.querySelector('.reader-parallel .pdf-page-shell canvas')
                    && document.querySelector('.reader-parallel .structured-version-block')
                    && !document.querySelector('.reader-state-banner')
                  if (ready) {
                    await new Promise(resolve => setTimeout(resolve, 600))
                    if (document.querySelector('.reader-parallel .pdf-page-shell canvas')
                      && document.querySelector('.reader-parallel .structured-version-block')
                      && !document.querySelector('.reader-state-banner')) return
                  }
                  await new Promise(resolve => setTimeout(resolve, 60))
                }
                throw new Error('visual-wait:stable-parallel')
              }
              const parallel = [...document.querySelectorAll('.reader-view-switch button')].find(button => button.textContent.includes('版面对照'))
              parallel.click()
              const parallelRoot = await waitForElement('.reader-parallel')
              await waitForStableParallel()
              const pdfWider = [...parallelRoot.querySelectorAll('button')].find(button => button.textContent.includes('PDF 更宽'))
              pdfWider.click()
              await waitForStableParallel()
            })()`, true)
            fs.writeFileSync(parallelScreenshotPath, (await mainWindow.capturePage()).toPNG())
            const reviewLayoutMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
              const started = Date.now()
              const hubNav = [...document.querySelectorAll('.nav-item')].find(button => button.textContent.includes('科研工作区'))
              hubNav.click()
              while (Date.now() - started < 12000 && !document.querySelector('.research-hub')) await new Promise(resolve => setTimeout(resolve, 40))
              const reviewEntry = [...document.querySelectorAll('.research-hub button')].find(button => button.textContent.includes('复盘与写作'))
              reviewEntry.click()
              while (Date.now() - started < 12000) {
                const root = document.querySelector('.research-review-workspace')
                const grid = root?.querySelector('.research-output-grid.is-empty')
                if (grid) {
                  const list = grid.querySelector('.research-output-list')
                  const studio = grid.querySelector('.research-report-studio')
                  const placeholder = grid.querySelector('.research-report-placeholder')
                  const gridRect = grid.getBoundingClientRect()
                  const listRect = list.getBoundingClientRect()
                  const studioRect = studio.getBoundingClientRect()
                  return {
                    fullWidthRows: Math.abs(gridRect.width - listRect.width) <= 2 && Math.abs(gridRect.width - studioRect.width) <= 2,
                    compactEmptyRail: listRect.height <= 130,
                    compactPlaceholder: placeholder.getBoundingClientRect().height <= 320,
                  }
                }
                await new Promise(resolve => setTimeout(resolve, 40))
              }
              throw new Error('visual-wait:.research-output-grid.is-empty')
            })()`, true)
            await new Promise(resolve => setTimeout(resolve, 160))
            fs.writeFileSync(reviewScreenshotPath, (await mainWindow.capturePage()).toPNG())
            const commandLayoutMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
              const started = Date.now()
              const hubNav = [...document.querySelectorAll('.nav-item')].find(button => button.textContent.includes('科研工作区'))
              hubNav.click()
              while (Date.now() - started < 12000 && !document.querySelector('.research-hub')) await new Promise(resolve => setTimeout(resolve, 40))
              const commandEntry = [...document.querySelectorAll('.research-hub button')].find(button => button.textContent.includes('课题与实验'))
              commandEntry.click()
              while (Date.now() - started < 12000) {
                const root = document.querySelector('.research-command-center')
                const grid = root?.querySelector('.research-command-grid.is-empty')
                if (grid) {
                  const milestone = grid.querySelector('.research-milestone-panel')
                  const nextPanel = grid.querySelector('.research-next-panel')
                  const supportCards = [...nextPanel.children]
                  const gridRect = grid.getBoundingClientRect()
                  const milestoneRect = milestone.getBoundingClientRect()
                  const nextRect = nextPanel.getBoundingClientRect()
                  const supportHeights = supportCards.map(card => card.getBoundingClientRect().height)
                  return {
                    fullWidthRows: Math.abs(gridRect.width - milestoneRect.width) <= 2 && Math.abs(gridRect.width - nextRect.width) <= 2,
                    compactMilestoneEmpty: milestone.querySelector('.research-guided-empty').getBoundingClientRect().height <= 140,
                    balancedSupportCards: supportHeights.length === 2 && Math.abs(supportHeights[0] - supportHeights[1]) <= 2,
                  }
                }
                await new Promise(resolve => setTimeout(resolve, 40))
              }
              throw new Error('visual-wait:.research-command-grid.is-empty')
            })()`, true)
            await new Promise(resolve => setTimeout(resolve, 160))
            fs.writeFileSync(commandScreenshotPath, (await mainWindow.capturePage()).toPNG())
            emptyStateLayoutMetrics = {
              reviewConverged: Object.values(reviewLayoutMetrics).every(Boolean),
              commandConverged: Object.values(commandLayoutMetrics).every(Boolean),
              review: reviewLayoutMetrics,
              command: commandLayoutMetrics,
            }
          }
          const workbenchLayoutMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
            const nav = [...document.querySelectorAll('aside nav .nav-item')].find(button => button.textContent.includes('Agent 对话'))
            if (!nav) throw new Error('visual-wait:agent-chat-nav')
            nav.click()
            const started = Date.now()
            while (Date.now() - started < 12000) {
              const root = document.querySelector('.agent-chat-page')
              const composer = root?.querySelector('.agent-composer')
              if (root && composer) {
                const textarea = composer.querySelector('textarea')
                const plus = composer.querySelector('.composer-icon')
                plus.click()
                await new Promise(resolve => setTimeout(resolve, 120))
                const menu = document.querySelector('.composer-plus-menu')
                const workflowNames = ['查找相应的文献', '文献分析总结', '实验方法指定总结', '实验技能教学']
                const visibleWorkflowCount = workflowNames.filter(name => [...document.querySelectorAll('.workflow-starters button,.composer-plus-menu button')].some(button => button.textContent.includes(name))).length
                const rect = composer.getBoundingClientRect()
                const rootStyle = getComputedStyle(root)
                return {
                  chatComposerVisible: rect.width > 500 && rect.height > 90,
                  inputVisible: textarea?.getBoundingClientRect().height > 50,
                  plusMenuVisible: Boolean(menu),
                  projectEntryVisible: [...(menu?.querySelectorAll('button') || [])].some(button => button.textContent.includes('项目内容')),
                  workflowLibraryEntryVisible: [...(menu?.querySelectorAll('button') || [])].some(button => button.textContent.includes('科研工作流库')),
                  modelSelectorVisible: Boolean(composer.querySelector('select[aria-label="选择模型"]')),
                  visibleWorkflowCount,
                  primaryNavCount: document.querySelectorAll('aside nav .nav-item').length,
                  conversationListVisible: Boolean(document.querySelector('.sidebar-conversations')),
                  noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth && rect.right <= innerWidth + 1,
                  scrollContainer: rootStyle.overflowY === 'auto' && root.clientHeight > 0,
                }
              }
              await new Promise(resolve => setTimeout(resolve, 40))
            }
            throw new Error('visual-wait:.agent-chat-page')
          })()`, true)
          if (workbenchScreenshotPath) {
            await new Promise(resolve => setTimeout(resolve, 160))
            fs.writeFileSync(workbenchScreenshotPath, (await mainWindow.capturePage()).toPNG())
          }
          const workbenchInteractionMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
            const summary = [...document.querySelectorAll('.workflow-starters button')].find(button => button.textContent.includes('文献分析总结'))
            summary?.click()
            await new Promise(resolve => setTimeout(resolve, 240))
            const sourcePickerVisible = Boolean(document.querySelector('.workflow-source-picker select'))
            const discoveredPdfOption = [...document.querySelectorAll('.workflow-source-picker option')].find(option => option.textContent.includes('auto-discovered-project.pdf'))
            const autoDiscoveredProjectPdfVisible = Boolean(discoveredPdfOption)
            const autoDiscoveredProjectPdfReadable = Boolean(discoveredPdfOption && !discoveredPdfOption.disabled)
            document.querySelector('.composer-icon')?.click()
            await new Promise(resolve => setTimeout(resolve, 80))
            const workflowLibraryEntry = [...document.querySelectorAll('.composer-plus-menu button')].find(button => button.textContent.includes('科研工作流库'))
            workflowLibraryEntry?.click()
            await new Promise(resolve => setTimeout(resolve, 120))
            const workflowLibraryVisible = Boolean(document.querySelector('.workflow-library'))
            const workflowLibraryCount = document.querySelectorAll('.workflow-library-card').length
            return { sourcePickerVisible, autoDiscoveredProjectPdfVisible, autoDiscoveredProjectPdfReadable, workflowLibraryVisible, workflowLibraryCount }
          })()`, true)
          if (workflowLibraryScreenshotPath) fs.writeFileSync(workflowLibraryScreenshotPath, (await mainWindow.capturePage()).toPNG())
          const workbenchSelectionMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
            const referenceWorkflow = [...document.querySelectorAll('.workflow-library-card')].find(button => button.textContent.includes('引用真实性核查'))
            referenceWorkflow?.click()
            await new Promise(resolve => setTimeout(resolve, 80))
            const capabilityFieldsVisible = Boolean(document.querySelector('.capability-workflow-fields'))
            const memoryEntry = document.querySelector('.sidebar-memory-button')
            memoryEntry?.click()
            await new Promise(resolve => setTimeout(resolve, 100))
            const memoryDrawerVisible = Boolean(document.querySelector('.memory-drawer .memory-create textarea'))
            document.querySelector('.memory-drawer button[aria-label="关闭项目记忆"]')?.click()
            return { capabilityFieldsVisible, memoryEntryVisible: Boolean(memoryEntry), memoryDrawerVisible }
          })()`, true)
          Object.assign(workbenchLayoutMetrics, workbenchInteractionMetrics, workbenchSelectionMetrics)
          const workbenchReachedEnd = await mainWindow.webContents.executeJavaScript(`(() => {
            const root = document.querySelector('.agent-chat-page')
            const composer = root?.querySelector('.agent-composer')
            return Boolean(root && composer && composer.getBoundingClientRect().bottom <= innerHeight)
          })()`)
          workbenchLayoutMetrics.reachedEnd = workbenchReachedEnd
          const workbenchLayoutPassed = workbenchLayoutMetrics.chatComposerVisible && workbenchLayoutMetrics.inputVisible && workbenchLayoutMetrics.plusMenuVisible && workbenchLayoutMetrics.projectEntryVisible && workbenchLayoutMetrics.workflowLibraryEntryVisible && workbenchLayoutMetrics.modelSelectorVisible && workbenchLayoutMetrics.visibleWorkflowCount === 4 && workbenchLayoutMetrics.autoDiscoveredProjectPdfVisible && workbenchLayoutMetrics.autoDiscoveredProjectPdfReadable && workbenchLayoutMetrics.workflowLibraryVisible && workbenchLayoutMetrics.workflowLibraryCount === 22 && workbenchLayoutMetrics.capabilityFieldsVisible && workbenchLayoutMetrics.primaryNavCount === 2 && workbenchLayoutMetrics.conversationListVisible && workbenchLayoutMetrics.noOverflow && workbenchLayoutMetrics.scrollContainer && workbenchReachedEnd
          const clipboardVerified = clipboard.readText() === smokeCitation && clipboardResult?.written === true
          clipboard.writeText(previousClipboardText)
          const largeViewportsPassed = largeViewportChecks.every(check => check.actualWidth === check.requestedWidth && check.actualHeight === check.requestedHeight && check.noOverflow && check.shellFillsViewport)
          if (!clipboardVerified || !desktop1024NoOverflow || !escapeClosedAndRestoredFocus || !greetingVisible || todayAnswerCount !== 5 || !todayContextRestored || !recordSaved || taskBucketCount !== 7 || !aiProposalVisible || !aiTaskConfirmed || !quickInboxSaved || !uiScale10Applied || !workspaceNavVisible || !readerModeRestored || !versionVisible || structuredInitialBlockCount >= structuredBlockCount || structuredBlockCount < 220 || !rawMarkdownPreserved || !structuredScrollable || !structuredReachedEnd || !parallelPanesVisible || !parallelStructuredScrollable || !parallelSeparatorAccessible || !parallelTocInitiallyHidden || !parallelTocCanToggle || !parallelLayoutAdjustable || !reviewMinimumTypeReadable || !reportControlsDoNotOverlap || !bilingualUsesStructuredOrder || !bilingualScrollable || !bilingualReachedEnd || !switchStressPassed || !errorFallbackVisible || !errorBoundaryRecovered || translationEngineCount !== 2 || translationViewCount !== 3 || !failedRetryVisible || !translationLocked || !glossarySaved || !cloudScopeVisible || !reader1024FillsViewport || !desktop1600.noOverflow || !desktop1600.readerFillsViewport || !largeViewportsPassed || !emptyStateLayoutMetrics.reviewConverged || !emptyStateLayoutMetrics.commandConverged || !workbenchLayoutPassed) {
            finishDesktopSmoke({ reason: 'desktop-acceptance-failed', title, clipboardVerified, desktop1024NoOverflow, escapeClosedAndRestoredFocus, greetingVisible, todayAnswerCount, todayContextRestored, recordSaved, taskBucketCount, aiProposalVisible, aiTaskConfirmed, quickInboxSaved, uiScale10Applied, workspaceNavVisible, readerModeRestored, versionVisible, structuredInitialBlockCount, structuredBlockCount, rawMarkdownPreserved, structuredScrollable, structuredReachedEnd, parallelPanesVisible, parallelStructuredScrollable, parallelSeparatorAccessible, parallelTocInitiallyHidden, parallelTocCanToggle, parallelLayoutAdjustable, parallelPanelMetrics, reviewMinimumTypeReadable, reportControlsDoNotOverlap, bilingualUsesStructuredOrder, bilingualScrollable, bilingualReachedEnd, switchStressPassed, errorFallbackVisible, errorBoundaryRecovered, translationEngineCount, translationViewCount, failedRetryVisible, translationLocked, glossarySaved, cloudScopeVisible, reader1024FillsViewport, desktop1600, largeViewportChecks, emptyStateLayoutMetrics, workbenchLayoutMetrics, userData: app.getPath('userData') }, true)
            return
          }
          finishDesktopSmoke({ title, clipboardVerified, clipboardRestored: clipboard.readText() === previousClipboardText, desktop1024NoOverflow, escapeClosedAndRestoredFocus, greetingVisible, todayAnswerCount, todayContextRestored, recordSaved, taskBucketCount, aiProposalVisible, aiTaskConfirmed, quickInboxSaved, uiScale10Applied, workspaceNavVisible, readerModeRestored, versionVisible, structuredInitialBlockCount, structuredBlockCount, rawMarkdownPreserved, structuredScrollable, structuredReachedEnd, parallelPanesVisible, parallelStructuredScrollable, parallelSeparatorAccessible, parallelTocInitiallyHidden, parallelTocCanToggle, parallelLayoutAdjustable, parallelPanelMetrics, reviewMinimumTypeReadable, reportControlsDoNotOverlap, bilingualUsesStructuredOrder, bilingualScrollable, bilingualReachedEnd, switchStressPassed, errorFallbackVisible, errorBoundaryRecovered, translationEngineCount, translationViewCount, failedRetryVisible, translationLocked, glossarySaved, cloudScopeVisible, reader1024FillsViewport, desktop1600, largeViewportChecks, emptyStateLayoutMetrics, workbenchLayoutMetrics, screenshotPath, reviewScreenshotPath, parallelScreenshotPath, commandScreenshotPath, workbenchScreenshotPath, workflowLibraryScreenshotPath, userData: app.getPath('userData') })
        })
        .catch(error => {
          clipboard.writeText(previousClipboardText)
          finishDesktopSmoke({ reason: 'title-read-failed', error: error.message }, true)
        })
      return
    }
    if (!pendingDeepLink) return
    mainWindow.webContents.send('app:deep-link', pendingDeepLink)
    pendingDeepLink = undefined
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
desktopSmokeTrace('single-instance-lock', { acquired: gotSingleInstanceLock })
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = findResearchReaderLink(commandLine)
    if (deepLink) {
      pendingDeepLink = deepLink
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send('app:deep-link', deepLink)
        pendingDeepLink = undefined
      }
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const deepLink = parseResearchReaderLink(url)
    if (!deepLink) return
    pendingDeepLink = deepLink
    if (mainWindow && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('app:deep-link', deepLink)
      pendingDeepLink = undefined
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => {
    desktopSmokeTrace('app:ready')
    app.setAppUserModelId('io.researchreader.desktop')
    Menu.setApplicationMenu(null)
    if (!isDesktopSmoke) {
      if (process.defaultApp && process.argv[1]) {
        app.setAsDefaultProtocolClient('research-reader', process.execPath, [path.resolve(process.argv[1])])
      } else {
        app.setAsDefaultProtocolClient('research-reader')
      }
    }
    workspaceService = new WorkspaceService({
      registryPath: path.join(app.getPath('userData'), 'workspaces.json'),
    })
    appSettingsStore = new AppSettingsStore({
      filePath: path.join(app.getPath('userData'), 'settings.json'),
      safeStorage,
    })
    llmService = new LLMService({ settingsStore: appSettingsStore })
    researchAgentService = new ResearchAgentService({ workspaceService })
    knowledgeGraphService = new KnowledgeGraphService({ workspaceService })
    pluginService = new PluginService({
      manifestRoot: path.join(projectRoot, 'plugins'),
      statePath: path.join(app.getPath('userData'), 'plugins.json'),
    })
    workspaceService.restoreCurrent()
    const desktopAdapter = {
      async listWindows() {
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true })
        return sources.map(source => ({ id: source.id, title: source.name, appIcon: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL() }))
      },
      async captureWindow(input = {}) {
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 }, fetchWindowIcons: false })
        const source = sources.find(candidate => candidate.id === input.sourceId)
        if (!source) throw new Error('授权窗口已关闭或发生变化，桌面操作已暂停。')
        let image = source.thumbnail
        const region = input.region && typeof input.region === 'object' ? input.region : undefined
        if (region) {
          const bounds = image.getSize()
          const x = Math.max(0, Math.min(bounds.width - 1, Math.round(Number(region.x) || 0)))
          const y = Math.max(0, Math.min(bounds.height - 1, Math.round(Number(region.y) || 0)))
          const width = Math.max(1, Math.min(bounds.width - x, Math.round(Number(region.width) || bounds.width)))
          const height = Math.max(1, Math.min(bounds.height - y, Math.round(Number(region.height) || bounds.height)))
          image = image.crop({ x, y, width, height })
        }
        const redacted = applyRedactions(image, input.redactions, nativeImage)
        return { sourceId: source.id, title: source.name, imageDataUrl: redacted.image.toDataURL(), capturedAt: new Date().toISOString(), persisted: false, redactionCount: redacted.redactionCount }
      },
    }
    const policyEngine = new PolicyEngine()
    workbenchBrowser = new BrowserAdapter({ profilePath: path.join(app.getPath('userData'), 'workbench-browser-profile') })
    const officeScriptPath = app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'office-create-copy.ps1') : path.join(projectRoot, 'scripts', 'office-create-copy.ps1')
    const wordWorkflowScriptPath = app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'office-word-workflow.ps1') : path.join(projectRoot, 'scripts', 'office-word-workflow.ps1')
    const translationExportScriptPath = app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'office-translation-export.ps1') : path.join(projectRoot, 'scripts', 'office-translation-export.ps1')
    const desktopInputScriptPath = app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'desktop-input.ps1') : path.join(projectRoot, 'scripts', 'desktop-input.ps1')
    const analysisScriptPath = app.isPackaged ? path.join(process.resourcesPath, 'scripts', 'causal-analysis.py') : path.join(projectRoot, 'scripts', 'causal-analysis.py')
    const translationAdapter = {
      availability: () => {
        const options = translationOptions({ from: 'en', to: 'zh' })
        return findPythonExecutable(options) && fs.existsSync(options.bridgeScript)
          ? { available: true }
          : { available: false, reason: '本地翻译运行时尚未安装；请先在设置中安装 Argos 英译中组件。' }
      },
      model: provider => provider === 'local' ? 'Argos en_zh' : 'configured-ai',
      translate: async input => {
        if (input.provider !== 'local') throw new Error('当前固定翻译工作流只接入本地 Argos；云端翻译仍请使用阅读器内的逐段确认界面。')
        const result = await translateLocally({ ...translationOptions(input), text: input.text })
        return result.text
      },
    }
    const imageAdapter = {
      svgToImage: svg => {
        const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(String(svg), 'utf8').toString('base64')}`)
        if (image.isEmpty()) throw new Error('Electron 无法渲染这张 SVG。')
        return image
      },
      svgToPng: async svg => imageAdapter.svgToImage(svg).toPNG(),
      svgToJpeg: async svg => imageAdapter.svgToImage(svg).toJPEG(92),
    }
    const toolRegistry = new ToolRegistry({ policyEngine, desktopAdapter, browserAdapter: workbenchBrowser, officeScriptPath, wordWorkflowScriptPath, translationExportScriptPath, desktopInputScriptPath, workspaceService, translationAdapter, imageAdapter, analysisScriptPath })
    workbenchService = new WorkbenchService({ workspaceService, toolRegistry, policyEngine, llmService, settingsStore: appSettingsStore })
    if (workspaceService.getCurrent()) workbenchService.recoverInterruptedRuns()
    desktopSmokeTrace('services:ready')
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

let shutdownStarted = false
let shutdownComplete = false
app.on('before-quit', event => {
  if (shutdownComplete) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  Promise.resolve()
    .then(() => mineruService?.stop())
    .catch(error => console.error(`本地服务退出失败：${error.message}`))
    .then(() => workbenchBrowser?.close())
    .catch(error => console.error(`工作台浏览器退出失败：${error.message}`))
    .then(() => workspaceService?.close())
    .catch(error => console.error(`研究库退出失败：${error.message}`))
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})
