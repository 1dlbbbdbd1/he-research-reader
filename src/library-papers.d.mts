export type PaperLibraryItem = {
  id: string
  sourceId?: string
  annotationCount?: number
  readingState?: {
    readingStatus?: string
    relevance?: string
    lastPage?: number
    totalPages?: number
  }
}

export type PaperLibrarySource = {
  id: string
  bibliographicItemId?: string
}

export type PaperLibraryAnnotation = {
  sourceId?: string
  bibliographicItemId?: string
}

export type PaperLibraryRow<
  TItem extends PaperLibraryItem = PaperLibraryItem,
  TSource extends PaperLibrarySource = PaperLibrarySource,
> = {
  item: TItem
  source?: TSource
  annotationCount: number
}

export function buildPaperLibraryRows<
  TItem extends PaperLibraryItem,
  TSource extends PaperLibrarySource,
>(
  items: TItem[],
  sources: TSource[],
  annotations: PaperLibraryAnnotation[],
): Array<PaperLibraryRow<TItem, TSource>>

export function unboundLibrarySources<TSource extends PaperLibrarySource>(
  items: PaperLibraryItem[],
  sources: TSource[],
): TSource[]

export function paperLibrarySummary(rows: PaperLibraryRow[]): {
  total: number
  unread: number
  inProgress: number
  finished: number
  mismatched: number
  annotationTotal: number
}

export function readingProgressPercent(readingState?: PaperLibraryItem['readingState']): number
