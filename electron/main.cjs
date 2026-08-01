const { app, BrowserWindow, dialog, ipcMain, shell, Menu, safeStorage } = require('electron')
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
const projectRoot = path.join(__dirname, '..')

const { isDesktopSmoke, managedCodexSession } = configureDesktopRuntime(app)

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

ipcMain.handle('workspace:list-recent', () => workspaceService.listRecent())
ipcMain.handle('workspace:get-current', () => workspaceService.getCurrent())
ipcMain.handle('workspace:load-library', () => workspaceService.loadLibraryState())
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
    pendingWorkspaceCreation = {
      requestId: crypto.randomUUID(),
      directory,
    }
    return {
      canceled: false,
      needsCreation: true,
      creationRequestId: pendingWorkspaceCreation.requestId,
      directory,
      suggestedName: path.basename(directory) || '我的研究库',
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
  const directory = pendingWorkspaceCreation.directory
  pendingWorkspaceCreation = undefined
  return {
    canceled: false,
    vault: workspaceService.createAt(directory, input?.name),
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f7f8f4',
    title: '小何的科研阅读助手',
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
      void mainWindow.webContents.executeJavaScript('document.title', true)
        .then(title => {
          finishDesktopSmoke({ title, userData: app.getPath('userData') })
        })
        .catch(error => {
          finishDesktopSmoke({ reason: 'title-read-failed', error: error.message }, true)
        })
      return
    }
    if (!pendingDeepLink) return
    mainWindow.webContents.send('app:deep-link', pendingDeepLink)
    pendingDeepLink = undefined
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
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
