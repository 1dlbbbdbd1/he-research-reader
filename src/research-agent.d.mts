export type AgentSearchResult = {
  id: string
  kind?: 'paper' | 'source' | 'fragment' | 'review'
  entityId?: string
  origin: string
  originLabel?: string
  title: string
  subtitle?: string
  excerpt: string
  sourceId?: string
  itemId?: string
  pageNumber?: number
  anchor?: unknown
}

export function agentQueryTerms(question: string): string[]
export function agentRetrievalQuestion(question: string, priorQuestions?: string[]): string
export function readerContextEvidence<T = AgentSearchResult>(readerContext: {
  sourceId: string
  sourceName?: string
  itemId?: string
  paperTitle?: string
  pageNumber?: number
  pageText?: string
  selection?: { text: string; anchor?: unknown }
} | undefined, scope: 'selection' | 'page' | 'current' | 'selected' | 'library'): T[]
export function mergeAgentSearchResponses<T extends AgentSearchResult>(
  responses: Array<{ results?: T[] }>,
  terms: string[],
  limit?: number,
): Array<T & { score: number }>
export function buildResearchAgentRequest(input: {
  question: string
  evidence: AgentSearchResult[]
  scopeLabel: string
  readerContext?: Record<string, unknown>
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}): {
  contexts: Array<{
    evidenceId: string
    title: string
    subtitle: string
    origin: string
    pageNumber: number | null
    excerpt: string
  }>
  system: string
  user: string
}
export function parseResearchAgentAnswer(
  content: string,
  contexts: Array<{ evidenceId: string }>,
): Array<{ content: string; citationIds: string[] }>
export function parseResearchAgentActions(
  content: string,
  contexts: Array<{ evidenceId: string }>,
): Array<{
  actionType: 'read' | 'compare' | 'verify' | 'experiment' | 'review' | 'note'
  title: string
  rationale: string
  citationIds: string[]
}>
