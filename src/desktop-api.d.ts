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
  existingPaperCount?: number
  existingPaperNames?: string[]
  importedPaperCount?: number
  skippedPaperCount?: number
}

type DesktopResearchRecordType = 'log' | 'experiment' | 'dataset' | 'decision' | 'milestone'

type DesktopResearchRecordStatus = 'planned' | 'active' | 'completed' | 'blocked' | 'archived'

type DesktopResearchProjectMode = 'exploration' | 'execution'

type DesktopResearchRunOutcome = 'planned' | 'running' | 'success' | 'failure' | 'invalid' | 'interrupted'

type DesktopResearchArtifactRole =
  | 'raw_data' | 'processed_data' | 'figure' | 'log' | 'script' | 'config'
  | 'model' | 'video' | 'image' | 'document' | 'directory' | 'other'

type DesktopResearchProject = {
  id: string
  name: string
  researchQuestion: string
  currentHypothesis: string
  stage: string
  mode: DesktopResearchProjectMode
  updatedAt: string
}

type DesktopResearchRecord = {
  id: string
  recordType: DesktopResearchRecordType
  title: string
  content: string
  status: DesktopResearchRecordStatus
  occurredAt: string
  filePath?: string
  sourceIds: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}

type DesktopResearchWorkspace = {
  project: DesktopResearchProject
  records: DesktopResearchRecord[]
  milestones: DesktopResearchMilestone[]
  runs: DesktopResearchRun[]
  artifacts: DesktopResearchArtifact[]
  runTemplates: DesktopResearchRunTemplate[]
  reports: DesktopResearchReport[]
  claims: DesktopResearchClaim[]
  history: DesktopResearchProjectHistoryEntry[]
}

type DesktopResearchResumeView =
  | 'today' | 'research-workspace' | 'research-review' | 'sources'
  | 'reader' | 'dashboard' | 'evidence' | 'actions'

type DesktopResearchResumeState = {
  projectId: string
  activeView: DesktopResearchResumeView
  sourceId?: string
  pageNumber?: number
  readerMode?: 'original' | 'markdown' | 'parallel' | 'bilingual'
  activeRunId?: string
  lastOpenedAt?: string
  lastActiveAt?: string
  previousActiveAt?: string
  firstVisit?: boolean
  createdAt?: string
  updatedAt?: string
}

type DesktopResearchResumeInput = {
  projectId?: string
  activeView?: DesktopResearchResumeView
  sourceId?: string | null
  pageNumber?: number | null
  readerMode?: DesktopResearchResumeState['readerMode'] | null
  activeRunId?: string | null
}

type DesktopResearchTaskStatus = 'inbox' | 'today' | 'later' | 'waiting' | 'completed' | 'abandoned' | 'deferred'
type DesktopResearchTaskSourceType = 'manual' | 'paper' | 'annotation' | 'ai_suggestion' | 'run' | 'anomaly' | 'milestone' | 'review_document'

type DesktopResearchTask = {
  id: string
  title: string
  detail: string
  status: DesktopResearchTaskStatus
  sourceType: DesktopResearchTaskSourceType
  sourceId?: string
  sourceRole: string
  origin: 'user' | 'ai' | 'system'
  approvalStatus: 'not_required' | 'proposed' | 'confirmed' | 'rejected'
  isFormal: boolean
  waitCondition: string
  deferredUntil?: string
  returnTarget: {
    view?: DesktopResearchResumeView
    sourceId?: string
    itemId?: string
    pageNumber?: number
    annotationId?: string
    runId?: string
    milestoneId?: string
    reviewDocumentId?: string
    actionPackId?: string
    actionItemId?: string
  }
  sourceSnapshot: Record<string, unknown>
  createdAt: string
  updatedAt: string
  events: Array<{
    id: string
    eventType: 'created' | 'legacy_synced' | 'confirmed' | 'rejected' | 'status_changed' | 'source_written_back'
    fromStatus?: DesktopResearchTaskStatus
    toStatus?: DesktopResearchTaskStatus
    actor: 'user' | 'ai' | 'system'
    note: string
    occurredAt: string
  }>
}

type DesktopResearchTaskList = {
  tasks: DesktopResearchTask[]
  summary: Record<DesktopResearchTaskStatus, number>
}

