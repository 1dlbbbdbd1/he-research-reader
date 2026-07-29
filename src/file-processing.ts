import JSZip from 'jszip'
import mammoth from 'mammoth/mammoth.browser'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type ImportedKind = 'PDF' | 'Word' | 'PPT' | '表格' | 'Markdown'

export function kindOf(name: string): ImportedKind {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (ext === 'doc' || ext === 'docx') return 'Word'
  if (ext === 'ppt' || ext === 'pptx') return 'PPT'
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return '表格'
  return 'Markdown'
}

export async function fileHash(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function parseFile(file: File, kind: ImportedKind) {
  if (kind === 'Markdown') return file.text()
  if (kind === 'Word') return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.trim()
  if (kind === '表格') return parseSpreadsheet(file)
  if (kind === 'PPT') return parsePresentation(file)
  return parsePdfText(file)
}

export async function pdfPageCount(file: Blob) {
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages = document.numPages
  return pages
}

export type LocalPdfDocument = pdfjs.PDFDocumentProxy

export async function loadPdfDocument(file: Blob) {
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

export async function renderPdfPage(file: Blob, canvas: HTMLCanvasElement, pageNumber: number, scale = 1.3) {
  const document = await loadPdfDocument(file)
  const page = await document.getPage(Math.max(1, Math.min(pageNumber, document.numPages)))
  const viewport = page.getViewport({ scale })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器未提供 Canvas 画布。')
  await page.render({ canvas, canvasContext: context, viewport }).promise
  return { pages: document.numPages, width: viewport.width, height: viewport.height }
}

export async function renderPdfPageWithTextLayer(
  document: LocalPdfDocument,
  canvas: HTMLCanvasElement,
  textLayerContainer: HTMLDivElement,
  pageNumber: number,
  scale = 1.25,
) {
  const page = await document.getPage(Math.max(1, Math.min(pageNumber, document.numPages)))
  const viewport = page.getViewport({ scale })
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.ceil(viewport.width * pixelRatio)
  canvas.height = Math.ceil(viewport.height * pixelRatio)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器未提供 Canvas 画布。')
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
  }).promise

  textLayerContainer.replaceChildren()
  textLayerContainer.style.setProperty('--total-scale-factor', String(scale))
  textLayerContainer.style.setProperty('--scale-round-x', '1px')
  textLayerContainer.style.setProperty('--scale-round-y', '1px')
  const textLayer = new pdfjs.TextLayer({
    textContentSource: await page.getTextContent(),
    container: textLayerContainer,
    viewport,
  })
  await textLayer.render()
  return { width: viewport.width, height: viewport.height }
}

async function parsePdfText(file: File) {
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const limit = Math.min(document.numPages, 30)
  const text: string[] = []
  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    text.push(`\n# Page ${pageNumber}\n${content.items.map(item => 'str' in item ? item.str : '').join(' ')}`)
  }
  const suffix = document.numPages > limit ? `\n\n[仅提取前 ${limit} 页用于本地索引]` : ''
  return `${text.join('')} ${suffix}`.trim()
}

async function parsePresentation(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const paths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
  const slides = await Promise.all(paths.map(async (path, index) => {
    const xml = await zip.file(path)?.async('text')
    const words = [...(xml ?? '').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1])).join(' ')
    return `# Slide ${index + 1}\n${words}`
  }))
  return slides.join('\n\n').trim()
}

async function parseSpreadsheet(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') return `# Sheet 1\n${await file.text()}`.trim()
  if (extension === 'xls') throw new Error('旧式 .xls 暂不支持，请先另存为 .xlsx 或 .csv。')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml')?.async('text')
  const sharedStrings = [...(sharedStringsXml ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(text => decodeXml(text[1])).join(''))
  const paths = Object.keys(zip.files).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort()
  const sheets = await Promise.all(paths.map(async (path, index) => {
    const xml = await zip.file(path)?.async('text') ?? ''
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map(cell => readXlsxCell(cell[1], cell[2], sharedStrings)).join('\t'))
    return `# Sheet ${index + 1}\n${rows.join('\n')}`
  }))
  return sheets.join('\n\n').trim() || '未从该表格提取到单元格文本。'
}

function readXlsxCell(attributes: string, inner: string, sharedStrings: string[]) {
  const type = /\bt="([^"]+)"/.exec(attributes)?.[1]
  const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ''
  return type === 's' ? sharedStrings[Number(raw)] ?? '' : decodeXml(raw)
}

function decodeXml(value: string) {
  const holder = document.createElement('textarea')
  holder.innerHTML = value
  return holder.value
}
