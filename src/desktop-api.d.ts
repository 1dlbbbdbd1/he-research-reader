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

type DesktopLibrarySearchFilters = {
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

interface Window {
  readerDesktop?: {
    isDesktop: true
    getMineruStatus(): Promise<MineruStatus>
    installMineru(input: { taskId: string }): Promise<MineruInstallResult>
    parseWithMineru(input: { taskId: string; fileName: string; bytes: ArrayBuffer }): Promise<MineruParseResult>
    onMineruProgress(callback: (progress: MineruProgress) => void): () => void
    getLocalTranslationStatus(input?: { from?: string; to?: string }): Promise<LocalTranslationStatus>
    installLocalTranslation(input: { taskId: string; from: string; to: string }): Promise<LocalTranslationInstallResult>
    translateLocally(input: { taskId: string; text: string; from: string; to: string }): Promise<LocalTranslationResult>
    onLocalTranslationProgress(callback: (progress: LocalTranslationProgress) => void): () => void
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
