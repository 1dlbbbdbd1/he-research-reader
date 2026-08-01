export type AcademicBoundary = {
  beforeBlockId: string
  section: '摘要' | '关键词' | '引言' | '相关工作' | '方法' | '实验设置' | '结果' | '讨论' | '局限' | '结论' | '参考文献' | '附录' | '正文'
}

export type AcademicMarkdownLayout = {
  version: string
  mode: 'rules' | 'ai-classified'
  sourceFingerprint: string
  boundaries: AcademicBoundary[]
  generatedAt?: string
  model?: string
}

export const ACADEMIC_MARKDOWN_SKILL: {
  id: string
  version: string
  purpose: string
  inputLayer: string
  outputLayer: string
  invariants: readonly string[]
}

export function academicMarkdownFingerprint(markdown?: string): string
export function normalizeAcademicMarkdown(markdown?: string): string
export function splitAcademicMarkdownBlocks(markdown?: string): {
  fingerprint: string
  blocks: Array<{ id: string; content: string }>
}
export function buildAcademicMarkdown(markdown?: string, boundaries?: AcademicBoundary[]): string
export function buildAcademicMarkdownAIRequest(input: {
  markdown: string
  paper?: {
    title?: string
    authors?: unknown[]
    issued?: string
    abstract?: string
    keywords?: string[]
  }
}): { fingerprint: string; system: string; user: string }
export function parseAcademicMarkdownBoundaries(content: string, markdown: string): AcademicBoundary[]
export function validAcademicMarkdownLayout(layout: AcademicMarkdownLayout | undefined, markdown: string): boolean
