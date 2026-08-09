import type { DomainId, EntityTimestamps, HumanReviewState } from '../shared'

export type ResearchProfile = EntityTimestamps & {
  id: DomainId
  name: string
  researchDirections: string[]
  preferredTerms: string[]
  workingPreferences: Record<string, string | number | boolean>
}

export type ResearchIdea = EntityTimestamps & {
  id: DomainId
  title: string
  content: string
  evidenceIds: DomainId[]
  experimentIds: DomainId[]
  reviewState: HumanReviewState
}
