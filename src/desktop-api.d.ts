type MineruStatus = {
  available: boolean
  backend: 'pipeline'
  localOnly: true
  executable?: string
  message: string
}

type DesktopPersonName = {
  family?: string
  given?: string
  literal?: string
}

type DesktopFragmentAnchor = {
  type: 'pdf' | 'markdown' | 'text' | 'legacy'
  state: 'resolved' | 'unresolved'
  pageNumber?: number
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  quote?: { exact: string; prefix?: string; suffix?: string }
  markdownBlockId?: string
  sourceContentSha256?: string
  legacyLocatorText?: string
}

type MineruParseResult = {
  taskId: string
  markdown: string
  markdownPath: string
  outputDirectory: string
  backend: 'pipeline'
  localOnly: true
  revision: string
  assetRootRelative: string
  markdownSha256: string
  generatedAt: string
  manifest: {
    version: 1
    sourceId: string
    backend: 'pipeline'
    generatedAt: string
    markdownPath: string
    markdownSha256: string
    files: Array<{ path: string; size: number; sha256: string }>
  }
}

type MineruInstallResult = {
  installed: true
  runtimeRoot: string
  localOnly: true
}

type MineruProgress = {
  taskId?: string
  stream: 'stdout' | 'stderr' | 'status'
  text: string
}

type LocalTranslationStatus = {
  available: boolean
  from: string
  to: string
  provider: 'argos'
  localOnly: true
  packageCode?: string
  packageVersion?: string
  modelLicense?: string
  argosVersion?: string
  message: string
}

type LocalTranslationInstallResult = {
  installed: true
  runtimeRoot: string
  from: string
  to: string
  provider: 'argos'
  localOnly: true
}

type LocalTranslationResult = {
  text: string
  from: string
  to: string
  provider: 'argos'
  localOnly: true
}

type LocalTranslationProgress = {
  taskId?: string
  stream: 'stdout' | 'stderr' | 'status'
  text: string
}

type LocalEmbeddingStatus = {
  available: boolean
  provider: 'fastembed-local'
  model: string
  dimension?: number
  fastembedVersion?: string
  libraryLicense?: string
  modelLicense?: string
  localOnly: true
  message: string
}

type LocalEmbeddingInstallResult = {
  installed: boolean
  runtimeRoot: string
  model: string
  provider: 'fastembed-local'
  localOnly: true
}

type LocalEmbeddingResult = {
  provider: 'fastembed-local'
  model: string
  dimension: 512
  kind: 'query' | 'passage'
  vectors: number[][]
  localOnly: true
}

type WorkspaceSummary = {
  id: string
  projectId?: string
  name: string
  path: string
  schemaVersion?: number
  createdAt?: string
  updatedAt: string
  isCurrent?: boolean
}

type WorkspaceDialogResult = {
  canceled: boolean
  vault?: WorkspaceSummary
  needsCreation?: boolean
  creationRequestId?: string
  directory?: string
  suggestedName?: string
}

type WorkspaceLibraryState = {
  sources: Array<Record<string, unknown>>
  annotations: Array<Record<string, unknown>>
  bibliographicItems: Array<Record<string, unknown>>
}

type DesktopUISettings = {
  uiScale: number
  density: 'compact' | 'comfortable'
  surfaceTone: 'neutral' | 'warm' | 'cool'
  accentColor: 'slate' | 'blue' | 'green' | 'plum'
  readerFontSize: number
  readerLineHeight: number
  readerWidth: number
}

type DesktopAppSettings = {
  ai: {
    baseUrl: string
    model: string
    apiKey: string
    allowFullDocument: boolean
    translationProvider: 'local' | 'ai'
  }
  ui: DesktopUISettings
  credentialState?: 'empty' | 'encrypted' | 'unavailable'
}

type DesktopLibrarySearchFilters = {
  itemIds?: string[]
  readingStatuses?: Array<'unread' | 'title_only' | 'skimming' | 'reading' | 'finished'>
  relevances?: Array<'undecided' | 'core' | 'relevant' | 'supplemental' | 'mismatched'>
  ideaStates?: Array<'undecided' | 'has_ideas' | 'no_new_ideas'>
  questionStates?: Array<'undecided' | 'has_questions' | 'no_questions'>
  purposeTags?: string[]
  origins?: Array<'bibliography' | 'source' | 'document' | 'mineru' | 'source_evidence' | 'user' | 'ai' | 'review'>
  hasAnnotations?: boolean
}

