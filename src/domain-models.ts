export type ISODateTime = string

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
  containerTitle?: string
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
