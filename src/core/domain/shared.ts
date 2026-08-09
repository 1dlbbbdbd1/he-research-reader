export type DomainId = string
export type ISODateTime = string

export type EntityTimestamps = {
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type SourceAnchor = {
  sourceId: DomainId
  sourceHash?: string
  pageNumber?: number
  figureLabel?: string
  tableLabel?: string
  algorithmLabel?: string
  quote: string
  prefix?: string
  suffix?: string
  boundingBoxes?: Array<{ x: number; y: number; width: number; height: number }>
}

export type HumanReviewState = 'draft' | 'confirmed' | 'rejected' | 'superseded'
export type KnowledgeOrigin = 'source' | 'human' | 'ai-suggestion' | 'import'
