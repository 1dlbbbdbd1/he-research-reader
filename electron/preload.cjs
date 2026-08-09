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
  getLocalEmbeddingStatus: () => ipcRenderer.invoke('embedding:status'),
  installLocalEmbedding: input => ipcRenderer.invoke('embedding:install', input),
  embedLocally: input => ipcRenderer.invoke('embedding:embed', input),
  onLocalEmbeddingProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('embedding:progress', listener)
    return () => ipcRenderer.removeListener('embedding:progress', listener)
  },
  loadAppSettings: () => ipcRenderer.invoke('settings:load'),
  saveAppSettings: input => ipcRenderer.invoke('settings:save', input),
  writeClipboardText: input => ipcRenderer.invoke('clipboard:write-text', input),
  listRecentWorkspaces: () => ipcRenderer.invoke('workspace:list-recent'),
  getCurrentWorkspace: () => ipcRenderer.invoke('workspace:get-current'),
  createWorkspace: input => ipcRenderer.invoke('workspace:create', input),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  createWorkspaceInSelectedFolder: input => ipcRenderer.invoke('workspace:create-selected', input),
  switchWorkspace: input => ipcRenderer.invoke('workspace:switch', input),
  loadWorkspaceLibrary: () => ipcRenderer.invoke('workspace:load-library'),
  getStructuredReading: input => ipcRenderer.invoke('structured-reading:get', input),
  generateStructuredReading: input => ipcRenderer.invoke('structured-reading:generate', input),
  saveStructuredReadingAdjustment: input => ipcRenderer.invoke('structured-reading:save-adjustment', input),
  restoreStructuredReadingVersion: input => ipcRenderer.invoke('structured-reading:restore', input),
  getResearchResume: () => ipcRenderer.invoke('research-resume:get'),
  beginResearchSession: () => ipcRenderer.invoke('research-resume:begin'),
  saveResearchResume: input => ipcRenderer.invoke('research-resume:save', input),
  listResearchTasks: input => ipcRenderer.invoke('research-task:list', input),
  createResearchTask: input => ipcRenderer.invoke('research-task:create', input),
  updateResearchTask: input => ipcRenderer.invoke('research-task:update', input),
  getResearchWorkspace: () => ipcRenderer.invoke('research-workspace:get'),
  saveResearchWorkspace: input => ipcRenderer.invoke('research-workspace:save', input),
  saveResearchProject: input => ipcRenderer.invoke('research-project:save', input),
  saveResearchRecord: input => ipcRenderer.invoke('research-record:save', input),
  saveResearchMilestone: input => ipcRenderer.invoke('research-milestone:save', input),
  saveResearchRun: input => ipcRenderer.invoke('research-run:save', input),
  saveResearchRunTemplate: input => ipcRenderer.invoke('research-run-template:save', input),
  saveResearchArtifact: input => ipcRenderer.invoke('research-artifact:save', input),
  selectResearchArtifactPath: input => ipcRenderer.invoke('research-artifact:select-path', input),
  listResearchReports: () => ipcRenderer.invoke('research-report:list'),
  getResearchReport: input => ipcRenderer.invoke('research-report:get', input),
  saveResearchReport: input => ipcRenderer.invoke('research-report:save', input),
  confirmResearchReport: input => ipcRenderer.invoke('research-report:confirm', input),
  exportResearchReport: input => ipcRenderer.invoke('research-report:export', input),
  getZoteroSyncCapabilities: () => ipcRenderer.invoke('zotero-sync:capabilities'),
  previewZoteroMetadataSync: input => ipcRenderer.invoke('zotero-sync:preview', input),
  applyZoteroMetadataSync: input => ipcRenderer.invoke('zotero-sync:apply', input),
  exportPortableMarkdown: input => ipcRenderer.invoke('portable-markdown:export', input),
  listResearchClaims: input => ipcRenderer.invoke('research-claim:list', input),
  saveResearchClaim: input => ipcRenderer.invoke('research-claim:save', input),
  archiveResearchClaim: input => ipcRenderer.invoke('research-claim:archive', input),
  getReadingTranslationSegments: input => ipcRenderer.invoke('reading-translation-cache:get', input),
  saveReadingTranslationSegment: input => ipcRenderer.invoke('reading-translation-cache:save', input),
  listReadingTranslationTerms: input => ipcRenderer.invoke('reading-translation-terms:list', input),
  saveReadingTranslationTerm: input => ipcRenderer.invoke('reading-translation-terms:save', input),
  deleteReadingTranslationTerm: input => ipcRenderer.invoke('reading-translation-terms:delete', input),
  searchWorkspaceLibrary: input => ipcRenderer.invoke('workspace:search-library', input),
  getWorkspaceSemanticStatus: () => ipcRenderer.invoke('workspace:semantic-status'),
  rebuildWorkspaceSemanticIndex: input => ipcRenderer.invoke('workspace:semantic-rebuild', input),
  searchWorkspaceHybrid: input => ipcRenderer.invoke('workspace:hybrid-search', input),
  onWorkspaceSemanticProgress: callback => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('semantic:progress', listener)
    return () => ipcRenderer.removeListener('semantic:progress', listener)
  },
  importLegacyWorkspaceData: input => ipcRenderer.invoke('workspace:import-legacy', input),
  syncWorkspaceLibrary: input => ipcRenderer.invoke('workspace:sync-library', input),
  updateReadingState: input => ipcRenderer.invoke('workspace:update-reading-state', input),
  reviseAnnotation: input => ipcRenderer.invoke('annotation:revise', input),
  archiveAnnotation: input => ipcRenderer.invoke('annotation:archive', input),
  restoreAnnotation: input => ipcRenderer.invoke('annotation:restore', input),
  exportAnnotations: input => ipcRenderer.invoke('annotation:export', input),
  getPaperReadingCard: input => ipcRenderer.invoke('reading-card:get', input),
  savePaperReadingCardDraft: input => ipcRenderer.invoke('reading-card:save-draft', input),
  acceptPaperReadingCard: input => ipcRenderer.invoke('reading-card:accept', input),
  getReviewInputs: input => ipcRenderer.invoke('review:get-inputs', input),
  createReviewDocument: input => ipcRenderer.invoke('review:create', input),
  listReviewDocuments: () => ipcRenderer.invoke('review:list'),
  getReviewDocument: input => ipcRenderer.invoke('review:get', input),
  confirmReviewDocument: input => ipcRenderer.invoke('review:confirm', input),
  getEvidenceGraph: input => ipcRenderer.invoke('evidence-graph:get', input),
  createEvidenceRelation: input => ipcRenderer.invoke('evidence-relation:create', input),
  reviewEvidenceRelation: input => ipcRenderer.invoke('evidence-relation:review', input),
  createActionPack: input => ipcRenderer.invoke('action-pack:create', input),
  listActionPacks: () => ipcRenderer.invoke('action-pack:list'),
  getActionPack: input => ipcRenderer.invoke('action-pack:get', input),
  reviewActionItem: input => ipcRenderer.invoke('action-pack:review-item', input),
  completeActionItem: input => ipcRenderer.invoke('action-pack:complete-item', input),
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
  loadMineruAssets: input => ipcRenderer.invoke('workspace:load-mineru-assets', input),
  importBibliography: () => ipcRenderer.invoke('workspace:import-bibliography'),
})
