import type { DomainId, EntityTimestamps, HumanReviewState, KnowledgeOrigin } from '../shared'

export type KnowledgeNodeType = 'paper' | 'author' | 'concept' | 'method' | 'experiment' | 'dataset' | 'code' | 'idea' | 'claim' | 'evidence'
export type KnowledgeEdgeType = 'authored_by' | 'mentions' | 'proposes' | 'uses' | 'validated_by' | 'derived_from' | 'supports' | 'contradicts' | 'related_to'

export type KnowledgeNode = EntityTimestamps & {
  id: DomainId
  type: KnowledgeNodeType
  entityId: DomainId
  label: string
  origin: KnowledgeOrigin
  reviewState: HumanReviewState
}

export type KnowledgeEdge = EntityTimestamps & {
  id: DomainId
  fromNodeId: DomainId
  toNodeId: DomainId
  type: KnowledgeEdgeType
  evidenceIds: DomainId[]
  origin: KnowledgeOrigin
  reviewState: HumanReviewState
}