type DesktopLibrarySearchResult = {
  id: string
  kind: 'paper' | 'source' | 'fragment' | 'review'
  entityId: string
  origin: string
  originLabel: string
  title: string
  subtitle?: string
  excerpt: string
  sourceId?: string
  itemId?: string
  reviewDocumentId?: string
  pageNumber?: number
  anchor?: DesktopFragmentAnchor
}

type DesktopLibrarySearchResponse = {
  query: string
  filters: DesktopLibrarySearchFilters
  results: DesktopLibrarySearchResult[]
  filteredItemCount: number
  totalItemCount: number
  facets: {
    readingStatuses: Record<string, number>
    relevances: Record<string, number>
    ideaStates: Record<string, number>
    questionStates: Record<string, number>
    purposeTags: Record<string, number>
    annotations: { withAnnotations: number; withoutAnnotations: number }
  }
}

type DesktopSemanticIndexStatus = LocalEmbeddingStatus & {
  ready: boolean
  stale: boolean
  dimension?: number
  chunkCount: number
  indexedAt?: string
  sourceIndexedAt?: string
}

type DesktopSemanticProgress = {
  taskId?: string
  phase: 'preparing' | 'embedding' | 'complete'
  completed: number
  total: number
  text: string
}

type DesktopHybridSearchResponse = Omit<DesktopLibrarySearchResponse, 'results'> & {
  results: Array<DesktopLibrarySearchResult & {
    channels: Array<'exact' | 'semantic'>
    fusionScore?: number
    semanticScore?: number
  }>
  mode: 'exact' | 'hybrid'
  semantic: DesktopSemanticIndexStatus
}

type DesktopPaperReadingCardContext = {
  contextId: string
  origin: 'bibliography' | 'user_state' | 'source_evidence' | 'user' | 'document'
  label: string
  content: string
  sourceId?: string
  fragmentId?: string
  pageNumber?: number
  anchor?: DesktopFragmentAnchor
}

type DesktopPaperReadingCardSnapshot = {
  paper: Record<string, unknown>
  contexts: DesktopPaperReadingCardContext[]
  card?: {
    generationRunId: string
    status: 'draft' | 'accepted'
    model?: string
    provider?: string
    generatedAt: string
    acceptedAt?: string
    sections: Array<{
      id: string
      key: string
      title: string
      content: string
      contentSha256: string
      citations: Array<{
        fragmentId: string
        origin: 'source_evidence' | 'user'
        sourceId?: string
        sourceName?: string
        pageNumber?: number
        anchor?: DesktopFragmentAnchor
        excerpt: string
      }>
    }>
  }
}

type ReviewInputFragment = {
  id: string
  bibliographicItemId: string
  sourceId?: string
  annotationId?: string
  origin: 'source_evidence' | 'user' | 'ai'
  kind: string
  content: string
  contentSha256: string
  purposeTags: string[]
  anchor: DesktopFragmentAnchor
  itemTitle: string
}

type ReviewDocumentView = {
  id: string
  title: string
  status: 'draft' | 'reviewed' | 'exported'
  generationRunId?: string
  createdAt: string
  updatedAt: string
  items: Array<{ id: string; title: string; position: number }>
  blocks: Array<{
    id: string
    position: number
    blockType: 'heading' | 'source_evidence' | 'user_note' | 'ai_organization'
    content: string
    contentSha256: string
    sourceFragmentId?: string
    unsupported: boolean
    citations: Array<{
      id: string
      itemId: string
      sourceId: string
      fragmentId?: string
      pageNumber?: number
      anchor?: DesktopFragmentAnchor
      quotedTextSha256?: string
      label: string
    }>
  }>
}

type ActionEvidenceInput = {
  evidenceType: 'fragment' | 'review' | 'source' | 'bibliography'
  entityId: string
  sourceId?: string
  itemId?: string
  reviewDocumentId?: string
  label: string
  excerpt: string
  pageNumber?: number
  anchor?: DesktopFragmentAnchor
}

