export const READING_CARD_SECTIONS: Array<{ key: string; title: string }>

export type PaperReadingCardContext = {
  contextId: string
  origin: string
  label: string
  pageNumber?: number
  content: string
}

export function buildPaperReadingCardRequest(input: {
  paper: {
    title: string
    authors?: unknown[]
    issued?: string
    containerTitle?: string
  }
  contexts: PaperReadingCardContext[]
}): {
  contexts: Array<{
    contextId: string
    origin: string
    label: string
    pageNumber: number | null
    content: string
  }>
  system: string
  user: string
}

export function parsePaperReadingCardAnswer(
  content: string,
  contexts: Array<{ contextId: string; origin: string }>,
): Array<{ key: string; title: string; content: string; citationIds: string[] }>