type DesktopResearchTaskInput = {
  projectId?: string
  title?: string
  detail?: string
  status?: DesktopResearchTaskStatus
  sourceType?: DesktopResearchTaskSourceType
  sourceId?: string
  sourceRole?: string
  origin?: 'user' | 'ai' | 'system'
  waitCondition?: string
  deferredUntil?: string
}

type DesktopResearchEvidenceRefType = 'bibliography' | 'source' | 'run' | 'artifact' | 'milestone'

type DesktopResearchEvidenceRef = {
  type: DesktopResearchEvidenceRefType
  id: string
  label?: string
}

type DesktopResearchReportType = 'weekly' | 'meeting' | 'stage_review'

type DesktopResearchReportStatus = 'draft' | 'confirmed'

type DesktopResearchReportRevision = {
  id: string
  revisionNumber: number
  snapshot: {
    title: string
    type: DesktopResearchReportType
    period: string
    markdown: string
    sourceRefs: DesktopResearchEvidenceRef[]
    status: DesktopResearchReportStatus
    confirmedAt?: string
    updatedAt: string
  }
  createdAt: string
}

type DesktopResearchReport = {
  id: string
  title: string
  type: DesktopResearchReportType
  period: string
  markdown: string
  sourceRefs: DesktopResearchEvidenceRef[]
  status: DesktopResearchReportStatus
  revisionNumber: number
  revisions: DesktopResearchReportRevision[]
  createdAt: string
  updatedAt: string
  confirmedAt?: string
}

type DesktopResearchReportInput = {
  id?: string
  projectId?: string
  title?: string
  type?: DesktopResearchReportType
  period?: string
  markdown?: string
  sourceRefs?: DesktopResearchEvidenceRef[]
  status?: 'draft'
}

type DesktopResearchClaimStatus = 'draft' | 'confirmed'

type DesktopResearchClaimRevision = {
  id: string
  revisionNumber: number
  snapshot: {
    section: string
    text: string
    status: DesktopResearchClaimStatus
    requiredEvidence: string[]
    evidenceRefs: DesktopResearchEvidenceRef[]
    confirmedAt?: string
    archivedAt?: string
    updatedAt: string
  }
  createdAt: string
}

type DesktopResearchClaim = {
  id: string
  section: string
  text: string
  status: DesktopResearchClaimStatus
  requiredEvidence: string[]
  evidenceRefs: DesktopResearchEvidenceRef[]
  revisionNumber: number
  revisions: DesktopResearchClaimRevision[]
  createdAt: string
  updatedAt: string
  confirmedAt?: string
  archivedAt?: string
}

type DesktopResearchClaimInput = {
  id?: string
  projectId?: string
  section?: string
  text?: string
  status?: DesktopResearchClaimStatus
  requiredEvidence?: string[]
  evidenceRefs?: DesktopResearchEvidenceRef[]
}

type DesktopResearchWorkspaceInput = {
  projectId?: string
  name?: string
  researchQuestion?: string
  currentHypothesis?: string
  stage?: string
  mode?: DesktopResearchProjectMode
  createdBy?: 'user' | 'ai' | 'system'
}

type DesktopResearchRecordInput = {
  id?: string
  projectId?: string
  recordType: DesktopResearchRecordType
  title: string
  content?: string
  status?: DesktopResearchRecordStatus
  occurredAt?: string
  filePath?: string
  sourceIds?: string[]
  tags?: string[]
}

