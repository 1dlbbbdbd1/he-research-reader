export function buildReviewAIRequest(fragments: Array<Record<string, unknown>>): {
  system: string
  user: string
}

export function parseReviewAISections(text: string, allowedFragmentIds: string[]): Array<{
  content: string
  citationFragmentIds: string[]
}>
