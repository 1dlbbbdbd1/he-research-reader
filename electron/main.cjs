const { app, BrowserWindow, clipboard, dialog, ipcMain, shell, Menu, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { mineruStatus, parseWithMineru } = require('./mineru.cjs')
const { MineruLocalService } = require('./mineru-service.cjs')
const { installMineruRuntime } = require('./mineru-install.cjs')
const { localTranslationStatus, translateLocally } = require('./local-translation.cjs')
const { installTranslationRuntime } = require('./translation-install.cjs')
const { embedLocally, localEmbeddingStatus } = require('./local-embedding.cjs')
const { installEmbeddingRuntime } = require('./embedding-install.cjs')
const { reciprocalRankFusion } = require('./semantic-index.cjs')
const { WorkspaceService } = require('./workspace-service.cjs')
const { AppSettingsStore } = require('./settings-service.cjs')
const { findResearchReaderLink, parseResearchReaderLink } = require('./deep-link.cjs')
const { configureDesktopRuntime } = require('./desktop-runtime.cjs')
const { writeClipboardText } = require('./clipboard-service.cjs')
const projectRoot = path.join(__dirname, '..')

const { isDesktopSmoke, managedCodexSession } = configureDesktopRuntime(app)

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
  process.env.RESEARCH_READER_DEV_USER_DATA || managedCodexUserData,
).trim()
if (!app.isPackaged && requestedDevelopmentUserData) {
  const resolvedUserData = path.resolve(requestedDevelopmentUserData)
  const allowedRoot = `${path.resolve(projectRoot, '.reader-cache')}${path.sep}`
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
let pendingWorkspaceCreation
let pendingDeepLink = findResearchReaderLink(process.argv)
let desktopSmokeFinished = false

function finishDesktopSmoke(payload, failed = false) {
  if (!isDesktopSmoke || desktopSmokeFinished) return
  desktopSmokeFinished = true
  const marker = failed ? 'RESEARCH_READER_DESKTOP_SMOKE_FAILED' : 'RESEARCH_READER_DESKTOP_SMOKE'
  const serialized = JSON.stringify(payload)
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

ipcMain.handle('translation:status', (_event, input) => localTranslationStatus(translationOptions(input)))

ipcMain.handle('translation:install', async (event, input) => {
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
ipcMain.handle('clipboard:write-text', (_event, input) => writeClipboardText(clipboard, input))

ipcMain.handle('workspace:list-recent', () => workspaceService.listRecent())
ipcMain.handle('workspace:get-current', () => workspaceService.getCurrent())
ipcMain.handle('workspace:load-library', () => workspaceService.loadLibraryState())
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
ipcMain.handle('zotero-sync:capabilities', () => workspaceService.getZoteroSyncCapabilities())
ipcMain.handle('zotero-sync:preview', (_event, input) => workspaceService.previewZoteroMetadataSync(input))
ipcMain.handle('zotero-sync:apply', (_event, input) => workspaceService.applyZoteroMetadataSync(input))
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: '#f7f8f4',
    title: 'H’s 科研助手',
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
    if (isDesktopSmoke) {
      mainWindow.setContentSize(1024, 768)
      const previousClipboardText = clipboard.readText()
      const smokeCitation = `H’s 科研助手 GB/T 7714—2015 剪贴板验收 ${Date.now()}`
      const expectedRawMarkdown = 'Abstract\n\nThis is the first evidence sentence.\nSecond glued paragraph begins here.\n\nMethods\n\nRaw evidence remains traceable.'
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
        const clipboardResult = await window.readerDesktop.writeClipboardText({ text: ${JSON.stringify(smokeCitation)} })
        const greeting = await waitFor(() => document.querySelector('.research-return-dialog'))
        const greetingVisible = greeting.textContent.includes('终于回来了')
        const dismissGreeting = [...greeting.querySelectorAll('button')].find(button => button.textContent.includes('先看今日科研'))
        dismissGreeting.click()
        const todayRoot = await waitFor(() => document.querySelector('.today-research'))
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
        const setValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value').set
          setter.call(element, value)
          element.dispatchEvent(new Event('input', { bubbles: true }))
        }
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
        const todayNav = [...document.querySelectorAll('.nav-item')].find(button => button.textContent.includes('今日科研'))
        todayNav.click()
        const returnedTodayRoot = await waitFor(() => document.querySelector('.today-research'))
        const continueResearch = returnedTodayRoot.querySelector('.today-continue')
        continueResearch.click()
        const structuredView = await waitFor(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '整理稿'))
        const readerModeRestored = structuredView.classList.contains('active')
        structuredView.click()
        const structuredRoot = await waitFor(() => document.querySelector('.versioned-structured-reader'))
        await waitFor(() => structuredRoot.querySelectorAll('.structured-version-block').length >= 3)
        const versionVisible = /v1/.test(structuredRoot.textContent) && structuredRoot.textContent.includes('本版变化')
        const structuredBlockCount = structuredRoot.querySelectorAll('.structured-version-block').length
        const rawSwitch = [...structuredRoot.querySelectorAll('button')].find(button => button.textContent.trim() === '原始 MD')
        rawSwitch.click()
        const raw = await waitFor(() => structuredRoot.querySelector('.structured-raw-markdown'))
        const bilingualSwitch = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '中英对照')
        bilingualSwitch.click()
        const bilingualRoot = await waitFor(() => document.querySelector('.bilingual-reader'), 12000, 'bilingual-root')
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
          readerModeRestored,
          versionVisible,
          structuredBlockCount,
          rawMarkdownPreserved: raw.textContent === ${JSON.stringify(expectedRawMarkdown)},
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
          const { title, clipboardResult, desktop1024NoOverflow, escapeClosedAndRestoredFocus, greetingVisible, todayAnswerCount, todayContextRestored, recordSaved, taskBucketCount, aiProposalVisible, aiTaskConfirmed, quickInboxSaved, readerModeRestored, versionVisible, structuredBlockCount, rawMarkdownPreserved, translationEngineCount, translationViewCount, failedRetryVisible, translationLocked, glossarySaved, cloudScopeVisible, reader1024FillsViewport } = result
          mainWindow.setContentSize(1600, 900)
          await new Promise(resolve => setTimeout(resolve, 160))
          const desktop1600 = await mainWindow.webContents.executeJavaScript(`(() => {
            const readerRoot = document.querySelector('.research-reader')
            return {
              noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
              readerFillsViewport: readerRoot?.getBoundingClientRect().bottom === innerHeight
                && readerRoot?.getBoundingClientRect().height === innerHeight
                && readerRoot?.scrollWidth === readerRoot?.clientWidth,
            }
          })()`, true)
          const clipboardVerified = clipboard.readText() === smokeCitation && clipboardResult?.written === true
          clipboard.writeText(previousClipboardText)
          if (!clipboardVerified || !desktop1024NoOverflow || !escapeClosedAndRestoredFocus || !greetingVisible || todayAnswerCount !== 5 || !todayContextRestored || !recordSaved || taskBucketCount !== 7 || !aiProposalVisible || !aiTaskConfirmed || !quickInboxSaved || !readerModeRestored || !versionVisible || structuredBlockCount < 3 || !rawMarkdownPreserved || translationEngineCount !== 2 || translationViewCount !== 3 || !failedRetryVisible || !translationLocked || !glossarySaved || !cloudScopeVisible || !reader1024FillsViewport || !desktop1600.noOverflow || !desktop1600.readerFillsViewport) {
            finishDesktopSmoke({ reason: 'desktop-acceptance-failed', title, clipboardVerified, desktop1024NoOverflow, escapeClosedAndRestoredFocus, greetingVisible, todayAnswerCount, todayContextRestored, recordSaved, taskBucketCount, aiProposalVisible, aiTaskConfirmed, quickInboxSaved, readerModeRestored, versionVisible, structuredBlockCount, rawMarkdownPreserved, translationEngineCount, translationViewCount, failedRetryVisible, translationLocked, glossarySaved, cloudScopeVisible, reader1024FillsViewport, desktop1600, userData: app.getPath('userData') }, true)
            return
          }
          finishDesktopSmoke({ title, clipboardVerified, clipboardRestored: clipboard.readText() === previousClipboardText, desktop1024NoOverflow, escapeClosedAndRestoredFocus, greetingVisible, todayAnswerCount, todayContextRestored, recordSaved, taskBucketCount, aiProposalVisible, aiTaskConfirmed, quickInboxSaved, readerModeRestored, versionVisible, structuredBlockCount, rawMarkdownPreserved, translationEngineCount, translationViewCount, failedRetryVisible, translationLocked, glossarySaved, cloudScopeVisible, reader1024FillsViewport, desktop1600, userData: app.getPath('userData') })
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
    app.setAppUserModelId('io.researchreader.desktop')
    Menu.setApplicationMenu(null)
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient('research-reader', process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('research-reader')
    }
    workspaceService = new WorkspaceService({
      registryPath: path.join(app.getPath('userData'), 'workspaces.json'),
    })
    appSettingsStore = new AppSettingsStore({
      filePath: path.join(app.getPath('userData'), 'settings.json'),
      safeStorage,
    })
    workspaceService.restoreCurrent()
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
    .then(() => workspaceService?.close())
    .catch(error => console.error(`研究库退出失败：${error.message}`))
    .finally(() => {
      shutdownComplete = true
      app.quit()
    })
})
