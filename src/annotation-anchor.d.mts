export type AnchoredAnnotation = {
  id: string
  page?: string
  anchor?: {
    type?: string
    state?: string
    pageNumber?: number
    rects?: Array<{ x: number; y: number; width: number; height: number }>
  }
}

export function annotationPage(annotation: AnchoredAnnotation): number | undefined
export function normalizedAnnotationRects(annotation: AnchoredAnnotation): Array<{ x: number; y: number; width: number; height: number }>
export function annotationHighlightsForPage(annotations: AnchoredAnnotation[], pageNumber: number): Array<{
  id: string
  rects: Array<{ x: number; y: number; width: number; height: number }>
}>
