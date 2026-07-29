import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, ClipboardCheck,
  Columns2, Expand, FileText, Languages,
  FilePlus2, Files, FlaskConical, Globe2, GraduationCap, Highlighter,
  LayoutDashboard, Menu, MessageSquareText, Minus, MoreHorizontal, PanelLeft,
  PanelRight, Plus, Search, Settings2, Sparkles, Upload, X
} from 'lucide-react'
import './styles.css'
import './functional.css'
import './library.css'
import './review.css'
import './reader.css'
import {
  fileHash,
  kindOf as detectedKind,
  loadPdfDocument,
  parseFile,
  pdfPageCount,
  renderPdfPageWithTextLayer,
  type ImportedKind,
  type LocalPdfDocument,
} from './file-processing'
import { getLocalFile, saveLocalFile } from './local-files'
import { searchLocalLibrary, searchTerms, type LocalSearchResult } from './local-search.mjs'
import { annotationHighlightsForPage, annotationPage } from './annotation-anchor.mjs'
import { buildReviewAIRequest, parseReviewAISections } from './review-ai.mjs'
import { clampReaderZoom, readerZoomAfterWheel } from './reader-zoom.mjs'
import { readingProgressLabel, reviewAnnotationCounts, reviewAnnotationsForItems } from './review-selection.mjs'

type SourceKind = ImportedKind
type EvidenceStatus = '事实' | '推断' | '假设'
type Source = { id: string; bibliographicItemId?: string; name: string; kind: SourceKind; version: number; updated: string; status: '已解析' | '待解析' | '需重新分析' | '解析失败'; pages?: number; fileId?: string; hash?: string; extractedText?: string; isDemo?: boolean; error?: string; mineruState?: '未使用' | '准备中' | '解析中' | '完成' | '失败'; mineruMarkdown?: string; mineruError?: string; mineruProgress?: string; mineruOutputDirectory?: string; mineruBackend?: 'pipeline' }
type Claim = { id: string; title: string; source: string; location: string; status: EvidenceStatus; strength: '强' | '中' | '待验证' }
type Annotation = { id: string; text: string; category: string; page: string; note: string; sourceId?: string; anchor?: FragmentAnchor }
type Action = { id: string; title: string; type: '阅读' | '实验' | '确认'; reason: string; done: boolean }
type AISettings = {
  baseUrl: string
  model: string
  apiKey: string
  allowFullDocument: boolean
  translationProvider: 'local' | 'ai'
}
type AnnotationDraft = { text?: string; location?: string; anchor?: FragmentAnchor }
type ReaderJumpTarget = { sourceId: string; pageNumber: number; anchor?: FragmentAnchor; nonce: string }
type LegacyWorkspaceSnapshot = { sources: Source[]; annotations: Annotation[] }
type FragmentAnchor = {
  type: 'pdf' | 'markdown' | 'text' | 'legacy'
  state: 'resolved' | 'unresolved'
  pageNumber?: number
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  quote?: { exact: string; prefix?: string; suffix?: string }
  legacyLocatorText?: string
}
type BibliographicSummary = {
  id: string
  title: string
  itemType: string
  authors: Array<{ family?: string; given?: string; literal?: string }>
  issued?: string
  containerTitle?: string
  abstract?: string
  keywords: string[]
  identifiers: Record<string, string[]>
  needsMetadataReview: boolean
  attachmentCount: number
  attachmentState: 'unknown' | 'found' | 'missing' | 'denied'
  sourceId?: string
  annotationCount: number
  readingState: PaperReadingState
}
type PaperReadingState = {
  readingStatus: 'unread' | 'title_only' | 'skimming' | 'reading' | 'finished'
  relevance: 'undecided' | 'core' | 'relevant' | 'supplemental' | 'mismatched'
  ideaState: 'undecided' | 'has_ideas' | 'no_new_ideas'
  questionState: 'undecided' | 'has_questions' | 'no_questions'
  purposeTags: string[]
  decisionNote: string
  lastPage?: number
  totalPages?: number
}
type ReadingStatePatch = Partial<PaperReadingState>
type ReviewDocumentSummary = {
  id: string
  title: string
  status: 'draft' | 'reviewed' | 'exported'
  createdAt: string
  updatedAt: string
  itemCount: number
  blockCount: number
}

const initialSources: Source[] = [
  { id: 's1', name: 'Adaptive impedance control for compliant assembly.pdf', kind: 'PDF', version: 1, updated: '示例资料', status: '已解析', pages: 14, isDemo: true },
  { id: 's2', name: '实验方案 v3.docx', kind: 'Word', version: 3, updated: '示例资料', status: '需重新分析', isDemo: true },
  { id: 's3', name: '传感器标定结果.xlsx', kind: '表格', version: 2, updated: '示例资料', status: '已解析', isDemo: true },
  { id: 's4', name: '组会汇报.pptx', kind: 'PPT', version: 1, updated: '示例资料', status: '已解析', isDemo: true },
]
const initialClaims: Claim[] = [
  { id: 'c1', title: '接触刚度变化会降低固定参数控制器的装配成功率', source: 'Adaptive impedance control', location: 'p. 3 · §2.1', status: '事实', strength: '强' },
  { id: 'c2', title: '在线辨识或可减少不同工件批次带来的参数失配', source: 'Adaptive impedance control', location: 'p. 7 · Fig. 5', status: '推断', strength: '中' },
  { id: 'c3', title: '利用力/位混合反馈可提升当前工位的鲁棒性', source: '你的研究假设', location: '待用实验验证', status: '假设', strength: '待验证' },
]
const initialActions: Action[] = [
  { id: 'a1', type: '阅读', title: '核对 3 篇文献是否在相同工况下比较', reason: '当前结论可能存在工况不一致', done: false },
  { id: 'a2', type: '实验', title: '设计刚度扰动的基线对照实验', reason: '验证“在线辨识”是否优于固定参数', done: false },
  { id: 'a3', type: '确认', title: '确认研究问题是否收敛为装配阶段的鲁棒控制', reason: 'Agent 建议：缩小范围以获得可测量的主指标', done: false },
]
const categories = ['可引用结论', '研究思路', '方法', '数据/证据', '局限', '术语', '待核实']
const purposeOptions = [
  '研究背景', '国内研究现状', '国外研究现状', '文献综述',
  '理论依据', '试验方法', '实验设计', '评价指标',
  '对比基线', '结果讨论', '研究局限', '未来工作', '复现实验',
]
const defaultAISettings: AISettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  allowFullDocument: false,
  translationProvider: 'local',
}

function pill(status: EvidenceStatus | Source['status'] | Claim['strength']) {
  const classes: Record<string, string> = { '事实': 'green', '强': 'green', '已解析': 'green', '推断': 'blue', '中': 'blue', '假设': 'amber', '待验证': 'amber', '待解析': 'gray', '需重新分析': 'red', '解析失败': 'red' }
  return classes[status] || 'gray'
}