type ActionPackSummary = {
  id: string
  title: string
  objective: string
  status: 'draft' | 'confirmed' | 'dismissed' | 'completed'
  createdBy: 'user' | 'ai' | 'system'
  createdAt: string
  updatedAt: string
  itemCount: number
  proposedCount: number
  confirmedCount: number
  completedCount: number
}

type ActionPackView = {
  id: string
  title: string
  objective: string
  scope: { kind: 'current' | 'selected' | 'library'; label: string; itemIds: string[] }
  status: 'draft' | 'confirmed' | 'dismissed' | 'completed'
  createdBy: 'user' | 'ai' | 'system'
  provider?: string
  model?: string
  generationRunId?: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string
  completedAt?: string
  items: Array<{
    id: string
    position: number
    actionType: 'read' | 'compare' | 'verify' | 'experiment' | 'review' | 'note'
    title: string
    rationale: string
    status: 'proposed' | 'confirmed' | 'dismissed' | 'completed'
    createdAt: string
    updatedAt: string
    evidence: Array<{
      id: string
      evidenceType: 'fragment' | 'review' | 'source' | 'bibliography'
      entityId: string
      fragmentId?: string
      reviewBlockId?: string
      reviewDocumentId?: string
      sourceId?: string
      itemId?: string
      label: string
      excerpt: string
      pageNumber?: number
      anchor?: DesktopFragmentAnchor
    }>
  }>
  events: Array<{
    id: string
    itemId?: string
    eventType: 'created' | 'item_confirmed' | 'item_dismissed' | 'item_reopened' | 'item_completed' | 'pack_status_changed' | 'migrated'
    actor: 'user' | 'ai' | 'system'
    note: string
    createdAt: string
  }>
}

type EvidenceGraphNode = {
  id: string
  entityId: string
  entityType: 'fragment' | 'review_block'
  layer: 'evidence' | 'interpretation' | 'synthesis'
  origin: 'source_evidence' | 'user' | 'ai' | 'review'
  trust: 'source' | 'user' | 'ai_draft' | 'ai_accepted' | 'unsupported'
  title: string
  excerpt: string
  kindLabel: string
  locationLabel: string
  itemId?: string
  itemTitle?: string
  sourceId?: string
  sourceName?: string
  documentId?: string
  documentTitle?: string
  pageNumber?: number
  anchor?: DesktopFragmentAnchor
}

type EvidenceGraphEdge = {
  id: string
  fromNodeId: string
  toNodeId: string
  relation: 'derived_from' | 'comments_on' | 'supports' | 'refutes' | 'mentions' | 'cites'
  label: string
  provenance: 'user_confirmed' | 'ai_proposed' | 'ai_accepted' | 'system'
  relationId?: string
  status?: 'proposed' | 'confirmed' | 'rejected'
  createdBy?: 'user' | 'ai' | 'system'
  rationale?: string
  createdAt?: string
  reviewedAt?: string
  canAccept?: boolean
  canReject?: boolean
}

type EvidenceGraphView = {
  nodes: EvidenceGraphNode[]
  edges: EvidenceGraphEdge[]
  unlinkedNodeIds: string[]
  limited: boolean
  scope: {
    documentId?: string
    itemIds: string[]
  }
  summary: {
    evidence: number
    userNotes: number
    aiDrafts: number
    aiAccepted: number
    reviewConclusions: number
    unsupported: number
    relations: number
  }
}