type DesktopResearchMilestone = {
  id: string
  title: string
  description: string
  status: DesktopResearchRecordStatus
  acceptanceCriteria: string[]
  dueAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

type DesktopResearchVariableChange = {
  name: string
  previousValue?: string
  currentValue: string
  unit?: string
}

type DesktopResearchRunTemplateDefaults = {
  purpose?: string
  hypothesis?: string
  changedVariables?: DesktopResearchVariableChange[]
  command?: string
  environment?: string
  procedure?: string
  observations?: string
  anomaly?: string
  nextStep?: string
}

type DesktopResearchRunTemplate = {
  id: string
  projectId?: string
  name: string
  category: string
  description: string
  defaults: DesktopResearchRunTemplateDefaults
  builtIn: boolean
  createdAt: string
  updatedAt: string
}

type DesktopResearchRun = {
  id: string
  milestoneId?: string
  templateId?: string
  title: string
  purpose: string
  hypothesis: string
  changedVariables: DesktopResearchVariableChange[]
  command: string
  environment: string
  procedure: string
  outcome: DesktopResearchRunOutcome
  observations: string
  anomaly: string
  nextStep: string
  nextStepTaskStatus?: DesktopResearchTaskStatus
  anomalyTaskStatus?: DesktopResearchTaskStatus
  sourceIds: string[]
  startedAt: string
  endedAt?: string
  createdAt: string
  updatedAt: string
}

type DesktopResearchArtifact = {
  id: string
  runId: string
  label: string
  role: DesktopResearchArtifactRole
  filePath: string
  resolvedPath: string
  kind: 'file' | 'directory'
  existsState: 'found' | 'missing' | 'denied'
  sizeBytes?: number
  modifiedAt?: string
  contentSha256?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type DesktopResearchProjectHistoryEntry = {
  id: string
  changedFields: string[]
  snapshot: {
    name: string
    researchQuestion: string
    currentHypothesis: string
    stage: string
    mode: DesktopResearchProjectMode
  }
  createdAt: string
  createdBy: 'user' | 'ai' | 'system'
}

type DesktopResearchMilestoneInput = {
  id?: string
  projectId?: string
  title?: string
  description?: string
  status?: DesktopResearchRecordStatus
  acceptanceCriteria?: string[]
  dueAt?: string
}

type DesktopResearchRunTemplateInput = {
  id?: string
  projectId?: string
  name?: string
  category?: string
  description?: string
  defaults?: DesktopResearchRunTemplateDefaults
  archived?: boolean
}

type DesktopResearchRunInput = {
  id?: string
  projectId?: string
  milestoneId?: string
  templateId?: string
  title?: string
  purpose?: string
  hypothesis?: string
  changedVariables?: DesktopResearchVariableChange[]
  command?: string
  environment?: string
  procedure?: string
  outcome?: DesktopResearchRunOutcome
  observations?: string
  anomaly?: string
  nextStep?: string
  sourceIds?: string[]
  startedAt?: string
  endedAt?: string
}

type DesktopResearchArtifactInput = {
  id?: string
  projectId?: string
  runId?: string
  label?: string
  role?: DesktopResearchArtifactRole
  filePath?: string
}

type DesktopReadingTranslationSegment = {
  sourceId: string
  segmentId: string
  sourceHash: string
  baseSourceHash: string
  sourceText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  provider: string
  model?: string
  status: 'pending' | 'translated' | 'failed'
  error?: string
  attempts: number
  locked: boolean
  lockedAt?: string
  createdAt: string
  updatedAt: string
}

type DesktopReadingTranslationTerm = {
  id: string
  sourceId: string
  sourceTerm: string
  targetTerm: string
  note: string
  createdAt: string
  updatedAt: string
}

type WorkspaceLibraryState = {
  sources: Array<Record<string, unknown>>
  annotations: Array<Record<string, unknown>>
  bibliographicItems: Array<Record<string, unknown>>
  researchWorkspace: DesktopResearchWorkspace
}

type DesktopStructuredReadingBlock = {
  id: string
  originalBlockIds: string[]
  content: string
  sourceSlices: Array<{ originalBlockId: string; content: string }>
  contentFingerprint: string
  kind: 'heading' | 'paragraph' | 'figure' | 'figure_caption' | 'table' | 'code' | 'formula'
  headingLevel?: number
  inferredHeading?: string
  pageNumber?: number
  pageRange?: [number, number]
  bbox?: [number, number, number, number]
  layoutBlockId?: string
  confidence?: number
  sourceVersion: number
  transformation?: 'cross-page-merge'
  relation?: { type: 'caption-of'; targetBlockId: string }
}

type DesktopStructuredReadingVersion = {
  id: string
  documentId: string
  sourceId: string
  versionNumber: number
  sourceFingerprint: string
  sourceVersion: number
  createdBy: 'rules' | 'ai' | 'user' | 'restore'
  model?: string
  blocks: DesktopStructuredReadingBlock[]
  toc: Array<{ blockId: string; title: string; level: number; pageNumber?: number }>
  diagnostics: Array<{ pageNumber: number; layout: 'single-column' | 'two-column' | 'uncertain'; confidence: number; coverage: number; reordered: boolean }>
  qualityIssues: Array<{ code: string; severity: 'info' | 'warning'; message: string; blockId?: string; pageNumber?: number }>
  changeSummary: Record<string, number | boolean>
  note: string
  restoredFromVersionId?: string
  createdAt: string
}

type DesktopStructuredReadingState = {
  documentId?: string
  sourceId: string
  sourceVersion: number
  sourceFingerprint?: string
  stale: boolean
  currentVersion?: DesktopStructuredReadingVersion
  versions: Array<{
    id: string
    versionNumber: number
    sourceFingerprint: string
    sourceVersion: number
    createdBy: 'rules' | 'ai' | 'user' | 'restore'
    model?: string
    changeSummary: Record<string, number | boolean>
    qualityIssueCount: number
    note: string
    restoredFromVersionId?: string
    createdAt: string
  }>
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

type DesktopZoteroMetadataRecord = {
  itemKey: string
  libraryId?: string
  version?: string | number
  localItemId?: string
  rawRecordId?: string
  rawRecordIdField?: string
  importFormat?: 'ris' | 'bibtex' | 'endnote-xml'
  collections?: string[]
  attachmentKeys?: string[]
}

type DesktopZoteroSyncPlanEntry = DesktopZoteroMetadataRecord & {
  localItemId?: string
  fingerprint: string
  reason?: 'duplicate-external-key' | 'local-item-not-found' | 'external-key-already-bound'
}

type DesktopZoteroSyncPlan = {
  adapter: 'zotero-export-metadata-v1'
  sourceFingerprint: string
  writesZoteroDatabase: false
  counts: { added: number; updated: number; unchanged: number; unmatched: number; conflicts: number }
  added: DesktopZoteroSyncPlanEntry[]
  updated: DesktopZoteroSyncPlanEntry[]
  unchanged: DesktopZoteroSyncPlanEntry[]
  unmatched: DesktopZoteroSyncPlanEntry[]
  conflicts: DesktopZoteroSyncPlanEntry[]
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
  evidenceType: 'fragment' | 'review' | 'source' | 'bibliography' | 'milestone' | 'run'
  entityId: string
  sourceId?: string
  itemId?: string
  milestoneId?: string
  runId?: string
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
      evidenceType: 'fragment' | 'review' | 'source' | 'bibliography' | 'milestone' | 'run'
      entityId: string
      fragmentId?: string
      reviewBlockId?: string
      reviewDocumentId?: string
      sourceId?: string
      itemId?: string
      milestoneId?: string
      runId?: string
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
    writeClipboardText(input: { text: string }): Promise<{ written: true; characterCount: number }>
    listRecentWorkspaces(): Promise<WorkspaceSummary[]>
    getCurrentWorkspace(): Promise<WorkspaceSummary | undefined>
    createWorkspace(input: { name: string }): Promise<WorkspaceDialogResult>
    openWorkspace(): Promise<WorkspaceDialogResult>
    createWorkspaceInSelectedFolder(input: { creationRequestId: string; name: string; manageExistingPapers?: boolean }): Promise<WorkspaceDialogResult>
    switchWorkspace(input: { id: string }): Promise<WorkspaceSummary>
    loadWorkspaceLibrary(): Promise<WorkspaceLibraryState>
    getStructuredReading(input: { sourceId: string }): Promise<DesktopStructuredReadingState>
    generateStructuredReading(input: {
      sourceId: string
      createdBy?: 'rules' | 'ai'
      model?: string
      boundaries?: Array<{ beforeBlockId: string; section: string }>
    }): Promise<DesktopStructuredReadingState>
    saveStructuredReadingAdjustment(input: {
      sourceId: string
      baseVersionId: string
      orderedBlockIds: string[]
      headingLevels: Record<string, number>
      note?: string
    }): Promise<DesktopStructuredReadingState>
    restoreStructuredReadingVersion(input: { sourceId: string; versionId: string }): Promise<DesktopStructuredReadingState>
    getResearchResume(): Promise<DesktopResearchResumeState>
    beginResearchSession(): Promise<DesktopResearchResumeState>
    saveResearchResume(input: DesktopResearchResumeInput): Promise<DesktopResearchResumeState>
    listResearchTasks(input?: { status?: DesktopResearchTaskStatus }): Promise<DesktopResearchTaskList>
    createResearchTask(input: DesktopResearchTaskInput): Promise<{ task: DesktopResearchTask; alreadyExists: boolean }>
    updateResearchTask(input: {
      taskId: string
      status?: DesktopResearchTaskStatus
      decision?: 'confirm' | 'reject'
      waitCondition?: string
      deferredUntil?: string
      note?: string
    }): Promise<DesktopResearchTaskList>
    getResearchWorkspace(): Promise<DesktopResearchWorkspace>
    saveResearchWorkspace(input: DesktopResearchWorkspaceInput): Promise<DesktopResearchWorkspace>
    saveResearchProject(input: DesktopResearchWorkspaceInput): Promise<DesktopResearchWorkspace>
    saveResearchRecord(input: DesktopResearchRecordInput): Promise<DesktopResearchWorkspace>
    saveResearchMilestone(input: DesktopResearchMilestoneInput): Promise<DesktopResearchWorkspace>
    saveResearchRun(input: DesktopResearchRunInput): Promise<DesktopResearchWorkspace>
    saveResearchRunTemplate(input: DesktopResearchRunTemplateInput): Promise<DesktopResearchWorkspace>
    saveResearchArtifact(input: DesktopResearchArtifactInput): Promise<DesktopResearchWorkspace>
    selectResearchArtifactPath(input?: { kind?: 'file' | 'directory' }): Promise<{
      canceled: boolean
      filePath?: string
    }>
    listResearchReports(): Promise<DesktopResearchReport[]>
    getResearchReport(input: { id: string }): Promise<DesktopResearchReport>
    saveResearchReport(input: DesktopResearchReportInput): Promise<DesktopResearchReport>
    confirmResearchReport(input: { id: string; projectId?: string }): Promise<DesktopResearchReport>
    exportResearchReport(input: {
      id: string
      destination?: 'exports' | 'save_as'
    }): Promise<{
      canceled?: boolean
      reportId?: string
      filePath?: string
      fileSha256?: string
      format?: 'markdown'
      exportedAt?: string
    }>
    getZoteroSyncCapabilities(): Promise<{
      adapter: 'zotero-export-metadata-v1'
      imports: Array<'ris' | 'bibtex' | 'endnote-xml'>
      metadata: string[]
      writesZoteroDatabase: false
      supports: string[]
      intentionallyUnsupported: string[]
    }>
    previewZoteroMetadataSync(input: { records: DesktopZoteroMetadataRecord[] }): Promise<DesktopZoteroSyncPlan>
    applyZoteroMetadataSync(input: { records: DesktopZoteroMetadataRecord[] }): Promise<DesktopZoteroSyncPlan & { runId: string; appliedAt: string }>
    exportPortableMarkdown(input: {
      kind: 'reading_card' | 'review_document' | 'experiment_retrospective' | 'research_report'
      id: string
    }): Promise<{
      canceled?: boolean
      kind?: string
      entityId?: string
      filePath?: string
      fileName?: string
      fileSha256?: string
      exportedAt?: string
      sourceOfTruth?: 'sqlite'
      direction?: 'one-way-snapshot'
      overwritten?: boolean
    }>
    listResearchClaims(input?: { includeArchived?: boolean }): Promise<DesktopResearchClaim[]>
    saveResearchClaim(input: DesktopResearchClaimInput): Promise<DesktopResearchClaim>
    archiveResearchClaim(input: { id: string; projectId?: string }): Promise<{
      id: string
      archivedAt: string
      alreadyArchived: boolean
    }>
    getReadingTranslationSegments(input: {
      sourceId: string
      segments: Array<{ segmentId: string; sourceHash: string }>
    }): Promise<{
      sourceId: string
      segments: DesktopReadingTranslationSegment[]
      misses: Array<{ segmentId: string; sourceHash: string }>
    }>
    saveReadingTranslationSegment(input: {
      sourceId: string
      segmentId: string
      sourceHash: string
      baseSourceHash?: string
      sourceText: string
      translatedText?: string
      sourceLanguage?: string
      targetLanguage?: string
      provider: string
      model?: string
      status: 'pending' | 'translated' | 'failed'
      error?: string
      attempts?: number
      locked?: boolean
      unlock?: boolean
    }): Promise<DesktopReadingTranslationSegment>
    listReadingTranslationTerms(input: { sourceId: string }): Promise<DesktopReadingTranslationTerm[]>
    saveReadingTranslationTerm(input: { sourceId: string; sourceTerm: string; targetTerm: string; note?: string }): Promise<DesktopReadingTranslationTerm[]>
    deleteReadingTranslationTerm(input: { sourceId: string; termId: string }): Promise<DesktopReadingTranslationTerm[]>
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
    confirmReviewDocument(input: { documentId: string }): Promise<ReviewDocumentView>
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
        itemIds: string[]
      }
    }>
  }
}
