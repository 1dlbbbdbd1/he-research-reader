import type { DomainId, EntityTimestamps } from '../shared'

export type ResearchTaskStatus = 'inbox' | 'today' | 'waiting' | 'next' | 'completed' | 'dropped'
export type ResearchTaskLinkType = 'paper' | 'experiment' | 'idea' | 'report' | 'evidence' | 'source'

export type ResearchTask = EntityTimestamps & {
  id: DomainId
  title: string
  status: ResearchTaskStatus
  note: string
  dueAt?: string
  links: Array<{ type: ResearchTaskLinkType; id: DomainId }>
  sourceActionId?: DomainId
}
