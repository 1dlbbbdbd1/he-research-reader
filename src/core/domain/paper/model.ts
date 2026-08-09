import type { DomainId, EntityTimestamps } from '../shared'

export type Paper = EntityTimestamps & {
  id: DomainId
  title: string
  authorIds: DomainId[]
  year?: number
  doi?: string
  abstract?: string
  keywords: string[]
  sourceIds: DomainId[]
  readingStatus: 'unread' | 'title_only' | 'skimming' | 'reading' | 'finished'
}

export type Author = EntityTimestamps & {
  id: DomainId
  displayName: string
  orcid?: string
}
