export type ReviewSelectableSource = { id: string; bibliographicItemId?: string }
export type ReviewSelectableItem = {
  id: string
  sourceId?: string
  readingState?: {
    readingStatus?: string
    lastPage?: number
    totalPages?: number
  }
}
export type ReviewSelectableAnnotation = { id: string; sourceId?: string }

export function reviewItemIdBySourceId(
  sources: ReviewSelectableSource[],
  items: ReviewSelectableItem[],
): Map<string, string>
export function reviewAnnotationsForItems<T extends ReviewSelectableAnnotation>(
  annotations: T[],
  sources: ReviewSelectableSource[],
  items: ReviewSelectableItem[],
  selectedItemIds: string[],
): T[]
export function reviewAnnotationCounts(
  annotations: ReviewSelectableAnnotation[],
  sources: ReviewSelectableSource[],
  items: ReviewSelectableItem[],
): Map<string, number>
export function readingProgressLabel(readingState?: ReviewSelectableItem['readingState']): string