interface Window {
  readerDesktop?: {
    isDesktop: true
    getMineruStatus(): Promise<MineruStatus>
    installMineru(input: { taskId: string }): Promise<MineruInstallResult>
    parseWithMineru(input: { taskId: string; sourceId: string; fileName: string; bytes: ArrayBuffer }): Promise<MineruParseResult>
    onMineruProgress(callback: (progress: MineruProgress) => void): () => void
    getLocalTranslationStatus(input?: { from?: string; to?: string }): Promise<LocalTranslationStatus>
    installLocalTranslation(input: { taskId: string; from: string; to: string }): Promise<LocalTranslationInstallResult>
    translateLocally(input: { taskId: string; text: string; from: string; to: string }): Promise<LocalTranslationResult>
    onLocalTranslationProgress(callback: (progress: LocalTranslationProgress) => void): () => void
    getLocalEmbeddingStatus(): Promise<LocalEmbeddingStatus>
    installLocalEmbedding(input: { taskId: string }): Promise<LocalEmbeddingInstallResult>
    embedLocally(input: { texts: string[]; kind: 'query' | 'passage' }): Promise<LocalEmbeddingResult>
    onLocalEmbeddingProgress(callback: (progress: LocalTranslationProgress) => void): () => void
    loadAppSettings(): Promise<DesktopAppSettings>
    saveAppSettings(input: {
      ai: DesktopAppSettings['ai']
      ui: DesktopUISettings
    }): Promise<DesktopAppSettings>
    listRecentWorkspaces(): Promise<WorkspaceSummary[]>
    getCurrentWorkspace(): Promise<WorkspaceSummary | undefined>
    createWorkspace(input: { name: string }): Promise<WorkspaceDialogResult>
    openWorkspace(): Promise<WorkspaceDialogResult>
    createWorkspaceInSelectedFolder(input: { creationRequestId: string; name: string }): Promise<WorkspaceDialogResult>
    switchWorkspace(input: { id: string }): Promise<WorkspaceSummary>
    loadWorkspaceLibrary(): Promise<WorkspaceLibraryState>
    searchWorkspaceLibrary(input: {
      query?: string
      filters?: DesktopLibrarySearchFilters
      limit?: number
    }): Promise<DesktopLibrarySearchResponse>
    getWorkspaceSemanticStatus(): Promise<DesktopSemanticIndexStatus>
    rebuildWorkspaceSemanticIndex(input: { taskId: string }): Promise<DesktopSemanticIndexStatus>
    searchWorkspaceHybrid(input: {
      taskId?: string
      query?: string
      filters?: DesktopLibrarySearchFilters
      limit?: number
      rebuildIfNeeded?: boolean
    }): Promise<DesktopHybridSearchResponse>
    onWorkspaceSemanticProgress(callback: (progress: DesktopSemanticProgress) => void): () => void
    importLegacyWorkspaceData(input: {
      sources: Array<Record<string, unknown>>
      annotations: Array<Record<string, unknown>>
    }): Promise<WorkspaceLibraryState & { runId: string; alreadyImported: boolean }>
    syncWorkspaceLibrary(input: {
      workspaceId: string
      sources: Array<Record<string, unknown>>
      annotations: Array<Record<string, unknown>>
    }): Promise<{ saved: true; sourceCount: number }>
    updateReadingState(input: {
      itemId: string
      readingStatus?: 'unread' | 'title_only' | 'skimming' | 'reading' | 'finished'
      relevance?: 'undecided' | 'core' | 'relevant' | 'supplemental' | 'mismatched'
      ideaState?: 'undecided' | 'has_ideas' | 'no_new_ideas'
      questionState?: 'undecided' | 'has_questions' | 'no_questions'
      purposeTags?: string[]
      decisionNote?: string
      lastPage?: number | null
      totalPages?: number | null
    }): Promise<{
      readingStatus: 'unread' | 'title_only' | 'skimming' | 'reading' | 'finished'
      relevance: 'undecided' | 'core' | 'relevant' | 'supplemental' | 'mismatched'
      ideaState: 'undecided' | 'has_ideas' | 'no_new_ideas'
      questionState: 'undecided' | 'has_questions' | 'no_questions'
      purposeTags: string[]
      decisionNote: string
      lastPage?: number
      totalPages?: number
    }>
    reviseAnnotation(input: {
      annotationId: string
      category: string
      note: string
    }): Promise<Record<string, unknown>>
    archiveAnnotation(input: { annotationId: string }): Promise<{
      annotationId: string
      archivedAt: string
      alreadyArchived: boolean
    }>
    restoreAnnotation(input: { annotationId: string }): Promise<Record<string, unknown>>
    exportAnnotations(input: { sourceId: string }): Promise<{
      filePath: string
      fileSha256: string
      format: 'markdown'
      annotationCount: number
      exportedAt: string
    }>
    getPaperReadingCard(input: { itemId: string }): Promise<DesktopPaperReadingCardSnapshot>
    savePaperReadingCardDraft(input: {
      itemId: string
      provider: string
      model: string
      promptFingerprint?: string
      sections: Array<{ key: string; content: string; citationIds: string[] }>
    }): Promise<DesktopPaperReadingCardSnapshot>
    acceptPaperReadingCard(input: {
      itemId: string
      generationRunId: string
    }): Promise<DesktopPaperReadingCardSnapshot>
    getReviewInputs(input: { itemIds: string[]; annotationIds: string[] }): Promise<{
      items: Array<{ id: string; title: string; itemType: string; authors: DesktopPersonName[]; issued?: string }>
      fragments: ReviewInputFragment[]
    }>
    createReviewDocument(input: {
      title: string
      itemIds: string[]
      annotationIds: string[]
      generationRunId?: string
      aiSections?: Array<{ content: string; citationFragmentIds: string[] }>
    }): Promise<ReviewDocumentView>
    listReviewDocuments(): Promise<Array<{
      id: string
      title: string
      status: 'draft' | 'reviewed' | 'exported'
      createdAt: string
      updatedAt: string
      itemCount: number
      blockCount: number
    }>>
    getReviewDocument(input: { documentId: string }): Promise<ReviewDocumentView>
    getEvidenceGraph(input?: { itemIds?: string[]; documentId?: string }): Promise<EvidenceGraphView>
    createEvidenceRelation(input: {
      fromFragmentId: string
      toFragmentId: string
      relation: 'supports' | 'refutes' | 'mentions'
      rationale: string
    }): Promise<{
      relationId: string
      relation: 'supports' | 'refutes' | 'mentions'
      status: 'confirmed'
      change: 'created' | 'reopened' | 'confirmed' | 'unchanged'
    }>
    reviewEvidenceRelation(input: {
      relationId: string
      decision: 'accept' | 'reject'
      rationale?: string
    }): Promise<{
      relationId: string
      relation: 'supports' | 'refutes' | 'mentions'
      status: 'confirmed' | 'rejected'
      changed: boolean
    }>
    createActionPack(input: {
      title: string
      objective: string
      scope: { kind: 'current' | 'selected' | 'library'; label: string; itemIds: string[] }
      createdBy: 'user' | 'ai' | 'system'
      provider?: string
      model?: string
      generationRunId?: string
      actions: Array<{
        actionType: 'read' | 'compare' | 'verify' | 'experiment' | 'review' | 'note'
        title: string
        rationale: string
        evidence: ActionEvidenceInput[]
      }>
    }): Promise<ActionPackView>
    listActionPacks(): Promise<ActionPackSummary[]>
    getActionPack(input: { packId: string }): Promise<ActionPackView>
    reviewActionItem(input: { itemId: string; decision: 'confirm' | 'dismiss'; note?: string }): Promise<ActionPackView>
    completeActionItem(input: { itemId: string; note?: string }): Promise<ActionPackView>
    exportReviewDocument(input: { documentId: string; format: 'markdown' | 'docx' }): Promise<{
      filePath: string
      fileSha256: string
      revisionHash: string
      format: 'markdown' | 'docx'
      exportedAt: string
    }>
    showReviewExport(input: { filePath: string }): Promise<void>
    resolveDeepLink(input: {
      sourceId: string
      pageNumber?: number
      fragmentId?: string
    }): Promise<{
      sourceId: string
      pageNumber: number
      anchor?: DesktopFragmentAnchor
    }>
    onDeepLink(callback: (deepLink: {
      sourceId: string
      pageNumber?: number
      fragmentId?: string
    }) => void): () => void
    importWorkspaceSourceFile(input: {
      id: string
      fileName: string
      kind: string
      version: number
      contentSha256: string
      bytes: ArrayBuffer
    }): Promise<{ sourceId: string; fileName: string; contentSha256: string; pathRelative: string }>
    readWorkspaceSourceFile(input: { sourceId: string }): Promise<{ fileName: string; bytes: Uint8Array }>
    loadMineruAssets(input: { sourceId: string }): Promise<{
      revision?: string
      markdownSha256?: string
      assets: Record<string, string>
      layoutSource?: string
        layoutBlocks: Array<{
          id: string
          type: string
          text: string
          pageNumber: number
          bbox?: [number, number, number, number]
        }>
    }>
    importBibliography(): Promise<{
      canceled: boolean
      result?: {
        batchId: string
        format: 'endnote-xml' | 'ris' | 'bibtex'
        itemCount: number
        attachmentCount: number
        copiedSourceCount: number
        alreadyImported: boolean
        warnings: Array<{ ordinal: number; code: string; message: string }>
      }
    }>
  }
}
