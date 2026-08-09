import type { DomainId, EntityTimestamps, HumanReviewState, KnowledgeOrigin, SourceAnchor } from '../shared'

export type EvidenceCard = EntityTimestamps & {
  id: DomainId
  paperId?: DomainId
  anchor: SourceAnchor
  original: string
  understanding: string
  tags: string[]
  relatedExperimentIds: DomainId[]
  origin: KnowledgeOrigin
  reviewState: HumanReviewState
}

export type Claim = EntityTimestamps & {
  id: DomainId
  statement: string
  evidenceIds: DomainId[]
  status: 'fact' | 'inference' | 'hypothesis'
  reviewState: HumanReviewState
}
