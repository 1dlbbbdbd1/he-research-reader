export type SearchableSource = {
  id: string
  name: string
  extractedText?: string
  mineruMarkdown?: string
}

export type SearchableAnnotation = {
  id: string
  sourceId?: string
  text: string
  note: string
  category: string
  page: string
}

export type LocalSearchResult = {
  id: string
  sourceId: string
  sourceName: string
  origin: 'title' | 'document' | 'mineru' | 'annotation'
  originLabel: '标题' | '解析正文' | 'MinerU Markdown' | '用户批注'
  excerpt: string
  location?: string
  pageNumber?: number
  score: number
}

export function normalizeSearchText(value: string): string
export function searchTerms(query: string): string[]
export function excerptAroundMatch(value: string, terms: string[], radius?: number): string
export function pageNumberFromLocation(location?: string): number | undefined
export function searchLocalLibrary(
  sources: SearchableSource[],
  annotations: SearchableAnnotation[],
  query: string,
  maximumResults?: number,
): LocalSearchResult[]