function App() {
  const browserStorage = !window.readerDesktop
  const [sources, setSources] = useStored<Source[]>('ra.sources', initialSources, browserStorage)
  const [claims, setClaims] = useStored<Claim[]>('ra.claims', initialClaims, browserStorage)
  const [actions, setActions] = useStored<Action[]>('ra.actions', initialActions, browserStorage)
  const [annotations, setAnnotations] = useStored<Annotation[]>('ra.annotations', [], browserStorage)
  const [bibliographicItems, setBibliographicItems] = useState<BibliographicSummary[]>([])
  const [aiSettings, setAISettings] = useStored<AISettings>('ra.ai-settings', defaultAISettings, browserStorage)
  const [active, setActive] = useState<'dashboard' | 'sources' | 'reader'>(() => sources.some(source => source.fileId) ? 'reader' : 'sources')
  const [selectedSource, setSelectedSource] = useState(sources[0]?.id ?? '')
  const [agentOpen, setAgentOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mineruTarget, setMineruTarget] = useState<Source | undefined>()
  const [mineruInstalling, setMineruInstalling] = useState(false)
  const [mineruInstallProgress, setMineruInstallProgress] = useState('')
  const [readerJumpTarget, setReaderJumpTarget] = useState<ReaderJumpTarget>()
  const [librarySearchRequest, setLibrarySearchRequest] = useState(0)
  const [workspace, setWorkspace] = useState<WorkspaceSummary>()
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('我的研究库')
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceCreationRequest, setWorkspaceCreationRequest] = useState<{
    creationRequestId: string
    directory: string
    suggestedName: string
  }>()
  const [legacySnapshot] = useState<LegacyWorkspaceSnapshot>(() => ({
    sources,
    annotations,
  }))
  const [reviewDocuments, setReviewDocuments] = useState<ReviewDocumentSummary[]>([])
  const [activeReview, setActiveReview] = useState<ReviewDocumentView>()
  const [toast, setToast] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const selected = sources.find(s => s.id === selectedSource) ?? sources[0]
  const evidenceCounts = useMemo(() => ({ fact: claims.filter(c => c.status === '事实').length, infer: claims.filter(c => c.status === '推断').length, hypo: claims.filter(c => c.status === '假设').length }), [claims])
  const legacySourceCount = legacySnapshot.sources.filter(source => !source.isDemo).length

  useEffect(() => {
    const desktop = window.readerDesktop
    if (!desktop) return
    let disposed = false
    Promise.all([desktop.getCurrentWorkspace(), desktop.listRecentWorkspaces()])
      .then(async ([current, recent]) => {
        if (disposed) return
        setRecentWorkspaces(recent)
        if (!current) {
          setSources([])
          setAnnotations([])
          setSelectedSource('')
          setWorkspaceMenuOpen(true)
          setReviewDocuments([])
          setActiveReview(undefined)
          return
        }
        const library = await desktop.loadWorkspaceLibrary()
        const reviews = await desktop.listReviewDocuments()
        if (disposed) return
        setWorkspace(current)
        setSources(library.sources as Source[])
        setAnnotations(library.annotations as Annotation[])
        setBibliographicItems(library.bibliographicItems as BibliographicSummary[])
        setReviewDocuments(reviews)
        setSelectedSource((library.sources[0] as Source | undefined)?.id ?? '')
        if (!library.sources.length) setActive('sources')
      })
      .catch(error => notify(error instanceof Error ? error.message : '研究库初始化失败。'))
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const desktop = window.readerDesktop
    if (!desktop || !workspace) return
    const timer = window.setTimeout(() => {
      void desktop.syncWorkspaceLibrary({
        workspaceId: workspace.id,
        sources: sources as unknown as Array<Record<string, unknown>>,
        annotations: annotations as unknown as Array<Record<string, unknown>>,
      }).catch(error => notify(error instanceof Error ? error.message : '研究库保存失败。'))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [workspace?.id, sources, annotations])

  useEffect(() => {
    const desktop = window.readerDesktop
    if (!desktop) return
    return desktop.onDeepLink(deepLink => {
      void desktop.resolveDeepLink(deepLink)
        .then(target => openSource(
          target.sourceId,
          target.pageNumber,
          target.anchor as FragmentAnchor | undefined,
        ))
        .catch(error => notify(error instanceof Error ? error.message : '无法打开这条论文引用。'))
    })
  }, [])

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2800) }

  async function activateWorkspace(next: WorkspaceSummary) {
    const desktop = window.readerDesktop
    if (!desktop) return
    const library = await desktop.loadWorkspaceLibrary()
    const reviews = await desktop.listReviewDocuments()
    setWorkspace(next)
    setSources(library.sources as Source[])
    setAnnotations(library.annotations as Annotation[])
    setBibliographicItems(library.bibliographicItems as BibliographicSummary[])
    setReviewDocuments(reviews)
    setActiveReview(undefined)
    setSelectedSource((library.sources[0] as Source | undefined)?.id ?? '')
    setActive('sources')
    setRecentWorkspaces(await desktop.listRecentWorkspaces())
    setWorkspaceMenuOpen(false)
  }

  async function flushWorkspace() {
    const desktop = window.readerDesktop
    if (!desktop || !workspace) return
    await desktop.syncWorkspaceLibrary({
      workspaceId: workspace.id,
      sources: sources as unknown as Array<Record<string, unknown>>,
      annotations: annotations as unknown as Array<Record<string, unknown>>,
    })
  }

  async function createWorkspace() {
    const desktop = window.readerDesktop
    if (!desktop) { notify('研究库切换只在桌面客户端中可用。'); return }
    setWorkspaceBusy(true)
    try {
      await flushWorkspace()
      const result = await desktop.createWorkspace({ name: workspaceName })
      if (result.canceled || !result.vault) return
      await activateWorkspace(result.vault)
      notify(`已创建研究库“${result.vault.name}”。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '研究库创建失败。')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function openWorkspace() {
    const desktop = window.readerDesktop
    if (!desktop) { notify('研究库切换只在桌面客户端中可用。'); return }
    setWorkspaceBusy(true)
    try {
      await flushWorkspace()
      const result = await desktop.openWorkspace()
      if (result.canceled) return
      if (result.needsCreation && result.creationRequestId && result.directory) {
        setWorkspaceCreationRequest({
          creationRequestId: result.creationRequestId,
          directory: result.directory,
          suggestedName: result.suggestedName || '我的研究库',
        })
        setWorkspaceMenuOpen(false)
        return
      }
      if (!result.vault) return
      await activateWorkspace(result.vault)
      notify(`已打开研究库“${result.vault.name}”。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '研究库打开失败。')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function createWorkspaceInSelectedFolder(name: string) {
    const desktop = window.readerDesktop
    const request = workspaceCreationRequest
    if (!desktop || !request) return
    setWorkspaceBusy(true)
    try {
      const result = await desktop.createWorkspaceInSelectedFolder({
        creationRequestId: request.creationRequestId,
        name,
      })
      if (result.canceled || !result.vault) return
      setWorkspaceCreationRequest(undefined)
      await activateWorkspace(result.vault)
      notify(`已在所选文件夹创建研究库“${result.vault.name}”；原有文件没有被删除。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '研究库创建失败。')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function switchWorkspace(id: string) {
    const desktop = window.readerDesktop
    if (!desktop || id === workspace?.id) { setWorkspaceMenuOpen(false); return }
    setWorkspaceBusy(true)
    try {
      await flushWorkspace()
      const next = await desktop.switchWorkspace({ id })
      await activateWorkspace(next)
      notify(`已切换到“${next.name}”。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '研究库切换失败。')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function migrateLegacyWorkspace() {
    const desktop = window.readerDesktop
    if (!desktop || !workspace) return
    setWorkspaceBusy(true)
    try {
      for (const source of legacySnapshot.sources.filter(item => !item.isDemo && item.fileId)) {
        const file = await getLocalFile(source.fileId!)
        if (!file) continue
        await desktop.importWorkspaceSourceFile({
          id: source.id,
          fileName: file.name,
          kind: source.kind,
          version: source.version,
          contentSha256: source.hash || await fileHash(file),
          bytes: await file.arrayBuffer(),
        })
      }
      const result = await desktop.importLegacyWorkspaceData(legacySnapshot as unknown as {
        sources: Array<Record<string, unknown>>
        annotations: Array<Record<string, unknown>>
      })
      setSources(result.sources as Source[])
      setAnnotations(result.annotations as Annotation[])
      setBibliographicItems(result.bibliographicItems as BibliographicSummary[])
      setSelectedSource((result.sources[0] as Source | undefined)?.id ?? '')
      setWorkspaceMenuOpen(false)
      notify(result.alreadyImported ? '这份旧数据已经迁移过，没有重复写入。' : '旧资料与批注已复制到当前研究库；旧数据仍保留。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '旧数据迁移失败，研究库没有切换数据指针。')
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function importBibliography() {
    const desktop = window.readerDesktop
    if (!desktop || !workspace) {
      setWorkspaceMenuOpen(Boolean(desktop))
      notify(desktop ? '请先创建或打开研究库。' : '题录导入只在桌面客户端中可用。')
      return
    }
    try {
      await flushWorkspace()
      const response = await desktop.importBibliography()
      if (response.canceled || !response.result) return
      const library = await desktop.loadWorkspaceLibrary()
      setSources(library.sources as Source[])
      setAnnotations(library.annotations as Annotation[])
      setBibliographicItems(library.bibliographicItems as BibliographicSummary[])
      const result = response.result
      if (result.alreadyImported) {
        notify(`这份 ${result.format} 已导入过，没有重复建立记录。`)
      } else {
        notify(`已导入 ${result.itemCount} 条题录；${result.copiedSourceCount} 份 PDF 已进入当前研究库。`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '题录导入失败，数据库事务已回滚。')
    }
  }

  async function updatePaperReading(itemId: string, patch: ReadingStatePatch, quiet = false) {
    const desktop = window.readerDesktop
    if (!desktop) {
      setBibliographicItems(current => current.map(item => item.id === itemId
        ? { ...item, readingState: { ...item.readingState, ...patch } }
        : item))
      if (!quiet) notify('浏览器预览已临时更新；桌面客户端会把状态写入研究库。')
      return
    }
    try {
      const readingState = await desktop.updateReadingState({ itemId, ...patch })
      setBibliographicItems(current => current.map(item => item.id === itemId
        ? { ...item, readingState }
        : item))
      if (!quiet) notify('阅读结论和研究用途已保存。')
    } catch (error) {
      if (!quiet) notify(error instanceof Error ? error.message : '阅读状态保存失败。')
    }
  }

  async function generateReviewDocument(title: string, itemIds: string[], annotationIds: string[]) {
    const desktop = window.readerDesktop
    if (!desktop || !workspace) {
      notify('请先在桌面客户端中打开研究库。')
      return
    }
    if (!itemIds.length) {
      notify('至少选择一篇论文。')
      return
    }
    try {
      const inputs = await desktop.getReviewInputs({ itemIds, annotationIds })
      let aiSections: Array<{ content: string; citationFragmentIds: string[] }> = []
      let generationRunId: string | undefined
      let aiMessage = '未配置 AI，本次只按来源生成证据与用户笔记区块。'
      if (aiSettings.baseUrl && aiSettings.model && aiSettings.apiKey && inputs.fragments.length) {
        generationRunId = crypto.randomUUID()
        const request = buildReviewAIRequest(inputs.fragments as unknown as Array<Record<string, unknown>>)
        try {
          const response = await fetch(`${aiSettings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiSettings.apiKey}` },
            body: JSON.stringify({
              model: aiSettings.model,
              temperature: 0.1,
              messages: [
                { role: 'system', content: request.system },
                { role: 'user', content: request.user },
              ],
            }),
          })
          if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
          aiSections = parseReviewAISections(
            data.choices?.[0]?.message?.content || '',
            inputs.fragments.map(fragment => fragment.id),
          )
          aiMessage = `AI 生成 ${aiSections.length} 个有引用的整理区块。`
        } catch (error) {
          aiMessage = error instanceof Error
            ? `AI 整理未采用：${error.message}；证据和用户笔记仍已生成。`
            : 'AI 整理失败；证据和用户笔记仍已生成。'
          generationRunId = undefined
        }
      }
      const document = await desktop.createReviewDocument({
        title,
        itemIds,
        annotationIds,
        generationRunId,
        aiSections,
      })
      setActiveReview(document)
      setReviewDocuments(await desktop.listReviewDocuments())
      notify(`复查文档已生成。${aiMessage}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '复查文档生成失败。')
    }
  }

  async function openReviewDocument(documentId: string) {
    const desktop = window.readerDesktop
    if (!desktop) return
    try {
      setActiveReview(await desktop.getReviewDocument({ documentId }))
    } catch (error) {
      notify(error instanceof Error ? error.message : '复查文档读取失败。')
    }
  }

  async function exportReviewDocument(documentId: string, format: 'markdown' | 'docx') {
    const desktop = window.readerDesktop
    if (!desktop) return
    try {
      const result = await desktop.exportReviewDocument({ documentId, format })
      setReviewDocuments(await desktop.listReviewDocuments())
      await desktop.showReviewExport({ filePath: result.filePath })
      notify(`${format === 'docx' ? 'Word' : 'Markdown'} 已导出，并保留引用回跳信息。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '复查文档导出失败。')
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    if (window.readerDesktop && !workspace) {
      setWorkspaceMenuOpen(true)
      notify('请先创建或打开一个研究库，再导入论文。')
      return
    }
    const incoming = Array.from(files)
    notify(`正在本机保存并解析 ${incoming.length} 份资料…`)
    for (const file of incoming) {
      const id = crypto.randomUUID()
      const kind = detectedKind(file.name)
      const hash = await fileHash(file)
      const existing = sources.filter(source => source.name === file.name)
      if (existing.some(source => source.hash === hash)) { notify(`${file.name} 已存在，相同内容未重复导入。`); continue }
      const version = existing.length ? Math.max(...existing.map(source => source.version)) + 1 : 1
      const source: Source = { id, fileId: id, name: file.name, kind, version, hash, updated: '刚刚导入', status: '待解析' }
      try {
        if (window.readerDesktop) {
          await window.readerDesktop.importWorkspaceSourceFile({
            id,
            fileName: file.name,
            kind,
            version,
            contentSha256: hash,
            bytes: await file.arrayBuffer(),
          })
        }
        setSources(current => [source, ...current]); setSelectedSource(id)
        await saveLocalFile(id, file)
        const extractedText = await parseFile(file, kind)
        const pages = kind === 'PDF' ? await pdfPageCount(file) : undefined
        setSources(current => current.map(item => item.id === id ? { ...item, extractedText, pages, status: '已解析' } : item))
      } catch (error) {
        setSources(current => current.map(item => item.id === id ? { ...item, status: '解析失败', error: error instanceof Error ? error.message : '未知解析错误' } : item))
      }
    }
    notify(window.readerDesktop ? '资料已保存到当前研究库；未上传到云端。' : '资料已保存到当前浏览器的本地数据库；未上传到云端。')
  }
  function toggleAction(id: string) { setActions(current => current.map(a => a.id === id ? { ...a, done: !a.done } : a)) }
  function addAnnotation(category: string, note: string, text: string, location: string) {
    const an: Annotation = { id: crypto.randomUUID(), sourceId: selected?.id, text, category, page: location, note, anchor: annotationDraft?.anchor }
    setAnnotations(current => [an, ...current]); setAnnotationDraft(null); notify('批注已保存，并保留当前原文页码。')
  }
  function createActionPack() {
    setAgentOpen(false)
    setActions(current => [{ id: crypto.randomUUID(), type: '确认', title: '确认 Agent 本次整理的证据边界', reason: '本次分析仅依据已解析的本地资料，未将推断视为事实。', done: false }, ...current])
    notify('研究行动包已生成，等待你的确认后才会写入项目记录。')
  }
  async function reanalyze(id: string) {
    const target = sources.find(source => source.id === id)
    if (!target?.fileId || target.isDemo) { notify('示例资料没有原文件可重新分析；请导入你自己的文件。'); return }
    setSources(current => current.map(source => source.id === id ? { ...source, status: '待解析' } : source))
    try {
      const file = await getStoredSourceFile(target)
      if (!file) throw new Error('本地原文件已不可用。')
      const extractedText = await parseFile(file, target.kind)
      const pages = target.kind === 'PDF' ? await pdfPageCount(file) : undefined
      setSources(current => current.map(source => source.id === id ? { ...source, extractedText, pages, status: '已解析', error: undefined, updated: '刚刚重新分析' } : source))
      notify('重新分析完成；历史版本与已有结论未被覆盖。')
    } catch (error) { setSources(current => current.map(source => source.id === id ? { ...source, status: '解析失败', error: error instanceof Error ? error.message : '重新分析失败' } : source)); notify('解析失败，请保留原文件并稍后重试。') }
  }
  async function runMineru() {
    const target = mineruTarget
    setMineruTarget(undefined)
    if (!target?.fileId) return
    setSources(current => current.map(source => source.id === target.id ? { ...source, mineruState: '准备中', mineruError: undefined, mineruProgress: '正在检查本地 MinerU…' } : source))
    const desktop = window.readerDesktop
    if (!desktop) {
      const message = '本地 MinerU 只在桌面客户端中运行；浏览器开发预览不会获得本机解析权限。'
      setSources(current => current.map(source => source.id === target.id ? { ...source, mineruState: '失败', mineruError: message, mineruProgress: undefined } : source))
      notify(message)
      return
    }
    const taskId = crypto.randomUUID()
    const unsubscribe = desktop.onMineruProgress(progress => {
      if (progress.taskId !== taskId) return
      const lines = progress.text.trim().split(/\r?\n/).filter(Boolean)
      const latest = lines[lines.length - 1]
      if (!latest) return
      setSources(current => current.map(source => source.id === target.id ? {
        ...source,
        mineruState: '解析中',
        mineruProgress: latest.slice(0, 240),
      } : source))
    })
    try {
      const status = await desktop.getMineruStatus()
      if (!status.available) throw new Error(status.message)
      const file = await getStoredSourceFile(target)
      if (!file) throw new Error('本地原文件不可用。')
      const result = await desktop.parseWithMineru({
        taskId,
        fileName: file.name,
        bytes: await file.arrayBuffer(),
      })
      setSources(current => current.map(source => source.id === target.id ? {
        ...source,
        mineruState: '完成',
        mineruMarkdown: result.markdown,
        mineruOutputDirectory: result.outputDirectory,
        mineruBackend: result.backend,
        mineruProgress: undefined,
        updated: '本地 MinerU 刚完成解析',
      } : source))
      notify('本地 MinerU 解析完成；文件未上传到云端。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地 MinerU 解析失败。'
      setSources(current => current.map(source => source.id === target.id ? { ...source, mineruState: '失败', mineruError: message, mineruProgress: undefined } : source))
      notify(message)
    } finally {
      unsubscribe()
    }
  }
  async function installMineru() {
    const desktop = window.readerDesktop
    if (!desktop) {
      notify('请先安装并打开桌面客户端，再安装本地 MinerU 组件。')
      return false
    }
    const taskId = crypto.randomUUID()
    setMineruInstalling(true)
    setMineruInstallProgress('正在准备本地安装…')
    const unsubscribe = desktop.onMineruProgress(progress => {
      if (progress.taskId !== taskId) return
      const lines = progress.text.trim().split(/\r?\n/).filter(Boolean)
      const latest = lines[lines.length - 1]
      if (latest) setMineruInstallProgress(latest.slice(0, 300))
    })
    try {
      await desktop.installMineru({ taskId })
      setMineruInstallProgress('本地 MinerU 已安装；首次解析会按需下载模型。')
      notify('本地 MinerU 安装完成；论文仍只在本机解析。')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地 MinerU 安装失败。'
      setMineruInstallProgress(message)
      notify('本地 MinerU 安装失败，请查看提示后重试。')
      return false
    } finally {
      unsubscribe()
      setMineruInstalling(false)
    }
  }

  function openSource(id: string, pageNumber?: number, anchor?: FragmentAnchor) {
    setSelectedSource(id)
    setReaderJumpTarget(pageNumber
      ? { sourceId: id, pageNumber, anchor, nonce: crypto.randomUUID() }
      : undefined)
    setActive('reader')
  }

  return <div className={`app-shell ${active === 'reader' ? 'reader-active' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><GraduationCap size={19}/></div><span>科研阅读</span></div>
      <div className="workspace-control">
        <button className="project-switch" type="button" onClick={() => setWorkspaceMenuOpen(open => !open)}>
          <div><small>当前研究库</small><strong>{workspace?.name ?? (window.readerDesktop ? '尚未选择' : '浏览器临时库')}</strong></div>
          <ChevronRight size={16}/>
        </button>
        {workspaceMenuOpen && <div className="workspace-menu">
          <div className="workspace-menu-title">
            <strong>研究库</strong>
            <button type="button" onClick={() => setWorkspaceMenuOpen(false)} aria-label="关闭"><X size={14}/></button>
          </div>
          {window.readerDesktop ? <>
            {recentWorkspaces.length > 0 && <div className="workspace-recent">
              <small>最近使用</small>
              {recentWorkspaces.map(item => <button
                type="button"
                className={item.id === workspace?.id ? 'active' : ''}
                onClick={() => void switchWorkspace(item.id)}
                disabled={workspaceBusy}
                key={item.id}
              >
                <span>{item.name}</span>
                {item.id === workspace?.id && <Check size={13}/>}
              </button>)}
            </div>}
            <div className="workspace-create">
              <small>新建研究库</small>
              <input value={workspaceName} maxLength={80} onChange={event => setWorkspaceName(event.target.value)} aria-label="研究库名称"/>
              <button type="button" className="workspace-primary" onClick={() => void createWorkspace()} disabled={workspaceBusy || !workspaceName.trim()}>
                <Plus size={14}/>选择位置并创建
              </button>
            </div>
            <button type="button" className="workspace-secondary" onClick={() => void openWorkspace()} disabled={workspaceBusy}>
              <Files size={14}/>打开已有研究库
            </button>
            {workspace && legacySourceCount > 0 && <button type="button" className="workspace-migrate" onClick={() => void migrateLegacyWorkspace()} disabled={workspaceBusy}>
              复制 {legacySourceCount} 份旧资料到当前库
              <small>先做快照，重复执行不会重复写入</small>
            </button>}
            <p>{workspaceBusy ? '正在安全切换…' : '每个研究库都有独立数据库、论文目录和导出目录。'}</p>
          </> : <p>浏览器预览使用临时本地库。安装桌面客户端后可创建、打开和切换独立研究库。</p>}
        </div>}
      </div>
      <nav>
        <Nav active={active === 'sources'} icon={<Files/>} label="资料库" count={sources.length} onClick={() => setActive('sources')}/>
        <Nav active={active === 'reader'} icon={<BookOpen/>} label="阅读" onClick={() => selected && setActive('reader')}/>
        <Nav active={active === 'dashboard'} icon={<ClipboardCheck/>} label="复查草稿" count={actions.filter(a => !a.done).length} onClick={() => setActive('dashboard')}/>
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings2/>设置</button><div className="local-note"><span className="status-dot"/>本地优先存储<br/><small>仅在你触发时调用 AI</small></div></div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-menu"><Menu/></button><div className="crumb">当前仓库 <ChevronRight size={14}/> <strong>{active === 'dashboard' ? '复查草稿' : active === 'reader' ? '阅读' : '资料库'}</strong></div><div className="top-actions"><button className="icon-button" title="本地搜索" onClick={() => { setActive('sources'); setLibrarySearchRequest(value => value + 1) }}><Search size={19}/></button><button className="agent-button" onClick={() => setAgentOpen(true)}><Sparkles size={16}/> 询问研究 Agent</button></div></header>
      {active === 'dashboard' && <ReviewWorkspace
        sources={sources}
        items={bibliographicItems}
        annotations={annotations}
        documents={reviewDocuments}
        activeDocument={activeReview}
        onGenerate={(title, itemIds, annotationIds) => void generateReviewDocument(title, itemIds, annotationIds)}
        onOpenDocument={(id) => void openReviewDocument(id)}
        onOpenCitation={(sourceId, pageNumber, anchor) => openSource(sourceId, pageNumber, anchor as FragmentAnchor | undefined)}
        onExport={(id, format) => void exportReviewDocument(id, format)}
      />}
      {active === 'sources' && <SourcesV2
        sources={sources}
        annotations={annotations}
        bibliographicItems={bibliographicItems}
        focusRequest={librarySearchRequest}
        onUpload={() => fileInput.current?.click()}
        onBibliography={() => void importBibliography()}
        onReader={openSource}
        onOpenReview={(documentId) => {
          setActive('dashboard')
          void openReviewDocument(documentId)
        }}
        onReanalyze={reanalyze}
        onMineru={id => { setMineruInstallProgress(''); setMineruTarget(sources.find(source => source.id === id)) }}
      />} 
      {active === 'reader' && selected && <FunctionalReader
        settings={aiSettings}
        source={selected}
        sources={sources}
        annotations={annotations}
        paper={bibliographicItems.find(item => item.id === selected.bibliographicItemId)}
        jumpTarget={readerJumpTarget}
        onSelectSource={(id) => { setSelectedSource(id); setReaderJumpTarget(undefined) }}
        onBack={() => setActive('sources')}
        onAnnotate={(draft = {}) => setAnnotationDraft(draft)}
        onUpdateReading={(itemId, patch, quiet) => void updatePaperReading(itemId, patch, quiet)}
        onAgent={() => setAgentOpen(true)}
      />}
    </main>
    <input ref={fileInput} className="hidden" type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xlsx,.xls,.md,.txt" onChange={e => addFiles(e.target.files)} />
    {agentOpen && <AgentModalV2 settings={aiSettings} sourceCount={sources.filter(source => source.status === '已解析').length} onClose={() => setAgentOpen(false)} onCreate={createActionPack}/>} 
    {annotationDraft && <AnnotationModalV2 source={selected} draft={annotationDraft} onClose={() => setAnnotationDraft(null)} onSave={addAnnotation}/>} 
    {settingsOpen && <SettingsModal settings={aiSettings} onClose={() => setSettingsOpen(false)} onSave={setAISettings}/>} 
    {workspaceCreationRequest && <WorkspaceCreationModal
      directory={workspaceCreationRequest.directory}
      suggestedName={workspaceCreationRequest.suggestedName}
      busy={workspaceBusy}
      onClose={() => setWorkspaceCreationRequest(undefined)}
      onCreate={name => void createWorkspaceInSelectedFolder(name)}
    />}
    {mineruTarget && <MineruConfirmModal
      source={mineruTarget}
      installing={mineruInstalling}
      installProgress={mineruInstallProgress}
      onClose={() => setMineruTarget(undefined)}
      onInstall={installMineru}
      onConfirm={runMineru}
    />} 
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </div>
}

function Nav({ icon, label, active, count, onClick }: { icon: React.ReactNode; label: string; active?: boolean; count?: number; onClick?: () => void }) { return <button onClick={onClick} className={`nav-item ${active ? 'active' : ''}`}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}</button> }
function Dashboard({ sources, claims, actions, counts, onToggle, onNavigate, onAgent, onUpload }: { sources: Source[]; claims: Claim[]; actions: Action[]; counts: { fact:number; infer:number; hypo:number }; onToggle:(id:string)=>void; onNavigate:(v:'dashboard'|'sources'|'reader')=>void; onAgent:()=>void; onUpload:()=>void }) {
  return <div className="page dashboard"><section className="hero"><div><p className="eyebrow">研究项目 · 进行中</p><h1>柔顺装配控制</h1><p className="hero-copy">研究在接触刚度变化下，如何通过在线辨识提升机械臂装配的鲁棒性。</p><div className="hypothesis"><span>当前假设</span><p>力/位混合反馈可以降低不同批次工件带来的控制参数失配。</p></div></div><button className="outline-button" onClick={onAgent}><Sparkles size={16}/> 让 Agent 审视项目</button></section>
    <div className="metrics"><Metric label="可追溯证据" value={String(counts.fact)} detail="来自已解析资料" tone="green"/><Metric label="待验证推断" value={String(counts.infer)} detail="需要补充对照" tone="blue"/><Metric label="研究假设" value={String(counts.hypo)} detail="尚未获得实验支持" tone="amber"/><Metric label="资料状态" value={`${sources.filter(s=>s.status==='已解析').length}/${sources.length}`} detail="已完成解析" tone="slate"/></div>
    <div className="dashboard-grid"><section className="card evidence-card"><div className="card-head"><div><p className="section-kicker">Evidence map</p><h2>证据地图</h2></div><button className="text-button" onClick={() => onNavigate('sources')}>查看资料 <ArrowRight size={14}/></button></div><p className="muted">所有结论都标明它是资料事实、Agent 推断还是你的研究假设。</p><div className="claims">{claims.map(c => <div className="claim" key={c.id}><span className={`claim-dot ${pill(c.status)}`}/><div><strong>{c.title}</strong><small>{c.source} · {c.location}</small></div><span className={`pill ${pill(c.status)}`}>{c.status}</span></div>)}</div></section>
      <section className="card actions-card"><div className="card-head"><div><p className="section-kicker">Next actions</p><h2>待你确认的行动</h2></div><span className="pill amber">{actions.filter(a=>!a.done).length} 项</span></div><div className="actions">{actions.map(a => <button key={a.id} className={`action ${a.done ? 'done' : ''}`} onClick={() => onToggle(a.id)}><span className="check-box">{a.done && <Check size={14}/>}</span><div><span className="action-type">{a.type}</span><strong>{a.title}</strong><small>{a.reason}</small></div></button>)}</div></section></div>
    <div className="dashboard-grid lower"><section className="card risk-card"><div className="card-head"><div><p className="section-kicker">Critical review</p><h2>Agent 发现的风险</h2></div><AlertTriangle className="risk-icon" size={20}/></div><div className="risk"><strong>比较条件可能不一致</strong><p>已有文献的“成功率”使用了不同的刚度范围和速度条件，暂不能直接支持性能优越的结论。</p><button className="text-button" onClick={onAgent}>查看质询与建议 <ArrowRight size={14}/></button></div></section><section className="card import-card"><FilePlus2 size={22}/><div><h2>把资料带进项目</h2><p>支持 PDF、Word、PPT、表格、Markdown。原文件始终保留，解析文本只是辅助层。</p><button className="primary-button" onClick={onUpload}><Upload size={16}/> 导入本地资料</button></div></section></div>
  </div>
}

function ReviewWorkspace({
  sources,
  items,
  annotations,
  documents,
  activeDocument,
  onGenerate,
  onOpenDocument,
  onOpenCitation,
  onExport,
}: {
  sources: Source[]
  items: BibliographicSummary[]
  annotations: Annotation[]
  documents: ReviewDocumentSummary[]
  activeDocument?: ReviewDocumentView
  onGenerate: (title: string, itemIds: string[], annotationIds: string[]) => void
  onOpenDocument: (id: string) => void
  onOpenCitation: (sourceId: string, pageNumber: number, anchor?: DesktopFragmentAnchor) => void
  onExport: (id: string, format: 'markdown' | 'docx') => void
}) {
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([])
  const [title, setTitle] = useState('结构化文献复查')
  const availableAnnotations = useMemo(
    () => reviewAnnotationsForItems(annotations, sources, items, selectedItemIds),
    [annotations, sources, items, selectedItemIds],
  )
  const annotationCounts = useMemo(
    () => reviewAnnotationCounts(annotations, sources, items),
    [annotations, sources, items],
  )
  const availableAnnotationKey = availableAnnotations.map(annotation => annotation.id).join('|')
  const allPapersSelected = items.length > 0 && selectedItemIds.length === items.length
  const allCurrentAnnotationsSelected = availableAnnotations.length > 0
    && availableAnnotations.every(annotation => selectedAnnotationIds.includes(annotation.id))

  useEffect(() => {
    const allowed = new Set(availableAnnotations.map(annotation => annotation.id))
    setSelectedAnnotationIds(current => current.filter(id => allowed.has(id)))
  }, [availableAnnotationKey])

  function toggleItem(id: string) {
    setSelectedItemIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function toggleAnnotation(id: string) {
    setSelectedAnnotationIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  return <div className="review-workspace">
    <aside className="review-builder">
      <header><span>REVIEW BUILDER</span><h1>结构化复查</h1><p>选择论文和批注。生成后，原文证据、用户笔记和 AI 整理仍是三种独立内容。</p></header>
      <label className="review-title-input">文档标题<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)}/></label>
      <section className="review-selection-section">
        <div className="review-selection-heading">
          <strong>1. 选择论文</strong>
          <div><span>{selectedItemIds.length}/{items.length}</span>{items.length > 0 && <button type="button" onClick={() => setSelectedItemIds(allPapersSelected ? [] : items.map(item => item.id))}>{allPapersSelected ? '清空' : '全选'}</button>}</div>
        </div>
        <div className="review-choice-list">
          {items.length ? items.map(item => {
            const selected = selectedItemIds.includes(item.id)
            const annotationCount = annotationCounts.get(item.id) ?? item.annotationCount ?? 0
            return <button type="button" aria-pressed={selected} className={selected ? 'selected' : ''} key={item.id} onClick={() => toggleItem(item.id)}>
            <span className="review-checkbox">{selectedItemIds.includes(item.id) && <Check size={12}/>}</span>
            <span>
              <strong title={item.title}>{item.title}</strong>
              <small className="review-paper-status">{readingStateLabel(item.readingState)} · {readingProgressLabel(item.readingState)} · {annotationCount} 条批注</small>
              <small className="review-paper-purpose">{item.readingState.purposeTags.join('、') || '用途未标记'}</small>
            </span>
          </button>
          }) : <p className="review-empty-copy">先在资料库导入论文。</p>}
        </div>
      </section>
      <section className="review-selection-section">
        <div className="review-selection-heading">
          <strong>2. 选择批注</strong>
          <div>
            <span>{selectedAnnotationIds.length}/{availableAnnotations.length}</span>
            {availableAnnotations.length > 0 && <button type="button" onClick={() => setSelectedAnnotationIds(allCurrentAnnotationsSelected ? [] : availableAnnotations.map(annotation => annotation.id))}>{allCurrentAnnotationsSelected ? '清空' : '全选当前批注'}</button>}
          </div>
        </div>
        <div className="review-choice-list notes">
          {availableAnnotations.length ? availableAnnotations.map(annotation => <button type="button" aria-pressed={selectedAnnotationIds.includes(annotation.id)} className={selectedAnnotationIds.includes(annotation.id) ? 'selected' : ''} key={annotation.id} onClick={() => toggleAnnotation(annotation.id)}>
            <span className="review-checkbox">{selectedAnnotationIds.includes(annotation.id) && <Check size={12}/>}</span>
            <span><strong>{annotation.text}</strong><small>{annotation.page} · {annotation.note || '仅保留原文证据'}</small></span>
          </button>) : <p className="review-empty-copy">{selectedItemIds.length ? '所选论文还没有批注；仍可生成论文范围草稿。' : '选择论文后显示其批注。'}</p>}
        </div>
      </section>
      <button className="review-generate-button" disabled={!selectedItemIds.length || !title.trim()} onClick={() => onGenerate(title.trim(), selectedItemIds, selectedAnnotationIds)}>
        <Sparkles size={15}/>生成可追溯复查文档
      </button>
      <small className="review-generate-note">配置 AI 时只发送所选碎片；没有证据引用的 AI 结论不会进入正式导出。</small>
      {documents.length > 0 && <section className="review-history">
        <strong>历史草稿</strong>
        {documents.map(document => <button className={activeDocument?.id === document.id ? 'active' : ''} key={document.id} onClick={() => onOpenDocument(document.id)}>
          <span>{document.title}</span><small>{document.itemCount} 篇 · {document.blockCount} 块 · {document.status === 'exported' ? '已导出' : '草稿'}</small>
        </button>)}
      </section>}
    </aside>
    <main className="review-document-pane">
      {activeDocument ? <>
        <header className="review-document-header">
          <div><span>TRACEABLE REVIEW</span><h2>{activeDocument.title}</h2><p>{activeDocument.items.length} 篇论文 · {activeDocument.blocks.length} 个来源区块</p></div>
          <div><button onClick={() => onExport(activeDocument.id, 'markdown')}>导出 Markdown</button><button onClick={() => onExport(activeDocument.id, 'docx')}>导出 Word</button></div>
        </header>
        <article className="review-document-content">
          <div className="review-origin-legend"><span className="evidence">原文证据</span><span className="user">用户笔记</span><span className="ai">AI 整理</span></div>
          {activeDocument.blocks.map(block => <section className={`review-block ${block.blockType} ${block.unsupported ? 'unsupported' : ''}`} key={block.id}>
            <span className="review-block-label">{reviewBlockLabel(block.blockType)}</span>
            <p>{block.content}</p>
            {block.unsupported && <small className="unsupported-note">无证据推断：仅在应用中提示，默认不进入正式导出。</small>}
            {block.citations.length > 0 && <div className="review-citations">{block.citations.map(citation => <button
              key={citation.id}
              disabled={!citation.pageNumber}
              onClick={() => citation.pageNumber && onOpenCitation(citation.sourceId, citation.pageNumber, citation.anchor)}
            ><BookOpen size={12}/>{citation.label}</button>)}</div>}
          </section>)}
        </article>
      </> : <div className="review-document-empty"><ClipboardCheck size={30}/><strong>选择论文和笔记，生成第一份复查文档</strong><span>文档不会把 AI 内容混进原文，也不会覆盖你的笔记。</span></div>}
    </main>
  </div>
}

function readingStateLabel(state: PaperReadingState) {
  const status = {
    unread: '未读',
    title_only: '只看题目/摘要',
    skimming: '快速浏览',
    reading: '精读中',
    finished: '已读完',
  }[state.readingStatus]
  const relevance = {
    undecided: '相关性待定',
    core: '核心相关',
    relevant: '相关',
    supplemental: '部分相关',
    mismatched: '方向不匹配',
  }[state.relevance]
  return `${status} · ${relevance}`
}

function reviewBlockLabel(type: ReviewDocumentView['blocks'][number]['blockType']) {
  return {
    heading: '结构',
    source_evidence: '原文证据',
    user_note: '用户笔记',
    ai_organization: 'AI 整理',
  }[type]
}

function Metric({ label, value, detail, tone }: { label:string; value:string; detail:string; tone:string }) { return <div className="metric"><div className={`metric-value ${tone}`}>{value}</div><div><strong>{label}</strong><small>{detail}</small></div></div> }
function Sources({ sources, onUpload, onReader, onReanalyze }: { sources: Source[]; onUpload:()=>void; onReader:(id:string)=>void; onReanalyze:(id:string)=>void }) { return <div className="page"><div className="page-title"><div><p className="eyebrow">Project sources</p><h1>资料库</h1><p>每份资料保留原文件与版本历史。解析或 AI 输出不能替代原始来源。</p></div><button className="primary-button" onClick={onUpload}><Upload size={16}/> 导入资料</button></div><div className="source-toolbar"><div className="search"><Search size={16}/><span>搜索标题、作者、标签…</span></div><span>{sources.length} 份资料</span></div><div className="source-table"><div className="table-head"><span>资料</span><span>版本</span><span>更新时间</span><span>解析状态</span><span/></div>{sources.map(s => <div className="table-row" key={s.id}><div className="source-name"><div className={`file-icon ${s.kind}`}>{s.kind === 'PDF' ? 'PDF' : s.kind}</div><div><strong>{s.name}</strong><small>{s.kind}{s.pages ? ` · ${s.pages} 页` : ''}</small></div></div><span>v{s.version}</span><span>{s.updated}</span><span className={`pill ${pill(s.status)}`}>{s.status}</span><div className="row-buttons">{s.status === '需重新分析' && <button className="compact-button" onClick={() => onReanalyze(s.id)}>重新分析</button>}<button className="icon-button" onClick={() => onReader(s.id)}><ChevronRight size={17}/></button></div></div>)}</div></div> }
type LibraryFilterState = {
  readingStatus: '' | PaperReadingState['readingStatus']
  relevance: '' | PaperReadingState['relevance']
  outcome: '' | 'has_ideas' | 'no_new_ideas' | 'has_questions' | 'no_questions'
  purposeTag: string
  annotationState: '' | 'with' | 'without'
  origin: '' | NonNullable<DesktopLibrarySearchFilters['origins']>[number]
}
const emptyLibraryFilters: LibraryFilterState = {
  readingStatus: '',
  relevance: '',
  outcome: '',
  purposeTag: '',
  annotationState: '',
  origin: '',
}

function desktopSearchFilters(state: LibraryFilterState): DesktopLibrarySearchFilters {
  return {
    ...(state.readingStatus ? { readingStatuses: [state.readingStatus] } : {}),
    ...(state.relevance ? { relevances: [state.relevance] } : {}),
    ...(state.outcome === 'has_ideas' || state.outcome === 'no_new_ideas'
      ? { ideaStates: [state.outcome] }
      : {}),
    ...(state.outcome === 'has_questions' || state.outcome === 'no_questions'
      ? { questionStates: [state.outcome] }
      : {}),
    ...(state.purposeTag ? { purposeTags: [state.purposeTag] } : {}),
    ...(state.annotationState ? { hasAnnotations: state.annotationState === 'with' } : {}),
    ...(state.origin ? { origins: [state.origin] } : {}),
  }
}

function SourcesV2({
  sources,
  annotations,
  bibliographicItems,
  focusRequest,
  onUpload,
  onBibliography,
  onReader,
  onOpenReview,
  onReanalyze,
  onMineru,
}: {
  sources: Source[]
  annotations: Annotation[]
  bibliographicItems: BibliographicSummary[]
  focusRequest: number
  onUpload:()=>void
  onBibliography:()=>void
  onReader:(id:string, pageNumber?:number, anchor?:FragmentAnchor)=>void
  onOpenReview:(documentId:string)=>void
  onReanalyze:(id:string)=>void
  onMineru:(id:string)=>void
}) {
  const [query, setQuery] = useState('')
  const [filterState, setFilterState] = useState<LibraryFilterState>(emptyLibraryFilters)
  const [desktopResults, setDesktopResults] = useState<DesktopLibrarySearchResponse>()
  const [searchBusy, setSearchBusy] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const fallbackResults = useMemo(
    () => searchLocalLibrary(sources, annotations, query),
    [annotations, query, sources],
  )
  const searching = searchTerms(query).length > 0
  const filters = useMemo(() => desktopSearchFilters(filterState), [filterState])
  const activeFilterCount = Object.values(filterState).filter(Boolean).length
  const filtering = activeFilterCount > 0
  const bibliographyMatches = useMemo(() => {
    const terms = searchTerms(query)
    const candidates = bibliographicItems.filter(item => !item.sourceId)
    if (!terms.length) return candidates.filter(item => !item.sourceId)
    return candidates.filter(item => {
      const haystack = [
        item.title,
        item.issued,
        ...item.authors.flatMap(author => [author.literal, author.family, author.given]),
      ].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    })
  }, [bibliographicItems, query, searching])
  const purposeFilterOptions = useMemo(
    () => [...new Set([
      ...purposeOptions,
      ...Object.keys(desktopResults?.facets.purposeTags ?? {}),
    ])].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [desktopResults?.facets.purposeTags],
  )

  useEffect(() => {
    const desktop = window.readerDesktop
    if (!desktop) return
    let disposed = false
    const timer = window.setTimeout(() => {
      setSearchBusy(true)
      void desktop.searchWorkspaceLibrary({ query, filters, limit: 120 })
        .then(response => {
          if (!disposed) setDesktopResults(response)
        })
        .catch(() => {
          if (!disposed) setDesktopResults(undefined)
        })
        .finally(() => {
          if (!disposed) setSearchBusy(false)
        })
    }, 160)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [annotations, bibliographicItems, filters, query, sources])

  useEffect(() => {
    if (focusRequest > 0) searchInput.current?.focus()
  }, [focusRequest])

  return <div className="page library-page">
    <div className="page-title">
      <div><p className="eyebrow">Local research library</p><h1>资料库</h1><p>搜索在本机完成，覆盖题录、正文、Markdown、批注、阅读结论与复查文档。</p></div>
      <div className="page-actions">
        <button className="outline-button" onClick={onBibliography}><BookOpen size={16}/> 导入题录</button>
        <button className="primary-button" onClick={onUpload}><Upload size={16}/> 导入资料</button>
      </div>
    </div>
    <div className="source-toolbar">
      <label className="search library-search">
        <Search size={16}/>
        <input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、正文、Markdown、批注…" aria-label="本地搜索"/>
        {query && <button type="button" title="清除搜索" onClick={() => setQuery('')}><X size={14}/></button>}
      </label>
      <span>{window.readerDesktop && desktopResults
        ? `${desktopResults.results.length} 个命中 · ${desktopResults.filteredItemCount}/${desktopResults.totalItemCount} 篇文献`
        : searching
          ? `${fallbackResults.length + bibliographyMatches.length} 个本地命中`
          : `${bibliographicItems.length} 篇文献 · ${sources.length} 份资料`}{searchBusy ? ' · 检索中' : ''}</span>
    </div>

    {window.readerDesktop && <LibraryFilters
      value={filterState}
      purposeOptions={purposeFilterOptions}
      activeCount={activeFilterCount}
      onChange={setFilterState}
      onClear={() => setFilterState(emptyLibraryFilters)}
    />}

    {window.readerDesktop && (searching || filtering) ? <UnifiedSearchResults
      results={desktopResults?.results ?? []}
      query={query}
      busy={searchBusy}
      onOpenSource={onReader}
      onOpenReview={onOpenReview}
    /> : searching ? <>
      <LocalSearchResults results={fallbackResults} query={query} onOpen={onReader} suppressEmpty={bibliographyMatches.length > 0}/>
      <BibliographicOnlyList items={bibliographyMatches.filter(item => !item.sourceId)} query={query}/>
    </> : <>
    <div className="source-table">
      <div className="table-head"><span>资料</span><span>版本</span><span>更新时间</span><span>解析状态</span><span/></div>
      {sources.map(source => <div className="table-row" key={source.id}>
        <button className="source-name source-open-button" onClick={() => onReader(source.id)}>
          <span className={`file-icon ${source.kind}`}>{source.kind === 'PDF' ? 'PDF' : source.kind.slice(0, 2)}</span>
          <span><strong>{source.name}</strong><small>{source.kind}{source.pages ? ` · ${source.pages} 页` : ''}{source.mineruState && source.mineruState !== '未使用' ? ` · 本地 MinerU ${source.mineruState}` : ''}{source.mineruProgress ? ` · ${source.mineruProgress}` : ''}</small></span>
        </button>
        <span>v{source.version}</span>
        <span>{source.updated}</span>
        <span className={`pill ${pill(source.status)}`}>{source.status}</span>
        <div className="row-buttons">
          {source.status === '需重新分析' && <button className="compact-button" onClick={() => onReanalyze(source.id)}>重新分析</button>}
          {source.fileId && !source.isDemo && <button className="compact-button mineru-button" disabled={source.mineruState === '准备中' || source.mineruState === '解析中'} onClick={() => source.mineruState === '完成' ? onReader(source.id) : onMineru(source.id)}>{source.mineruState === '完成' ? '查看 Markdown' : source.mineruState === '准备中' || source.mineruState === '解析中' ? '本地解析中' : '本地 MinerU'}</button>}
          <button className="icon-button" title="打开阅读" onClick={() => onReader(source.id)}><ChevronRight size={17}/></button>
        </div>
      </div>)}
    </div>
    <BibliographicOnlyList items={bibliographyMatches} query=""/>
    </>}
  </div>
}

function LibraryFilters({
  value,
  purposeOptions,
  activeCount,
  onChange,
  onClear,
}: {
  value: LibraryFilterState
  purposeOptions: string[]
  activeCount: number
  onChange: (value: LibraryFilterState) => void
  onClear: () => void
}) {
  function patch<K extends keyof LibraryFilterState>(key: K, next: LibraryFilterState[K]) {
    onChange({ ...value, [key]: next })
  }
  return <section className="library-filters" aria-label="文献筛选">
    <div className="library-filter-heading">
      <span>筛选{activeCount ? ` · ${activeCount}` : ''}</span>
      {activeCount > 0 && <button type="button" onClick={onClear}>全部清除</button>}
    </div>
    <label><span>阅读阶段</span><select value={value.readingStatus} onChange={event => patch('readingStatus', event.target.value as LibraryFilterState['readingStatus'])}>
      <option value="">全部阶段</option>
      <option value="unread">未读</option>
      <option value="title_only">只看标题</option>
      <option value="skimming">快速浏览</option>
      <option value="reading">正在精读</option>
      <option value="finished">已读完</option>
    </select></label>
    <label><span>相关性</span><select value={value.relevance} onChange={event => patch('relevance', event.target.value as LibraryFilterState['relevance'])}>
      <option value="">全部相关性</option>
      <option value="core">核心文献</option>
      <option value="relevant">相关</option>
      <option value="supplemental">补充材料</option>
      <option value="mismatched">方向不匹配</option>
      <option value="undecided">尚未判断</option>
    </select></label>
    <label><span>阅读结果</span><select value={value.outcome} onChange={event => patch('outcome', event.target.value as LibraryFilterState['outcome'])}>
      <option value="">全部结果</option>
      <option value="has_ideas">有想法</option>
      <option value="no_new_ideas">没有新想法</option>
      <option value="has_questions">有疑问</option>
      <option value="no_questions">没有疑问</option>
    </select></label>
    <label><span>研究用途</span><select value={value.purposeTag} onChange={event => patch('purposeTag', event.target.value)}>
      <option value="">全部用途</option>
      {purposeOptions.map(option => <option value={option} key={option}>{option}</option>)}
    </select></label>
    <label><span>批注</span><select value={value.annotationState} onChange={event => patch('annotationState', event.target.value as LibraryFilterState['annotationState'])}>
      <option value="">有无批注</option>
      <option value="with">有批注</option>
      <option value="without">无批注</option>
    </select></label>
    <label><span>内容来源</span><select value={value.origin} onChange={event => patch('origin', event.target.value as LibraryFilterState['origin'])}>
      <option value="">全部来源</option>
      <option value="bibliography">题录</option>
      <option value="source">未关联资料</option>
      <option value="document">解析正文</option>
      <option value="mineru">MinerU Markdown</option>
      <option value="source_evidence">原文证据</option>
      <option value="user">用户笔记</option>
      <option value="ai">AI 内容</option>
      <option value="review">复查文档</option>
    </select></label>
  </section>
}

function UnifiedSearchResults({
  results,
  query,
  busy,
  onOpenSource,
  onOpenReview,
}: {
  results: DesktopLibrarySearchResult[]
  query: string
  busy: boolean
  onOpenSource: (id: string, pageNumber?: number, anchor?: FragmentAnchor) => void
  onOpenReview: (documentId: string) => void
}) {
  if (!results.length) {
    return <section className="local-search-empty">
      <Search size={22}/>
      <strong>{busy ? '正在检索本地研究库…' : '没有符合条件的结果'}</strong>
      <span>{busy ? '索引只在本机 SQLite 中更新。' : '可以减少关键词，或清除一个阅读状态、用途或来源筛选。'}</span>
    </section>
  }
  return <section className={`local-search-results unified-search-results ${busy ? 'is-busy' : ''}`} aria-live="polite">
    {results.map(result => {
      const canOpen = Boolean(result.reviewDocumentId || result.sourceId)
      return <button
        type="button"
        key={result.id}
        className={`local-search-result origin-${result.origin}`}
        disabled={!canOpen}
        onClick={() => {
          if (result.reviewDocumentId) onOpenReview(result.reviewDocumentId)
          else if (result.sourceId) onOpenSource(
            result.sourceId,
            result.pageNumber,
            result.anchor as FragmentAnchor | undefined,
          )
        }}
      >
        <span className="search-origin">{result.originLabel}</span>
        <span className="search-result-copy">
          <strong><HighlightedText text={result.title} query={query}/></strong>
          {result.subtitle && <small className="search-result-subtitle"><HighlightedText text={result.subtitle} query={query}/></small>}
          {result.excerpt && <span><HighlightedText text={result.excerpt} query={query}/></span>}
          <small>{result.reviewDocumentId
            ? '点击打开复查文档'
            : result.sourceId
              ? `点击打开论文${result.pageNumber ? `并回到第 ${result.pageNumber} 页` : ''}`
              : '仅有题录，关联原文后可阅读'}</small>
        </span>
        {canOpen && <ChevronRight size={16}/>}
      </button>
    })}
  </section>
}

function LocalSearchResults({
  results,
  query,
  onOpen,
  suppressEmpty = false,
}: {
  results: LocalSearchResult[]
  query: string
  onOpen: (id: string, pageNumber?: number) => void
  suppressEmpty?: boolean
}) {
  if (!results.length) {
    if (suppressEmpty) return null
    return <section className="local-search-empty"><Search size={22}/><strong>没有找到本地结果</strong><span>试试标题中的词、原文术语、批注内容或研究用途标签。</span></section>
  }
  return <section className="local-search-results" aria-live="polite">
    {results.map(result => <button key={result.id} className={`local-search-result ${result.origin}`} onClick={() => onOpen(result.sourceId, result.pageNumber)}>
      <span className="search-origin">{result.originLabel}</span>
      <span className="search-result-copy">
        <strong><HighlightedText text={result.sourceName} query={query}/></strong>
        <span><HighlightedText text={result.excerpt} query={query}/></span>
        <small>{result.location ? `${result.location} · ` : ''}点击打开{result.pageNumber ? `并跳到第 ${result.pageNumber} 页` : ''}</small>
      </span>
      <ChevronRight size={16}/>
    </button>)}
  </section>
}

function BibliographicOnlyList({ items, query }: { items: BibliographicSummary[]; query: string }) {
  if (!items.length) return null
  return <section className="bibliographic-only">
    <header><div><strong>仅题录记录</strong><small>原始记录已保存，关联 PDF 后可进入阅读器</small></div><span>{items.length}</span></header>
    {items.map(item => <div className="bibliographic-row" key={item.id}>
      <span className="file-icon BIB">BIB</span>
      <span className="bibliographic-copy">
        <strong><HighlightedText text={item.title} query={query}/></strong>
        <small>{item.authors.map(author => author.literal || [author.family, author.given].filter(Boolean).join(', ')).filter(Boolean).join('；') || '作者待核对'}{item.issued ? ` · ${item.issued}` : ''}{item.identifiers.DOI?.[0] ? ` · DOI ${item.identifiers.DOI[0]}` : ''}</small>
      </span>
      <span className="bibliographic-status">
        <span className="pill gray">{readingStateLabel(item.readingState)}</span>
        <span className={`pill ${item.attachmentState === 'missing' || item.attachmentState === 'denied' ? 'red' : 'gray'}`}>
          {item.attachmentState === 'missing' ? '附件缺失' : item.attachmentState === 'denied' ? '无权读取' : item.attachmentCount ? '附件待关联' : '无附件'}
        </span>
      </span>
    </div>)}
  </section>
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query)
  if (!terms.length) return <>{text}</>
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const matcher = new RegExp(`(${escaped.join('|')})`, 'gi')
  return <>{text.split(matcher).map((part, index) => terms.includes(part.normalize('NFKC').toLocaleLowerCase())
    ? <mark key={`${part}-${index}`}>{part}</mark>
    : part)}</>
}
function Reader({ source, annotations, onAnnotate, onAgent }: { source:Source; annotations:Annotation[]; onAnnotate:()=>void; onAgent:()=>void }) { return <div className="reader-page"><div className="reader-header"><div><button className="back-link"><Files size={15}/> 资料库</button><h2>{source.name}</h2><span className={`pill ${pill(source.status)}`}>{source.status}</span></div><div><button className="outline-button" onClick={onAgent}><MessageSquareText size={16}/> 问本篇论文</button><button className="primary-button" onClick={onAnnotate}><Highlighter size={16}/> 添加批注</button></div></div><div className="reader-body"><section className="pdf-canvas"><div className="pdf-toolbar"><span>第 7 / {source.pages ?? 14} 页</span><span>100%</span><MoreHorizontal size={19}/></div><article className="paper"><p className="paper-kicker">III. ADAPTIVE IMPEDANCE CONTROL</p><h2>Force-feedback parameter adaptation</h2><p>To cope with the varying contact conditions, the controller adapts the impedance parameters based on contact force feedback. The adaptation law is designed to preserve stability while reducing transient tracking errors.</p><p className="selected-text">The experimental results demonstrate that the proposed approach maintains a higher success rate under uncertain stiffness conditions.</p><figure><div className="chart"><span>Success rate</span><i className="bar a"/><i className="bar b"/><i className="bar c"/><small>fixed &nbsp; adaptive &nbsp; proposed</small></div><figcaption>Fig. 5. Assembly performance under varying stiffness.</figcaption></figure><p>However, the comparison is limited to a single velocity range and a laboratory setup. Further validation is needed for different workpiece batches.</p></article></section><aside className="reader-side"><div className="side-tabs"><strong>批注与理解</strong><button onClick={onAgent}><Sparkles size={16}/></button></div><div className="translation"><p className="section-kicker">划词翻译 · 示例</p><strong>该控制器会根据接触力反馈，自适应调整阻抗参数。</strong><small>术语：impedance parameters = 阻抗参数；contact force feedback = 接触力反馈</small><button className="text-button">收藏术语 <Plus size={13}/></button></div><div className="annotation-head"><h3>本篇批注</h3><span>{annotations.length}</span></div>{annotations.length === 0 ? <div className="empty-note"><Highlighter size={22}/><p>选中原文后添加批注。每条批注会保留页码定位，并可进入阅读卡。</p></div> : annotations.map(a => <div className="annotation" key={a.id}><span className="pill blue">{a.category}</span><p>{a.text}</p><small>{a.page} · {a.note || '无额外备注'}</small></div>)}<button className="full-width outline-button" onClick={onAnnotate}><Plus size={16}/> 新建研究批注</button></aside></div></div> }
type ReaderViewMode = 'original' | 'markdown' | 'parallel'
type ReaderSelection = {
  text: string
  pageNumber?: number
  rects: Array<{ x: number; y: number; width: number; height: number }>
  menuX: number
  menuY: number
}

function FunctionalReader({
  settings,
  source,
  sources,
  annotations,
  paper,
  jumpTarget,
  onSelectSource,
  onBack,
  onAnnotate,
  onUpdateReading,
  onAgent,
}: {
  settings: AISettings
  source: Source
  sources: Source[]
  annotations: Annotation[]
  paper?: BibliographicSummary
  jumpTarget?: ReaderJumpTarget
  onSelectSource: (id: string) => void
  onBack: () => void
  onAnnotate: (draft?: AnnotationDraft) => void
  onUpdateReading: (itemId: string, patch: ReadingStatePatch, quiet?: boolean) => void
  onAgent: () => void
}) {
  const [file, setFile] = useState<File | undefined>()
  const [pdfDocument, setPdfDocument] = useState<LocalPdfDocument | undefined>()
  const [activePage, setActivePage] = useState(1)
  const [loadState, setLoadState] = useState('正在读取本地原文件…')
  const [viewMode, setViewMode] = useState<ReaderViewMode>('original')
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [immersive, setImmersive] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [selection, setSelection] = useState<ReaderSelection>()
  const [selectionMode, setSelectionMode] = useState<'translate' | 'explain' | 'ask'>('translate')
  const [selectionQuestion, setSelectionQuestion] = useState('')
  const [selectionAnswer, setSelectionAnswer] = useState('')
  const [selectionNotice, setSelectionNotice] = useState('')
  const [selectionBusy, setSelectionBusy] = useState(false)
  const [localTranslationStatus, setLocalTranslationStatus] = useState<LocalTranslationStatus>()
  const [translationInstalling, setTranslationInstalling] = useState(false)
  const [translationInstallProgress, setTranslationInstallProgress] = useState('')
  const [activeAnnotationId, setActiveAnnotationId] = useState<string>()
  const [citationAnchor, setCitationAnchor] = useState<FragmentAnchor>()
  const sourceAnnotations = annotations.filter(annotation => !annotation.sourceId || annotation.sourceId === source.id)
  const renderedAnnotations = citationAnchor
    ? [...sourceAnnotations, {
        id: '__citation_target__',
        sourceId: source.id,
        text: citationAnchor.quote?.exact || '复查文档引用',
        note: '',
        category: '复查引用',
        page: citationAnchor.pageNumber ? `p. ${citationAnchor.pageNumber}` : '',
        anchor: citationAnchor,
      }]
    : sourceAnnotations
  const readableText = source.mineruMarkdown ?? source.extractedText
  const translationProvider = settings.translationProvider ?? 'local'

  useEffect(() => {
    if (!paper || !['unread', 'title_only'].includes(paper.readingState.readingStatus)) return
    onUpdateReading(paper.id, { readingStatus: 'reading' }, true)
  }, [paper?.id])

  useEffect(() => {
    if (!paper || !pdfDocument || activePage < 1) return
    const timer = window.setTimeout(() => {
      onUpdateReading(paper.id, {
        lastPage: activePage,
        totalPages: pdfDocument.numPages,
      }, true)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [activePage, paper?.id, pdfDocument?.numPages])

  useEffect(() => {
    let alive = true
    let loadedDocument: LocalPdfDocument | undefined
    setActivePage(1)
    setSelection(undefined)
    setSelectionAnswer('')
    setActiveAnnotationId(undefined)
    setCitationAnchor(undefined)
    setPdfDocument(undefined)
    setViewMode('original')
    if (!source.fileId) {
      setFile(undefined)
      setLoadState(source.isDemo ? '这是界面示例资料：请导入真实 PDF 以启用沉浸阅读和划词菜单。' : '此资料没有可用的本地原文件。')
      return () => { alive = false }
    }
    setLoadState('正在读取本地原文件…')
    getStoredSourceFile(source)
      .then(async value => {
        if (!alive) return
        setFile(value)
        if (!value) {
          setLoadState('未找到本地原文件，请重新导入。')
          return
        }
        if (source.kind === 'PDF') {
          setLoadState('正在建立 PDF 文字层…')
          const document = await loadPdfDocument(value)
          loadedDocument = document
          if (!alive) {
            await document.cleanup()
            return
          }
          setPdfDocument(document)
        }
        setLoadState('')
      })
      .catch(error => alive && setLoadState(error instanceof Error ? error.message : '读取本地原文件失败。'))
    return () => {
      alive = false
      void loadedDocument?.cleanup()
    }
  }, [source.id, source.fileId, source.isDemo, source.kind])

  useEffect(() => {
    let alive = true
    const desktop = window.readerDesktop
    if (!desktop || translationProvider !== 'local') {
      setLocalTranslationStatus(undefined)
      return () => { alive = false }
    }
    desktop.getLocalTranslationStatus({ from: 'en', to: 'zh' })
      .then(status => { if (alive) setLocalTranslationStatus(status) })
      .catch(error => {
        if (!alive) return
        setLocalTranslationStatus({
          available: false,
          from: 'en',
          to: 'zh',
          provider: 'argos',
          localOnly: true,
          message: error instanceof Error ? error.message : '无法检查本地翻译组件。',
        })
      })
    return () => { alive = false }
  }, [translationProvider])

  useEffect(() => {
    if (!jumpTarget || jumpTarget.sourceId !== source.id || !pdfDocument) return
    setCitationAnchor(jumpTarget.anchor)
    setActiveAnnotationId(jumpTarget.anchor ? '__citation_target__' : undefined)
    const frame = window.requestAnimationFrame(() => {
      setActivePage(jumpTarget.pageNumber)
      const target = document.querySelector<HTMLElement>(`[data-pdf-page="${jumpTarget.pageNumber}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [jumpTarget, pdfDocument, source.id])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (selection) {
        setSelection(undefined)
        return
      }
      if (immersive) {
        setImmersive(false)
        setRightOpen(true)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [immersive, selection])

  function toggleImmersive() {
    setImmersive(current => {
      if (!current) {
        setLeftOpen(false)
        setRightOpen(false)
      } else {
        setRightOpen(true)
      }
      return !current
    })
  }

  function captureSelection() {
    window.requestAnimationFrame(() => {
      const current = window.getSelection()
      const text = current?.toString().trim()
      if (!current || current.isCollapsed || !text || current.rangeCount === 0) return
      const range = current.getRangeAt(0)
      const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const pageElement = startElement?.closest<HTMLElement>('[data-pdf-page]')
      const allowedRoot = startElement?.closest('.reader-document')
      if (!allowedRoot) return
      const pageRect = pageElement?.getBoundingClientRect()
      const rects = pageRect
        ? Array.from(range.getClientRects())
          .filter(rect => rect.width > 0 && rect.height > 0)
          .map(rect => ({
            x: Math.max(0, (rect.left - pageRect.left) / pageRect.width),
            y: Math.max(0, (rect.top - pageRect.top) / pageRect.height),
            width: Math.min(1, rect.width / pageRect.width),
            height: Math.min(1, rect.height / pageRect.height),
          }))
        : []
      const selectionRect = range.getBoundingClientRect()
      setSelection({
        text,
        pageNumber: pageElement ? Number(pageElement.dataset.pdfPage) : undefined,
        rects,
        menuX: Math.max(12, Math.min(selectionRect.left, window.innerWidth - 430)),
        menuY: Math.max(12, Math.min(selectionRect.bottom + 8, window.innerHeight - 300)),
      })
      setSelectionMode('translate')
      setSelectionQuestion('')
      setSelectionAnswer('')
      setSelectionNotice('')
    })
  }

  async function runLocalSelectionTranslation() {
    if (!selection?.text) return
    const desktop = window.readerDesktop
    if (!desktop) {
      setSelectionNotice('本地翻译只在桌面客户端中运行；浏览器预览不会发送选区。')
      return
    }
    setSelectionBusy(true)
    setSelectionAnswer('')
    setSelectionNotice('正在检查 Argos 英文 → 中文本地语言包…')
    try {
      const status = await desktop.getLocalTranslationStatus({ from: 'en', to: 'zh' })
      setLocalTranslationStatus(status)
      if (!status.available) {
        setSelectionNotice(`${status.message} 首次安装需要联网并预留约 2 GB 空间；安装后的翻译不消耗第三方 Token。`)
        return
      }
      const taskId = crypto.randomUUID()
      const result = await desktop.translateLocally({
        taskId,
        text: selection.text,
        from: 'en',
        to: 'zh',
      })
      setSelectionAnswer(result.text)
      setSelectionNotice('由 Argos 在本机完成；选区未上传，也没有消耗第三方 Token。原文仍是引用依据。')
    } catch (error) {
      setSelectionNotice(error instanceof Error ? `本地翻译失败：${error.message}` : '本地翻译失败。')
    } finally {
      setSelectionBusy(false)
    }
  }

  async function installLocalTranslation() {
    const desktop = window.readerDesktop
    if (!desktop) {
      setSelectionNotice('请使用桌面客户端安装本地翻译组件。')
      return
    }
    const taskId = crypto.randomUUID()
    setTranslationInstalling(true)
    setTranslationInstallProgress('正在准备独立的本地翻译环境…')
    const unsubscribe = desktop.onLocalTranslationProgress(progress => {
      if (progress.taskId !== taskId) return
      const lines = progress.text.trim().split(/\r?\n/).filter(Boolean)
      const latest = lines[lines.length - 1]
      if (latest) setTranslationInstallProgress(latest.slice(0, 300))
    })
    try {
      await desktop.installLocalTranslation({ taskId, from: 'en', to: 'zh' })
      const status = await desktop.getLocalTranslationStatus({ from: 'en', to: 'zh' })
      setLocalTranslationStatus(status)
      setSelectionNotice('Argos 英文 → 中文本地翻译已安装。正在翻译当前选区…')
      await runLocalSelectionTranslation()
    } catch (error) {
      setSelectionNotice(error instanceof Error ? `安装失败：${error.message}` : '本地翻译组件安装失败。')
    } finally {
      unsubscribe()
      setTranslationInstalling(false)
      setTranslationInstallProgress('')
    }
  }

  async function runSelectionAI(mode: 'translate' | 'explain' | 'ask') {
    if (!selection?.text) return
    setSelectionMode(mode)
    if (mode === 'translate' && translationProvider === 'local') {
      await runLocalSelectionTranslation()
      return
    }
    if (mode === 'ask' && !selectionQuestion.trim()) {
      setSelectionNotice('输入你针对此处的问题，再发送。')
      return
    }
    if (!settings.baseUrl || !settings.model || !settings.apiKey) {
      setSelectionNotice(mode === 'translate'
        ? '当前选择使用 AI 翻译，但尚未配置 AI 服务；选区不会被发送。'
        : '当前未配置 AI 服务；选区不会被发送。')
      return
    }
    setSelectionBusy(true)
    setSelectionAnswer('')
    setSelectionNotice('只发送当前选区和你的问题，不发送整篇论文。')
    const prompts = {
      translate: '忠实翻译这段学术文本为中文。保留术语，随后列出关键术语；不要补写原文没有的结论。',
      explain: '用清晰但严谨的中文解释这段学术文本。区分原文事实与必要推断，不确定处明确说明。',
      ask: `回答用户针对此段原文的问题。答案必须以选区为依据，信息不足就明确说无法从此处判断。用户问题：${selectionQuestion.trim()}`,
    }
    try {
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: prompts[mode] },
            { role: 'user', content: `原文位置：${selection.pageNumber ? `p. ${selection.pageNumber}` : '结构化文本'}\n\n${selection.text}` },
          ],
        }),
      })
      if (!response.ok) throw new Error(`服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('服务没有返回可用内容。')
      setSelectionAnswer(content)
      setSelectionNotice('结果仅为辅助；原文仍是引用依据。')
    } catch (error) {
      setSelectionNotice(error instanceof Error ? `调用失败：${error.message}` : '调用失败。')
    } finally {
      setSelectionBusy(false)
    }
  }

  function saveSelection() {
    if (!selection) return
    onAnnotate({
      text: selection.text,
      location: selection.pageNumber
        ? `p. ${selection.pageNumber}`
        : '结构化文本选区',
      anchor: selection.pageNumber
        ? {
            type: 'pdf',
            state: 'resolved',
            pageNumber: selection.pageNumber,
            rects: selection.rects,
            quote: { exact: selection.text },
          }
        : {
            type: source.mineruMarkdown ? 'markdown' : 'text',
            state: 'resolved',
            quote: { exact: selection.text },
          },
    })
    setSelection(undefined)
  }

  function scrollToPage(pageNumber: number) {
    const target = document.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleReaderWheel(event: React.WheelEvent<HTMLElement>) {
    if (!event.ctrlKey || source.kind !== 'PDF') return
    event.preventDefault()
    setZoom(current => readerZoomAfterWheel(current, event.deltaY, true))
  }

  const readerClasses = [
    'research-reader',
    leftOpen ? 'with-library' : 'library-collapsed',
    rightOpen ? 'with-inspector' : 'inspector-collapsed',
    immersive ? 'is-immersive' : '',
  ].filter(Boolean).join(' ')

  return <div className={readerClasses}>
    <header className="research-reader-toolbar">
      <div className="reader-toolbar-group reader-title-group">
        <button className="reader-icon-button" onClick={onBack} title="返回资料库"><ArrowLeft size={17}/></button>
        <button className={`reader-icon-button ${leftOpen ? 'active' : ''}`} onClick={() => { setLeftOpen(value => !value); setImmersive(false) }} title="文献列表"><PanelLeft size={17}/></button>
        <div className="reader-title">
          <strong>{source.name}</strong>
          <span>{source.kind === 'PDF' ? `第 ${activePage} / ${pdfDocument?.numPages ?? source.pages ?? '…'} 页` : source.kind}</span>
        </div>
      </div>
      <div className="reader-view-switch" aria-label="阅读视图">
        <button className={viewMode === 'original' ? 'active' : ''} disabled={source.kind !== 'PDF'} onClick={() => setViewMode('original')}><FileText size={14}/>原文</button>
        <button className={viewMode === 'parallel' ? 'active' : ''} disabled={source.kind !== 'PDF' || !readableText} onClick={() => setViewMode('parallel')}><Columns2 size={14}/>对照</button>
        <button className={viewMode === 'markdown' ? 'active' : ''} disabled={!readableText} onClick={() => setViewMode('markdown')}><BookOpen size={14}/>Markdown</button>
      </div>
      <div className="reader-toolbar-group">
        {source.kind === 'PDF' && <div className="reader-zoom">
          <button onClick={() => setZoom(value => clampReaderZoom(value - .1))} title="缩小（Ctrl + 滚轮向下）"><Minus size={14}/></button>
          <span title="可在正文区域按 Ctrl + 滚轮缩放">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(value => clampReaderZoom(value + .1))} title="放大（Ctrl + 滚轮向上）"><Plus size={14}/></button>
        </div>}
        <button className="reader-icon-button" onClick={toggleImmersive} title="沉浸阅读"><Expand size={17}/></button>
        <button className={`reader-icon-button ${rightOpen ? 'active' : ''}`} onClick={() => { setRightOpen(value => !value); setImmersive(false) }} title="批注与 AI"><PanelRight size={17}/></button>
      </div>
    </header>

    <aside className="reader-library">
      <div className="reader-pane-heading">
        <div><span>当前仓库</span><strong>柔顺装配控制</strong></div>
        <button className="reader-icon-button" onClick={onBack} title="打开资料库"><Files size={16}/></button>
      </div>
      <div className="reader-library-search"><Search size={14}/><span>筛选当前文献…</span></div>
      <div className="reader-paper-list">
        {sources.map(item => <button key={item.id} className={item.id === source.id ? 'active' : ''} onClick={() => onSelectSource(item.id)}>
          <span className={`reader-file-type ${item.kind}`}>{item.kind === 'PDF' ? 'PDF' : item.kind.slice(0, 2)}</span>
          <span><strong>{item.name}</strong><small>{item.pages ? `${item.pages} 页 · ` : ''}{item.mineruState === '完成' ? 'MD 已就绪' : item.status}</small></span>
        </button>)}
      </div>
    </aside>

    <main className="reader-document" onWheel={handleReaderWheel} onMouseUp={captureSelection} onPointerUp={captureSelection}>
      {loadState && <div className="reader-state-banner">{loadState}</div>}
      {viewMode === 'original' && pdfDocument && <PdfContinuousReader
        document={pdfDocument}
        zoom={zoom}
        annotations={renderedAnnotations}
        activeAnnotationId={activeAnnotationId}
        onActivePage={setActivePage}
        onScroll={() => setSelection(undefined)}
      />}
      {viewMode === 'parallel' && pdfDocument && <div className="reader-parallel">
        <PdfContinuousReader document={pdfDocument} zoom={Math.max(.52, zoom * .55)} annotations={renderedAnnotations} activeAnnotationId={activeAnnotationId} onActivePage={setActivePage} onScroll={() => setSelection(undefined)}/>
        <StructuredDocument text={readableText} title="本地结构化版本"/>
      </div>}
      {(viewMode === 'markdown' || source.kind !== 'PDF') && <StructuredDocument text={readableText} title={source.mineruMarkdown ? 'MinerU Markdown' : '结构化提取文本'}/>}
      {!loadState && source.kind === 'PDF' && !pdfDocument && <div className="reader-empty-state"><BookOpen size={28}/><strong>原始 PDF 暂不可用</strong><span>请从资料库重新导入原文件。</span></div>}
    </main>

    <aside className="reader-inspector">
      <div className="reader-inspector-head">
        <div><span>当前文献</span><strong>笔记与 AI</strong></div>
        <button className="reader-icon-button" onClick={onAgent} title="问本篇资料"><Sparkles size={16}/></button>
      </div>
      <section className="reader-selection-card">
        <div className="reader-section-label"><Languages size={14}/>划词助手</div>
        <p>直接在原文中选中文字，菜单会贴着选区出现。翻译或问答只在你点击后调用当前 Provider。</p>
        {selection?.text && <blockquote>{selection.text}<small>{selection.pageNumber ? `p. ${selection.pageNumber}` : '结构化文本'}</small></blockquote>}
        {selectionAnswer && <div className="reader-ai-result"><span>{selectionMode === 'translate' && translationProvider === 'local' ? '本地翻译' : 'AI 整理'}</span><pre>{selectionAnswer}</pre></div>}
      </section>
      {paper && <PaperReadingCard paper={paper} onUpdate={(patch) => onUpdateReading(paper.id, patch)}/>}
      <section className="reader-annotations">
        <div className="annotation-head"><h3>用户笔记</h3><span>{sourceAnnotations.length}</span></div>
        {sourceAnnotations.length === 0
          ? <div className="empty-note"><Highlighter size={22}/><p>划词后保存笔记；用户原笔记不会被 AI 覆盖。</p></div>
          : sourceAnnotations.map(annotation => <button className={`annotation ${activeAnnotationId === annotation.id ? 'active' : ''}`} key={annotation.id} onClick={() => {
            const page = annotationPage(annotation)
            setActiveAnnotationId(annotation.id)
            setViewMode(annotation.anchor?.type === 'pdf' ? 'original' : viewMode)
            if (page) {
              setActivePage(page)
              window.requestAnimationFrame(() => scrollToPage(page))
            } else {
              setSelectionNotice('这条旧批注没有可验证的页码锚点；原文和备注仍然保留。')
            }
          }}>
            <span className="note-origin user">用户笔记</span>
            <p>{annotation.text}</p>
            <small>{annotation.page} · {annotation.note || '无额外备注'}</small>
          </button>)}
        <button className="full-width outline-button" onClick={() => onAnnotate()}><Plus size={16}/> 新建研究批注</button>
      </section>
      <div className="reader-privacy-note">
        <span className="status-dot"/>
        <div><strong>原文与 MinerU 结果保存在本机</strong><small>当前翻译后端：{translationProvider === 'local' ? localTranslationStatus?.available ? '本地 Argos · 无 Token' : '本地 Argos · 待安装' : settings.model ? `AI ${settings.model} · 会发送选区` : 'AI 未配置；不会发送'}</small></div>
      </div>
    </aside>

    {selection && <div className="selection-popover" style={{ left: selection.menuX, top: selection.menuY }}>
      <div className="selection-actions">
        <button className={selectionMode === 'translate' ? 'active' : ''} disabled={selectionBusy} onClick={() => runSelectionAI('translate')}><Languages size={14}/>翻译</button>
        <button className={selectionMode === 'explain' ? 'active' : ''} disabled={selectionBusy} onClick={() => runSelectionAI('explain')}><Sparkles size={14}/>解释</button>
        <button className={selectionMode === 'ask' ? 'active' : ''} disabled={selectionBusy} onClick={() => { setSelectionMode('ask'); setSelectionNotice('输入你针对此处的问题，再发送。') }}><MessageSquareText size={14}/>提问</button>
        <button disabled={selectionBusy} onClick={saveSelection}><Highlighter size={14}/>保存笔记</button>
        <button className="close" onClick={() => setSelection(undefined)}><X size={14}/></button>
      </div>
      {selectionMode === 'ask' && <div className="selection-question">
        <textarea autoFocus value={selectionQuestion} onChange={event => setSelectionQuestion(event.target.value)} placeholder="例如：这里的结论依赖哪些实验条件？"/>
        <button disabled={selectionBusy || !selectionQuestion.trim()} onClick={() => runSelectionAI('ask')}>发送</button>
      </div>}
      {(selectionBusy || selectionNotice || selectionAnswer) && <div className="selection-response">
        {selectionBusy && <span>正在处理当前选区…</span>}
        {selectionNotice && <small>{selectionNotice}</small>}
        {selectionMode === 'translate' && translationProvider === 'local' && localTranslationStatus && !localTranslationStatus.available && <button className="selection-install-button" disabled={translationInstalling || selectionBusy} onClick={installLocalTranslation}>{translationInstalling ? '正在安装，请勿关闭…' : '安装英文 → 中文本地翻译'}</button>}
        {translationInstallProgress && <small className="selection-install-progress">{translationInstallProgress}</small>}
        {selectionAnswer && <pre>{selectionAnswer}</pre>}
      </div>}
    </div>}
  </div>
}

function PaperReadingCard({
  paper,
  onUpdate,
}: {
  paper: BibliographicSummary
  onUpdate: (patch: ReadingStatePatch) => void
}) {
  const state = paper.readingState
  const [decisionNote, setDecisionNote] = useState(state.decisionNote)

  useEffect(() => {
    setDecisionNote(state.decisionNote)
  }, [paper.id, state.decisionNote])

  function togglePurpose(tag: string) {
    onUpdate({
      purposeTags: state.purposeTags.includes(tag)
        ? state.purposeTags.filter(item => item !== tag)
        : [...state.purposeTags, tag],
    })
  }

  return <section className="paper-reading-card">
    <div className="annotation-head">
      <h3>阅读结论</h3>
      <span>{state.lastPage && state.totalPages ? `${state.lastPage}/${state.totalPages}` : '论文级'}</span>
    </div>
    <div className="paper-state-grid">
      <label>阅读阶段<select value={state.readingStatus} onChange={event => onUpdate({ readingStatus: event.target.value as PaperReadingState['readingStatus'] })}>
        <option value="unread">未读</option>
        <option value="title_only">只看题目/摘要</option>
        <option value="skimming">快速浏览</option>
        <option value="reading">精读中</option>
        <option value="finished">已读完</option>
      </select></label>
      <label>与当前方向<select value={state.relevance} onChange={event => onUpdate({ relevance: event.target.value as PaperReadingState['relevance'] })}>
        <option value="undecided">尚未判断</option>
        <option value="core">核心相关</option>
        <option value="relevant">相关，可保留</option>
        <option value="supplemental">部分相关/补充</option>
        <option value="mismatched">读后方向不匹配</option>
      </select></label>
    </div>
    <div className="reading-outcome-row">
      <span>想法</span>
      <button className={state.ideaState === 'has_ideas' ? 'active' : ''} onClick={() => onUpdate({ ideaState: 'has_ideas' })}>有新想法</button>
      <button className={state.ideaState === 'no_new_ideas' ? 'active' : ''} onClick={() => onUpdate({ ideaState: 'no_new_ideas' })}>读完无新想法</button>
    </div>
    <div className="reading-outcome-row">
      <span>疑问</span>
      <button className={state.questionState === 'has_questions' ? 'active' : ''} onClick={() => onUpdate({ questionState: 'has_questions' })}>有待解决疑问</button>
      <button className={state.questionState === 'no_questions' ? 'active' : ''} onClick={() => onUpdate({ questionState: 'no_questions' })}>阅读中无疑问</button>
    </div>
    <div className="paper-purpose">
      <span>可用于</span>
      <div>{purposeOptions.map(tag => <button className={state.purposeTags.includes(tag) ? 'active' : ''} key={tag} onClick={() => togglePurpose(tag)}>
        {state.purposeTags.includes(tag) && <Check size={11}/>} {tag}
      </button>)}</div>
    </div>
    <label className="paper-decision-note">读后判断
      <textarea
        value={decisionNote}
        onChange={event => setDecisionNote(event.target.value)}
        onBlur={() => {
          if (decisionNote.trim() !== state.decisionNote) onUpdate({ decisionNote: decisionNote.trim() })
        }}
        placeholder="例如：题目相关，但试验对象不同；可用于国外研究现状，不进入方法复现。"
      />
    </label>
  </section>
}

function PdfContinuousReader({
  document,
  zoom,
  annotations,
  activeAnnotationId,
  onActivePage,
  onScroll,
}: {
  document: LocalPdfDocument
  zoom: number
  annotations: Annotation[]
  activeAnnotationId?: string
  onActivePage: (page: number) => void
  onScroll: () => void
}) {
  return <div className="pdf-scroll" onScroll={onScroll}>
    {Array.from({ length: document.numPages }, (_, index) => <PdfPage
      key={index + 1}
      document={document}
      pageNumber={index + 1}
      scale={1.2 * zoom}
      annotations={annotations}
      activeAnnotationId={activeAnnotationId}
      onVisible={onActivePage}
    />)}
  </div>
}

function PdfPage({
  document,
  pageNumber,
  scale,
  annotations,
  activeAnnotationId,
  onVisible,
}: {
  document: LocalPdfDocument
  pageNumber: number
  scale: number
  annotations: Annotation[]
  activeAnnotationId?: string
  onVisible: (page: number) => void
}) {
  const shellRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2)
  const [dimensions, setDimensions] = useState({ width: 612 * scale, height: 792 * scale })
  const [error, setError] = useState('')
  const highlights = annotationHighlightsForPage(annotations, pageNumber)

  useEffect(() => {
    const element = shellRef.current
    if (!element) return
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) setShouldRender(true)
        if (entry.intersectionRatio >= .35) onVisible(pageNumber)
      }
    }, { rootMargin: '700px 0px', threshold: [0, .35, .7] })
    observer.observe(element)
    return () => observer.disconnect()
  }, [onVisible, pageNumber])

  useEffect(() => {
    if (!shouldRender || !canvasRef.current || !textLayerRef.current) return
    let alive = true
    setError('')
    renderPdfPageWithTextLayer(document, canvasRef.current, textLayerRef.current, pageNumber, scale)
      .then(next => alive && setDimensions(next))
      .catch(reason => alive && setError(reason instanceof Error ? reason.message : '页面渲染失败。'))
    return () => { alive = false }
  }, [document, pageNumber, scale, shouldRender])

  return <section
    ref={shellRef}
    className="pdf-page-shell"
    data-pdf-page={pageNumber}
    style={{ width: dimensions.width, minHeight: dimensions.height }}
    aria-label={`PDF 第 ${pageNumber} 页`}
  >
    {shouldRender && <><canvas ref={canvasRef}/><div ref={textLayerRef} className="pdf-text-layer textLayer"/>
      <div className="pdf-annotation-layer" aria-hidden="true">
        {highlights.flatMap(highlight => highlight.rects.map((rect, index) => <span
          className={`pdf-saved-highlight ${highlight.id === activeAnnotationId ? 'active' : ''}`}
          key={`${highlight.id}-${index}`}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />))}
      </div>
    </>}
    {!shouldRender && <div className="pdf-page-placeholder">第 {pageNumber} 页</div>}
    {error && <div className="pdf-page-error">{error}</div>}
    <span className="pdf-page-number">{pageNumber}</span>
  </section>
}

function StructuredDocument({ text, title }: { text?: string; title: string }) {
  return <article className="structured-reader">
    <header><span>派生阅读层</span><strong>{title}</strong></header>
    {text ? <pre>{text}</pre> : <div className="reader-empty-state"><BookOpen size={28}/><strong>尚无结构化版本</strong><span>可先阅读原 PDF，或使用本地 MinerU 生成 Markdown。</span></div>}
  </article>
}
function AgentModalV2({ settings, sourceCount, onClose, onCreate }: { settings: AISettings; sourceCount: number; onClose:()=>void; onCreate:()=>void }) {
  const [question, setQuestion] = useState('请作为批判性科研伙伴，审视当前研究假设，并指出最重要的证据缺口。')
  const [answer, setAnswer] = useState('“在线辨识更鲁棒”目前仍是合理推断，不能写成已被你的项目证实的事实。现有资料还缺少固定参数基线、多批次重复实验和一致工况下的对比。')
  const [busy, setBusy] = useState(false)
  const [papers, setPapers] = useState<Array<{ title: string; doi?: string; year?: string }>>([])
  const [notice, setNotice] = useState('')
  async function askModel() {
    if (!settings.baseUrl || !settings.model || !settings.apiKey) { setNotice('请先在“设置”中填写 OpenAI 兼容服务地址、模型和 API 密钥。'); return }
    setBusy(true); setNotice('正在将你的问题发送到已配置的服务；不会自动发送任何原文件。')
    try {
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` }, body: JSON.stringify({ model: settings.model, temperature: 0.2, messages: [{ role: 'system', content: '你是谨慎的科研助手。必须明确区分事实、推断和假设；无法验证时要说不知道。不要捏造文献。' }, { role: 'user', content: `项目：柔顺装配控制。已解析本地资料：${sourceCount} 份。问题：${question}` }] }) })
      if (!response.ok) throw new Error(`服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('服务没有返回可用内容。')
      setAnswer(content); setNotice('已收到回答。它仍是建议，生成行动包后需要你确认。')
    } catch (error) { setNotice(error instanceof Error ? `调用失败：${error.message}` : '调用失败。') } finally { setBusy(false) }
  }
  async function searchPapers() {
    setBusy(true); setNotice('正在按项目关键词检索 Crossref；只发送检索词，不发送你的资料。')
    try {
      const response = await fetch(`https://api.crossref.org/works?rows=5&query=${encodeURIComponent('adaptive impedance control compliant assembly')}`)
      if (!response.ok) throw new Error(`Crossref 返回 ${response.status}`)
      const data = await response.json() as { message?: { items?: Array<{ title?: string[]; DOI?: string; published?: { 'date-parts'?: number[][] } }> } }
      setPapers((data.message?.items ?? []).map(item => ({ title: item.title?.[0] ?? '未提供标题', doi: item.DOI, year: item.published?.['date-parts']?.[0]?.[0]?.toString() })))
      setNotice('公开检索完成；候选文献尚未导入你的项目。')
    } catch (error) { setNotice(error instanceof Error ? `检索失败：${error.message}` : '检索失败。') } finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><section className="agent-modal agent-modal-v2"><header><div><span className="agent-orb"><Sparkles size={18}/></span><div><p className="section-kicker">RESEARCH AGENT</p><h2>项目批判与行动建议</h2></div></div><button className="icon-button" onClick={onClose}><X/></button></header><div className="agent-context"><span><Files size={15}/> 依据 {sourceCount} 份已解析资料</span><span><Globe2 size={15}/> 手动触发公开检索</span></div><div className="agent-answer"><label className="agent-question">你想让 Agent 帮你审视什么？<textarea value={question} onChange={event => setQuestion(event.target.value)}/></label><div className="agent-actions"><button className="outline-button" disabled={busy} onClick={askModel}><Sparkles size={15}/> 用已配置 AI 分析</button><button className="outline-button" disabled={busy} onClick={searchPapers}><Globe2 size={15}/> 检索公开文献</button></div>{notice && <p className="agent-notice">{notice}</p>}<div className="agent-section"><h3>当前建议</h3><p>{answer}</p></div>{papers.length > 0 && <div className="paper-results"><h3>公开检索候选</h3>{papers.map(paper => <a key={`${paper.title}-${paper.doi}`} href={paper.doi ? `https://doi.org/${paper.doi}` : undefined} target="_blank" rel="noreferrer"><strong>{paper.title}</strong><small>{paper.year ?? '年份未知'}{paper.doi ? ` · DOI: ${paper.doi}` : ''}</small></a>)}</div>}</div><footer><p><strong>Agent 只提出建议。</strong>本次默认只发送你的问题；不会自动上传本地文件。</p><button className="primary-button" onClick={onCreate}><ClipboardCheck size={16}/> 生成待确认行动包</button></footer></section></div>
}
function SettingsModal({ settings, onClose, onSave }: { settings: AISettings; onClose:()=>void; onSave:(settings:AISettings)=>void }) {
  const [draft, setDraft] = useState({ ...defaultAISettings, ...settings })
  return <div className="modal-backdrop"><section className="annotation-modal settings-modal"><header><div><p className="section-kicker">LOCAL AI SETTINGS</p><h2>AI 与翻译设置</h2></div><button className="icon-button" onClick={onClose}><X/></button></header><p className="settings-note">划词翻译默认使用桌面端 Argos，不需要第三方 Token。解释和提问仍使用 OpenAI 兼容的 `/chat/completions` 接口，且只在你点击后发送当前选区。</p><label>划词翻译方式<select value={draft.translationProvider} onChange={event => setDraft({ ...draft, translationProvider: event.target.value as AISettings['translationProvider'] })}><option value="local">本地 Argos（推荐，不消耗 Token）</option><option value="ai">已配置的 AI 服务（会发送选区）</option></select></label><label>AI 服务地址<input value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1"/></label><label>模型名称<input value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} placeholder="例如 gpt-4.1-mini"/></label><label>API 密钥<input type="password" value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} placeholder="不会显示在界面上"/></label><label className="toggle-label"><input type="checkbox" checked={draft.allowFullDocument} onChange={event => setDraft({ ...draft, allowFullDocument: event.target.checked })}/>允许以后在你明确确认时发送整篇资料</label><footer><button className="outline-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => { onSave(draft); onClose() }}>保存本机设置</button></footer></section></div>
}

function WorkspaceCreationModal({
  directory,
  suggestedName,
  busy,
  onClose,
  onCreate,
}: {
  directory: string
  suggestedName: string
  busy: boolean
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const [step, setStep] = useState<'confirm' | 'name'>('confirm')
  const [name, setName] = useState(suggestedName)
  return <div className="modal-backdrop"><section className="annotation-modal workspace-create-modal">
    <header><div><p className="section-kicker">NEW RESEARCH LIBRARY</p><h2>{step === 'confirm' ? '这个文件夹还不是研究库' : '给研究库起个名字'}</h2></div><button className="icon-button" disabled={busy} onClick={onClose}><X/></button></header>
    {step === 'confirm' ? <div className="workspace-create-copy">
      <p>是否直接在这个文件夹中创建科研阅读工作库？</p>
      <code title={directory}>{directory}</code>
      <small>软件只会新增 vault.json、library.sqlite、papers、exports 和缓存目录，不会删除文件夹里已有的内容。</small>
    </div> : <label>研究库名称<input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="例如：柔顺装配控制"/></label>}
    <footer>
      <button className="outline-button" disabled={busy} onClick={step === 'name' ? () => setStep('confirm') : onClose}>{step === 'name' ? '上一步' : '取消'}</button>
      {step === 'confirm'
        ? <button className="primary-button" onClick={() => setStep('name')}>在这里创建</button>
        : <button className="primary-button" disabled={busy || !name.trim()} onClick={() => onCreate(name.trim())}>{busy ? '正在创建…' : '创建并打开'}</button>}
    </footer>
  </section></div>
}

function MineruConfirmModal({
  source,
  installing,
  installProgress,
  onClose,
  onInstall,
  onConfirm,
}: {
  source: Source
  installing: boolean
  installProgress: string
  onClose:()=>void
  onInstall:()=>Promise<boolean>
  onConfirm:()=>void
}) {
  const [status, setStatus] = useState<MineruStatus>()
  const [checking, setChecking] = useState(true)

  async function refreshStatus() {
    const desktop = window.readerDesktop
    if (!desktop) {
      setStatus({ available: false, backend: 'pipeline', localOnly: true, message: '浏览器预览不能安装本地组件；请打开桌面客户端。' })
      setChecking(false)
      return
    }
    setChecking(true)
    try {
      setStatus(await desktop.getMineruStatus())
    } catch (error) {
      setStatus({
        available: false,
        backend: 'pipeline',
        localOnly: true,
        message: error instanceof Error ? error.message : '无法检查本地 MinerU。',
      })
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { void refreshStatus() }, [])

  async function install() {
    if (await onInstall()) await refreshStatus()
  }

  return <div className="modal-backdrop"><section className="annotation-modal mineru-modal">
    <header><div><p className="section-kicker">MINERU LOCAL PARSE</p><h2>使用本地 MinerU 深度解析</h2></div><button className="icon-button" disabled={installing} onClick={onClose}><X/></button></header>
    <div className="mineru-copy">
      <p><strong>{source.name}</strong> 将由桌面客户端在本机解析，生成 Markdown、公式和图片资源。</p>
      <ul>
        <li>原文件不会上传到 MinerU 或其他云端服务。</li>
        <li>运行时安装在当前 Windows 用户的数据目录，不修改系统 Python。</li>
        <li>首次安装会联网下载开源依赖；首次解析可能继续下载模型。</li>
        <li>原 PDF 始终保留，已有批注和本地提取文本不会被覆盖。</li>
      </ul>
      <div className={`mineru-runtime-status ${status?.available ? 'ready' : 'missing'}`}>
        <span className="status-dot"/>
        <div><strong>{checking ? '正在检查本地组件…' : status?.available ? '本地组件已就绪' : '需要安装本地组件'}</strong><small>{installProgress || status?.message}</small></div>
      </div>
    </div>
    <footer>
      <button className="outline-button" disabled={installing} onClick={onClose}>取消</button>
      {!status?.available && <button className="primary-button" disabled={checking || installing || !window.readerDesktop} onClick={install}>{installing ? '正在安装，请勿关闭…' : '安装本地 MinerU'}</button>}
      {status?.available && <button className="primary-button" disabled={installing} onClick={onConfirm}>开始本地解析</button>}
    </footer>
  </section></div>
}
function AgentModal({ onClose, onCreate }: { onClose:()=>void; onCreate:()=>void }) { return <div className="modal-backdrop"><section className="agent-modal"><header><div><span className="agent-orb"><Sparkles size={18}/></span><div><p className="section-kicker">RESEARCH AGENT</p><h2>项目批判与行动建议</h2></div></div><button className="icon-button" onClick={onClose}><X/></button></header><div className="agent-answer"><p>旧版 Agent 面板。</p></div><footer><button className="primary-button" onClick={onCreate}>生成行动包</button></footer></section></div> }
function AnnotationModalV2({ source, draft, onClose, onSave }: { source?: Source; draft: AnnotationDraft; onClose:()=>void; onSave:(category:string,note:string,text:string,location:string)=>void }) {
  const [category, setCategory] = useState(categories[0]); const [note, setNote] = useState(''); const [text, setText] = useState(draft.text ?? ''); const [location, setLocation] = useState(draft.location ?? (source?.kind === 'PDF' ? 'p. 1' : '段落/页码（可选）'))
  return <div className="modal-backdrop"><section className="annotation-modal"><header><div><p className="section-kicker">TRACEABLE ANNOTATION</p><h2>添加研究批注</h2></div><button className="icon-button" onClick={onClose}><X/></button></header><p className="annotation-source">资料：{source?.name ?? '未选择资料'}。请粘贴你要保留的原文摘录；它不会自动发送到 AI。</p><label>原文摘录<textarea value={text} onChange={event => setText(event.target.value)} placeholder="粘贴或输入关键原文；例如论文中的结论、方法或限制。"/></label><label>页码或位置<input value={location} onChange={event => setLocation(event.target.value)} placeholder="例如 p. 7 · Fig. 5"/></label><label>这段内容对研究的意义<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select></label><label>你的备注（可选）<textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="例如：可作为在线辨识方案的理论依据，但需要核对实验条件。"/></label><footer><button className="outline-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!text.trim()} onClick={()=>onSave(category,note,text.trim(),location.trim() || '未标注位置')}>保存并关联原文</button></footer></section></div>
}
function AnnotationModal({ onClose, onSave }: { onClose:()=>void; onSave:(category:string,note:string)=>void }) { const [category, setCategory] = useState(categories[0]); const [note, setNote] = useState(''); return <div className="modal-backdrop"><section className="annotation-modal"><header><div><p className="section-kicker">TRACEABLE ANNOTATION</p><h2>添加研究批注</h2></div><button className="icon-button" onClick={onClose}><X/></button></header><blockquote>“The controller adapts the impedance parameters based on contact force feedback.”<small>p. 7 · §3.2</small></blockquote><label>这段内容对研究的意义<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>你的备注（可选）<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：可作为在线辨识方案的理论依据，但需要核对实验条件。"/></label><footer><button className="outline-button" onClick={onClose}>取消</button><button className="primary-button" onClick={()=>onSave(category,note)}>保存并关联原文</button></footer></section></div> }
function kindOf(name:string): SourceKind { const ext = name.split('.').pop()?.toLowerCase(); if (ext === 'pdf') return 'PDF'; if (ext === 'doc' || ext === 'docx') return 'Word'; if (ext === 'ppt' || ext === 'pptx') return 'PPT'; if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return '表格'; return 'Markdown' }
function useStored<T>(key:string, fallback:T, persist = true) { const [value, setValue] = useState<T>(()=>{ try { const saved=localStorage.getItem(key); return saved ? JSON.parse(saved) as T : fallback } catch { return fallback } }); useEffect(()=>{ if (persist) localStorage.setItem(key, JSON.stringify(value)) },[key,persist,value]); return [value,setValue] as const }

async function getStoredSourceFile(source: Source) {
  if (source.fileId) {
    const local = await getLocalFile(source.fileId)
    if (local) return local
  }
  const desktop = window.readerDesktop
  if (!desktop) return undefined
  const stored = await desktop.readWorkspaceSourceFile({ sourceId: source.id })
  const bytes = new Uint8Array(stored.bytes).buffer
  return new File([bytes], stored.fileName)
}

createRoot(document.getElementById('root')!).render(<App />)
