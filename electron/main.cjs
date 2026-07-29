const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { mineruStatus, parseWithMineru } = require('./mineru.cjs')
const { MineruLocalService } = require('./mineru-service.cjs')
const { installMineruRuntime } = require('./mineru-install.cjs')
const { localTranslationStatus, translateLocally } = require('./local-translation.cjs')
const { installTranslationRuntime } = require('./translation-install.cjs')
const { WorkspaceService } = require('./workspace-service.cjs')
const { findResearchReaderLink, parseResearchReaderLink } = require('./deep-link.cjs')

let mainWindow
let mineruService
let mineruInstallation
let translationInstallation
let workspaceService
let pendingWorkspaceCreation
let pendingDeepLink = findResearchReaderLink(process.argv)
const projectRoot = path.join(__dirname, '..')

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

function translationRuntimeRoot() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'translation-runtime')
    : path.join(projectRoot, '.runtime', 'translation')
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
  return {
    projectRoot: app.isPackaged ? undefined : projectRoot,
    runtimeRoot: translationRuntimeRoot(),
    userDataPath: app.getPath('userData'),
    bridgeScript: translationBridgeScript(),
    from: input.from,
    to: input.to,
  }
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
  return parseWithMineru({
    app,
    ...mineruOptions(),
    input,
    onProgress,
    apiUrl,
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
      runtimeRoot: translationRuntimeRoot(),
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

ipcMain.handle('workspace:list-recent', () => workspaceService.listRecent())
ipcMain.handle('workspace:get-current', () => workspaceService.getCurrent())
ipcMain.handle('workspace:load-library', () => workspaceService.loadLibraryState())
ipcMain.handle('workspace:search-library', (_event, input) => workspaceService.searchLibrary(input))
ipcMain.handle('workspace:import-legacy', (_event, input) => workspaceService.importLegacySnapshot(input))
ipcMain.handle('workspace:sync-library', (_event, input) => workspaceService.syncLibraryState(input))
ipcMain.handle('workspace:update-reading-state', (_event, input) => workspaceService.updateReadingState(input))
ipcMain.handle('review:get-inputs', (_event, input) => workspaceService.getReviewInputs(input))
ipcMain.handle('review:create', (_event, input) => workspaceService.createReviewDocument(input))
ipcMain.handle('review:list', () => workspaceService.listReviewDocuments())
ipcMain.handle('review:get', (_event, input) => workspaceService.getReviewDocument(input?.documentId))
ipcMain.handle('review:export', (_event, input) => workspaceService.exportReviewDocument(input))
ipcMain.handle('review:show-export', (_event, input) => {
  if (typeof input?.filePath === 'string') shell.showItemInFolder(input.filePath)
})
ipcMain.handle('app:resolve-deep-link', (_event, input) => workspaceService.resolveDeepLink(input))
ipcMain.handle('workspace:import-source-file', (_event, input) => workspaceService.importSourceFile(input))
ipcMain.handle('workspace:read-source-file', (_event, input) => workspaceService.readSourceFile(input?.sourceId))
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
    title: '科研阅读闭环',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.removeMenu()
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  mainWindow.webContents.once('did-finish-load', () => {
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
    workspaceService.restoreCurrent()
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  void mineruService?.stop()
  workspaceService?.close()
})
