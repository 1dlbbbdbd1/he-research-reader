import type { DomainId, EntityTimestamps } from '../shared'

export type CitationStyle = 'gb-t-7714-2015' | 'apa-7' | 'ieee'

export type CitationRecord = EntityTimestamps & {
  id: DomainId
  paperId?: DomainId
  type: string
  title: string
  authors: Array<{ family?: string; given?: string; literal?: string }>
  issued?: string
  containerTitle?: string
  publisher?: string
  volume?: string
  issue?: string
  pages?: string
  identifiers: Record<string, string[]>
  needsReview: boolean
}
