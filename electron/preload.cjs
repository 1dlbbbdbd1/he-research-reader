const { contextBridge, ipcRenderer } = require('electron')

const deepLinkListeners = new Set()
const pendingDeepLinks = []
ipcRenderer.on('app:deep-link', (_event, deepLink) => {
  if (!deepLinkListeners.size) {
    pendingDeepLinks.push(deepLink)
    return
  }
  for (const listener of deepLinkListeners) listener(deepLink)
})

contextBridge.exposeInMainWorld('readerDesktop', {
  isDesktop: true,
  getMineruStatus: () => ipcRenderer.invoke('mineru:status'),
  installMineru: input => ipcRenderer.invoke('mineru:install', input),
  parseWithMineru: input => ipcRenderer.invoke('mineru:parse', input),
  onMineruProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('mineru:progress', listener)
    return () => ipcRenderer.removeListener('mineru:progress', listener)
  },
  getLocalTranslationStatus: input => ipcRenderer.invoke('translation:status', input),
  installLocalTranslation: input => ipcRenderer.invoke('translation:install', input),
  translateLocally: input => ipcRenderer.invoke('translation:translate', input),
  onLocalTranslationProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('translation:progress', listener)
    return () => ipcRenderer.removeListener('translation:progress', listener)
  },
  listRecentWorkspaces: () => ipcRenderer.invoke('workspace:list-recent'),
  getCurrentWorkspace: () => ipcRenderer.invoke('workspace:get-current'),
  createWorkspace: input => ipcRenderer.invoke('workspace:create', input),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  createWorkspaceInSelectedFolder: input => ipcRenderer.invoke('workspace:create-selected', input),
  switchWorkspace: input => ipcRenderer.invoke('workspace:switch', input),
  loadWorkspaceLibrary: () => ipcRenderer.invoke('workspace:load-library'),
  searchWorkspaceLibrary: input => ipcRenderer.invoke('workspace:search-library', input),
  importLegacyWorkspaceData: input => ipcRenderer.invoke('workspace:import-legacy', input),
  syncWorkspaceLibrary: input => ipcRenderer.invoke('workspace:sync-library', input),
  updateReadingState: input => ipcRenderer.invoke('workspace:update-reading-state', input),
  getReviewInputs: input => ipcRenderer.invoke('review:get-inputs', input),
  createReviewDocument: input => ipcRenderer.invoke('review:create', input),
  listReviewDocuments: () => ipcRenderer.invoke('review:list'),
  getReviewDocument: input => ipcRenderer.invoke('review:get', input),
  exportReviewDocument: input => ipcRenderer.invoke('review:export', input),
  showReviewExport: input => ipcRenderer.invoke('review:show-export', input),
  resolveDeepLink: input => ipcRenderer.invoke('app:resolve-deep-link', input),
  onDeepLink: callback => {
    deepLinkListeners.add(callback)
    for (const deepLink of pendingDeepLinks.splice(0)) callback(deepLink)
    return () => deepLinkListeners.delete(callback)
  },
  importWorkspaceSourceFile: input => ipcRenderer.invoke('workspace:import-source-file', input),
  readWorkspaceSourceFile: input => ipcRenderer.invoke('workspace:read-source-file', input),
  importBibliography: () => ipcRenderer.invoke('workspace:import-bibliography'),
})
