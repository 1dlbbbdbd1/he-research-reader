export type MarkdownBlockTarget = {
  state: 'resolved' | 'unresolved'
  markdownBlockId?: string
  pageNumber?: number
  reason?: 'empty-quote' | 'ambiguous' | 'not-found'
  matchCount?: number
  rects?: Array<{ x: number; y: number; width: number; height: number }>
}

export function normalizedAnchorText(value?: string): string
export type MineruLayoutBlock = {
  id: string
  type: string
  text: string
  pageNumber: number
  bbox?: [number, number, number, number]
}
export function markdownReadingBlocks(markdown?: string, mineruLayoutBlocks?: MineruLayoutBlock[]): {
  fingerprint: string
  blocks: Array<{
    id: string
    content: string
    pageNumber?: number
    rects?: Array<{ x: number; y: number; width: number; height: number }>
  }>
}
export function locateQuoteInMarkdown(markdown?: string, quote?: string, mineruLayoutBlocks?: MineruLayoutBlock[]): MarkdownBlockTarget
export function markdownSelectionAnchor(markdown?: string, markdownBlockId?: string, quote?: string, mineruLayoutBlocks?: MineruLayoutBlock[]): {
  type: 'markdown'
  state: 'resolved' | 'unresolved'
  markdownBlockId?: string
  pageNumber?: number
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  quote: { exact: string }
}
