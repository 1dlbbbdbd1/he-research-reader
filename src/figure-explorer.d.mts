import type { MineruLayoutBlock } from './markdown-anchor.mjs'

export type FigureExplorerItem = {
  id: string
  kind: 'figure' | 'table' | 'algorithm'
  label: string
  caption: string
  assetPath?: string
  preview?: string
  pageNumber?: number
  markdownLine: number
}

export function extractFigureExplorerItems(markdown?: string, layoutBlocks?: MineruLayoutBlock[]): FigureExplorerItem[]
