export type PdfSearchResult = {
  pageNumber: number
  matchCount: number
  excerpt: string
}

export type PdfOutlineEntry = {
  id: string
  title: string
  depth: number
  pageNumber?: number
}

export type ReaderSourceState = {
  viewMode: 'original' | 'markdown' | 'parallel'
  zoom: number
}

export function normalizedPdfSearchQuery(value: unknown): string
export function pdfPageSearchMatches(text: unknown, query: unknown, excerptRadius?: number): {
  count: number
  excerpt: string
}
export function searchPdfDocument(
  document: {
    numPages: number
    getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
  },
  query: string,
  options?: {
    limit?: number
    isCancelled?: () => boolean
    onProgress?: (progress: { pageNumber: number; totalPages: number; resultCount: number }) => void
  },
): Promise<PdfSearchResult[]>
export function loadPdfOutline(document: {
  getOutline(): Promise<Array<{ title?: string; dest?: unknown; items?: unknown[] }> | null>
  getDestination(destination: string): Promise<unknown[] | null>
  getPageIndex(reference: unknown): Promise<number>
}): Promise<PdfOutlineEntry[]>
export function normalizeReaderSourceState(value: unknown, hasStructuredText?: boolean): ReaderSourceState
export function restoredReaderPage(value: unknown, totalPages?: unknown): number
