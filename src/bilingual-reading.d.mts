export type BilingualSegmentKind = 'whitespace' | 'heading' | 'paragraph' | 'list' | 'table' | 'math' | 'code' | 'image' | 'structure'
export type BilingualTranslationStatus = 'pending' | 'translating' | 'translated' | 'failed' | 'skipped'

export type BilingualSegment = {
  id: string
  contentHash: string
  sourceIndex: number
  kind: BilingualSegmentKind
  source: string
  translationSource: string
  translationSourceHash: string
  translatable: boolean
  status: BilingualTranslationStatus
  translation: string
  attempts: number
  error?: string
  locked: boolean
  provider?: string
  model?: string
}

export type BilingualReadingDocument = {
  version: 1
  sourceFingerprint: string
  sourceMarkdown: string
  segments: BilingualSegment[]
}

export const BILINGUAL_READING_DEFAULTS: Readonly<{
  maxSegmentCharacters: number
  batchSize: number
  batchCharacters: number
}>

export function bilingualContentHash(content?: string): string
export function bilingualDocumentFingerprint(markdown?: string): string
export function smartMergeTranslationProse(content?: string): string
export function prepareTranslationSelection(text?: string, startPageNumber?: number, endPageNumber?: number): {
  originalText: string
  mergedText: string
  startPageNumber?: number
  endPageNumber?: number
  crossesPages: boolean
  characterCount: number
}
export function segmentBilingualMarkdown(markdown?: string, options?: {
  maxSegmentCharacters?: number
  cachedSegments?: Partial<BilingualSegment>[]
}): BilingualSegment[]
export function createBilingualReadingDocument(markdown?: string, options?: {
  maxSegmentCharacters?: number
  cachedSegments?: Partial<BilingualSegment>[]
}): BilingualReadingDocument
export function updateBilingualSegment(segments: BilingualSegment[], segmentId: string, patch?: {
  status?: BilingualTranslationStatus
  translation?: string
  error?: string
  attempts?: number
  incrementAttempts?: boolean
  translationSource?: string
  locked?: boolean
  unlock?: boolean
  provider?: string
  model?: string
}): BilingualSegment[]
export function selectBilingualTranslationBatch(segments: BilingualSegment[], options?: {
  limit?: number
  maxCharacters?: number
  maxAttempts?: number
  retryFailed?: boolean
}): BilingualSegment[]
export function markBilingualBatchTranslating(segments: BilingualSegment[], batch: BilingualSegment[]): BilingualSegment[]
export function retryFailedBilingualSegments(segments: BilingualSegment[], options?: { maxAttempts?: number }): BilingualSegment[]
export function buildBilingualReadingPairs(segments: BilingualSegment[]): Array<{
  segmentId: string
  contentHash: string
  kind: BilingualSegmentKind
  sourceMarkdown: string
  translationSource: string
  sourceWasAdjusted: boolean
  translatedMarkdown: string
  status: BilingualTranslationStatus
  translatable: boolean
  error?: string
  locked: boolean
  provider?: string
  model?: string
}>
export function reconstructBilingualSource(segments: BilingualSegment[]): string
