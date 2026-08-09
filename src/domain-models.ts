export type ISODateTime = string

export type ResearchRecordType = 'log' | 'experiment' | 'dataset' | 'decision' | 'milestone'

export type ResearchRecordStatus = 'planned' | 'active' | 'completed' | 'blocked' | 'archived'

export type ResearchProjectMode = 'exploration' | 'execution'

export type ResearchRunOutcome = 'planned' | 'running' | 'success' | 'failure' | 'invalid' | 'interrupted'

export type ResearchArtifactRole =
  | 'raw_data'
  | 'processed_data'
  | 'figure'
  | 'log'
  | 'script'
  | 'config'
  | 'model'
  | 'video'
  | 'image'
  | 'document'
  | 'directory'
  | 'other'

export type ResearchProject = {
  id: string
  name: string
  researchQuestion: string
  currentHypothesis: string
  stage: string
  mode: ResearchProjectMode
  updatedAt: ISODateTime
}

export type ResearchRecord = {
  id: string
  recordType: ResearchRecordType
  title: string
  content: string
  status: ResearchRecordStatus
  occurredAt: ISODateTime
  filePath?: string
  sourceIds: string[]
  tags: string[]
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ResearchWorkspace = {
  project: ResearchProject
  records: ResearchRecord[]
  milestones: ResearchMilestone[]
  runs: ResearchRun[]
  artifacts: ResearchArtifact[]
  runTemplates: ResearchRunTemplate[]
  reports: ResearchReport[]
  claims: ResearchClaim[]
  history: ResearchProjectHistoryEntry[]
}

export type ResearchEvidenceRefType = 'bibliography' | 'source' | 'run' | 'artifact' | 'milestone'

export type ResearchEvidenceRef = {
  type: ResearchEvidenceRefType
  id: string
  label?: string
}

export type ResearchReportType = 'weekly' | 'meeting' | 'stage_review'

export type ResearchReportStatus = 'draft' | 'confirmed'

export type ResearchReportRevision = {
  id: string
  revisionNumber: number
  snapshot: {
    title: string
    type: ResearchReportType
    period: string
    markdown: string
    sourceRefs: ResearchEvidenceRef[]
    status: ResearchReportStatus
    confirmedAt?: ISODateTime
    updatedAt: ISODateTime
  }
  createdAt: ISODateTime
}

export type ResearchReport = {
  id: string
  title: string
  type: ResearchReportType
  period: string
  markdown: string
  sourceRefs: ResearchEvidenceRef[]
  status: ResearchReportStatus
  revisionNumber: number
  revisions: ResearchReportRevision[]
  createdAt: ISODateTime
  updatedAt: ISODateTime
  confirmedAt?: ISODateTime
}

export type ResearchClaimStatus = 'draft' | 'confirmed'

export type ResearchClaimRevision = {
  id: string
  revisionNumber: number
  snapshot: {
    section: string
    text: string
    status: ResearchClaimStatus
    requiredEvidence: string[]
    evidenceRefs: ResearchEvidenceRef[]
    confirmedAt?: ISODateTime
    archivedAt?: ISODateTime
    updatedAt: ISODateTime
  }
  createdAt: ISODateTime
}

export type ResearchClaim = {
  id: string
  section: string
  text: string
  status: ResearchClaimStatus
  requiredEvidence: string[]
  evidenceRefs: ResearchEvidenceRef[]
  revisionNumber: number
  revisions: ResearchClaimRevision[]
  createdAt: ISODateTime
  updatedAt: ISODateTime
  confirmedAt?: ISODateTime
  archivedAt?: ISODateTime
}

export type ResearchMilestone = {
  id: string
  title: string
  description: string
  status: ResearchRecordStatus
  acceptanceCriteria: string[]
  dueAt?: ISODateTime
  completedAt?: ISODateTime
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ResearchVariableChange = {
  name: string
  previousValue?: string
  currentValue: string
  unit?: string
}

export type ResearchRunTemplateDefaults = {
  purpose?: string
  hypothesis?: string
  changedVariables?: ResearchVariableChange[]
  command?: string
  environment?: string
  procedure?: string
  observations?: string
  anomaly?: string
  nextStep?: string
}

export type ResearchRunTemplate = {
  id: string
  projectId?: string
  name: string
  category: string
  description: string
  defaults: ResearchRunTemplateDefaults
  builtIn: boolean
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ResearchRun = {
  id: string
  milestoneId?: string
  templateId?: string
  title: string
  purpose: string
  hypothesis: string
  changedVariables: ResearchVariableChange[]
  command: string
  environment: string
  procedure: string
  outcome: ResearchRunOutcome
  observations: string
  anomaly: string
  nextStep: string
  sourceIds: string[]
  startedAt: ISODateTime
  endedAt?: ISODateTime
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ResearchArtifact = {
  id: string
  runId: string
  label: string
  role: ResearchArtifactRole
  filePath: string
  resolvedPath: string
  kind: 'file' | 'directory'
  existsState: 'found' | 'missing' | 'denied'
  sizeBytes?: number
  modifiedAt?: ISODateTime
  contentSha256?: string
  metadata: Record<string, unknown>
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ResearchProjectHistoryEntry = {
  id: string
  changedFields: string[]
  snapshot: Pick<ResearchProject, 'name' | 'researchQuestion' | 'currentHypothesis' | 'stage' | 'mode'>
  createdAt: ISODateTime
  createdBy: 'user' | 'ai' | 'system'
}

export type ReadingTranslationSegment = {
  sourceId: string
  segmentId: string
  sourceHash: string
  sourceText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  provider: string
  model?: string
  status: 'pending' | 'translated' | 'failed'
  error?: string
  attempts: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type PersonName = {
  family?: string
  given?: string
  literal?: string
}

export type FragmentAnchor = {
  type: 'pdf' | 'markdown' | 'text' | 'legacy'
  state: 'resolved' | 'unresolved'
  pageNumber?: number
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  quote?: { exact: string; prefix?: string; suffix?: string }
  markdownBlockId?: string
  sourceContentSha256?: string
  legacyLocatorText?: string
}

export type BibliographicItem = {
  id: string
  projectId: string
  itemType: string
  title: string
  authors: PersonName[]
  issued?: string
  accessed?: string
  containerTitle?: string
  publisher?: string
  publisherPlace?: string
  volume?: string
  issue?: string
  pages?: string
  abstract?: string
  language?: string
  keywords: string[]
  identifiers: Record<string, string[]>
  needsMetadataReview: boolean
  importProvenance: {
    format: 'endnote-xml' | 'ris' | 'bibtex' | 'legacy' | 'manual'
    importBatchId: string
    sourceFileName?: string
    sourceFileSha256?: string
    recordOrdinal: number
    rawRecordId?: string
    rawRecordIdField?: string
    rawPayload: string
    rawFields: Record<string, string[]>
    parserName: string
    parserVersion: string
    importedAt: ISODateTime
  }
  createdAt: ISODateTime
  updatedAt: ISODateTime
  archivedAt?: ISODateTime
}

export type NoteFragment = {
  id: string
  projectId: string
  bibliographicItemId?: string
  sourceId?: string
  annotationId?: string
  origin: 'source_evidence' | 'user' | 'ai'
  kind: 'quote' | 'note' | 'translation' | 'question' | 'answer' | 'summary' | 'figure_caption'
  content: string
  contentSha256: string
  language?: string
  purposeTags: string[]
  anchor: FragmentAnchor
  aiProvenance?: {
    providerId: string
    model: string
    promptHash: string
    runId: string
    inputFragmentIds: string[]
    generatedAt: ISODateTime
  }
  supersedesId?: string
  createdAt: ISODateTime
  createdBy: 'user' | 'ai' | 'system'
}

export type ReviewDocument = {
  id: string
  projectId: string
  title: string
  templateId?: string
  templateVersion?: string
  status: 'draft' | 'reviewed' | 'exported'
  selectedItemIds: string[]
  selectedFragmentIds: string[]
  generationRunId?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type ReviewBlock = {
  id: string
  documentId: string
  position: number
  blockType: 'heading' | 'source_evidence' | 'user_note' | 'ai_organization'
  content: string
  contentSha256: string
  sourceFragmentId?: string
  unsupported?: boolean
}

export type ReviewCitation = {
  id: string
  blockId: string
  itemId: string
  sourceId: string
  fragmentId?: string
  pageNumber?: number
  anchor?: FragmentAnchor
  quotedTextSha256?: string
  label: string
}
