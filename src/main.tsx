import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { Group as ResizableGroup, Panel as ResizablePanel, Separator as ResizableSeparator } from 'react-resizable-panels'
import xiaoheLogoMark from '../brand/xiaohe-logo-mark.svg'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Bug, Check, ChevronRight, ClipboardCheck, Cloud,
  CircleDot, Columns2, Download, Expand, ExternalLink, FileText, GitBranch, HardDrive, Languages, Link2,
  FilePlus2, Files, FlaskConical, Globe2, Highlighter,
  LayoutDashboard, Menu, MessageSquareText, Minus, MoreHorizontal, PanelLeft,
  Mail, PanelRight, Pencil, Plus, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X
} from 'lucide-react'
import './styles.css'
import './functional.css'
import './library.css'
import './review.css'
import './evidence.css'
import './action-pack.css'
import './reader.css'
import './desktop-ui.css'
import './research-review.css'
import './citation.css'
import './structured-reading.css'
import './today-research.css'
import './research-tasks.css'
import 'katex/dist/katex.min.css'
import {
  fileHash,
  kindOf as detectedKind,
  cleanupPdfDocumentWhenIdle,
  loadPdfDocument,
  parseFile,
  pdfPageCount,
  renderPdfPageWithTextLayer,
  renderPdfThumbnail,
  type ImportedKind,
  type LocalPdfDocument,
} from './file-processing'
import { getLocalFile, saveLocalFile } from './local-files'
import { searchLocalLibrary, searchTerms, type LocalSearchResult } from './local-search.mjs'
import { annotationHighlightsForPage, annotationPage } from './annotation-anchor.mjs'
import { buildReviewAIRequest, parseReviewAISections } from './review-ai.mjs'
import { clampReaderZoom, readerZoomAfterWheel } from './reader-zoom.mjs'
import {
  loadPdfOutline,
  normalizeReaderSourceState,
  restoredReaderPage,
  searchPdfDocument,
  type PdfOutlineEntry,
  type PdfSearchResult,
  type ReaderSourceState,
} from './pdf-navigation.mjs'
import { readingProgressLabel, reviewAnnotationCounts, reviewAnnotationsForItems } from './review-selection.mjs'
import {
  buildPaperLibraryRows,
  paperLibrarySummary,
  readingProgressPercent,
  unboundLibrarySources,
} from './library-papers.mjs'
import {
  ACADEMIC_MARKDOWN_SKILL,
  buildAcademicMarkdownAIRequest,
  parseAcademicMarkdownBoundaries,
  validAcademicMarkdownLayout,
  type AcademicMarkdownLayout,
} from './academic-markdown-skill.mjs'
import {
  locateQuoteInMarkdown,
  markdownReadingBlocks,
  markdownSelectionAnchor,
  type MineruLayoutBlock,
} from './markdown-anchor.mjs'
import {
  agentQueryTerms,
  agentRetrievalQuestion,
  buildResearchAgentRequest,
  mergeAgentSearchResponses,
  parseResearchAgentAnswer,
  parseResearchAgentActions,
  readerContextEvidence,
  researchWorkspaceEvidence,
} from './research-agent.mjs'
import {
  buildPaperReadingCardRequest,
  parsePaperReadingCardAnswer,
} from './paper-reading-card.mjs'
import BilingualDocument from './BilingualDocument'
import { prepareTranslationSelection } from './bilingual-reading.mjs'
import ResearchCommandCenter from './ResearchCommandCenter'
import ResearchReviewWorkspace from './ResearchReviewWorkspace'
import TodayResearch, { ResearchReturnGreeting } from './TodayResearch'
import ResearchTasks from './ResearchTasks'
import ReaderViewBoundary from './features/reader/ReaderViewBoundary'
import VersionedStructuredReading from './features/reader/VersionedStructuredReading'
import {
  CitationButton,
  CitationDialog,
  CitationImportPanel,
  type CitationItemView,
  type CitationView,
} from './features/citations/CitationControls'
import { useDialogKeyboard } from './use-dialog-keyboard'

const feedbackIssueUrl = 'https://github.com/1dlbbbdbd1/he-research-reader/issues/new/choose'
const feedbackEmailUrl = 'mailto:hzh1144@163.com?subject=H%E2%80%99s%20%E7%A7%91%E7%A0%94%E5%8A%A9%E6%89%8B%E9%97%AE%E9%A2%98%E5%8F%8D%E9%A6%88'

type SourceKind = ImportedKind
type EvidenceStatus = '事实' | '推断' | '假设'
type Source = {
  id: string
  bibliographicItemId?: string
  name: string
  kind: SourceKind
  version: number
  updated: string
  status: '已解析' | '待解析' | '需重新分析' | '解析失败'
  pages?: number
  fileId?: string
  hash?: string
  extractedText?: string
  isDemo?: boolean
  error?: string
  mineruState?: '未使用' | '准备中' | '解析中' | '完成' | '失败'
  mineruMarkdown?: string
  mineruError?: string
  mineruProgress?: string
  mineruOutputDirectory?: string
  mineruBackend?: 'pipeline'
  mineruRevision?: string
  mineruAssetRootRelative?: string
  mineruMarkdownFileRelative?: string
  mineruMarkdownSha256?: string
  mineruGeneratedAt?: string
  markdownLayout?: AcademicMarkdownLayout
  readerState?: ReaderSourceState
}
type Claim = { id: string; title: string; source: string; location: string; status: EvidenceStatus; strength: '强' | '中' | '待验证' }
type Annotation = {
  id: string
  text: string
  category: string
  page: string
  note: string
  sourceId?: string
  bibliographicItemId?: string
  sourceName?: string
  paperTitle?: string
  anchor?: FragmentAnchor
  taskStatus?: DesktopResearchTaskStatus
}
type Action = { id: string; title: string; type: '阅读' | '实验' | '确认'; reason: string; done: boolean }
type ResearchRecordType = 'log' | 'experiment' | 'dataset' | 'decision' | 'milestone'
type ResearchRecordStatus = 'planned' | 'active' | 'completed' | 'blocked' | 'archived'
type ResearchRecord = {
  id: string
  recordType: ResearchRecordType
  title: string
  content: string
  status: ResearchRecordStatus
  occurredAt: string
  filePath?: string
  sourceIds: string[]
  tags: string[]
  createdAt: string
  updatedAt: string
}
type ResearchWorkspace = {
  project: {
    id: string
    name: string
    researchQuestion: string
    currentHypothesis: string
    stage: string
    mode: DesktopResearchProjectMode
    updatedAt: string
  }
  records: ResearchRecord[]
  milestones: DesktopResearchMilestone[]
  runs: DesktopResearchRun[]
  artifacts: DesktopResearchArtifact[]
  runTemplates: DesktopResearchRunTemplate[]
  reports: DesktopResearchReport[]
  claims: DesktopResearchClaim[]
  history: DesktopResearchProjectHistoryEntry[]
}
type ResearchDesktopBridge = {
  getResearchWorkspace?: () => Promise<ResearchWorkspace>
  saveResearchProject?: (input: Pick<ResearchWorkspace['project'], 'name' | 'researchQuestion' | 'currentHypothesis' | 'stage' | 'mode'>) => Promise<ResearchWorkspace>
  saveResearchRecord?: (input: Partial<ResearchRecord> & Pick<ResearchRecord, 'recordType' | 'title' | 'status'>) => Promise<ResearchWorkspace>
  saveResearchMilestone?: (input: DesktopResearchMilestoneInput) => Promise<ResearchWorkspace>
  saveResearchRun?: (input: DesktopResearchRunInput) => Promise<ResearchWorkspace>
  saveResearchRunTemplate?: (input: DesktopResearchRunTemplateInput) => Promise<ResearchWorkspace>
  saveResearchArtifact?: (input: DesktopResearchArtifactInput) => Promise<ResearchWorkspace>
  selectResearchArtifactPath?: (input?: { kind?: 'file' | 'directory' }) => Promise<{ canceled: boolean; filePath?: string }>
}
type AISettings = {
  baseUrl: string
  model: string
  apiKey: string
  allowFullDocument: boolean
  translationProvider: 'local' | 'ai'
}
type UISettings = DesktopUISettings
type AnnotationDraft = { text?: string; location?: string; anchor?: FragmentAnchor }
type ReaderJumpTarget = { sourceId: string; pageNumber: number; anchor?: FragmentAnchor; nonce: string }
type LegacyWorkspaceSnapshot = { sources: Source[]; annotations: Annotation[] }
type FragmentAnchor = {
  type: 'pdf' | 'markdown' | 'text' | 'legacy'
  state: 'resolved' | 'unresolved'
  pageNumber?: number
  rects?: Array<{ x: number; y: number; width: number; height: number }>
  quote?: { exact: string; prefix?: string; suffix?: string }
  markdownBlockId?: string
  sourceContentSha256?: string
  legacyLocatorText?: string
}
type BibliographicSummary = {
  id: string
  title: string
  itemType: string
  authors: Array<{ family?: string; given?: string; literal?: string }>
  issued?: string
  accessed?: string
  containerTitle?: string
  publisher?: string
  publisherPlace?: string
  volume?: string
  issue?: string
  pages?: string
  language?: string
  abstract?: string
  keywords: string[]
  identifiers: Record<string, string[]>
  needsMetadataReview: boolean
  attachmentCount: number
  attachmentState: 'unknown' | 'found' | 'missing' | 'denied'
  sourceId?: string
  annotationCount: number
  readingState: PaperReadingState
  citation: CitationView
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
type EvidenceScope = { kind: 'all' } | { kind: 'item'; id: string } | { kind: 'document'; id: string }
type AgentActionProposal = {
  actionType: 'read' | 'compare' | 'verify' | 'experiment' | 'review' | 'note'
  title: string
  rationale: string
  citationIds: string[]
}
type AgentActionPackDraft = {
  title: string
  objective: string
  scope: { kind: 'current' | 'selected' | 'library'; label: string; itemIds: string[] }
  provider?: string
  model?: string
  generationRunId?: string
  actions: Array<Omit<AgentActionProposal, 'citationIds'> & { evidence: ActionEvidenceInput[] }>
}
type AgentScope = 'selection' | 'page' | 'current' | 'selected' | 'library'
type AgentReaderContext = {
  sourceId: string
  sourceName: string
  itemId?: string
  paperTitle: string
  pageNumber?: number
  pageText?: string
  viewMode: ReaderViewMode
  readingStatus?: PaperReadingState['readingStatus']
  annotationCount: number
  selection?: { text: string; anchor?: FragmentAnchor }
}
type AgentTurn = {
  id: string
  question: string
  scopeLabel: string
  sections: Array<{ content: string; citationIds: string[] }>
  evidence: Array<DesktopLibrarySearchResult & { score: number }>
  contexts: Array<{ evidenceId: string }>
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
const defaultUISettings: UISettings = {
  uiScale: 1,
  density: 'comfortable',
  surfaceTone: 'neutral',
  accentColor: 'slate',
  readerFontSize: 16,
  readerLineHeight: 1.8,
  readerWidth: 820,
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
  const [uiSettings, setUISettings] = useStored<UISettings>('ra.ui-settings', defaultUISettings, browserStorage)
  const [credentialState, setCredentialState] = useState<'empty' | 'encrypted' | 'unavailable'>('empty')
  const [settingsLoaded, setSettingsLoaded] = useState(!window.readerDesktop)
  const [aiOnboardingRequired, setAIOnboardingRequired] = useState(false)
  const [active, setActive] = useState<DesktopResearchResumeView>('today')
  const [selectedSource, setSelectedSource] = useState(sources[0]?.id ?? '')
  const [agentOpen, setAgentOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null)
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation>()
  const [archivedAnnotation, setArchivedAnnotation] = useState<Annotation>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [mineruTarget, setMineruTarget] = useState<Source | undefined>()
  const [mineruInstalling, setMineruInstalling] = useState(false)
  const [mineruInstallProgress, setMineruInstallProgress] = useState('')
  const [readerJumpTarget, setReaderJumpTarget] = useState<ReaderJumpTarget>()
  const [librarySearchRequest, setLibrarySearchRequest] = useState(0)
  const [workspace, setWorkspace] = useState<WorkspaceSummary>()
  const [researchWorkspace, setResearchWorkspace] = useStored<ResearchWorkspace | undefined>('ra.research-workspace', undefined, browserStorage)
  const [researchResume, setResearchResume] = useState<DesktopResearchResumeState>()
  const [returnGreetingOpen, setReturnGreetingOpen] = useState(false)
  const [researchResumeReady, setResearchResumeReady] = useState(false)
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('我的研究库')
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceCreationRequest, setWorkspaceCreationRequest] = useState<{
    creationRequestId: string
    directory: string
    suggestedName: string
    existingPaperCount: number
    existingPaperNames: string[]
  }>()
  const [legacySnapshot] = useState<LegacyWorkspaceSnapshot>(() => ({
    sources,
    annotations,
  }))
  const [reviewDocuments, setReviewDocuments] = useState<ReviewDocumentSummary[]>([])
  const [activeReview, setActiveReview] = useState<ReviewDocumentView>()
  const [evidenceGraph, setEvidenceGraph] = useState<EvidenceGraphView>()
  const [evidenceScope, setEvidenceScope] = useState<EvidenceScope>({ kind: 'all' })
  const [evidenceGraphBusy, setEvidenceGraphBusy] = useState(false)
  const [actionPacks, setActionPacks] = useState<ActionPackSummary[]>([])
  const [researchTasks, setResearchTasks] = useState<DesktopResearchTaskList>()
  const [researchTaskBusy, setResearchTaskBusy] = useState(false)
  const [researchTaskError, setResearchTaskError] = useState('')
  const [taskSourcePackOpen, setTaskSourcePackOpen] = useState(false)
  const [activeActionPack, setActiveActionPack] = useState<ActionPackView>()
  const [citationDialog, setCitationDialog] = useState<{ item: CitationItemView; reason?: string }>()
  const [bibliographyImportResult, setBibliographyImportResult] = useState<{ itemIds: string[]; alreadyImported: boolean }>()
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const selected = sources.find(s => s.id === selectedSource) ?? sources[0]
  const selectedPaper = bibliographicItems.find(item => item.id === selected?.bibliographicItemId || item.sourceId === selected?.id)
  const evidenceCounts = useMemo(() => ({ fact: claims.filter(c => c.status === '事实').length, infer: claims.filter(c => c.status === '推断').length, hypo: claims.filter(c => c.status === '假设').length }), [claims])
  const legacySourceCount = legacySnapshot.sources.filter(source => !source.isDemo).length

  useEffect(() => {
    const desktop = window.readerDesktop
    if (!desktop) return
    let disposed = false
    desktop.loadAppSettings()
      .then(settings => {
        if (disposed) return
        setAISettings({ ...defaultAISettings, ...settings.ai })
        setUISettings({ ...defaultUISettings, ...settings.ui })
        setCredentialState(settings.credentialState ?? 'empty')
        const missingAI = !settings.ai.model?.trim() || !settings.ai.apiKey?.trim() || !settings.ai.baseUrl?.trim()
        setAIOnboardingRequired(missingAI)
        setSettingsLoaded(true)
      })
      .catch(error => {
        setSettingsLoaded(true)
        setAIOnboardingRequired(true)
        notify(error instanceof Error ? error.message : '桌面设置读取失败。')
      })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (active !== 'evidence') return
    void loadEvidenceGraph(evidenceScope)
  }, [active, workspace?.id, evidenceScope.kind, evidenceScope.kind === 'all' ? '' : evidenceScope.id])

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
          setActionPacks([])
          setResearchTasks(undefined)
          setActiveReview(undefined)
          setActiveActionPack(undefined)
          setResearchWorkspace(undefined)
          return
        }
        const library = await desktop.loadWorkspaceLibrary()
        const [reviews, packs, resume, tasks] = await Promise.all([
          desktop.listReviewDocuments(),
          desktop.listActionPacks(),
          desktop.beginResearchSession(),
          desktop.listResearchTasks(),
        ])
        if (disposed) return
        setWorkspace(current)
        setSources(library.sources as Source[])
        setAnnotations(library.annotations as Annotation[])
        setBibliographicItems(library.bibliographicItems as BibliographicSummary[])
        setResearchWorkspace((library as WorkspaceLibraryState & { researchWorkspace?: ResearchWorkspace }).researchWorkspace)
        setReviewDocuments(reviews)
        setActionPacks(packs)
        setResearchTasks(tasks)
        setResearchResume(resume)
        setResearchResumeReady(true)
        setReturnGreetingOpen(true)
        const restoredSource = (library.sources as Source[]).find(source => source.id === resume.sourceId)
        setSelectedSource(restoredSource?.id ?? (library.sources[0] as Source | undefined)?.id ?? '')
        setActive('today')
      })
      .catch(error => notify(error instanceof Error ? error.message : '研究库初始化失败。'))
    return () => { disposed = true }
  }, [])

  async function saveResearchProject(project: Pick<ResearchWorkspace['project'], 'name' | 'researchQuestion' | 'currentHypothesis' | 'stage' | 'mode'>) {
    const bridge = window.readerDesktop as (typeof window.readerDesktop & ResearchDesktopBridge) | undefined
    if (bridge?.saveResearchProject) {
      const saved = await bridge.saveResearchProject(project)
      setResearchWorkspace(saved)
      setWorkspace(current => current ? { ...current, name: saved.project.name, updatedAt: saved.project.updatedAt } : current)
      notify('课题定位已保存到当前研究库。')
      return
    }
    if (!window.readerDesktop) {
      const timestamp = new Date().toISOString()
      setResearchWorkspace(current => ({
        project: { id: current?.project.id ?? 'browser-research-project', ...project, updatedAt: timestamp },
        records: current?.records ?? [],
        milestones: current?.milestones ?? [], runs: current?.runs ?? [], artifacts: current?.artifacts ?? [],
        runTemplates: current?.runTemplates ?? [], reports: current?.reports ?? [], claims: current?.claims ?? [], history: current?.history ?? [],
      }))
      notify('课题定位已保存到浏览器预览。')
      return
    }
    throw new Error('桌面保存接口尚未接通。当前内容没有写入研究库。')
  }

  async function saveResearchRecord(record: Partial<ResearchRecord> & Pick<ResearchRecord, 'recordType' | 'title' | 'status'>) {
    const bridge = window.readerDesktop as (typeof window.readerDesktop & ResearchDesktopBridge) | undefined
    if (bridge?.saveResearchRecord) {
      const saved = await bridge.saveResearchRecord(record)
      setResearchWorkspace(saved)
      notify('科研记录已写入当前研究库。')
      return
    }
    if (!window.readerDesktop) {
      const timestamp = new Date().toISOString()
      const nextRecord: ResearchRecord = {
        id: record.id ?? crypto.randomUUID(), recordType: record.recordType, title: record.title,
        content: record.content ?? '', status: record.status, occurredAt: record.occurredAt ?? timestamp,
        filePath: record.filePath, sourceIds: record.sourceIds ?? [], tags: record.tags ?? [],
        createdAt: record.createdAt ?? timestamp, updatedAt: timestamp,
      }
      setResearchWorkspace(current => ({
        project: current?.project ?? { id: 'browser-research-project', name: '我的研究课题', researchQuestion: '', currentHypothesis: '', stage: '探索中', mode: 'exploration', updatedAt: timestamp },
        records: [nextRecord, ...(current?.records ?? []).filter(item => item.id !== nextRecord.id)],
        milestones: current?.milestones ?? [], runs: current?.runs ?? [], artifacts: current?.artifacts ?? [],
        runTemplates: current?.runTemplates ?? [], reports: current?.reports ?? [], claims: current?.claims ?? [], history: current?.history ?? [],
      }))
      notify('科研记录已保存到浏览器预览。')
      return
    }
    throw new Error('桌面保存接口尚未接通。当前记录没有写入研究库。')
  }

  async function saveResearchMilestone(input: DesktopResearchMilestoneInput) {
    const bridge = window.readerDesktop as (typeof window.readerDesktop & ResearchDesktopBridge) | undefined
    if (bridge?.saveResearchMilestone) {
      const saved = await bridge.saveResearchMilestone(input)
      setResearchWorkspace(saved)
      notify('里程碑已保存；验收条件仍由你确认。')
      return
    }
    throw new Error('里程碑需要在桌面研究库中保存。')
  }

  async function saveResearchRun(input: DesktopResearchRunInput) {
    const bridge = window.readerDesktop as (typeof window.readerDesktop & ResearchDesktopBridge) | undefined
    if (bridge?.saveResearchRun) {
      const saved = await bridge.saveResearchRun(input)
      setResearchWorkspace(saved)
      if (window.readerDesktop) setResearchResume(await window.readerDesktop.getResearchResume())
      notify('本次测试已保存，并保留参数、异常和下一步。')
      return saved
    }
    throw new Error('测试记录需要在桌面研究库中保存。')
  }

  async function saveResearchRunTemplate(input: DesktopResearchRunTemplateInput) {
    const bridge = window.readerDesktop as (typeof window.readerDesktop & ResearchDesktopBridge) | undefined
    if (bridge?.saveResearchRunTemplate) {
      const saved = await bridge.saveResearchRunTemplate(input)
      setResearchWorkspace(saved)
      notify('自定义测试模板已保存到当前研究库。')
      return
    }
    throw new Error('自定义模板需要在桌面研究库中保存。')
  }

  async function registerResearchArtifact(runId: string, kind: 'file' | 'directory') {
    const bridge = window.readerDesktop as (typeof window.readerDesktop & ResearchDesktopBridge) | undefined
    if (!bridge?.selectResearchArtifactPath || !bridge.saveResearchArtifact) throw new Error('产物登记需要在桌面客户端中运行。')
    const choice = await bridge.selectResearchArtifactPath({ kind })
    if (choice.canceled || !choice.filePath) return
    const pathParts = choice.filePath.split(/[\\/]/).filter(Boolean)
    const label = pathParts[pathParts.length - 1] || '测试产物'
    const saved = await bridge.saveResearchArtifact({ runId, filePath: choice.filePath, label, role: kind === 'directory' ? 'directory' : 'other' })
    setResearchWorkspace(saved)
    notify('文件只登记在原位置，没有移动或复制。')
  }

  async function refreshResearchWorkspace() {
    const desktop = window.readerDesktop
    if (!desktop) return
    setResearchWorkspace(await desktop.getResearchWorkspace() as ResearchWorkspace)
  }

  async function saveResearchReport(input: DesktopResearchReportInput) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('科研报告需要在桌面研究库中保存。')
    const saved = await desktop.saveResearchReport(input)
    await refreshResearchWorkspace()
    notify('报告草稿已保存；尚未成为正式科研记录。')
    return saved
  }

  async function confirmResearchReport(id: string) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('科研报告需要在桌面研究库中确认。')
    const saved = await desktop.confirmResearchReport({ id })
    await refreshResearchWorkspace()
    notify('报告已由你确认，并保留来源与修订版本。')
    return saved
  }

  async function exportResearchReport(id: string) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('报告导出需要在桌面客户端中运行。')
    const result = await desktop.exportResearchReport({ id, destination: 'save_as' })
    if (!result.canceled && result.filePath) notify(`报告已导出到 ${result.filePath}`)
  }

  async function exportPortableMarkdown(kind: 'reading_card' | 'review_document' | 'experiment_retrospective' | 'research_report', id: string) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('可迁移 Markdown 需要在桌面客户端中导出。')
    const result = await desktop.exportPortableMarkdown({ kind, id })
    if (!result.canceled && result.filePath) notify(`可迁移 Markdown 已导出到 ${result.filePath}`)
  }

  async function saveResearchClaim(input: DesktopResearchClaimInput) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('论文论断需要在桌面研究库中保存。')
    const saved = await desktop.saveResearchClaim(input)
    await refreshResearchWorkspace()
    notify(saved.status === 'confirmed' ? '正式论断已确认，并锁定当前证据版本。' : '论断草稿已保存；尚未确认为正式结论。')
    return saved
  }

  async function archiveResearchClaim(id: string) {
    if (!window.confirm('确认归档这条论文论断？历史版本仍会保留。')) return
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('论文论断需要在桌面研究库中归档。')
    await desktop.archiveResearchClaim({ id })
    await refreshResearchWorkspace()
    notify('论文论断已归档，历史版本仍然保留。')
  }

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
    if (!desktop || !workspace || !researchResumeReady || active === 'today') return
    const timer = window.setTimeout(() => {
      const activeRunId = researchResume?.activeRunId
        ?? researchWorkspace?.runs.find(run => run.outcome === 'running')?.id
        ?? researchWorkspace?.runs.find(run => run.outcome === 'planned')?.id
      void desktop.saveResearchResume({
        projectId: workspace.projectId,
        activeView: active,
        sourceId: selected?.id || null,
        pageNumber: selectedPaper?.readingState.lastPage ?? null,
        readerMode: selected?.readerState?.viewMode ?? null,
        activeRunId: activeRunId ?? null,
      }).then(setResearchResume).catch(error => notify(error instanceof Error ? error.message : '科研现场保存失败。'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [
    workspace?.id,
    active,
    selected?.id,
    selected?.readerState?.viewMode,
    selectedPaper?.readingState.lastPage,
    researchResume?.activeRunId,
    researchResumeReady,
  ])

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

  function notify(message: string, keepArchiveUndo = false) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    if (!keepArchiveUndo) setArchivedAnnotation(undefined)
    setToast(message)
    toastTimer.current = window.setTimeout(() => {
      setToast('')
      setArchivedAnnotation(undefined)
    }, 4200)
  }

  async function activateWorkspace(next: WorkspaceSummary) {
    const desktop = window.readerDesktop
    if (!desktop) return
    const library = await desktop.loadWorkspaceLibrary()
    const [reviews, packs, resume] = await Promise.all([
      desktop.listReviewDocuments(),
      desktop.listActionPacks(),
      desktop.getResearchResume(),
    ])
    setWorkspace(next)
    setSources(library.sources as Source[])
    setAnnotations(library.annotations as Annotation[])
    setBibliographicItems(library.bibliographicItems as BibliographicSummary[])
    setResearchWorkspace((library as WorkspaceLibraryState & { researchWorkspace?: ResearchWorkspace }).researchWorkspace)
    setReviewDocuments(reviews)
    setActionPacks(packs)
    setResearchTasks(await desktop.listResearchTasks())
    setResearchResume(resume)
    setResearchResumeReady(true)
    setActiveReview(undefined)
    setActiveActionPack(undefined)
    setEvidenceGraph(undefined)
    setEvidenceScope({ kind: 'all' })
    const restoredSource = (library.sources as Source[]).find(source => source.id === resume.sourceId)
    setSelectedSource(restoredSource?.id ?? (library.sources[0] as Source | undefined)?.id ?? '')
    setActive('today')
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
          existingPaperCount: result.existingPaperCount ?? 0,
          existingPaperNames: result.existingPaperNames ?? [],
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

  async function createWorkspaceInSelectedFolder(name: string, manageExistingPapers: boolean) {
    const desktop = window.readerDesktop
    const request = workspaceCreationRequest
    if (!desktop || !request) return
    setWorkspaceBusy(true)
    try {
      const result = await desktop.createWorkspaceInSelectedFolder({
        creationRequestId: request.creationRequestId,
        name,
        manageExistingPapers,
      })
      if (result.canceled || !result.vault) return
      setWorkspaceCreationRequest(undefined)
      await activateWorkspace(result.vault)
      notify(result.importedPaperCount
        ? `已创建研究库，并纳入 ${result.importedPaperCount} 篇现有论文。原文件仍保留。`
        : `已在所选文件夹创建研究库“${result.vault.name}”；原有文件没有被删除。`)
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
      setBibliographyImportResult({ itemIds: result.itemIds, alreadyImported: result.alreadyImported })
      if (result.alreadyImported) {
        notify(`这份 ${result.format} 已导入过，没有重复建立记录。`)
      } else {
        notify(`已导入 ${result.itemCount} 条题录；${result.copiedSourceCount} 份 PDF 已进入当前研究库。`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : '题录导入失败，数据库事务已回滚。')
    }
  }

  async function copyCitation(item: CitationItemView) {
    try {
      if (window.readerDesktop) {
        await window.readerDesktop.writeClipboardText({ text: item.citation.text })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.citation.text)
      } else {
        throw new Error('当前环境没有可用的剪贴板接口。')
      }
      notify('已复制 GB/T 7714—2015 引用')
    } catch (error) {
      setCitationDialog({
        item,
        reason: error instanceof Error ? error.message : '系统剪贴板写入失败。',
      })
    }
  }

  async function loadEvidenceGraph(scope: EvidenceScope = evidenceScope) {
    setEvidenceGraphBusy(true)
    try {
      const desktop = window.readerDesktop
      if (!desktop) {
        setEvidenceGraph(buildBrowserEvidenceGraph(sources, annotations))
        return
      }
      const input = scope.kind === 'document'
        ? { documentId: scope.id }
        : scope.kind === 'item'
          ? { itemIds: [scope.id] }
          : undefined
      setEvidenceGraph(await desktop.getEvidenceGraph(input))
    } catch (error) {
      notify(error instanceof Error ? error.message : '证据关系读取失败。')
      setEvidenceGraph(undefined)
    } finally {
      setEvidenceGraphBusy(false)
    }
  }

  async function createEvidenceRelation(input: {
    fromFragmentId: string
    toFragmentId: string
    relation: 'supports' | 'refutes' | 'mentions'
    rationale: string
  }) {
    const desktop = window.readerDesktop
    if (!desktop) {
      notify('人工证据关系只在桌面客户端中写入研究库。')
      return false
    }
    try {
      const result = await desktop.createEvidenceRelation(input)
      await loadEvidenceGraph(evidenceScope)
      notify(result.change === 'reopened'
        ? '已重新确认关系；此前的撤销记录仍保留。'
        : result.change === 'unchanged'
          ? '这条证据关系已经存在。'
          : '证据关系和判断理由已保存。')
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : '证据关系保存失败。')
      return false
    }
  }

  async function reviewEvidenceRelation(relationId: string, decision: 'accept' | 'reject') {
    const desktop = window.readerDesktop
    if (!desktop) return false
    try {
      await desktop.reviewEvidenceRelation({ relationId, decision })
      await loadEvidenceGraph(evidenceScope)
      notify(decision === 'accept' ? '已采纳这条关系建议。' : '已撤销这条关系；审计记录仍保留。')
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : '证据关系审核失败。')
      return false
    }
  }

  function openEvidence(scope: EvidenceScope = { kind: 'all' }) {
    setEvidenceScope(scope)
    setActive('evidence')
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

  async function confirmReviewDocument(documentId: string) {
    const desktop = window.readerDesktop
    if (!desktop) return
    if (!window.confirm('确认这份复查文档中的来源内容无误？\n\n无证据推断仍会被排除；确认后才能导出正式可迁移 Markdown。')) return
    try {
      const confirmed = await desktop.confirmReviewDocument({ documentId })
      setActiveReview(confirmed)
      setReviewDocuments(await desktop.listReviewDocuments())
      notify('复查文档已确认，可以导出可迁移 Markdown。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '复查文档确认失败。')
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
    const an: Annotation = {
      id: crypto.randomUUID(),
      sourceId: selected?.id,
      bibliographicItemId: selectedPaper?.id,
      sourceName: selected?.name,
      paperTitle: selectedPaper?.title ?? selected?.name.replace(/\.pdf$/i, ''),
      text,
      category,
      page: location,
      note,
      anchor: annotationDraft?.anchor,
    }
    setAnnotations(current => [an, ...current]); setAnnotationDraft(null); notify('批注已保存，并保留当前原文页码。')
  }
  async function reviseAnnotation(annotation: Annotation, category: string, note: string) {
    try {
      const next = window.readerDesktop
        ? await window.readerDesktop.reviseAnnotation({ annotationId: annotation.id, category, note }) as Annotation
        : { ...annotation, category, note }
      setAnnotations(current => current.map(item => item.id === annotation.id ? next : item))
      setEditingAnnotation(undefined)
      notify('批注已更新；旧笔记版本仍保留在研究库中。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '批注更新失败。')
    }
  }
  async function archiveAnnotation(annotation: Annotation) {
    try {
      if (window.readerDesktop) await window.readerDesktop.archiveAnnotation({ annotationId: annotation.id })
      setAnnotations(current => current.filter(item => item.id !== annotation.id))
      setArchivedAnnotation(annotation)
      notify('批注已移入归档，可立即撤销。', true)
    } catch (error) {
      notify(error instanceof Error ? error.message : '批注归档失败。')
    }
  }
  async function restoreArchivedAnnotation() {
    const annotation = archivedAnnotation
    if (!annotation) return
    try {
      const restored = window.readerDesktop
        ? await window.readerDesktop.restoreAnnotation({ annotationId: annotation.id }) as Annotation
        : annotation
      setAnnotations(current => [restored, ...current.filter(item => item.id !== restored.id)])
      setArchivedAnnotation(undefined)
      notify('批注已恢复。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '批注恢复失败。')
    }
  }
  async function exportSourceAnnotations(sourceId: string) {
    if (!window.readerDesktop) {
      notify('可追溯批注导出只在桌面客户端中可用。')
      return
    }
    try {
      const result = await window.readerDesktop.exportAnnotations({ sourceId })
      await window.readerDesktop.showReviewExport({ filePath: result.filePath })
      notify(`已导出 ${result.annotationCount} 条批注，并在文件夹中定位。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '批注导出失败。')
    }
  }
  async function createActionPack(draft: AgentActionPackDraft) {
    const desktop = window.readerDesktop
    if (!desktop || !workspace) {
      notify('待确认行动包只在桌面研究库中保存。')
      return
    }
    try {
      const pack = await desktop.createActionPack({
        ...draft,
        createdBy: 'ai',
      })
      setActionPacks(await desktop.listActionPacks())
      setResearchTasks(await desktop.listResearchTasks())
      setActiveActionPack(pack)
      setAgentOpen(false)
      setActive('actions')
      notify(`已保存 ${pack.items.length} 条待确认行动；尚未执行任何操作。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '行动包保存失败。')
    }
  }

  async function openActionPack(packId: string) {
    const desktop = window.readerDesktop
    if (!desktop) return
    try {
      setActiveActionPack(await desktop.getActionPack({ packId }))
    } catch (error) {
      notify(error instanceof Error ? error.message : '行动包读取失败。')
    }
  }

  async function reviewActionItem(itemId: string, decision: 'confirm' | 'dismiss') {
    const desktop = window.readerDesktop
    if (!desktop) return
    try {
      const pack = await desktop.reviewActionItem({ itemId, decision })
      setActiveActionPack(pack)
      setActionPacks(await desktop.listActionPacks())
      setResearchTasks(await desktop.listResearchTasks())
      notify(decision === 'confirm' ? '已确认这条行动；尚未自动执行。' : '已拒绝这条建议；原建议和审批记录仍保留。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '行动审批失败。')
    }
  }

  async function completeActionItem(itemId: string) {
    const desktop = window.readerDesktop
    if (!desktop) return
    try {
      const pack = await desktop.completeActionItem({ itemId })
      setActiveActionPack(pack)
      setActionPacks(await desktop.listActionPacks())
      setResearchTasks(await desktop.listResearchTasks())
      notify('已记录行动完成；证据和审批历史没有被改写。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '行动状态更新失败。')
    }
  }

  async function createUnifiedResearchTask(input: DesktopResearchTaskInput) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('统一科研任务需要在桌面研究库中保存。')
    setResearchTaskBusy(true)
    setResearchTaskError('')
    try {
      const result = await desktop.createResearchTask(input)
      setResearchTasks(await desktop.listResearchTasks())
      notify(result.alreadyExists ? '这个来源已经有一条科研任务。' : '科研任务已进入统一收件箱。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '科研任务创建失败。'
      setResearchTaskError(message)
      throw new Error(message)
    } finally {
      setResearchTaskBusy(false)
    }
  }

  async function updateUnifiedResearchTask(input: Parameters<NonNullable<typeof window.readerDesktop>['updateResearchTask']>[0]) {
    const desktop = window.readerDesktop
    if (!desktop) throw new Error('统一科研任务需要在桌面研究库中保存。')
    setResearchTaskBusy(true)
    setResearchTaskError('')
    try {
      setResearchTasks(await desktop.updateResearchTask(input))
      const [library, packs] = await Promise.all([desktop.loadWorkspaceLibrary(), desktop.listActionPacks()])
      setSources(library.sources as Source[])
      setAnnotations(library.annotations as Annotation[])
      setBibliographicItems(library.bibliographicItems as BibliographicSummary[])
      setResearchWorkspace((library as WorkspaceLibraryState & { researchWorkspace?: ResearchWorkspace }).researchWorkspace)
      setActionPacks(packs)
      notify(input.decision === 'confirm' ? 'AI 建议已由你确认，现已成为正式任务。' : input.decision === 'reject' ? 'AI 建议已拒绝并保留历史。' : '任务状态已保存并回写来源。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '科研任务更新失败。'
      setResearchTaskError(message)
      throw new Error(message)
    } finally {
      setResearchTaskBusy(false)
    }
  }

  function returnToResearchTaskSource(task: DesktopResearchTask) {
    const target = task.returnTarget
    if (target.view === 'reader' && target.sourceId) {
      openSource(target.sourceId, target.pageNumber)
      return
    }
    if (target.view === 'dashboard' && target.reviewDocumentId) {
      setActive('dashboard')
      void openReviewDocument(target.reviewDocumentId)
      return
    }
    if (target.view === 'actions' && target.actionPackId) {
      setTaskSourcePackOpen(true)
      void openActionPack(target.actionPackId)
      return
    }
    if (target.view) setActive(target.view)
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
        sourceId: target.id,
        fileName: file.name,
        bytes: await file.arrayBuffer(),
      })
      setSources(current => current.map(source => source.id === target.id ? {
        ...source,
        mineruState: '完成',
        mineruMarkdown: result.markdown,
        mineruOutputDirectory: result.outputDirectory,
        mineruBackend: result.backend,
        mineruRevision: result.revision,
        mineruAssetRootRelative: result.assetRootRelative,
        mineruMarkdownFileRelative: result.markdownPath,
        mineruMarkdownSha256: result.markdownSha256,
        mineruGeneratedAt: result.generatedAt,
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

  function continueLastResearch() {
    setReturnGreetingOpen(false)
    if (!researchResume || researchResume.activeView === 'today') {
      setActive('research-workspace')
      return
    }
    if (researchResume.activeView === 'reader') {
      const source = sources.find(item => item.id === researchResume.sourceId)
      if (!source) {
        setActive('sources')
        notify('上次阅读的资料已不可用，已回到资料库。')
        return
      }
      if (researchResume.readerMode) {
        setSources(current => current.map(item => item.id === source.id
          ? { ...item, readerState: { ...(item.readerState ?? { zoom: 1 }), viewMode: researchResume.readerMode! } }
          : item))
      }
      openSource(source.id, researchResume.pageNumber)
      return
    }
    setActive(researchResume.activeView)
  }

  async function saveAppSettings(ai: AISettings, ui: UISettings) {
    const desktop = window.readerDesktop
    try {
      if (desktop) {
        const saved = await desktop.saveAppSettings({ ai, ui })
        setAISettings({ ...defaultAISettings, ...saved.ai })
        setUISettings({ ...defaultUISettings, ...saved.ui })
        setCredentialState(saved.credentialState ?? 'empty')
      } else {
        setAISettings(ai)
        setUISettings(ui)
      }
      notify('AI、翻译和阅读界面设置已保存在本机。')
      if (ai.baseUrl.trim() && ai.model.trim() && ai.apiKey.trim()) setAIOnboardingRequired(false)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '本机设置保存失败。')
    }
  }

  const normalizedAccent = uiSettings.accentColor === 'green' ? 'plum' : uiSettings.accentColor
  const accentPalette = {
    slate: { main: '#42474b', soft: '#e9ebec', contrast: '#ffffff' },
    blue: { main: '#476b86', soft: '#e6eef4', contrast: '#ffffff' },
    plum: { main: '#6d5c75', soft: '#eee8f1', contrast: '#ffffff' },
  }[normalizedAccent as 'slate' | 'blue' | 'plum'] ?? { main: '#42474b', soft: '#e9ebec', contrast: '#ffffff' }
  const surfacePalette = {
    neutral: { page: '#f5f5f3', sidebar: '#f0f0ee', paper: '#ffffff' },
    warm: { page: '#f7f5f0', sidebar: '#f1eee7', paper: '#fffefb' },
    cool: { page: '#f3f5f6', sidebar: '#edf0f2', paper: '#fcfdfe' },
  }[uiSettings.surfaceTone]
  const effectiveUIScale = Math.max(1, uiSettings.uiScale)
  const scaledText = (base: number) => `${Math.round(base * effectiveUIScale * 10) / 10}px`
  const appShellStyle = {
    '--ui-scale': effectiveUIScale,
    '--ui-text-xs': scaledText(13),
    '--ui-text-sm': scaledText(14),
    '--ui-text-md': scaledText(15),
    '--ui-text-lg': scaledText(17),
    '--ui-line-compact': 1.4,
    '--ui-line-normal': 1.55,
    '--ui-control-min-height': `${Math.round(36 * effectiveUIScale)}px`,
    '--ui-accent': accentPalette.main,
    '--ui-accent-soft': accentPalette.soft,
    '--ui-accent-contrast': accentPalette.contrast,
    '--ui-page': surfacePalette.page,
    '--ui-sidebar': surfacePalette.sidebar,
    '--ui-paper': surfacePalette.paper,
    '--reader-font-size': `${uiSettings.readerFontSize}px`,
    '--reader-line-height': uiSettings.readerLineHeight,
    '--reader-content-width': `${uiSettings.readerWidth}px`,
  } as CSSProperties

  return <div
    className={`app-shell ui-density-${uiSettings.density} ui-surface-${uiSettings.surfaceTone} ${active === 'reader' ? 'reader-active' : ''}`}
    style={appShellStyle}
  >
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><img src={xiaoheLogoMark} alt="" aria-hidden="true"/></div><span>H’s 科研助手</span></div>
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
        <Nav active={active === 'today'} icon={<LayoutDashboard/>} label="今日科研" count={(researchTasks?.summary.today ?? 0) + (researchTasks?.summary.waiting ?? 0)} onClick={() => setActive('today')}/>
        <Nav active={active === 'research-workspace'} icon={<CircleDot/>} label="课题与实验" count={researchWorkspace?.runs.filter(run => run.outcome === 'running' || run.outcome === 'planned').length} onClick={() => setActive('research-workspace')}/>
        <Nav active={active === 'research-review'} icon={<ShieldCheck/>} label="复盘与写作" count={(researchWorkspace?.reports.length ?? 0) + (researchWorkspace?.claims.length ?? 0)} onClick={() => setActive('research-review')}/>
        <Nav active={active === 'sources'} icon={<Files/>} label="资料库" count={sources.length} onClick={() => setActive('sources')}/>
        <Nav active={active === 'reader'} icon={<BookOpen/>} label="阅读" onClick={() => selected && setActive('reader')}/>
        <Nav active={active === 'dashboard'} icon={<ClipboardCheck/>} label="文献综述" count={reviewDocuments.length} onClick={() => setActive('dashboard')}/>
        <Nav active={active === 'evidence'} icon={<GitBranch/>} label="证据关系" count={evidenceGraph?.summary.relations} onClick={() => openEvidence()}/>
        <Nav active={active === 'actions'} icon={<FlaskConical/>} label="研究任务" count={(researchTasks?.summary.today ?? 0) + (researchTasks?.summary.inbox ?? 0)} onClick={() => { setTaskSourcePackOpen(false); setActive('actions') }}/>
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setFeedbackOpen(true)}><Bug/><span>问题反馈</span></button>
        <button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings2/><span>设置</span></button>
        <div className="local-note"><span className="status-dot"/>本地优先存储<br/><small>仅在你触发时调用 AI</small></div>
      </div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-menu"><Menu/></button><div className="crumb">当前研究库 <ChevronRight size={14}/> <strong>{active === 'today' ? '今日科研' : active === 'research-workspace' ? '课题与实验' : active === 'research-review' ? '复盘与写作' : active === 'dashboard' ? '文献综述' : active === 'reader' ? '阅读' : active === 'evidence' ? '证据关系' : active === 'actions' ? '研究任务' : '资料库'}</strong></div><div className="top-actions"><button className="icon-button" title="本地搜索" onClick={() => { setActive('sources'); setLibrarySearchRequest(value => value + 1) }}><Search size={19}/></button><button className="agent-button" onClick={() => setAgentOpen(true)}><MessageSquareText size={16}/> 询问科研助手</button></div></header>
      {active === 'today' && <TodayResearch
        workspace={researchWorkspace as DesktopResearchWorkspace | undefined}
        papers={bibliographicItems}
        sources={sources}
        actionPacks={actionPacks}
        resume={researchResume}
        onContinue={continueLastResearch}
        onSaveRecord={saveResearchRecord}
        onOpenTasks={() => { setTaskSourcePackOpen(false); setActive('actions') }}
        onOpenWorkspace={() => setActive('research-workspace')}
      />}
      {active === 'research-workspace' && <ResearchCommandCenter
        workspace={researchWorkspace as DesktopResearchWorkspace | undefined}
        fallbackName={workspace?.name ?? workspaceName}
        papers={bibliographicItems}
        sources={sources}
        onSaveProject={saveResearchProject}
        onSaveMilestone={saveResearchMilestone}
        onSaveRun={saveResearchRun}
        onSaveTemplate={saveResearchRunTemplate}
        onRegisterArtifact={registerResearchArtifact}
        onExportRun={(id) => exportPortableMarkdown('experiment_retrospective', id)}
        onOpenPapers={() => setActive('sources')}
        onOpenReports={() => setActive('research-review')}
        onAskAgent={() => setAgentOpen(true)}
      />}
      {active === 'research-review' && <ResearchReviewWorkspace
        workspace={researchWorkspace as DesktopResearchWorkspace | undefined}
        bibliography={bibliographicItems}
        onSaveReport={saveResearchReport}
        onConfirmReport={confirmResearchReport}
        onExportReport={exportResearchReport}
        onPortableExportReport={(id) => exportPortableMarkdown('research_report', id)}
        onSaveClaim={saveResearchClaim}
        onArchiveClaim={archiveResearchClaim}
        onOpenReader={(sourceId) => void openSource(sourceId)}
      />}
      {active === 'dashboard' && <ReviewWorkspace
        sources={sources}
        items={bibliographicItems}
        annotations={annotations}
        documents={reviewDocuments}
        activeDocument={activeReview}
        onGenerate={(title, itemIds, annotationIds) => void generateReviewDocument(title, itemIds, annotationIds)}
        onOpenDocument={(id) => void openReviewDocument(id)}
        onOpenCitation={(sourceId, pageNumber, anchor) => openSource(sourceId, pageNumber, anchor as FragmentAnchor | undefined)}
        onOpenEvidence={(documentId) => openEvidence({ kind: 'document', id: documentId })}
        onConfirm={(id) => void confirmReviewDocument(id)}
        onExport={(id, format) => void exportReviewDocument(id, format)}
        onPortableExport={(id) => void exportPortableMarkdown('review_document', id)}
      />}
      {active === 'sources' && <SourcesV2
        sources={sources}
        annotations={annotations}
        bibliographicItems={bibliographicItems}
        focusRequest={librarySearchRequest}
        onUpload={() => fileInput.current?.click()}
        onBibliography={() => void importBibliography()}
        importResult={bibliographyImportResult ? {
          items: bibliographicItems.filter(item => bibliographyImportResult.itemIds.includes(item.id)),
          alreadyImported: bibliographyImportResult.alreadyImported,
        } : undefined}
        onDismissImportResult={() => setBibliographyImportResult(undefined)}
        onCopyCitation={item => void copyCitation(item)}
        onReviewCitation={item => setCitationDialog({ item })}
        onReader={openSource}
        onOpenReview={(documentId) => {
          setActive('dashboard')
          void openReviewDocument(documentId)
        }}
        onReanalyze={reanalyze}
        onMineru={id => { setMineruInstallProgress(''); setMineruTarget(sources.find(source => source.id === id)) }}
      />} 
      {active === 'evidence' && <EvidenceGraphWorkspace
        graph={evidenceGraph}
        loading={evidenceGraphBusy}
        scope={evidenceScope}
        items={bibliographicItems}
        documents={reviewDocuments}
        onScopeChange={setEvidenceScope}
        onRefresh={() => void loadEvidenceGraph(evidenceScope)}
        onOpenSource={(sourceId, pageNumber, anchor) => openSource(sourceId, pageNumber, anchor as FragmentAnchor | undefined)}
        onOpenReview={(documentId) => {
          setActive('dashboard')
          void openReviewDocument(documentId)
        }}
        canEdit={Boolean(window.readerDesktop)}
        onCreateRelation={createEvidenceRelation}
        onReviewRelation={reviewEvidenceRelation}
      />}
      {active === 'actions' && !taskSourcePackOpen && <ResearchTasks
        data={researchTasks}
        busy={researchTaskBusy}
        error={researchTaskError}
        onCreate={createUnifiedResearchTask}
        onUpdate={updateUnifiedResearchTask}
        onReturn={returnToResearchTaskSource}
      />}
      {active === 'actions' && taskSourcePackOpen && <div className="task-source-pack-workspace"><button className="back-link" onClick={() => setTaskSourcePackOpen(false)}><ArrowLeft/>返回统一研究任务</button><ActionPackWorkspace
        packs={actionPacks}
        activePack={activeActionPack}
        onOpen={packId => void openActionPack(packId)}
        onReview={(itemId, decision) => void reviewActionItem(itemId, decision)}
        onComplete={itemId => void completeActionItem(itemId)}
        onOpenEvidence={evidence => {
          if (evidence.sourceId) openSource(evidence.sourceId, evidence.pageNumber, evidence.anchor as FragmentAnchor | undefined)
          else if (evidence.reviewDocumentId) {
            setActive('dashboard')
            void openReviewDocument(evidence.reviewDocumentId)
          }
        }}
        onAskAgent={() => setAgentOpen(true)}
      /></div>}
      {active === 'reader' && selected && <FunctionalReader
        settings={aiSettings}
        workspaceName={workspace?.name ?? workspaceName}
        source={selected}
        sources={sources}
        items={bibliographicItems}
        annotations={annotations}
        paper={selectedPaper}
        researchWorkspace={researchWorkspace}
        agentOpen={agentOpen}
        jumpTarget={readerJumpTarget}
        onSelectSource={(id) => { setSelectedSource(id); setReaderJumpTarget(undefined) }}
        onBack={() => setActive('sources')}
        onAnnotate={(draft = {}) => setAnnotationDraft(draft)}
        onUpdateReading={(itemId, patch, quiet) => void updatePaperReading(itemId, patch, quiet)}
        onSaveMarkdownLayout={(sourceId, markdownLayout) => setSources(current => current.map(item => item.id === sourceId
          ? { ...item, markdownLayout, updated: '刚刚更新阅读排版' }
          : item))}
        onSaveReaderState={(sourceId, readerState) => setSources(current => current.map(item => item.id === sourceId
          ? { ...item, readerState }
          : item))}
        onOpenCitation={(sourceId, pageNumber, anchor) => openSource(sourceId, pageNumber, anchor)}
        onEditAnnotation={setEditingAnnotation}
        onArchiveAnnotation={annotation => void archiveAnnotation(annotation)}
        onCreateTaskFromAnnotation={annotation => createUnifiedResearchTask({
          sourceType: 'annotation',
          sourceId: annotation.id,
          sourceRole: 'primary',
          status: 'inbox',
        })}
        onExportAnnotations={sourceId => void exportSourceAnnotations(sourceId)}
        onCopyCitation={item => void copyCitation(item)}
        onAgent={() => setAgentOpen(true)}
        onAgentClose={() => setAgentOpen(false)}
        onCreateActionPack={createActionPack}
        onSettings={() => setSettingsOpen(true)}
      />}
    </main>
    {returnGreetingOpen && researchResume && <ResearchReturnGreeting resume={researchResume} onDismiss={() => setReturnGreetingOpen(false)} onContinue={continueLastResearch}/>}
    {citationDialog && <CitationDialog item={citationDialog.item} reason={citationDialog.reason} onClose={() => setCitationDialog(undefined)}/>}
    <input ref={fileInput} className="hidden" type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xlsx,.xls,.md,.txt" onChange={e => addFiles(e.target.files)} />
    {agentOpen && active !== 'reader' && <AgentModalV2
      settings={aiSettings}
      workspaceName={workspace?.name ?? workspaceName}
      researchWorkspace={researchWorkspace}
      items={bibliographicItems}
      currentItemId={selectedPaper?.id}
      onClose={() => setAgentOpen(false)}
      onCreate={createActionPack}
      onOpenCitation={(sourceId, pageNumber, anchor) => {
        setAgentOpen(false)
        openSource(sourceId, pageNumber, anchor)
      }}
    />}
    {annotationDraft && <AnnotationModalV2 source={selected} paper={selectedPaper} draft={annotationDraft} onClose={() => setAnnotationDraft(null)} onSave={addAnnotation}/>}
    {editingAnnotation && <AnnotationEditModal annotation={editingAnnotation} onClose={() => setEditingAnnotation(undefined)} onSave={(category, note) => void reviseAnnotation(editingAnnotation, category, note)}/>}
    {(settingsOpen || (settingsLoaded && aiOnboardingRequired)) && <SettingsModal
      settings={aiSettings}
      uiSettings={uiSettings}
      credentialState={credentialState}
      onboarding={aiOnboardingRequired}
      workspaceOpen={Boolean(workspace)}
      onClose={() => { if (!aiOnboardingRequired) setSettingsOpen(false) }}
      onSave={saveAppSettings}
    />}
    {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)}/>}
    {workspaceCreationRequest && <WorkspaceCreationModal
      directory={workspaceCreationRequest.directory}
      suggestedName={workspaceCreationRequest.suggestedName}
      existingPaperCount={workspaceCreationRequest.existingPaperCount}
      existingPaperNames={workspaceCreationRequest.existingPaperNames}
      busy={workspaceBusy}
      onClose={() => setWorkspaceCreationRequest(undefined)}
      onCreate={(name, manageExistingPapers) => void createWorkspaceInSelectedFolder(name, manageExistingPapers)}
    />}
    {mineruTarget && <MineruConfirmModal
      source={mineruTarget}
      installing={mineruInstalling}
      installProgress={mineruInstallProgress}
      onClose={() => setMineruTarget(undefined)}
      onInstall={installMineru}
      onConfirm={runMineru}
    />} 
    {toast && <div className="toast"><Check size={16}/><span>{toast}</span>{archivedAnnotation && <button type="button" onClick={() => void restoreArchivedAnnotation()}><RotateCcw size={14}/>撤销</button>}</div>}
  </div>
}

function Nav({ icon, label, active, count, onClick }: { icon: React.ReactNode; label: string; active?: boolean; count?: number; onClick?: () => void }) { return <button aria-label={count === undefined ? label : `${label} ${count}`} title={label} onClick={onClick} className={`nav-item ${active ? 'active' : ''}`}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}</button> }

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogKeyboard<HTMLElement>(onClose)
  return <div className="research-modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section ref={dialogRef} className="research-modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <header>
        <div><p className="section-kicker">Support</p><h2 id="feedback-title">问题反馈</h2></div>
        <button type="button" aria-label="关闭问题反馈" onClick={onClose}><X size={17}/></button>
      </header>
      <div className="feedback-copy">
        <p>如果软件报错、功能不符合预期，或你有改进建议，可以选择下面任一种方式联系开发者。</p>
        <div className="feedback-options">
          <a autoFocus href={feedbackIssueUrl} target="_blank" rel="noreferrer">
            <GitBranch size={22}/>
            <span><strong>提交 GitHub Issue</strong><small>推荐：便于补充截图、版本与处理进度</small></span>
            <ExternalLink size={16}/>
          </a>
          <a href={feedbackEmailUrl} target="_blank" rel="noreferrer">
            <Mail size={22}/>
            <span><strong>发送问题邮件</strong><small>hzh1144@163.com</small></span>
            <ExternalLink size={16}/>
          </a>
        </div>
        <p className="feedback-privacy"><ShieldCheck size={15}/>提交前请移除论文原文、API 密钥、私人路径等敏感信息。</p>
      </div>
      <div className="research-modal-actions"><button type="button" className="outline-button" onClick={onClose}>关闭</button></div>
    </section>
  </div>
}
const researchRecordMeta: Record<ResearchRecordType, { label: string; hint: string }> = {
  log: { label: '研究日志', hint: '今天推进了什么、遇到什么问题' },
  experiment: { label: '实验', hint: '目标、变量、步骤和结果' },
  dataset: { label: '数据', hint: '数据集、脚本或结果文件的位置' },
  decision: { label: '决策', hint: '决定了什么，以及为什么' },
  milestone: { label: '里程碑', hint: '阶段成果或下一检查点' },
}
const researchStatusLabel: Record<ResearchRecordStatus, string> = {
  planned: '待开始', active: '进行中', completed: '已完成', blocked: '受阻', archived: '已归档',
}

function ResearchDashboard({
  workspace: data,
  fallbackName,
  papers,
  sources,
  onSaveProject,
  onSaveRecord,
  onOpenPapers,
  onAskAgent,
}: {
  workspace?: ResearchWorkspace
  fallbackName: string
  papers: BibliographicSummary[]
  sources: Source[]
  onSaveProject: (project: Pick<ResearchWorkspace['project'], 'name' | 'researchQuestion' | 'currentHypothesis' | 'stage' | 'mode'>) => Promise<void>
  onSaveRecord: (record: Partial<ResearchRecord> & Pick<ResearchRecord, 'recordType' | 'title' | 'status'>) => Promise<void>
  onOpenPapers: () => void
  onAskAgent: () => void
}) {
  const project = data?.project ?? { id: '', name: fallbackName || '我的研究课题', researchQuestion: '', currentHypothesis: '', stage: '探索中', mode: 'exploration', updatedAt: '' }
  const records = data?.records ?? []
  const [editingProject, setEditingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState(project)
  const [recordType, setRecordType] = useState<ResearchRecordType>()
  const [recordDraft, setRecordDraft] = useState({ title: '', content: '', status: 'active' as ResearchRecordStatus, filePath: '', tags: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!editingProject) setProjectDraft(project) }, [project.name, project.researchQuestion, project.currentHypothesis, project.stage, editingProject])

  async function saveProject() {
    setBusy(true); setError('')
    try {
      await onSaveProject({ name: projectDraft.name, researchQuestion: projectDraft.researchQuestion, currentHypothesis: projectDraft.currentHypothesis, stage: projectDraft.stage, mode: projectDraft.mode })
      setEditingProject(false)
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '课题保存失败。') }
    finally { setBusy(false) }
  }

  async function saveRecord() {
    if (!recordType || !recordDraft.title.trim()) return
    setBusy(true); setError('')
    try {
      await onSaveRecord({
        recordType, title: recordDraft.title.trim(), content: recordDraft.content.trim(), status: recordDraft.status,
        filePath: recordDraft.filePath.trim() || undefined,
        tags: recordDraft.tags.split(/[，,]/).map(tag => tag.trim()).filter(Boolean),
      })
      setRecordType(undefined)
      setRecordDraft({ title: '', content: '', status: 'active', filePath: '', tags: '' })
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '科研记录保存失败。') }
    finally { setBusy(false) }
  }

  const activeRecords = records.filter(record => record.status === 'active' || record.status === 'blocked')
  const completedMilestones = records.filter(record => record.recordType === 'milestone' && record.status === 'completed').length
  return <div className="research-dashboard">
    <section className="research-brief">
      <div className="research-brief-main">
        <div className="research-stage-line"><span>当前课题</span><b>{project.stage}</b></div>
        <h1>{project.name}</h1>
        <div className={`research-question ${project.researchQuestion ? '' : 'empty'}`}>
          <small>研究问题</small><p>{project.researchQuestion || '还没有写下研究问题。先定义“要解释、比较或验证什么”。'}</p>
        </div>
        <div className={`research-hypothesis ${project.currentHypothesis ? '' : 'empty'}`}>
          <small>当前假设</small><p>{project.currentHypothesis || '暂未形成假设。记录一个可被证据推翻的判断。'}</p>
        </div>
      </div>
      <div className="research-brief-actions">
        <button className="outline-button" onClick={() => setEditingProject(true)}><Pencil size={15}/>编辑课题</button>
        <button className="primary-button" onClick={onAskAgent}><Sparkles size={15}/>审视下一步</button>
      </div>
    </section>

    <section className="research-pulse" aria-label="课题进度概览">
      <div><span>{papers.length}</span><small>篇论文进入课题</small></div>
      <div><span>{records.filter(record => record.recordType === 'experiment').length}</span><small>项实验记录</small></div>
      <div><span>{records.filter(record => record.recordType === 'dataset').length}</span><small>份数据记录</small></div>
      <div><span>{completedMilestones}</span><small>个里程碑完成</small></div>
      <div><span>{activeRecords.length}</span><small>项正在推进</small></div>
    </section>

    <div className="research-dashboard-grid">
      <section className="research-record-panel">
        <header><div><p className="section-kicker">Research trail</p><h2>研究过程</h2></div><span>{records.length} 条本地记录</span></header>
        <div className="research-add-strip">
          {(Object.entries(researchRecordMeta) as Array<[ResearchRecordType, { label: string; hint: string }]>).map(([type, meta]) => <button key={type} onClick={() => setRecordType(type)} className={recordType === type ? 'active' : ''}>
            {type === 'experiment' ? <FlaskConical/> : type === 'dataset' ? <Files/> : type === 'decision' ? <GitBranch/> : type === 'milestone' ? <CircleDot/> : <FileText/>}
            <span>添加{meta.label}</span>
          </button>)}
        </div>
        {records.length ? <div className="research-timeline">{records.slice(0, 30).map(record => <article key={record.id} className={`research-record ${record.status}`}>
          <i/><div className="research-record-date">{new Date(record.occurredAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</div>
          <div><div className="research-record-meta"><span>{researchRecordMeta[record.recordType].label}</span><b>{researchStatusLabel[record.status]}</b></div><h3>{record.title}</h3>{record.content && <p>{record.content}</p>}{record.filePath && <code>{record.filePath}</code>}{record.tags.length > 0 && <footer>{record.tags.map(tag => <span key={tag}>#{tag}</span>)}</footer>}</div>
        </article>)}</div> : <div className="research-empty"><FlaskConical/><strong>把科研过程留在课题里</strong><p>从一条日志、一次实验或一个决定开始。它们会按时间形成可回看的研究轨迹。</p></div>}
      </section>

      <aside className="research-focus-panel">
        <section><div className="research-panel-title"><p className="section-kicker">Now</p><h2>现在推进什么</h2></div>
          {activeRecords.length ? activeRecords.slice(0, 5).map(record => <article key={record.id}><span>{researchRecordMeta[record.recordType].label}</span><strong>{record.title}</strong><small>{record.status === 'blocked' ? '需要解除阻碍' : '进行中'}</small></article>) : <div className="research-mini-empty">暂无进行中的记录。添加实验或里程碑，明确下一步。</div>}
        </section>
        <section className="research-paper-status"><div className="research-panel-title"><p className="section-kicker">Literature</p><h2>文献推进</h2></div>
          <div className="research-paper-bar"><i style={{ width: `${papers.length ? Math.round(papers.filter(paper => paper.readingState.readingStatus === 'finished').length / papers.length * 100) : 0}%` }}/></div>
          <p><b>{papers.filter(paper => paper.readingState.readingStatus === 'finished').length}</b> / {papers.length} 篇已精读</p>
          <small>{sources.filter(source => source.status === '已解析').length} 份资料已解析，可作为科研助手的证据来源。</small>
          <button className="text-button" onClick={onOpenPapers}>进入资料库 <ArrowRight size={14}/></button>
        </section>
      </aside>
    </div>

    {editingProject && <div className="research-inline-editor"><section>
      <header><div><p className="section-kicker">Project definition</p><h2>编辑课题定位</h2></div><button className="icon-button" onClick={() => setEditingProject(false)}><X/></button></header>
      <label>课题名称<input value={projectDraft.name} maxLength={80} onChange={event => setProjectDraft({ ...projectDraft, name: event.target.value })}/></label>
      <label>研究阶段<select value={projectDraft.stage} onChange={event => setProjectDraft({ ...projectDraft, stage: event.target.value })}><option>探索中</option><option>方案设计</option><option>实验中</option><option>分析中</option><option>论文写作</option><option>已完成</option></select></label>
      <label>研究问题<textarea value={projectDraft.researchQuestion} onChange={event => setProjectDraft({ ...projectDraft, researchQuestion: event.target.value })} placeholder="例如：在什么条件下，方法 A 是否比基线 B 更稳定？"/></label>
      <label>当前假设<textarea value={projectDraft.currentHypothesis} onChange={event => setProjectDraft({ ...projectDraft, currentHypothesis: event.target.value })} placeholder="写成可以被数据或文献推翻的判断。"/></label>
      {error && <p className="research-form-error">{error}</p>}
      <footer><button className="outline-button" onClick={() => setEditingProject(false)}>取消</button><button className="primary-button" disabled={busy || !projectDraft.name.trim()} onClick={() => void saveProject()}>{busy ? '正在保存…' : '保存课题'}</button></footer>
    </section></div>}

    {recordType && <div className="research-inline-editor"><section>
      <header><div><p className="section-kicker">New research record</p><h2>添加{researchRecordMeta[recordType].label}</h2></div><button className="icon-button" onClick={() => setRecordType(undefined)}><X/></button></header>
      <p className="research-form-hint">{researchRecordMeta[recordType].hint}</p>
      <label>标题<input autoFocus value={recordDraft.title} maxLength={240} onChange={event => setRecordDraft({ ...recordDraft, title: event.target.value })} placeholder="一句话说明这条记录"/></label>
      <label>状态<select value={recordDraft.status} onChange={event => setRecordDraft({ ...recordDraft, status: event.target.value as ResearchRecordStatus })}><option value="planned">待开始</option><option value="active">进行中</option><option value="completed">已完成</option><option value="blocked">受阻</option></select></label>
      <label>内容<textarea value={recordDraft.content} onChange={event => setRecordDraft({ ...recordDraft, content: event.target.value })} placeholder={recordType === 'experiment' ? '目标、变量、步骤、观察和结果…' : '记录过程、依据和下一步…'}/></label>
      {(recordType === 'dataset' || recordType === 'experiment') && <label>本地文件或目录（可选）<input value={recordDraft.filePath} onChange={event => setRecordDraft({ ...recordDraft, filePath: event.target.value })} placeholder="例如 E:\\实验\\run-003"/></label>}
      <label>标签（逗号分隔）<input value={recordDraft.tags} onChange={event => setRecordDraft({ ...recordDraft, tags: event.target.value })} placeholder="例如 基线, 待复现"/></label>
      {error && <p className="research-form-error">{error}</p>}
      <footer><button className="outline-button" onClick={() => setRecordType(undefined)}>取消</button><button className="primary-button" disabled={busy || !recordDraft.title.trim()} onClick={() => void saveRecord()}>{busy ? '正在保存…' : `保存${researchRecordMeta[recordType].label}`}</button></footer>
    </section></div>}
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
  onOpenEvidence,
  onConfirm,
  onExport,
  onPortableExport,
}: {
  sources: Source[]
  items: BibliographicSummary[]
  annotations: Annotation[]
  documents: ReviewDocumentSummary[]
  activeDocument?: ReviewDocumentView
  onGenerate: (title: string, itemIds: string[], annotationIds: string[]) => void
  onOpenDocument: (id: string) => void
  onOpenCitation: (sourceId: string, pageNumber: number, anchor?: DesktopFragmentAnchor) => void
  onOpenEvidence: (documentId: string) => void
  onConfirm: (id: string) => void
  onExport: (id: string, format: 'markdown' | 'docx') => void
  onPortableExport: (id: string) => void
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
      <header><span>复查文档</span><h1>结构化复查</h1><p>选择论文和批注。生成后，原文证据、用户笔记和 AI 整理仍是三种独立内容。</p></header>
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
          <span>{document.title}</span><small>{document.itemCount} 篇 · {document.blockCount} 块 · {document.status === 'exported' ? '已导出' : document.status === 'reviewed' ? '已确认' : '草稿'}</small>
        </button>)}
      </section>}
    </aside>
    <main className="review-document-pane">
      {activeDocument ? <>
        <header className="review-document-header">
          <div><span>TRACEABLE REVIEW</span><h2>{activeDocument.title}</h2><p>{activeDocument.items.length} 篇论文 · {activeDocument.blocks.length} 个来源区块</p></div>
          <div><button className="review-evidence-button" onClick={() => onOpenEvidence(activeDocument.id)}><GitBranch size={13}/>查看证据关系</button>{activeDocument.status === 'draft' ? <button onClick={() => onConfirm(activeDocument.id)}><ShieldCheck size={13}/>人工确认</button> : <button onClick={() => onPortableExport(activeDocument.id)}><Download size={13}/>可迁移 Markdown</button>}<button onClick={() => onExport(activeDocument.id, 'docx')}>导出 Word</button></div>
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

function ActionPackWorkspace({
  packs,
  activePack,
  onOpen,
  onReview,
  onComplete,
  onOpenEvidence,
  onAskAgent,
}: {
  packs: ActionPackSummary[]
  activePack?: ActionPackView
  onOpen: (packId: string) => void
  onReview: (itemId: string, decision: 'confirm' | 'dismiss') => void
  onComplete: (itemId: string) => void
  onOpenEvidence: (evidence: ActionPackView['items'][number]['evidence'][number]) => void
  onAskAgent: () => void
}) {
  useEffect(() => {
    if (!activePack && packs[0]) onOpen(packs[0].id)
  }, [activePack, packs, onOpen])

  if (!packs.length) return <div className="action-pack-empty">
    <div className="action-pack-empty-mark"><FlaskConical size={25}/></div>
    <strong>还没有待审查的研究行动</strong>
    <p>先让研究 Agent 基于本地证据回答问题。只有带来源的下一步建议才能保存到这里。</p>
    <button type="button" onClick={onAskAgent}><Sparkles size={15}/>询问研究 Agent</button>
  </div>

  return <div className="action-pack-workspace">
    <aside className="action-pack-list">
      <header><span>ACTION LEDGER</span><h1>行动建议</h1><p>AI 只能提交建议；你确认后才进入正式行动。</p></header>
      <div className="action-pack-list-scroll">{packs.map(pack => <button
        type="button"
        className={activePack?.id === pack.id ? 'active' : ''}
        onClick={() => onOpen(pack.id)}
        key={pack.id}
      >
        <span><i className={pack.status}/>{actionPackStatusLabel(pack.status)}</span>
        <strong>{pack.title}</strong>
        <small>{pack.itemCount} 条 · {pack.proposedCount} 条待确认</small>
      </button>)}</div>
      <button type="button" className="action-pack-new" onClick={onAskAgent}><Sparkles size={14}/>基于证据提出新行动</button>
    </aside>
    <main className="action-pack-detail">
      {activePack ? <>
        <header className="action-pack-detail-head">
          <div><span>{activePack.createdBy === 'ai' ? 'AI 建议 · 等待人工裁决' : '用户行动'}</span><h2>{activePack.title}</h2><p>{activePack.objective}</p></div>
          <div><strong>{actionPackStatusLabel(activePack.status)}</strong><small>{activePack.scope.label || '整个研究库'}{activePack.model ? ` · ${activePack.model}` : ''}</small></div>
        </header>
        <section className="action-pack-rule"><AlertTriangle size={14}/><span>确认只代表“同意进入行动清单”，不会自动联网、改写笔记、删除资料或运行实验。</span></section>
        <div className="action-docket">
          {activePack.items.map((item, index) => <article className={`action-docket-item ${item.status}`} key={item.id}>
            <div className="action-docket-number">{String(index + 1).padStart(2, '0')}</div>
            <div className="action-docket-body">
              <header><span>{agentActionTypeLabel(item.actionType)}</span><em>{actionItemStatusLabel(item.status)}</em></header>
              <h3>{item.title}</h3>
              <p>{item.rationale}</p>
              <section className="action-evidence-strip">
                <strong>依据</strong>
                {item.evidence.map(evidence => <button
                  type="button"
                  disabled={!evidence.sourceId && !evidence.reviewDocumentId}
                  onClick={() => onOpenEvidence(evidence)}
                  key={evidence.id}
                ><BookOpen size={12}/><span>{evidence.label}<small>{evidence.pageNumber ? `第 ${evidence.pageNumber} 页` : evidence.evidenceType === 'review' ? '复查区块' : '位置待核对'}</small></span></button>)}
              </section>
              <footer>
                {item.status === 'proposed' && <><button type="button" className="confirm" onClick={() => onReview(item.id, 'confirm')}><Check size={14}/>确认进入行动</button><button type="button" onClick={() => onReview(item.id, 'dismiss')}><X size={14}/>拒绝建议</button></>}
                {item.status === 'dismissed' && <button type="button" onClick={() => onReview(item.id, 'confirm')}><RotateCcw size={14}/>重新确认</button>}
                {item.status === 'confirmed' && <button type="button" className="complete" onClick={() => onComplete(item.id)}><Check size={14}/>标记已完成</button>}
                {item.status === 'completed' && <span><Check size={14}/>已由用户记录完成</span>}
              </footer>
            </div>
          </article>)}
        </div>
        <details className="action-audit">
          <summary>查看审批记录 · {activePack.events.length} 条</summary>
          <ol>{activePack.events.map(event => <li key={event.id}><span>{actionEventLabel(event.eventType)}</span><p>{event.note}</p><small>{event.actor === 'user' ? '用户' : event.actor === 'ai' ? 'AI' : '系统'} · {new Date(event.createdAt).toLocaleString('zh-CN')}</small></li>)}</ol>
        </details>
      </> : <div className="action-pack-detail-loading"><RotateCcw className="spinning" size={22}/><span>正在读取行动包…</span></div>}
    </main>
  </div>
}

function agentActionTypeLabel(type: AgentActionProposal['actionType']) {
  return {
    read: '补充阅读',
    compare: '跨文献比较',
    verify: '证据核验',
    experiment: '实验建议',
    review: '复查整理',
    note: '笔记整理',
  }[type]
}

function actionPackStatusLabel(status: ActionPackView['status']) {
  return { draft: '待确认', confirmed: '已确认', dismissed: '已拒绝', completed: '已完成' }[status]
}

function actionItemStatusLabel(status: ActionPackView['items'][number]['status']) {
  return { proposed: '待确认', confirmed: '已确认 · 未执行', dismissed: '已拒绝', completed: '已完成' }[status]
}

function actionEventLabel(type: ActionPackView['events'][number]['eventType']) {
  return {
    created: '建立行动包',
    item_confirmed: '确认行动',
    item_dismissed: '拒绝建议',
    item_reopened: '重新确认',
    item_completed: '记录完成',
    pack_status_changed: '行动包状态变化',
    migrated: '旧版行动迁移',
  }[type]
}

function EvidenceGraphWorkspace({
  graph,
  loading,
  scope,
  items,
  documents,
  onScopeChange,
  onRefresh,
  onOpenSource,
  onOpenReview,
  canEdit,
  onCreateRelation,
  onReviewRelation,
}: {
  graph?: EvidenceGraphView
  loading: boolean
  scope: EvidenceScope
  items: BibliographicSummary[]
  documents: ReviewDocumentSummary[]
  onScopeChange: (scope: EvidenceScope) => void
  onRefresh: () => void
  onOpenSource: (sourceId: string, pageNumber?: number, anchor?: DesktopFragmentAnchor) => void
  onOpenReview: (documentId: string) => void
  canEdit: boolean
  onCreateRelation: (input: {
    fromFragmentId: string
    toFragmentId: string
    relation: 'supports' | 'refutes' | 'mentions'
    rationale: string
  }) => Promise<boolean>
  onReviewRelation: (relationId: string, decision: 'accept' | 'reject') => Promise<boolean>
}) {
  const [filter, setFilter] = useState<'all' | 'human' | 'ai' | 'claim' | 'unlinked'>('all')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [relationEditorOpen, setRelationEditorOpen] = useState(false)
  const [relationTargetId, setRelationTargetId] = useState('')
  const [relationType, setRelationType] = useState<'supports' | 'refutes' | 'mentions'>('supports')
  const [relationRationale, setRelationRationale] = useState('')
  const [relationBusy, setRelationBusy] = useState(false)
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map(node => [node.id, node])), [graph])
  const orderedEdges = useMemo(() => (graph?.edges ?? []).flatMap(edge => {
    const from = nodeById.get(edge.fromNodeId)
    const to = nodeById.get(edge.toNodeId)
    if (!from || !to) return []
    const fromRank = evidenceLayerRank(from.layer)
    const toRank = evidenceLayerRank(to.layer)
    return [{
      edge,
      first: fromRank <= toRank ? from : to,
      second: fromRank <= toRank ? to : from,
      firstRank: Math.min(fromRank, toRank),
      secondRank: Math.max(fromRank, toRank),
      sameLayer: fromRank === toRank,
    }]
  }), [graph, nodeById])
  const visibleEdges = orderedEdges.filter(({ edge }) => {
    if (filter === 'human') return edge.provenance === 'user_confirmed'
    if (filter === 'ai') return edge.provenance === 'ai_proposed' || edge.provenance === 'ai_accepted'
    if (filter === 'claim') return edge.relation === 'supports' || edge.relation === 'refutes'
    return filter !== 'unlinked'
  })
  const unlinkedNodes = (graph?.unlinkedNodeIds ?? []).map(id => nodeById.get(id)).filter(Boolean) as EvidenceGraphNode[]
  const selectedNode = nodeById.get(selectedNodeId) ?? graph?.nodes[0]
  const relatedEdges = selectedNode
    ? (graph?.edges ?? []).filter(edge => edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id)
    : []
  const relationCandidates = (graph?.nodes ?? []).filter(node => node.entityType === 'fragment' && node.id !== selectedNode?.id)

  useEffect(() => {
    if (!graph?.nodes.length) {
      setSelectedNodeId('')
      return
    }
    if (!graph.nodes.some(node => node.id === selectedNodeId)) setSelectedNodeId(graph.nodes[0].id)
  }, [graph, selectedNodeId])

  useEffect(() => {
    setRelationEditorOpen(false)
    setRelationRationale('')
    setRelationTargetId('')
  }, [selectedNode?.id])

  const scopeValue = scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`
  function changeScope(value: string) {
    if (value === 'all') onScopeChange({ kind: 'all' })
    else if (value.startsWith('item:')) onScopeChange({ kind: 'item', id: value.slice(5) })
    else if (value.startsWith('document:')) onScopeChange({ kind: 'document', id: value.slice(9) })
  }

  async function submitRelation() {
    const target = relationCandidates.find(node => node.id === relationTargetId)
    if (!selectedNode || selectedNode.entityType !== 'fragment' || !target || relationRationale.trim().length < 4) return
    setRelationBusy(true)
    try {
      const saved = await onCreateRelation({
        fromFragmentId: selectedNode.entityId,
        toFragmentId: target.entityId,
        relation: relationType,
        rationale: relationRationale.trim(),
      })
      if (saved) {
        setRelationEditorOpen(false)
        setRelationRationale('')
        setRelationTargetId('')
      }
    } finally {
      setRelationBusy(false)
    }
  }

  async function reviewRelation(edge: EvidenceGraphEdge, decision: 'accept' | 'reject') {
    if (!edge.relationId || relationBusy) return
    setRelationBusy(true)
    try {
      await onReviewRelation(edge.relationId, decision)
    } finally {
      setRelationBusy(false)
    }
  }

  return <div className="evidence-workspace">
    <section className="evidence-canvas">
      <header className="evidence-header">
        <div>
          <span>证据关系</span>
          <h1>从原文到结论</h1>
          <p>这里显示已经保存的关系，不根据文本相似度猜测“支持”或“反驳”。</p>
        </div>
        <div className="evidence-header-actions">
          <label>查看范围<select value={scopeValue} onChange={event => changeScope(event.target.value)}>
            <option value="all">整个研究库</option>
            {documents.length > 0 && <optgroup label="复查文档">{documents.map(document => <option value={`document:${document.id}`} key={document.id}>{document.title}</option>)}</optgroup>}
            {items.length > 0 && <optgroup label="单篇论文">{items.map(item => <option value={`item:${item.id}`} key={item.id}>{item.title}</option>)}</optgroup>}
          </select></label>
          <button type="button" onClick={onRefresh} disabled={loading}><RotateCcw size={14}/>{loading ? '读取中…' : '刷新关系'}</button>
        </div>
      </header>

      <div className="evidence-summary" aria-label="当前证据关系概况">
        <span><strong>{graph?.summary.evidence ?? 0}</strong>原文证据</span>
        <span><strong>{graph?.summary.userNotes ?? 0}</strong>用户笔记</span>
        <span><strong>{(graph?.summary.aiDrafts ?? 0) + (graph?.summary.reviewConclusions ?? 0)}</strong>AI/复查</span>
        <span><strong>{graph?.summary.relations ?? 0}</strong>可追溯关系</span>
        <span className={(graph?.summary.unsupported ?? 0) > 0 ? 'warning' : ''}><strong>{graph?.summary.unsupported ?? 0}</strong>待核验</span>
      </div>

      <div className="evidence-filter-row" role="toolbar" aria-label="筛选证据关系">
        {([
          ['all', '全部关系'],
          ['human', '用户确认'],
          ['ai', 'AI 建议'],
          ['claim', '支持/反驳'],
          ['unlinked', `待连接 ${unlinkedNodes.length}`],
        ] as const).map(([value, label]) => <button type="button" aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}
      </div>

      {graph?.limited && <div className="evidence-limit-note"><AlertTriangle size={14}/>当前范围超过 1200 个片段，只显示最近内容。请选择单篇论文或复查文档继续缩小范围。</div>}

      <div className="evidence-lane-heads" aria-hidden="true">
        <span><i className="source"/>原文证据</span><span><i className="user"/>用户判断</span><span><i className="synthesis"/>AI 与复查</span>
      </div>
      <div className="evidence-chain-list">
        {filter === 'unlinked' ? unlinkedNodes.map(node => <div className="evidence-unlinked-row" key={node.id}>
          <CircleDot size={15}/><EvidenceNodeButton node={node} selected={selectedNode?.id === node.id} onSelect={setSelectedNodeId}/><span>{node.trust === 'unsupported' ? '没有任何来源引用，不能进入正式结论' : '尚未与其他证据建立明确关系'}</span>
        </div>) : visibleEdges.map(({ edge, first, second, firstRank, secondRank, sameLayer }) => {
          const firstColumn = sameLayer ? 1 : firstRank * 2 + 1
          const secondColumn = sameLayer ? 3 : secondRank * 2 + 1
          return <div className={`evidence-chain-row ${sameLayer ? 'same-layer' : ''}`} key={edge.id}>
            <EvidenceNodeButton node={first} selected={selectedNode?.id === first.id} onSelect={setSelectedNodeId} style={{ gridColumn: firstColumn }}/>
            <div className={`evidence-relation ${edge.provenance}`} style={{ gridColumn: sameLayer ? 2 : `${firstColumn + 1} / ${secondColumn}` }}>
              <span>{edge.label}</span><small>{evidenceProvenanceLabel(edge.provenance)}</small>
            </div>
            <EvidenceNodeButton node={second} selected={selectedNode?.id === second.id} onSelect={setSelectedNodeId} style={{ gridColumn: secondColumn }}/>
          </div>
        })}
        {!loading && ((filter === 'unlinked' && !unlinkedNodes.length) || (filter !== 'unlinked' && !visibleEdges.length)) && <div className="evidence-empty">
          <GitBranch size={28}/><strong>{graph?.nodes.length ? '当前筛选下没有关系' : '还没有形成证据关系'}</strong>
          <span>{graph?.nodes.length ? '切换到“全部关系”，或选择其他论文和复查文档。' : '先在阅读器保存一条带原文的批注，或生成带引用的阅读卡/复查文档。'}</span>
        </div>}
        {loading && <div className="evidence-empty"><RotateCcw className="spinning" size={25}/><strong>正在读取本地证据关系</strong><span>只查询当前研究库，不会发送到网络。</span></div>}
      </div>
    </section>

    <aside className="evidence-inspector">
      {selectedNode ? <>
        <header><span>当前节点</span><strong>{selectedNode.kindLabel}</strong></header>
        <div className={`evidence-inspector-status ${selectedNode.trust}`}>{evidenceTrustLabel(selectedNode.trust)}</div>
        <h2>{selectedNode.title}</h2>
        <blockquote>{selectedNode.excerpt}</blockquote>
        <dl>
          <div><dt>位置</dt><dd>{selectedNode.locationLabel}</dd></div>
          {selectedNode.sourceName && <div><dt>附件</dt><dd>{selectedNode.sourceName}</dd></div>}
          {selectedNode.documentTitle && <div><dt>复查文档</dt><dd>{selectedNode.documentTitle}</dd></div>}
        </dl>
        <p className="evidence-trust-copy">{evidenceTrustCopy(selectedNode.trust)}</p>
        {selectedNode.entityType === 'fragment' && <section className="evidence-relation-compose">
          <button
            type="button"
            className="evidence-compose-toggle"
            disabled={!canEdit || !relationCandidates.length}
            title={!canEdit ? '浏览器预览不会写入研究库' : !relationCandidates.length ? '当前范围内没有其他可连接片段' : undefined}
            onClick={() => {
              setRelationEditorOpen(open => !open)
              if (!relationTargetId && relationCandidates[0]) setRelationTargetId(relationCandidates[0].id)
            }}
          ><Plus size={14}/>{relationEditorOpen ? '收起关系编辑' : '建立证据关系'}</button>
          {!canEdit && <small>桌面客户端中可保存人工判断；浏览器预览仅展示。</small>}
          {relationEditorOpen && <div className="evidence-relation-editor">
            <div className="evidence-relation-sentence">
              <span>当前节点</span>
              <select aria-label="关系类型" value={relationType} onChange={event => setRelationType(event.target.value as typeof relationType)}>
                <option value="supports">支持</option>
                <option value="refutes">反驳</option>
                <option value="mentions">补充</option>
              </select>
              <select aria-label="目标节点" value={relationTargetId} onChange={event => setRelationTargetId(event.target.value)}>
                {relationCandidates.map(node => <option value={node.id} key={node.id}>{node.title}</option>)}
              </select>
            </div>
            <label>判断理由<textarea value={relationRationale} maxLength={1000} rows={3} placeholder="写清两条内容为什么构成这个关系（至少 4 个字）" onChange={event => setRelationRationale(event.target.value)}/></label>
            <div><small>{relationRationale.trim().length}/1000</small><button type="button" disabled={relationBusy || !relationTargetId || relationRationale.trim().length < 4} onClick={() => void submitRelation()}>{relationBusy ? '保存中…' : '确认建立'}</button></div>
          </div>}
        </section>}
        {relatedEdges.length > 0 && <section className="evidence-related"><strong>直接关系</strong>{relatedEdges.map(edge => {
          const neighborId = edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.fromNodeId
          const neighbor = nodeById.get(neighborId)
          return <div className={`evidence-related-row ${edge.status ?? 'confirmed'}`} key={edge.id}>
            <button type="button" className="evidence-related-target" onClick={() => neighbor && setSelectedNodeId(neighbor.id)}><Link2 size={13}/><span>{edge.label}<small>{neighbor?.title}</small></span></button>
            {edge.rationale && <p>{edge.rationale}</p>}
            <div className="evidence-related-meta"><span>{edge.status === 'proposed' ? '待你确认' : evidenceProvenanceLabel(edge.provenance)}</span>{edge.relationId && (edge.canAccept || edge.canReject) && <span>
              {edge.canAccept && <button type="button" disabled={relationBusy} onClick={() => void reviewRelation(edge, 'accept')}>采纳</button>}
              {edge.canReject && <button type="button" disabled={relationBusy} onClick={() => void reviewRelation(edge, 'reject')}>{edge.status === 'proposed' ? '拒绝' : '撤销'}</button>}
            </span>}</div>
          </div>
        })}</section>}
        <div className="evidence-inspector-actions">
          {selectedNode.sourceId && <button type="button" onClick={() => onOpenSource(selectedNode.sourceId!, selectedNode.pageNumber, selectedNode.anchor)}><BookOpen size={14}/>{selectedNode.pageNumber ? '回到原文位置' : '打开论文附件'}</button>}
          {selectedNode.documentId && <button type="button" onClick={() => onOpenReview(selectedNode.documentId!)}><ExternalLink size={14}/>打开复查文档</button>}
        </div>
      </> : <div className="evidence-inspector-empty"><CircleDot size={24}/><strong>选择一条关系</strong><span>这里会解释节点来源、可信状态和返回原文的位置。</span></div>}
    </aside>
  </div>
}

function EvidenceNodeButton({ node, selected, onSelect, style }: {
  node: EvidenceGraphNode
  selected: boolean
  onSelect: (id: string) => void
  style?: CSSProperties
}) {
  return <button type="button" className={`evidence-node ${node.trust} ${selected ? 'selected' : ''}`} style={style} onClick={() => onSelect(node.id)}>
    <span><i/>{node.kindLabel}<small>{node.locationLabel}</small></span>
    <strong>{node.title}</strong>
    <p>{node.excerpt}</p>
  </button>
}

function evidenceLayerRank(layer: EvidenceGraphNode['layer']) {
  return { evidence: 0, interpretation: 1, synthesis: 2 }[layer]
}

function evidenceProvenanceLabel(provenance: EvidenceGraphEdge['provenance']) {
  return {
    user_confirmed: '用户建立',
    ai_proposed: 'AI 建议',
    ai_accepted: '已采纳 AI',
    system: '系统溯源',
  }[provenance]
}

function evidenceTrustLabel(trust: EvidenceGraphNode['trust']) {
  return {
    source: '原文证据',
    user: '用户原笔记',
    ai_draft: 'AI 草稿',
    ai_accepted: '用户已采纳',
    unsupported: '待核验 · 无来源',
  }[trust]
}

function evidenceTrustCopy(trust: EvidenceGraphNode['trust']) {
  return {
    source: '内容来自保存的论文原文片段。位置明确时可以直接回到 PDF 页码和选区。',
    user: '这是你的原始笔记或阅读判断。AI 只能引用它，不能覆盖或改写它。',
    ai_draft: '这是 AI 生成的整理草稿。关系线只表示它引用了哪些材料，不代表结论已经得到人工确认。',
    ai_accepted: '这是已由用户采纳的 AI 阅读卡内容；来源关系仍保留，采纳不会改变原文或用户笔记。',
    unsupported: '这段内容没有任何来源引用，只能作为待核验提示，不能伪装成正式结论。',
  }[trust]
}

function buildBrowserEvidenceGraph(sources: Source[], annotations: Annotation[]): EvidenceGraphView {
  const sourceById = new Map(sources.map(source => [source.id, source]))
  const nodes: EvidenceGraphNode[] = []
  const edges: EvidenceGraphEdge[] = []
  for (const annotation of annotations) {
    const source = annotation.sourceId ? sourceById.get(annotation.sourceId) : undefined
    const pageNumber = annotation.anchor?.pageNumber
    const common = {
      itemId: annotation.bibliographicItemId,
      itemTitle: annotation.paperTitle,
      sourceId: annotation.sourceId,
      sourceName: annotation.sourceName || source?.name,
      pageNumber,
      anchor: annotation.anchor as DesktopFragmentAnchor | undefined,
      locationLabel: pageNumber ? `第 ${pageNumber} 页` : annotation.page || '位置待核对',
    }
    const quoteId = `fragment:preview-quote:${annotation.id}`
    if (annotation.text.trim()) nodes.push({
      id: quoteId,
      entityId: `preview-quote:${annotation.id}`,
      entityType: 'fragment',
      layer: 'evidence',
      origin: 'source_evidence',
      trust: 'source',
      title: annotation.paperTitle || annotation.sourceName || source?.name || '原文证据',
      excerpt: annotation.text,
      kindLabel: '原文摘录',
      ...common,
    })
    if (annotation.note.trim()) {
      const noteId = `fragment:preview-note:${annotation.id}`
      nodes.push({
        id: noteId,
        entityId: `preview-note:${annotation.id}`,
        entityType: 'fragment',
        layer: 'interpretation',
        origin: 'user',
        trust: 'user',
        title: `我的批注 · ${annotation.paperTitle || annotation.sourceName || source?.name || '未关联论文'}`,
        excerpt: annotation.note,
        kindLabel: annotation.category || '用户笔记',
        ...common,
      })
      if (annotation.text.trim()) edges.push({
        id: `preview-relation:${annotation.id}`,
        fromNodeId: noteId,
        toNodeId: quoteId,
        relation: 'comments_on',
        label: '批注于',
        provenance: 'user_confirmed',
      })
    }
  }
  const linked = new Set(edges.flatMap(edge => [edge.fromNodeId, edge.toNodeId]))
  return {
    nodes,
    edges,
    unlinkedNodeIds: nodes.filter(node => !linked.has(node.id)).map(node => node.id),
    limited: false,
    scope: { itemIds: [] },
    summary: {
      evidence: nodes.filter(node => node.origin === 'source_evidence').length,
      userNotes: nodes.filter(node => node.origin === 'user').length,
      aiDrafts: 0,
      aiAccepted: 0,
      reviewConclusions: 0,
      unsupported: 0,
      relations: edges.length,
    },
  }
}

function readingStateLabel(state: PaperReadingState) {
  return `${readingStatusLabel(state.readingStatus)} · ${relevanceLabel(state.relevance)}`
}

function readingStatusLabel(status: PaperReadingState['readingStatus']) {
  return {
    unread: '未读',
    title_only: '只看题目/摘要',
    skimming: '快速浏览',
    reading: '精读中',
    finished: '已读完',
  }[status]
}

function relevanceLabel(relevance: PaperReadingState['relevance']) {
  return {
    undecided: '相关性待定',
    core: '核心相关',
    relevant: '相关',
    supplemental: '部分相关',
    mismatched: '方向不匹配',
  }[relevance]
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
  importResult,
  onDismissImportResult,
  onCopyCitation,
  onReviewCitation,
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
  importResult?: { items: BibliographicSummary[]; alreadyImported: boolean }
  onDismissImportResult:()=>void
  onCopyCitation:(item: CitationItemView)=>void
  onReviewCitation:(item: CitationItemView)=>void
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
  const paperRows = useMemo(
    () => buildPaperLibraryRows(bibliographicItems, sources, annotations),
    [annotations, bibliographicItems, sources],
  )
  const librarySummary = useMemo(() => paperLibrarySummary(paperRows), [paperRows])
  const unboundSources = useMemo(
    () => unboundLibrarySources(bibliographicItems, sources),
    [bibliographicItems, sources],
  )
  const bibliographyMatches = useMemo(() => {
    const terms = searchTerms(query)
    const candidates = paperRows.filter(row => !row.source).map(row => row.item)
    if (!terms.length) return candidates
    return candidates.filter(item => {
      const haystack = [
        item.title,
        item.issued,
        ...item.authors.flatMap(author => [author.literal, author.family, author.given]),
      ].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    })
  }, [paperRows, query])
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
      <div><p className="eyebrow">本地研究库</p><h1>资料库</h1><p>搜索在本机完成，覆盖题录、正文、Markdown、批注、阅读结论与复查文档。</p></div>
      <div className="page-actions">
        <button className="outline-button" onClick={onBibliography}><BookOpen size={16}/> 导入题录</button>
        <button className="primary-button" onClick={onUpload}><Upload size={16}/> 导入资料</button>
      </div>
    </div>
    {importResult && <CitationImportPanel
      items={importResult.items}
      alreadyImported={importResult.alreadyImported}
      onCopy={onCopyCitation}
      onReview={onReviewCitation}
      onClose={onDismissImportResult}
    />}
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
      <BibliographicOnlyList items={bibliographyMatches} query={query}/>
    </> : <>
      <PaperLibraryOverview summary={librarySummary}/>
      <PaperLibraryTable
        rows={paperRows}
        onReader={onReader}
        onReanalyze={onReanalyze}
        onMineru={onMineru}
        onCopyCitation={onCopyCitation}
        onReviewCitation={onReviewCitation}
      />
      <UnboundSourceList
        sources={unboundSources}
        initiallyOpen={!paperRows.length}
        onReader={onReader}
        onReanalyze={onReanalyze}
        onMineru={onMineru}
      />
    </>}
  </div>
}

function PaperLibraryOverview({ summary }: { summary: ReturnType<typeof paperLibrarySummary> }) {
  const entries = [
    ['论文项目', summary.total, 'all'],
    ['未开始', summary.unread, 'unread'],
    ['阅读中', summary.inProgress, 'reading'],
    ['已读完', summary.finished, 'finished'],
    ['批注', summary.annotationTotal, 'annotations'],
  ] as const
  return <section className="paper-library-overview" aria-label="当前研究库概况">
    {entries.map(([label, value, tone]) => <div className={tone} key={label}>
      <strong>{value}</strong><span>{label}</span>
    </div>)}
    {summary.mismatched > 0 && <p>{summary.mismatched} 篇已标记“方向不匹配”，仍保留在研究记录中。</p>}
  </section>
}

function PaperLibraryTable({
  rows,
  onReader,
  onReanalyze,
  onMineru,
  onCopyCitation,
  onReviewCitation,
}: {
  rows: ReturnType<typeof buildPaperLibraryRows<BibliographicSummary, Source>>
  onReader: (id: string) => void
  onReanalyze: (id: string) => void
  onMineru: (id: string) => void
  onCopyCitation: (item: CitationItemView) => void
  onReviewCitation: (item: CitationItemView) => void
}) {
  if (!rows.length) return <section className="paper-library-empty">
    <BookOpen size={24}/>
    <strong>还没有论文项目</strong>
    <span>导入 PDF 或 EndNote XML、RIS、BibTeX 后，这里会按论文显示阅读进度和研究状态。</span>
  </section>

  return <section className="paper-library-table" aria-label="论文项目">
    <header>
      <span>论文项目</span><span>阅读状态</span><span>阅读进度</span><span>批注</span><span>研究用途</span><span/>
    </header>
    {rows.map(({ item, source, annotationCount }) => {
      const state = item.readingState
      const progress = readingProgressPercent(state)
      const authorText = item.authors
        .map(author => author.literal || [author.family, author.given].filter(Boolean).join(', '))
        .filter(Boolean)
        .slice(0, 3)
        .join('；')
      const attachmentLabel = source
        ? `${source.name}${source.pages ? ` · ${source.pages} 页` : ''}`
        : item.attachmentState === 'missing'
          ? '附件路径失效'
          : item.attachmentState === 'denied'
            ? '附件无权读取'
            : '仅题录，尚未关联原文'
      return <article className={`paper-library-row ${source ? '' : 'without-source'}`} key={item.id}>
        <div className="paper-library-title">
          <span className={`file-icon ${source?.kind ?? 'BIB'}`}>{source?.kind === 'PDF' ? 'PDF' : source ? source.kind.slice(0, 2) : 'BIB'}</span>
          <span>
            <strong title={item.title}>{item.title}</strong>
            <small>{authorText || '作者待核对'}{item.issued ? ` · ${item.issued}` : ''}</small>
            <em className={source ? '' : 'missing'}>{attachmentLabel}</em>
          </span>
        </div>
        <div className="paper-state-cell">
          <span className={`paper-reading-badge ${state.readingStatus}`}>{readingStatusLabel(state.readingStatus)}</span>
          <small className={state.relevance === 'mismatched' ? 'mismatched' : ''}>{relevanceLabel(state.relevance)}</small>
        </div>
        <div className="paper-progress-cell">
          <div><i style={{ width: `${progress}%` }}/></div>
          <small>{readingProgressLabel(state)}</small>
        </div>
        <div className="paper-annotation-count">
          <strong>{annotationCount}</strong><small>条</small>
        </div>
        <div className="paper-purpose-cell">
          {state.purposeTags.length
            ? <>{state.purposeTags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}{state.purposeTags.length > 2 && <small>+{state.purposeTags.length - 2}</small>}</>
            : <em>用途待标记</em>}
        </div>
        <div className="paper-library-actions">
          {(item.needsMetadataReview || item.citation.incomplete) && <button className="citation-review-button" onClick={() => onReviewCitation(item)}><AlertTriangle size={13}/>检查题录</button>}
          <CitationButton item={item} onCopy={onCopyCitation} compact/>
          {source?.status === '需重新分析' && <button className="compact-button warning" onClick={() => onReanalyze(source.id)}>重新分析</button>}
          {source?.fileId && !source.isDemo && source.mineruState !== '完成' && <button
            className="compact-button mineru-button"
            disabled={source.mineruState === '准备中' || source.mineruState === '解析中'}
            onClick={() => onMineru(source.id)}
          >{source.mineruState === '准备中' || source.mineruState === '解析中' ? '解析中' : '转 Markdown'}</button>}
          {source
            ? <button className="paper-open-button" onClick={() => onReader(source.id)}>继续阅读 <ChevronRight size={14}/></button>
            : <span className="paper-no-attachment">等待附件</span>}
        </div>
        {source && <div className="paper-parse-state">
          <span className={`pill ${pill(source.status)}`}>{source.status}</span>
          {source.mineruState && source.mineruState !== '未使用' && <span>MinerU {source.mineruState}{source.mineruProgress ? ` · ${source.mineruProgress}` : ''}</span>}
        </div>}
      </article>
    })}
  </section>
}

function UnboundSourceList({
  sources,
  initiallyOpen,
  onReader,
  onReanalyze,
  onMineru,
}: {
  sources: Source[]
  initiallyOpen: boolean
  onReader: (id: string) => void
  onReanalyze: (id: string) => void
  onMineru: (id: string) => void
}) {
  if (!sources.length) return null
  return <details className="unbound-sources" open={initiallyOpen}>
    <summary>
      <span><strong>其他资料</strong><small>未绑定论文题录的实验文件、汇报、表格或旧资料</small></span>
      <em>{sources.length}</em>
    </summary>
    <div className="source-table">
      <div className="table-head"><span>资料</span><span>版本</span><span>更新时间</span><span>解析状态</span><span/></div>
      {sources.map(source => <div className="table-row" key={source.id}>
        <button className="source-name source-open-button" onClick={() => onReader(source.id)}>
          <span className={`file-icon ${source.kind}`}>{source.kind === 'PDF' ? 'PDF' : source.kind.slice(0, 2)}</span>
          <span><strong>{source.name}</strong><small>{source.kind}{source.pages ? ` · ${source.pages} 页` : ''}</small></span>
        </button>
        <span>v{source.version}</span>
        <span>{source.updated}</span>
        <span className={`pill ${pill(source.status)}`}>{source.status}</span>
        <div className="row-buttons">
          {source.status === '需重新分析' && <button className="compact-button" onClick={() => onReanalyze(source.id)}>重新分析</button>}
          {source.fileId && !source.isDemo && <button className="compact-button mineru-button" disabled={source.mineruState === '准备中' || source.mineruState === '解析中'} onClick={() => source.mineruState === '完成' ? onReader(source.id) : onMineru(source.id)}>{source.mineruState === '完成' ? '查看 Markdown' : source.mineruState === '准备中' || source.mineruState === '解析中' ? '解析中' : '本地 MinerU'}</button>}
          <button className="icon-button" title="打开资料" onClick={() => onReader(source.id)}><ChevronRight size={17}/></button>
        </div>
      </div>)}
    </div>
  </details>
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
type ReaderViewMode = 'original' | 'markdown' | 'parallel' | 'bilingual'
type ReaderSelection = {
  text: string
  translationText: string
  pageNumber?: number
  endPageNumber?: number
  markdownBlockId?: string
  rects: Array<{ x: number; y: number; width: number; height: number }>
  menuX: number
  menuY: number
}

function FunctionalReader({
  settings,
  workspaceName,
  source,
  sources,
  items,
  annotations,
  paper,
  researchWorkspace,
  agentOpen,
  jumpTarget,
  onSelectSource,
  onBack,
  onAnnotate,
  onUpdateReading,
  onSaveMarkdownLayout,
  onSaveReaderState,
  onOpenCitation,
  onEditAnnotation,
  onArchiveAnnotation,
  onCreateTaskFromAnnotation,
  onExportAnnotations,
  onCopyCitation,
  onAgent,
  onAgentClose,
  onCreateActionPack,
  onSettings,
}: {
  settings: AISettings
  workspaceName: string
  source: Source
  sources: Source[]
  items: BibliographicSummary[]
  annotations: Annotation[]
  paper?: BibliographicSummary
  researchWorkspace?: ResearchWorkspace
  agentOpen: boolean
  jumpTarget?: ReaderJumpTarget
  onSelectSource: (id: string) => void
  onBack: () => void
  onAnnotate: (draft?: AnnotationDraft) => void
  onUpdateReading: (itemId: string, patch: ReadingStatePatch, quiet?: boolean) => void
  onSaveMarkdownLayout: (sourceId: string, layout: AcademicMarkdownLayout) => void
  onSaveReaderState: (sourceId: string, state: ReaderSourceState) => void
  onOpenCitation: (sourceId: string, pageNumber?: number, anchor?: FragmentAnchor) => void
  onEditAnnotation: (annotation: Annotation) => void
  onArchiveAnnotation: (annotation: Annotation) => void
  onCreateTaskFromAnnotation: (annotation: Annotation) => Promise<void>
  onExportAnnotations: (sourceId: string) => void
  onCopyCitation: (item: CitationItemView) => void
  onAgent: () => void
  onAgentClose: () => void
  onCreateActionPack: (draft: AgentActionPackDraft) => Promise<void>
  onSettings: () => void
}) {
  const readableText = source.mineruMarkdown ?? source.extractedText
  const initialReaderState = source.kind === 'PDF'
    ? normalizeReaderSourceState(source.readerState, Boolean(readableText))
    : { viewMode: 'markdown' as const, zoom: 1 }
  const [file, setFile] = useState<File | undefined>()
  const [pdfDocument, setPdfDocument] = useState<LocalPdfDocument | undefined>()
  const [activePage, setActivePage] = useState(restoredReaderPage(paper?.readingState.lastPage))
  const [loadState, setLoadState] = useState('正在读取本地原文件…')
  const [viewMode, setViewMode] = useState<ReaderViewMode>(initialReaderState.viewMode)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [immersive, setImmersive] = useState(false)
  const [zoom, setZoom] = useState(initialReaderState.zoom)
  const [leftPanelMode, setLeftPanelMode] = useState<'papers' | 'outline' | 'pages' | 'search'>('papers')
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineEntry[]>([])
  const [outlineState, setOutlineState] = useState('')
  const [pdfSearchQuery, setPdfSearchQuery] = useState('')
  const [pdfSearchResults, setPdfSearchResults] = useState<PdfSearchResult[]>([])
  const [pdfSearchState, setPdfSearchState] = useState('')
  const [pdfSearchBusy, setPdfSearchBusy] = useState(false)
  const [currentPageText, setCurrentPageText] = useState('')
  const pdfSearchInputRef = useRef<HTMLInputElement>(null)
  const pdfSearchRunRef = useRef(0)
  const [selection, setSelection] = useState<ReaderSelection>()
  const [agentSelection, setAgentSelection] = useState<ReaderSelection>()
  const [annotationCaptureMode, setAnnotationCaptureMode] = useState(false)
  const annotationCaptureModeRef = useRef(false)
  const selectionCaptureScheduledRef = useRef(false)
  const [selectionMode, setSelectionMode] = useState<'translate' | 'explain' | 'ask'>('translate')
  const [selectionQuestion, setSelectionQuestion] = useState('')
  const [selectionAnswer, setSelectionAnswer] = useState('')
  const [selectionNotice, setSelectionNotice] = useState('')
  const [selectionBusy, setSelectionBusy] = useState(false)
  const [selectionTranslationProvider, setSelectionTranslationProvider] = useState<'local' | 'ai'>(settings.translationProvider ?? 'local')
  const [selectionCloudConfirm, setSelectionCloudConfirm] = useState(false)
  const [selectionEditMode, setSelectionEditMode] = useState(false)
  const [localTranslationStatus, setLocalTranslationStatus] = useState<LocalTranslationStatus>()
  const [translationInstalling, setTranslationInstalling] = useState(false)
  const [translationInstallProgress, setTranslationInstallProgress] = useState('')
  const [parallelFocus, setParallelFocus] = useState<'both' | 'pdf' | 'draft'>('both')
  const [parallelOutlineOpen, setParallelOutlineOpen] = useState(false)
  const [parallelLayoutRevision, setParallelLayoutRevision] = useState(0)
  const [parallelLayout, setParallelLayout] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('reader-parallel-layout-v1') || '')
      if (saved && Number(saved['parallel-pdf']) >= 30 && Number(saved['parallel-draft']) >= 30) return saved
    } catch { /* A missing or old local preference falls back to an even split. */ }
    return { 'parallel-pdf': 50, 'parallel-draft': 50 }
  })
  const [mineruLayoutBlocks, setMineruLayoutBlocks] = useState<MineruLayoutBlock[]>([])
  const [activeAnnotationId, setActiveAnnotationId] = useState<string>()
  const [citationAnchor, setCitationAnchor] = useState<FragmentAnchor>()
  const sourceAnnotations = annotations.filter(annotation => !annotation.sourceId || annotation.sourceId === source.id)
  const activeAnnotation = activeAnnotationId === '__citation_target__'
    ? undefined
    : sourceAnnotations.find(annotation => annotation.id === activeAnnotationId)
  const activeMarkdownTarget = useMemo(() => {
    if (!source.mineruMarkdown) return undefined
    const anchor = activeAnnotation?.anchor ?? (activeAnnotationId === '__citation_target__' ? citationAnchor : undefined)
    const sameMarkdownRevision = !anchor?.sourceContentSha256
      || !source.mineruMarkdownSha256
      || anchor.sourceContentSha256 === source.mineruMarkdownSha256
    if (anchor?.markdownBlockId && sameMarkdownRevision) {
      return { state: 'resolved' as const, markdownBlockId: anchor.markdownBlockId, pageNumber: anchor.pageNumber }
    }
    const quote = anchor?.quote?.exact ?? activeAnnotation?.text
    return quote ? locateQuoteInMarkdown(source.mineruMarkdown, quote, mineruLayoutBlocks) : undefined
  }, [activeAnnotation, activeAnnotationId, citationAnchor, mineruLayoutBlocks, source.mineruMarkdown])
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
    if (!pdfDocument || source.kind !== 'PDF') {
      setCurrentPageText('')
      return
    }
    let cancelled = false
    pdfDocument.getPage(activePage)
      .then(page => page.getTextContent())
      .then(content => {
        if (cancelled) return
        const text = content.items
          .map(item => 'str' in item ? item.str : '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        setCurrentPageText(text)
      })
      .catch(() => { if (!cancelled) setCurrentPageText('') })
    return () => { cancelled = true }
  }, [activePage, pdfDocument, source.id, source.kind])

  useEffect(() => {
    let alive = true
    let loadedDocument: LocalPdfDocument | undefined
    const restoredReaderState = source.kind === 'PDF'
      ? normalizeReaderSourceState(source.readerState, Boolean(source.mineruMarkdown ?? source.extractedText))
      : { viewMode: 'markdown' as const, zoom: 1 }
    const restoredPage = restoredReaderPage(paper?.readingState.lastPage)
    setActivePage(restoredPage)
    setSelection(undefined)
    setAgentSelection(undefined)
    setSelectionAnswer('')
    setActiveAnnotationId(undefined)
    setCitationAnchor(undefined)
    setPdfDocument(undefined)
    setCurrentPageText('')
    setViewMode(restoredReaderState.viewMode)
    setZoom(restoredReaderState.zoom)
    setLeftPanelMode('papers')
    setPdfOutline([])
    setOutlineState('')
    setPdfSearchQuery('')
    setPdfSearchResults([])
    setPdfSearchState('')
    setParallelFocus('both')
    setParallelOutlineOpen(false)
    pdfSearchRunRef.current += 1
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
            await cleanupPdfDocumentWhenIdle(document)
            return
          }
          setPdfDocument(document)
        }
        setLoadState('')
      })
      .catch(error => alive && setLoadState(error instanceof Error ? error.message : '读取本地原文件失败。'))
    return () => {
      alive = false
      if (loadedDocument) void cleanupPdfDocumentWhenIdle(loadedDocument).catch(() => undefined)
    }
  }, [source.id, source.fileId, source.isDemo, source.kind])

  useEffect(() => {
    if (!pdfDocument || source.kind !== 'PDF') return
    let disposed = false
    setOutlineState('正在读取 PDF 目录…')
    void loadPdfOutline(pdfDocument)
      .then(entries => {
        if (disposed) return
        setPdfOutline(entries)
        setOutlineState(entries.length ? '' : '这份 PDF 没有内置目录。')
      })
      .catch(error => {
        if (!disposed) setOutlineState(error instanceof Error ? error.message : 'PDF 目录读取失败。')
      })
    return () => { disposed = true }
  }, [pdfDocument, source.id, source.kind])

  useEffect(() => {
    if (!pdfDocument || source.kind !== 'PDF') return
    const restoredPage = restoredReaderPage(paper?.readingState.lastPage, pdfDocument.numPages)
    setActivePage(restoredPage)
    const frame = window.requestAnimationFrame(() => scrollToPage(restoredPage, false))
    return () => window.cancelAnimationFrame(frame)
  }, [pdfDocument, source.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onSaveReaderState(source.id, normalizeReaderSourceState({ viewMode, zoom }, Boolean(readableText)))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [source.id, viewMode, zoom])

  useEffect(() => {
    let alive = true
    const desktop = window.readerDesktop
    if (!desktop || selectionTranslationProvider !== 'local') {
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
  }, [selectionTranslationProvider])

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
    if (viewMode === 'original' || !activeMarkdownTarget) return
    if (activeMarkdownTarget.state !== 'resolved' || !activeMarkdownTarget.markdownBlockId) {
      setSelectionNotice('这条证据无法在当前 Markdown 中唯一定位；已保留原 PDF 页码与原文，不会猜测对应段落。')
      return
    }
    setSelectionNotice('已按唯一原文命中定位到 Markdown 块；页码只在解析结果明确提供时显示。')
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-markdown-block="${activeMarkdownTarget.markdownBlockId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeMarkdownTarget, viewMode])

  useEffect(() => {
    function handleReaderKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f' && source.kind === 'PDF') {
        event.preventDefault()
        setImmersive(false)
        setLeftOpen(true)
        setLeftPanelMode('search')
        window.setTimeout(() => pdfSearchInputRef.current?.focus(), 0)
        return
      }
      if (event.key === 'Escape') {
        if (selection) {
          setSelection(undefined)
          return
        }
        if (annotationCaptureModeRef.current) {
          annotationCaptureModeRef.current = false
          setAnnotationCaptureMode(false)
          return
        }
        if (immersive) {
          setImmersive(false)
          setRightOpen(true)
        }
      }
    }
    document.addEventListener('keydown', handleReaderKey)
    return () => document.removeEventListener('keydown', handleReaderKey)
  }, [immersive, selection, source.kind])

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
    if (selectionCaptureScheduledRef.current) return
    selectionCaptureScheduledRef.current = true
    window.requestAnimationFrame(() => {
      selectionCaptureScheduledRef.current = false
      const current = window.getSelection()
      const text = current?.toString().trim()
      if (!current || current.isCollapsed || !text || current.rangeCount === 0) return
      const range = current.getRangeAt(0)
      const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const endElement = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
      const pageElement = startElement?.closest<HTMLElement>('[data-pdf-page]')
      const endPageElement = endElement?.closest<HTMLElement>('[data-pdf-page]')
      const markdownBlockElement = startElement?.closest<HTMLElement>('[data-markdown-block]')
      const allowedRoot = startElement?.closest('.reader-document')
      if (!allowedRoot) return
      const pageRect = pageElement?.getBoundingClientRect()
      const rects = pageRect
        ? Array.from(range.getClientRects())
          .filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom >= pageRect.top && rect.top <= pageRect.bottom)
          .map(rect => ({
            x: Math.max(0, (rect.left - pageRect.left) / pageRect.width),
            y: Math.max(0, (rect.top - pageRect.top) / pageRect.height),
            width: Math.min(1, rect.width / pageRect.width),
            height: Math.min(1, rect.height / pageRect.height),
          }))
        : []
      const selectionRect = range.getBoundingClientRect()
      const prepared = prepareTranslationSelection(text, pageElement ? Number(pageElement.dataset.pdfPage) : undefined, endPageElement ? Number(endPageElement.dataset.pdfPage) : undefined)
      const nextSelection = {
        text,
        translationText: prepared.mergedText,
        pageNumber: pageElement ? Number(pageElement.dataset.pdfPage) : undefined,
        endPageNumber: endPageElement ? Number(endPageElement.dataset.pdfPage) : undefined,
        markdownBlockId: markdownBlockElement?.dataset.markdownBlock,
        rects,
        menuX: Math.max(12, Math.min(selectionRect.left, window.innerWidth - 430)),
        menuY: Math.max(12, Math.min(selectionRect.bottom + 8, window.innerHeight - 300)),
      }
      if (annotationCaptureModeRef.current) {
        annotationCaptureModeRef.current = false
        setAnnotationCaptureMode(false)
        setSelection(undefined)
        onAnnotate(annotationDraftForSelection(nextSelection))
        return
      }
      setSelection(nextSelection)
      setSelectionMode('translate')
      setSelectionQuestion('')
      setSelectionAnswer('')
      setSelectionNotice('')
      setSelectionTranslationProvider(settings.translationProvider ?? 'local')
      setSelectionCloudConfirm(false)
      setSelectionEditMode(false)
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
        text: selection.translationText,
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

  async function runSelectionAI(mode: 'translate' | 'explain' | 'ask', cloudConfirmed = false) {
    if (!selection?.text) return
    setSelectionMode(mode)
    if (mode === 'translate' && selectionTranslationProvider === 'local') {
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
    if (mode === 'translate' && selectionTranslationProvider === 'ai' && !cloudConfirmed) {
      setSelectionCloudConfirm(true)
      setSelectionNotice('发送前请核对下方范围、Provider、模型和字符数。')
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
            { role: 'user', content: `原文位置：${selection.pageNumber ? selection.endPageNumber && selection.endPageNumber !== selection.pageNumber ? `p. ${selection.pageNumber}–${selection.endPageNumber}` : `p. ${selection.pageNumber}` : '结构化文本'}\n\n${selection.translationText}` },
          ],
        }),
      })
      if (!response.ok) throw new Error(`服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('服务没有返回可用内容。')
      setSelectionAnswer(content)
      setSelectionCloudConfirm(false)
      setSelectionNotice('结果仅为辅助；原文仍是引用依据。')
    } catch (error) {
      setSelectionNotice(error instanceof Error ? `调用失败：${error.message}` : '调用失败。')
    } finally {
      setSelectionBusy(false)
    }
  }

  function saveSelection() {
    if (!selection) return
    onAnnotate(annotationDraftForSelection(selection))
    setSelection(undefined)
  }

  function addSelectionToAgent() {
    if (!selection) return
    setAgentSelection(selection)
    window.getSelection()?.removeAllRanges()
    setSelection(undefined)
    setSelectionAnswer('')
    setSelectionNotice('')
    openAgentPanel()
  }

  function annotationDraftForSelection(selectedText: ReaderSelection): AnnotationDraft {
    const markdownAnchor = source.mineruMarkdown && selectedText.markdownBlockId
      ? markdownSelectionAnchor(source.mineruMarkdown, selectedText.markdownBlockId, selectedText.text, mineruLayoutBlocks)
      : undefined
    return {
      text: selectedText.text,
      location: selectedText.pageNumber
        ? selectedText.endPageNumber && selectedText.endPageNumber !== selectedText.pageNumber
          ? `第 ${selectedText.pageNumber}–${selectedText.endPageNumber} 页`
          : `第 ${selectedText.pageNumber} 页`
        : selectedText.markdownBlockId ? `Markdown · ${selectedText.markdownBlockId}` : '结构化文本选区',
      anchor: selectedText.pageNumber
        ? {
            type: 'pdf',
            state: 'resolved',
            pageNumber: selectedText.pageNumber,
            rects: selectedText.rects,
            quote: { exact: selectedText.text },
          }
        : markdownAnchor
          ? {
              ...markdownAnchor,
              sourceContentSha256: source.mineruMarkdownSha256,
            }
          : {
            type: source.mineruMarkdown ? 'markdown' : 'text',
            state: 'resolved',
            quote: { exact: selectedText.text },
          },
    }
  }

  function beginAnnotationCapture() {
    window.getSelection()?.removeAllRanges()
    setSelection(undefined)
    setSelectionAnswer('')
    setSelectionNotice('')
    annotationCaptureModeRef.current = true
    setAnnotationCaptureMode(true)
    if (source.kind === 'PDF') setViewMode('original')
    else setViewMode('markdown')
    window.setTimeout(() => {
      if (source.kind === 'PDF') scrollToPage(activePage)
      document.querySelector<HTMLElement>('.reader-document')?.focus()
    }, 0)
  }

  function scrollToPage(pageNumber: number, smooth = true) {
    const target = document.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`)
    target?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  function openLeftPanel(mode: 'papers' | 'outline' | 'pages' | 'search') {
    setImmersive(false)
    setLeftOpen(true)
    setLeftPanelMode(mode)
    if (mode === 'search') window.setTimeout(() => pdfSearchInputRef.current?.focus(), 0)
  }

  function openAgentPanel() {
    setImmersive(false)
    setLeftOpen(false)
    setRightOpen(true)
    onAgent()
  }

  async function runPdfPageSearch() {
    if (!pdfDocument) return
    const query = pdfSearchQuery.trim()
    if (!query) {
      setPdfSearchResults([])
      setPdfSearchState('输入要在当前 PDF 中查找的文字。')
      return
    }
    const runId = pdfSearchRunRef.current + 1
    pdfSearchRunRef.current = runId
    setPdfSearchBusy(true)
    setPdfSearchResults([])
    setPdfSearchState(`正在本机搜索 ${pdfDocument.numPages} 页…`)
    try {
      const results = await searchPdfDocument(pdfDocument, query, {
        limit: 200,
        isCancelled: () => pdfSearchRunRef.current !== runId,
        onProgress: progress => {
          if (pdfSearchRunRef.current === runId) {
            setPdfSearchState(`已搜索 ${progress.pageNumber}/${progress.totalPages} 页 · ${progress.resultCount} 个命中页面`)
          }
        },
      })
      if (pdfSearchRunRef.current !== runId) return
      setPdfSearchResults(results)
      const totalMatches = results.reduce((sum, result) => sum + result.matchCount, 0)
      setPdfSearchState(results.length
        ? `${results.length} 个页面、共 ${totalMatches} 处命中 · 搜索仅在本机完成`
        : '当前 PDF 没有找到这个词。')
    } catch (error) {
      if (pdfSearchRunRef.current === runId) {
        setPdfSearchState(error instanceof Error ? error.message : '当前 PDF 搜索失败。')
      }
    } finally {
      if (pdfSearchRunRef.current === runId) setPdfSearchBusy(false)
    }
  }

  function handleReaderWheel(event: React.WheelEvent<HTMLElement>) {
    if (!event.ctrlKey || source.kind !== 'PDF') return
    event.preventDefault()
    setZoom(current => readerZoomAfterWheel(current, event.deltaY, true))
  }

  function setParallelBalance(pdfPercent: number) {
    const layout = { 'parallel-pdf': pdfPercent, 'parallel-draft': 100 - pdfPercent }
    setParallelFocus('both')
    setParallelLayout(layout)
    window.localStorage.setItem('reader-parallel-layout-v1', JSON.stringify(layout))
    setParallelLayoutRevision(value => value + 1)
  }

  const readerClasses = [
    'research-reader',
    leftOpen ? 'with-library' : 'library-collapsed',
    rightOpen ? 'with-inspector' : 'inspector-collapsed',
    agentOpen ? 'agent-inspector-open' : '',
    immersive ? 'is-immersive' : '',
  ].filter(Boolean).join(' ')
  let selectionCloudProviderLabel = 'AI Provider'
  try { selectionCloudProviderLabel = new URL(settings.baseUrl).host || selectionCloudProviderLabel } catch { /* Settings UI validates before use. */ }

  return <div className={readerClasses}>
    <header className="research-reader-toolbar">
      <div className="reader-toolbar-group reader-title-group">
        <button className="reader-icon-button" onClick={onBack} title="返回资料库"><ArrowLeft size={17}/></button>
        <button className={`reader-icon-button ${leftOpen ? 'active' : ''}`} onClick={() => { setLeftOpen(value => !value); setImmersive(false) }} title="文献与 PDF 导航"><PanelLeft size={17}/></button>
        <div className="reader-title">
          <strong>{source.name}</strong>
          <span>{source.kind === 'PDF' ? `第 ${activePage} / ${pdfDocument?.numPages ?? source.pages ?? '…'} 页` : source.kind}</span>
        </div>
      </div>
      <div className="reader-view-switch" aria-label="阅读视图">
        <button className={viewMode === 'original' ? 'active' : ''} disabled={source.kind !== 'PDF'} onClick={() => setViewMode('original')}><FileText size={14}/>PDF 原文</button>
        <button className={viewMode === 'parallel' ? 'active' : ''} disabled={source.kind !== 'PDF' || !readableText} title="可调节宽度的 PDF 与整理稿对照" onClick={() => { setViewMode('parallel'); setLeftOpen(false); setRightOpen(false); setParallelFocus('both') }}><Columns2 size={14}/>版面对照</button>
        <button className={viewMode === 'bilingual' ? 'active' : ''} disabled={!readableText} onClick={() => setViewMode('bilingual')}><Languages size={14}/>中英对照</button>
        <button className={viewMode === 'markdown' ? 'active' : ''} disabled={!readableText} onClick={() => setViewMode('markdown')}><BookOpen size={14}/>整理稿</button>
      </div>
      <div className="reader-toolbar-group">
        {paper && <CitationButton item={paper} onCopy={onCopyCitation} compact/>}
        {source.kind === 'PDF' && <button className={`reader-icon-button ${leftOpen && leftPanelMode === 'search' ? 'active' : ''}`} onClick={() => openLeftPanel('search')} title="搜索当前 PDF（Ctrl + F）"><Search size={16}/></button>}
        {source.kind === 'PDF' && <div className="reader-zoom">
          <button onClick={() => setZoom(value => clampReaderZoom(value - .1))} title="缩小（Ctrl + 滚轮向下）"><Minus size={14}/></button>
          <span title="可在正文区域按 Ctrl + 滚轮缩放">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(value => clampReaderZoom(value + .1))} title="放大（Ctrl + 滚轮向上）"><Plus size={14}/></button>
        </div>}
        <button className="reader-icon-button" onClick={toggleImmersive} title="沉浸阅读"><Expand size={17}/></button>
        <button className={`reader-icon-button ${rightOpen ? 'active' : ''}`} onClick={() => { setRightOpen(value => !value); setImmersive(false) }} title="笔记与研究 Agent"><PanelRight size={17}/></button>
      </div>
    </header>

    <aside className="reader-library">
      <div className="reader-pane-heading">
        <div><span>阅读导航</span><strong>{paper?.title ?? source.name.replace(/\.pdf$/i, '')}</strong></div>
        <button className="reader-icon-button" onClick={onBack} title="打开资料库"><Files size={16}/></button>
      </div>
      <div className="reader-library-tabs" role="tablist" aria-label="阅读导航类型">
        <button className={leftPanelMode === 'papers' ? 'active' : ''} onClick={() => setLeftPanelMode('papers')}>文献</button>
        <button className={leftPanelMode === 'outline' ? 'active' : ''} disabled={!pdfDocument} onClick={() => setLeftPanelMode('outline')}>目录</button>
        <button className={leftPanelMode === 'pages' ? 'active' : ''} disabled={!pdfDocument} onClick={() => setLeftPanelMode('pages')}>页面</button>
        <button className={leftPanelMode === 'search' ? 'active' : ''} disabled={!pdfDocument} onClick={() => openLeftPanel('search')}>搜索</button>
      </div>
      {leftPanelMode === 'papers' && <div className="reader-paper-list">
        {sources.map(item => <button key={item.id} className={item.id === source.id ? 'active' : ''} onClick={() => onSelectSource(item.id)}>
          <span className={`reader-file-type ${item.kind}`}>{item.kind === 'PDF' ? 'PDF' : item.kind.slice(0, 2)}</span>
          <span><strong>{item.name}</strong><small>{item.pages ? `${item.pages} 页 · ` : ''}{item.mineruState === '完成' ? 'MD 已就绪' : item.status}</small></span>
        </button>)}
      </div>}
      {leftPanelMode === 'outline' && <div className="reader-outline-list">
        {outlineState && <p className="reader-navigation-state">{outlineState}</p>}
        {pdfOutline.map(entry => <button
          key={entry.id}
          disabled={!entry.pageNumber}
          className={entry.pageNumber === activePage ? 'active' : ''}
          style={{ paddingLeft: `${12 + Math.min(entry.depth, 4) * 14}px` }}
          onClick={() => entry.pageNumber && scrollToPage(entry.pageNumber)}
        >
          <span>{entry.title}</span>{entry.pageNumber && <small>{entry.pageNumber}</small>}
        </button>)}
      </div>}
      {leftPanelMode === 'pages' && pdfDocument && <div className="reader-thumbnail-list">
        {Array.from({ length: pdfDocument.numPages }, (_, index) => <PdfThumbnail
          key={index + 1}
          document={pdfDocument}
          pageNumber={index + 1}
          active={activePage === index + 1}
          onOpen={pageNumber => scrollToPage(pageNumber)}
        />)}
      </div>}
      {leftPanelMode === 'search' && <div className="reader-pdf-search">
        <form onSubmit={event => { event.preventDefault(); void runPdfPageSearch() }}>
          <Search size={14}/>
          <input
            ref={pdfSearchInputRef}
            value={pdfSearchQuery}
            onChange={event => setPdfSearchQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void runPdfPageSearch()
            }}
            placeholder="搜索当前 PDF…"
            aria-label="搜索当前 PDF"
          />
          {pdfSearchQuery && <button type="button" title="清空" onClick={() => { pdfSearchRunRef.current += 1; setPdfSearchQuery(''); setPdfSearchResults([]); setPdfSearchState('') }}><X size={13}/></button>}
        </form>
        <button className="reader-pdf-search-submit" disabled={pdfSearchBusy || !pdfSearchQuery.trim()} onClick={() => void runPdfPageSearch()}>{pdfSearchBusy ? '搜索中…' : '搜索'}</button>
        {pdfSearchState && <p className="reader-navigation-state">{pdfSearchState}</p>}
        <div className="reader-pdf-search-results">
          {pdfSearchResults.map(result => <button key={result.pageNumber} onClick={() => scrollToPage(result.pageNumber)}>
            <span><strong>第 {result.pageNumber} 页</strong><small>{result.matchCount} 处</small></span>
            <p><HighlightedText text={result.excerpt} query={pdfSearchQuery}/></p>
          </button>)}
        </div>
      </div>}
    </aside>

    <main className="reader-document" tabIndex={-1} onWheel={handleReaderWheel} onMouseUp={captureSelection} onPointerUp={captureSelection}>
      {annotationCaptureMode && <div className="annotation-capture-banner">
        <Highlighter size={15}/>
        <div><strong>请在原文中拖动选择要批注的文字</strong><small>{paper?.title ?? source.name} · 当前第 {activePage} 页；选完会自动带入论文和位置。</small></div>
        <button type="button" onPointerUp={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()} onClick={() => { annotationCaptureModeRef.current = false; setAnnotationCaptureMode(false) }}>取消</button>
      </div>}
      {loadState && <div className="reader-state-banner">{loadState}</div>}
      {viewMode === 'original' && pdfDocument && <PdfContinuousReader
        document={pdfDocument}
        zoom={zoom}
        annotations={renderedAnnotations}
        activeAnnotationId={activeAnnotationId}
        onActivePage={setActivePage}
        onScroll={() => setSelection(undefined)}
      />}
      {viewMode === 'parallel' && pdfDocument && <ReaderViewBoundary viewLabel="版面对照" resetKey={`${source.id}:${source.mineruRevision || source.hash}:parallel`} onReturnToOriginal={() => setViewMode('original')}>
        <div className="reader-parallel">
          <header className="reader-parallel-toolbar">
            <div><strong>证据双页台</strong><span>拖动中线调节宽度；目录默认收起，不挤压正文。</span></div>
            <div className="reader-parallel-layouts" aria-label="版面对照布局">
              <button className={parallelFocus === 'pdf' ? 'active' : ''} onClick={() => setParallelFocus(value => value === 'pdf' ? 'both' : 'pdf')}>专注 PDF</button>
              <button className={parallelFocus === 'both' && parallelLayout['parallel-pdf'] > 54 ? 'active' : ''} onClick={() => setParallelBalance(62)}>PDF 更宽</button>
              <button className={parallelFocus === 'both' && parallelLayout['parallel-pdf'] >= 46 && parallelLayout['parallel-pdf'] <= 54 ? 'active' : ''} onClick={() => setParallelBalance(50)}>均分</button>
              <button className={parallelFocus === 'both' && parallelLayout['parallel-pdf'] < 46 ? 'active' : ''} onClick={() => setParallelBalance(38)}>整理稿更宽</button>
              <button className={parallelFocus === 'draft' ? 'active' : ''} onClick={() => setParallelFocus(value => value === 'draft' ? 'both' : 'draft')}>专注整理稿</button>
            </div>
            <div className="reader-parallel-actions">
              <button className={parallelOutlineOpen ? 'active' : ''} onClick={() => setParallelOutlineOpen(value => !value)}><BookOpen size={14}/>{parallelOutlineOpen ? '隐藏目录' : '显示目录'}</button>
              <button onClick={() => setViewMode('markdown')}><Expand size={14}/>完整整理稿</button>
            </div>
          </header>
          <div className="reader-parallel-stage">
            {parallelFocus === 'pdf' ? <div className="reader-parallel-pane pdf-pane"><PdfContinuousReader document={pdfDocument} zoom={zoom} annotations={renderedAnnotations} activeAnnotationId={activeAnnotationId} onActivePage={setActivePage} onScroll={() => setSelection(undefined)}/></div>
              : parallelFocus === 'draft' ? <div className="reader-parallel-pane draft-pane"><StructuredDocument
                text={readableText} title="当前整理稿" source={source} paper={paper} settings={settings}
                presentation="comparison" showToc={parallelOutlineOpen}
                activeMarkdownBlockId={activeMarkdownTarget?.state === 'resolved' ? activeMarkdownTarget.markdownBlockId : undefined}
                mineruLayoutBlocks={mineruLayoutBlocks} onMineruLayoutBlocks={setMineruLayoutBlocks}
                onSaveLayout={layout => onSaveMarkdownLayout(source.id, layout)} onSettings={onSettings}
              /></div> : <ResizableGroup
                key={`${source.id}:${parallelLayoutRevision}`}
                className="reader-parallel-group"
                id={`parallel-${source.id}`}
                orientation="horizontal"
                defaultLayout={parallelLayout}
                resizeTargetMinimumSize={{ fine: 18, coarse: 32 }}
                onLayoutChanged={layout => {
                  setParallelLayout(layout)
                  window.localStorage.setItem('reader-parallel-layout-v1', JSON.stringify(layout))
                }}
              >
                <ResizablePanel id="parallel-pdf" minSize="340px" className="reader-parallel-pane pdf-pane">
                  <PdfContinuousReader document={pdfDocument} zoom={Math.max(.68, zoom * .72)} annotations={renderedAnnotations} activeAnnotationId={activeAnnotationId} onActivePage={setActivePage} onScroll={() => setSelection(undefined)}/>
                </ResizablePanel>
                <ResizableSeparator id="parallel-divider" className="reader-parallel-divider"><span/></ResizableSeparator>
                <ResizablePanel id="parallel-draft" minSize="380px" className="reader-parallel-pane draft-pane">
                  <StructuredDocument
                    text={readableText} title="当前整理稿" source={source} paper={paper} settings={settings}
                    presentation="comparison" showToc={parallelOutlineOpen}
                    activeMarkdownBlockId={activeMarkdownTarget?.state === 'resolved' ? activeMarkdownTarget.markdownBlockId : undefined}
                    mineruLayoutBlocks={mineruLayoutBlocks} onMineruLayoutBlocks={setMineruLayoutBlocks}
                    onSaveLayout={layout => onSaveMarkdownLayout(source.id, layout)} onSettings={onSettings}
                  />
                </ResizablePanel>
              </ResizableGroup>}
          </div>
        </div>
      </ReaderViewBoundary>}
      {viewMode === 'bilingual' && <ReaderViewBoundary viewLabel="中英对照" resetKey={`${source.id}:${source.mineruRevision || source.hash}:bilingual`} returnLabel={source.kind === 'PDF' ? '返回 PDF 原文' : '返回整理稿'} onReturnToOriginal={() => setViewMode(source.kind === 'PDF' ? 'original' : 'markdown')}>
        <BilingualDocument
          sourceId={source.id}
          sourceRevision={source.mineruRevision || source.hash}
          text={readableText}
          title={paper?.title || source.name.replace(/\.[^.]+$/, '')}
          settings={settings}
          onSettings={onSettings}
        />
      </ReaderViewBoundary>}
      {(viewMode === 'markdown' || (source.kind !== 'PDF' && viewMode !== 'bilingual')) && <ReaderViewBoundary viewLabel="整理稿" resetKey={`${source.id}:${source.mineruRevision || source.hash}:markdown`} returnLabel={source.kind === 'PDF' ? '返回 PDF 原文' : '返回资料库'} onReturnToOriginal={() => source.kind === 'PDF' ? setViewMode('original') : onBack()}>
        <StructuredDocument
          text={readableText}
          title={source.mineruMarkdown ? 'MinerU Markdown' : '结构化提取文本'}
          source={source}
          paper={paper}
          settings={settings}
          activeMarkdownBlockId={activeMarkdownTarget?.state === 'resolved' ? activeMarkdownTarget.markdownBlockId : undefined}
          mineruLayoutBlocks={mineruLayoutBlocks}
          onMineruLayoutBlocks={setMineruLayoutBlocks}
          onSaveLayout={layout => onSaveMarkdownLayout(source.id, layout)}
          onSettings={onSettings}
        />
      </ReaderViewBoundary>}
      {!loadState && source.kind === 'PDF' && !pdfDocument && <div className="reader-empty-state"><BookOpen size={28}/><strong>原始 PDF 暂不可用</strong><span>请从资料库重新导入原文件。</span></div>}
    </main>

    <aside className="reader-inspector">
      <div className="reader-inspector-head">
        <div><span>当前文献</span><strong>{agentOpen ? '研究 Agent' : '笔记与阅读卡'}</strong></div>
        <div className="reader-inspector-tabs">
          <button className={!agentOpen ? 'active' : ''} onClick={onAgentClose}><Highlighter size={14}/>笔记</button>
          <button className={agentOpen ? 'active' : ''} onClick={openAgentPanel}><MessageSquareText size={14}/>Agent</button>
        </div>
      </div>
      {agentOpen ? <AgentModalV2
        embedded
        settings={settings}
        workspaceName={workspaceName}
        researchWorkspace={researchWorkspace}
        items={items}
        currentItemId={paper?.id}
        readerContext={{
          sourceId: source.id,
          sourceName: source.name,
          itemId: paper?.id,
          paperTitle: paper?.title ?? source.name.replace(/\.pdf$/i, ''),
          pageNumber: source.kind === 'PDF' ? activePage : undefined,
          pageText: currentPageText,
          viewMode,
          readingStatus: paper?.readingState.readingStatus,
          annotationCount: sourceAnnotations.length,
          selection: agentSelection ? {
            text: agentSelection.text,
            anchor: annotationDraftForSelection(agentSelection).anchor,
          } : undefined,
        }}
        onClose={onAgentClose}
        onClearReaderSelection={() => setAgentSelection(undefined)}
        onCreate={onCreateActionPack}
        onOpenCitation={onOpenCitation}
      /> : <><section className="reader-selection-card">
        <div className="reader-section-label"><Languages size={14}/>划词助手</div>
        <p>直接在原文中选中文字，菜单会贴着选区出现。翻译或问答只在你点击后调用当前 Provider。</p>
        {selection?.text && <blockquote>{selection.text}<small>{selection.pageNumber ? `p. ${selection.pageNumber}` : '结构化文本'}</small></blockquote>}
        {selectionAnswer && <div className="reader-ai-result"><span>{selectionMode === 'translate' && selectionTranslationProvider === 'local' ? '本地翻译' : 'AI 整理'}</span><pre>{selectionAnswer}</pre></div>}
      </section>
      {paper && <PaperReadingCard
        paper={paper}
        settings={settings}
        onUpdate={(patch) => onUpdateReading(paper.id, patch)}
        onSettings={onSettings}
        onOpenCitation={onOpenCitation}
      />}
      <section className="reader-annotations">
        <div className="annotation-head"><h3>用户笔记</h3><div><span>{sourceAnnotations.length}</span><button type="button" title="导出本篇批注为 Markdown" disabled={!sourceAnnotations.length} onClick={() => onExportAnnotations(source.id)}><Download size={14}/></button></div></div>
        {sourceAnnotations.length === 0
          ? <div className="empty-note"><Highlighter size={22}/><p>划词后保存笔记；用户原笔记不会被 AI 覆盖。</p></div>
          : sourceAnnotations.map(annotation => <article className={`annotation ${activeAnnotationId === annotation.id ? 'active' : ''}`} key={annotation.id}>
          <button type="button" className="annotation-main" onClick={() => {
            const page = annotationPage(annotation)
            setActiveAnnotationId(annotation.id)
            setViewMode(annotation.anchor?.type === 'pdf' ? 'original' : annotation.anchor?.type === 'markdown' ? 'markdown' : viewMode)
            if (annotation.anchor?.type === 'markdown') {
              setSelectionNotice('')
            } else if (page) {
              setActivePage(page)
              window.requestAnimationFrame(() => scrollToPage(page))
            } else {
              setSelectionNotice('这条旧批注没有可验证的页码锚点；原文和备注仍然保留。')
            }
          }}>
            <span className="note-origin user">用户笔记</span>
            <strong className="annotation-paper-title">{annotation.paperTitle ?? paper?.title ?? source.name.replace(/\.pdf$/i, '')}</strong>
            <small className="annotation-source-locator">{annotation.sourceName ?? source.name} · {annotation.page || '位置未记录'}</small>
            <p>{annotation.text}</p>
            <small>{annotation.note || '无额外备注'}</small>
          </button>
          <div className="annotation-actions">
            <button type="button" disabled={Boolean(annotation.taskStatus)} onClick={() => void onCreateTaskFromAnnotation(annotation)}><ClipboardCheck size={13}/>{annotation.taskStatus ? `任务：${annotation.taskStatus}` : '转为任务'}</button>
            <button type="button" onClick={() => onEditAnnotation(annotation)}><Pencil size={13}/>编辑笔记</button>
            <button type="button" className="danger" onClick={() => onArchiveAnnotation(annotation)}><Trash2 size={13}/>归档</button>
          </div>
          </article>)}
        <button className={`full-width outline-button ${annotationCaptureMode ? 'active' : ''}`} onClick={beginAnnotationCapture}><Highlighter size={16}/>{annotationCaptureMode ? '请到原文拖选文字…' : '从原文新建研究批注'}</button>
      </section>
      <div className="reader-privacy-note">
        <span className="status-dot"/>
        <div><strong>原文与 MinerU 结果保存在本机</strong><small>当前划词翻译：{selectionTranslationProvider === 'local' ? localTranslationStatus?.available ? '本地 Argos · 无 Token' : '本地 Argos · 待安装' : settings.model ? `云端 ${settings.model} · 发送前确认范围` : '云端未配置；不会发送'}</small></div>
      </div>
      </>}
    </aside>

    {selection && <div className="selection-popover" style={{ left: selection.menuX, top: selection.menuY }}>
      <div className="selection-actions">
        <button className={selectionMode === 'translate' ? 'active' : ''} disabled={selectionBusy} onClick={() => runSelectionAI('translate')}><Languages size={14}/>翻译</button>
        <button className={selectionMode === 'explain' ? 'active' : ''} disabled={selectionBusy} onClick={() => runSelectionAI('explain')}><Sparkles size={14}/>解释</button>
        <button className={selectionMode === 'ask' ? 'active' : ''} disabled={selectionBusy} onClick={() => { setSelectionMode('ask'); setSelectionNotice('输入你针对此处的问题，再发送。') }}><MessageSquareText size={14}/>提问</button>
        <button disabled={selectionBusy} onClick={addSelectionToAgent}><MessageSquareText size={14}/>添加到对话</button>
        <button disabled={selectionBusy} onClick={saveSelection}><Highlighter size={14}/>保存笔记</button>
        <button className="close" onClick={() => { setSelection(undefined); setSelectionCloudConfirm(false); setSelectionEditMode(false) }}><X size={14}/></button>
      </div>
      {selectionMode === 'translate' && <div className="selection-translation-tools">
        <div className="selection-engine-switch"><button className={selectionTranslationProvider === 'local' ? 'active' : ''} disabled={selectionBusy} onClick={() => { setSelectionTranslationProvider('local'); setSelectionCloudConfirm(false) }}><HardDrive size={13}/>本地 Argos</button><button className={selectionTranslationProvider === 'ai' ? 'active' : ''} disabled={selectionBusy} onClick={() => setSelectionTranslationProvider('ai')}><Cloud size={13}/>云端 AI</button></div>
        <small>{selection.pageNumber ? selection.endPageNumber && selection.endPageNumber !== selection.pageNumber ? `跨页 p. ${selection.pageNumber}–${selection.endPageNumber} · 智能合并后 ${selection.translationText.length} 字符` : `p. ${selection.pageNumber} · ${selection.translationText.length} 字符` : `结构化文本 · ${selection.translationText.length} 字符`}</small>
        <button className={selectionEditMode ? 'active' : ''} disabled={selectionBusy} onClick={() => setSelectionEditMode(value => !value)}><Pencil size={13}/>修正提取文本</button>
      </div>}
      {selectionEditMode && selectionMode === 'translate' && <div className="selection-source-editor"><strong>只修正本次用于翻译的文本</strong><small>PDF 和原始提取层不会改变。</small><textarea value={selection.translationText} onChange={event => setSelection({ ...selection, translationText: event.target.value })}/></div>}
      {selectionCloudConfirm && selectionMode === 'translate' && selectionTranslationProvider === 'ai' && <div className="selection-cloud-confirm"><Cloud size={15}/><div><strong>确认发送当前选区？</strong><small>范围：{selection.pageNumber ? selection.endPageNumber && selection.endPageNumber !== selection.pageNumber ? `p. ${selection.pageNumber}–${selection.endPageNumber}` : `p. ${selection.pageNumber}` : '结构化文本'} · Provider：{selectionCloudProviderLabel} · 模型：{settings.model || '未配置'} · {selection.translationText.length} 字符。不会发送整篇 PDF。</small></div><button onClick={() => setSelectionCloudConfirm(false)}>取消</button><button className="confirm" onClick={() => void runSelectionAI('translate', true)}>确认发送</button></div>}
      {selectionMode === 'ask' && <div className="selection-question">
        <textarea autoFocus value={selectionQuestion} onChange={event => setSelectionQuestion(event.target.value)} placeholder="例如：这里的结论依赖哪些实验条件？"/>
        <button disabled={selectionBusy || !selectionQuestion.trim()} onClick={() => runSelectionAI('ask')}>发送</button>
      </div>}
      {(selectionBusy || selectionNotice || selectionAnswer) && <div className="selection-response">
        {selectionBusy && <span>正在处理当前选区…</span>}
        {selectionNotice && <small>{selectionNotice}</small>}
        {selectionMode === 'translate' && selectionTranslationProvider === 'local' && localTranslationStatus && !localTranslationStatus.available && <div className="selection-install-actions">
          <button className="selection-install-button" disabled={translationInstalling || selectionBusy} onClick={installLocalTranslation}>{translationInstalling ? '正在安装，请勿关闭…' : '安装英文 → 中文本地翻译'}</button>
          <button className="selection-api-button" disabled={translationInstalling || selectionBusy} onClick={onSettings}>改用已配置 API</button>
        </div>}
        {translationInstallProgress && <small className="selection-install-progress">{translationInstallProgress}</small>}
        {selectionAnswer && <pre>{selectionAnswer}</pre>}
      </div>}
    </div>}
  </div>
}

function PaperReadingCard({
  paper,
  settings,
  onUpdate,
  onSettings,
  onOpenCitation,
}: {
  paper: BibliographicSummary
  settings: AISettings
  onUpdate: (patch: ReadingStatePatch) => void
  onSettings: () => void
  onOpenCitation: (sourceId: string, pageNumber?: number, anchor?: FragmentAnchor) => void
}) {
  const state = paper.readingState
  const [decisionNote, setDecisionNote] = useState(state.decisionNote)
  const [snapshot, setSnapshot] = useState<DesktopPaperReadingCardSnapshot>()
  const [pendingRequest, setPendingRequest] = useState<ReturnType<typeof buildPaperReadingCardRequest>>()
  const [cardBusy, setCardBusy] = useState(false)
  const [cardNotice, setCardNotice] = useState('')

  useEffect(() => {
    setDecisionNote(state.decisionNote)
  }, [paper.id, state.decisionNote])

  useEffect(() => {
    const desktop = window.readerDesktop
    let disposed = false
    setSnapshot(undefined)
    setPendingRequest(undefined)
    setCardNotice('')
    if (!desktop) return () => { disposed = true }
    void desktop.getPaperReadingCard({ itemId: paper.id })
      .then(result => {
        if (!disposed) setSnapshot(result)
      })
      .catch(error => {
        if (!disposed) setCardNotice(error instanceof Error ? error.message : '阅读卡加载失败。')
      })
    return () => { disposed = true }
  }, [paper.id])

  function togglePurpose(tag: string) {
    onUpdate({
      purposeTags: state.purposeTags.includes(tag)
        ? state.purposeTags.filter(item => item !== tag)
        : [...state.purposeTags, tag],
    })
  }

  async function prepareReadingCard() {
    const desktop = window.readerDesktop
    if (!desktop) {
      setCardNotice('AI 阅读卡需要在桌面客户端的研究库中生成。')
      return
    }
    if (!settings.baseUrl || !settings.model || !settings.apiKey) {
      setCardNotice('尚未配置可用的 AI 服务。')
      return
    }
    setCardBusy(true)
    setCardNotice('')
    try {
      const latest = await desktop.getPaperReadingCard({ itemId: paper.id })
      setSnapshot(latest)
      const allowedContexts = latest.contexts.filter(context => (
        settings.allowFullDocument || context.origin !== 'document'
      ))
      const request = buildPaperReadingCardRequest({ paper, contexts: allowedContexts })
      setPendingRequest(request)
    } catch (error) {
      setCardNotice(error instanceof Error ? error.message : '阅读卡材料准备失败。')
    } finally {
      setCardBusy(false)
    }
  }

  async function generateReadingCard() {
    const desktop = window.readerDesktop
    if (!desktop || !pendingRequest) return
    setCardBusy(true)
    setCardNotice(`正在让 ${settings.model} 整理可追溯阅读卡…`)
    try {
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          messages: [
            { role: 'system', content: pendingRequest.system },
            { role: 'user', content: pendingRequest.user },
          ],
        }),
      })
      if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const sections = parsePaperReadingCardAnswer(
        data.choices?.[0]?.message?.content || '',
        pendingRequest.contexts,
      )
      const fingerprintBytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${pendingRequest.system}\n${pendingRequest.user}`),
      )
      const promptFingerprint = [...new Uint8Array(fingerprintBytes)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
      const saved = await desktop.savePaperReadingCardDraft({
        itemId: paper.id,
        provider: settings.baseUrl,
        model: settings.model,
        promptFingerprint,
        sections,
      })
      setSnapshot(saved)
      setPendingRequest(undefined)
      setCardNotice('阅读卡草稿已保存；采纳前不会成为正式阅读结论。')
    } catch (error) {
      setCardNotice(error instanceof Error ? error.message : '阅读卡生成失败。')
    } finally {
      setCardBusy(false)
    }
  }

  async function acceptReadingCard() {
    const desktop = window.readerDesktop
    if (!desktop || !snapshot?.card) return
    setCardBusy(true)
    try {
      const accepted = await desktop.acceptPaperReadingCard({
        itemId: paper.id,
        generationRunId: snapshot.card.generationRunId,
      })
      setSnapshot(accepted)
      setCardNotice('已采纳当前阅读卡；原文证据和用户笔记均未改写。')
    } catch (error) {
      setCardNotice(error instanceof Error ? error.message : '阅读卡采纳失败。')
    } finally {
      setCardBusy(false)
    }
  }

  async function exportReadingCard() {
    const desktop = window.readerDesktop
    if (!desktop || snapshot?.card?.status !== 'accepted') return
    setCardBusy(true)
    try {
      const result = await desktop.exportPortableMarkdown({ kind: 'reading_card', id: paper.id })
      if (!result.canceled && result.filePath) setCardNotice(`可迁移 Markdown 已导出到 ${result.filePath}`)
    } catch (error) {
      setCardNotice(error instanceof Error ? error.message : '阅读卡导出失败。')
    } finally {
      setCardBusy(false)
    }
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
    <div className="paper-ai-card">
      <div className="paper-ai-card-head">
        <div>
          <strong>结构化阅读卡</strong>
          <small>{snapshot?.card
            ? snapshot.card.status === 'accepted' ? '已采纳 · 可进入全库检索' : 'AI 草稿 · 等待你的确认'
            : '原文证据、用户笔记和 AI 整理分开保存'}</small>
        </div>
        <button disabled={cardBusy} onClick={() => void prepareReadingCard()}>
          <Sparkles size={13}/>{snapshot?.card ? '重新生成草稿' : '生成阅读卡'}
        </button>
      </div>
      {pendingRequest && <div className="paper-ai-card-confirm">
        <p>将向 <b>{settings.model}</b> 发送 {pendingRequest.contexts.length} 条材料、约 {pendingRequest.contexts.reduce((total, context) => total + context.content.length, 0).toLocaleString('zh-CN')} 个字符。</p>
        <small>{settings.allowFullDocument
          ? '包含 MinerU/本地解析段落；不会发送原 PDF 文件。'
          : '未开启整篇派生文本权限，只发送题录、阅读状态、原文摘录和用户笔记。'}</small>
        <div><button onClick={() => setPendingRequest(undefined)}>取消</button><button className="confirm" disabled={cardBusy} onClick={() => void generateReadingCard()}>确认生成</button></div>
      </div>}
      {cardNotice && <div className="paper-ai-card-notice">
        <span>{cardNotice}</span>
        {(!settings.baseUrl || !settings.model || !settings.apiKey) && <button onClick={onSettings}>打开设置</button>}
      </div>}
      {snapshot?.card?.sections.map(section => <article className="paper-ai-card-section" key={section.id}>
        <div><span className={`note-origin ${snapshot.card?.status === 'accepted' ? 'accepted' : 'ai'}`}>{snapshot.card?.status === 'accepted' ? '已采纳' : 'AI 草稿'}</span><strong>{section.title}</strong></div>
        <p>{section.content}</p>
        <div className="paper-ai-card-citations">{section.citations.map(citation => citation.sourceId
          ? <button key={citation.fragmentId} onClick={() => onOpenCitation(citation.sourceId!, citation.pageNumber, citation.anchor as FragmentAnchor | undefined)}>
            {citation.origin === 'user' ? '用户状态/笔记' : '原文证据'} · {citation.sourceName || '当前论文'}{citation.pageNumber ? ` · 第 ${citation.pageNumber} 页` : ' · 派生文本'}
          </button>
          : <span key={citation.fragmentId}>来源位置待核验</span>)}</div>
      </article>)}
      {snapshot?.card?.status === 'draft' && <button className="paper-ai-card-accept" disabled={cardBusy} onClick={() => void acceptReadingCard()}>
        <Check size={14}/>采纳为当前阅读卡
      </button>}
      {snapshot?.card?.status === 'accepted' && <button className="paper-ai-card-accept" disabled={cardBusy} onClick={() => void exportReadingCard()}>
        <Download size={14}/>导出可迁移 Markdown
      </button>}
    </div>
  </section>
}

function PdfThumbnail({
  document,
  pageNumber,
  active,
  onOpen,
}: {
  document: LocalPdfDocument
  pageNumber: number
  active: boolean
  onOpen: (pageNumber: number) => void
}) {
  const shellRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(pageNumber <= 4)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = shellRef.current
    if (!element) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true)
    }, { rootMargin: '500px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvasRef.current) return
    let disposed = false
    const controller = new AbortController()
    setError('')
    void renderPdfThumbnail(document, canvasRef.current, pageNumber, 168, controller.signal)
      .catch(reason => {
        if (!disposed && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : '缩略图失败')
      })
    return () => { disposed = true; controller.abort() }
  }, [document, pageNumber, visible])

  return <button
    ref={shellRef}
    className={`reader-thumbnail ${active ? 'active' : ''}`}
    onClick={() => onOpen(pageNumber)}
    aria-label={`转到 PDF 第 ${pageNumber} 页`}
  >
    <span className="reader-thumbnail-canvas">
      {visible && <canvas ref={canvasRef}/>} {!visible && <i/>}
      {error && <small>{error}</small>}
    </span>
    <strong>{pageNumber}</strong>
  </button>
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
    const controller = new AbortController()
    setError('')
    renderPdfPageWithTextLayer(document, canvasRef.current, textLayerRef.current, pageNumber, scale, controller.signal)
      .then(next => alive && setDimensions(next))
      .catch(reason => alive && !controller.signal.aborted && setError(reason instanceof Error ? reason.message : '页面渲染失败。'))
    return () => { alive = false; controller.abort() }
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

type StructuredDocumentProps = {
  text?: string
  title: string
  source: Source
  paper?: BibliographicSummary
  settings: AISettings
  activeMarkdownBlockId?: string
  mineruLayoutBlocks: MineruLayoutBlock[]
  onMineruLayoutBlocks: (blocks: MineruLayoutBlock[]) => void
  onSaveLayout: (layout: AcademicMarkdownLayout) => void
  onSettings: () => void
  presentation?: 'full' | 'comparison'
  showToc?: boolean
}

function StructuredDocument(props: StructuredDocumentProps) {
  if (window.readerDesktop && props.source.mineruMarkdown && props.text) {
    return <VersionedStructuredReading
      sourceId={props.source.id}
      sourceName={props.source.name}
      rawMarkdown={props.text}
      paper={props.paper}
      settings={props.settings}
      activeMarkdownBlockId={props.activeMarkdownBlockId}
      presentation={props.presentation}
      showToc={props.showToc}
      onMineruLayoutBlocks={props.onMineruLayoutBlocks}
      onSettings={props.onSettings}
    />
  }
  return <LegacyStructuredDocument {...props}/>
}

function LegacyStructuredDocument({
  text,
  title,
  source,
  paper,
  settings,
  activeMarkdownBlockId,
  mineruLayoutBlocks,
  onMineruLayoutBlocks,
  onSaveLayout,
  onSettings,
}: StructuredDocumentProps) {
  const [displayMode, setDisplayMode] = useState<'academic' | 'raw'>('academic')
  const [confirmAI, setConfirmAI] = useState(false)
  const [aiBusy, setAIBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [mineruAssets, setMineruAssets] = useState<Record<string, string>>({})
  const isMineru = Boolean(source.mineruMarkdown)
  const savedLayout = text && validAcademicMarkdownLayout(source.markdownLayout, text)
    ? source.markdownLayout
    : undefined
  const academicReading = useMemo(() => markdownReadingBlocks(text, mineruLayoutBlocks), [mineruLayoutBlocks, text])
  const academicBlocks = useMemo(() => {
    const blocks = academicReading.blocks
    const sectionByBlock = new Map((savedLayout?.boundaries ?? []).map(boundary => [boundary.beforeBlockId, boundary.section]))
    return blocks.map(block => ({ ...block, section: sectionByBlock.get(block.id) }))
  }, [academicReading.blocks, savedLayout])
  const twoColumnPages = academicReading.diagnostics?.filter(diagnostic => diagnostic.layout === 'two-column') ?? []
  const reorderedPages = twoColumnPages.filter(diagnostic => diagnostic.reordered)
  const authors = paper?.authors
    .map(author => author.literal || [author.family, author.given].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('；')

  useEffect(() => {
    setDisplayMode('academic')
    setConfirmAI(false)
    setNotice('')
  }, [source.id])

  useEffect(() => {
    let disposed = false
    setMineruAssets({})
    onMineruLayoutBlocks([])
    if (!isMineru || !window.readerDesktop) return () => { disposed = true }
    void window.readerDesktop.loadMineruAssets({ sourceId: source.id })
      .then(result => {
        if (!disposed) {
          setMineruAssets(result.assets)
          onMineruLayoutBlocks(result.layoutBlocks)
        }
      })
      .catch(error => {
        if (!disposed) setNotice(error instanceof Error ? error.message : 'MinerU 图片资源加载失败。')
      })
    return () => { disposed = true }
  }, [isMineru, onMineruLayoutBlocks, source.id, source.mineruRevision])

  function resolvedMineruImage(src?: string) {
    if (!src) return undefined
    const normalized = src.replace(/\\/g, '/')
    let decoded = normalized
    try {
      decoded = decodeURIComponent(normalized)
    } catch {
      // Use the original relative path when it is not URI encoded.
    }
    return mineruAssets[normalized]
      || mineruAssets[normalized.replace(/^\.\//, '')]
      || mineruAssets[decoded]
      || mineruAssets[decoded.replace(/^\.\//, '')]
  }

  function requestAIClassification() {
    if (!settings.baseUrl || !settings.model || !settings.apiKey) {
      setNotice('尚未配置可用的 AI 服务。请先在设置中填写 OpenAI 兼容地址、模型和密钥。')
      return
    }
    if (!settings.allowFullDocument) {
      setNotice('当前设置不允许发送整篇派生 Markdown。请先在设置中开启该权限；原 PDF 仍不会发送。')
      return
    }
    setNotice('')
    setConfirmAI(true)
  }

  async function confirmAIClassification() {
    if (!text) return
    setAIBusy(true)
    setNotice(`正在让 ${settings.model} 识别章节边界；AI 不能返回替换正文。`)
    try {
      const request = buildAcademicMarkdownAIRequest({ markdown: text, paper })
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      })
      if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const boundaries = parseAcademicMarkdownBoundaries(
        data.choices?.[0]?.message?.content || '',
        text,
      )
      onSaveLayout({
        version: ACADEMIC_MARKDOWN_SKILL.version,
        mode: 'ai-classified',
        sourceFingerprint: request.fingerprint,
        boundaries,
        generatedAt: new Date().toISOString(),
        model: settings.model,
      })
      setConfirmAI(false)
      setDisplayMode('academic')
      setNotice(`已保存 ${boundaries.length} 个章节边界；MinerU 原文未被覆盖。`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 章节识别失败。')
    } finally {
      setAIBusy(false)
    }
  }

  return <article className="structured-reader">
    <header className="structured-reader-header">
      <div><span>派生阅读层 · 原 PDF 仍是引用依据</span><strong>{title}</strong></div>
      {text && <div className="structured-reader-actions">
        <div className="structured-mode-switch">
          <button className={displayMode === 'academic' ? 'active' : ''} onClick={() => setDisplayMode('academic')}>学术排版</button>
          <button className={displayMode === 'raw' ? 'active' : ''} onClick={() => setDisplayMode('raw')}>原始 MD</button>
        </div>
        {isMineru && <button className="academic-ai-button" disabled={aiBusy} onClick={requestAIClassification}>
          <Sparkles size={13}/>{savedLayout?.mode === 'ai-classified' ? '重新识别章节' : 'AI 识别章节'}
        </button>}
      </div>}
    </header>
    {text ? <>
      <section className="paper-metadata-card">
        <span className="paper-metadata-origin">{savedLayout?.mode === 'ai-classified' ? `AI 章节边界 · ${savedLayout.model}` : '本地规则排版 · 未改写正文'}{mineruLayoutBlocks.length ? ` · MinerU ${mineruLayoutBlocks.length} 个页块` : ''}{twoColumnPages.length ? ` · 检出 ${twoColumnPages.length} 个双栏页${reorderedPages.length ? `，已自动修复 ${reorderedPages.length} 页顺序` : ''}` : ''}</span>
        <h1>{paper?.title || source.name.replace(/\.[^.]+$/, '')}</h1>
        {authors && <p>{authors}</p>}
        <div>
          {paper?.issued && <span>{paper.issued}</span>}
          {paper?.containerTitle && <span>{paper.containerTitle}</span>}
          {paper?.identifiers.DOI?.[0] && <span>DOI {paper.identifiers.DOI[0]}</span>}
          {paper?.keywords.slice(0, 5).map(keyword => <span key={keyword}>#{keyword}</span>)}
        </div>
      </section>
      {confirmAI && <section className="academic-ai-confirm">
        <div>
          <strong>确认发送派生 Markdown 做章节识别？</strong>
          <p>将向 <b>{settings.model}</b> 发送题录和约 {text.length.toLocaleString('zh-CN')} 个字符。只采用章节边界 JSON；任何正文改写都会被丢弃，原 PDF 与 MinerU 原始 Markdown 不会覆盖。</p>
        </div>
        <button onClick={() => setConfirmAI(false)}>取消</button>
        <button className="confirm" disabled={aiBusy} onClick={() => void confirmAIClassification()}>{aiBusy ? '识别中…' : '确认发送'}</button>
      </section>}
      {notice && <div className="academic-layout-notice">
        <span>{notice}</span>
        {(!settings.baseUrl || !settings.model || !settings.apiKey || !settings.allowFullDocument) && <button onClick={onSettings}>打开设置</button>}
      </div>}
      {displayMode === 'raw'
        ? <pre className="structured-raw-markdown">{text}</pre>
        : isMineru
          ? <div className="academic-markdown">
            {academicBlocks.map(block => <section
              key={block.id}
              data-markdown-block={block.id}
              data-markdown-page={block.pageNumber}
              className={`academic-markdown-block ${activeMarkdownBlockId === block.id ? 'active-anchor' : ''}`}
            >
              {block.section && block.section !== '正文' && !block.content.trimStart().startsWith('#') && <h2 className="academic-inferred-heading">{block.section}</h2>}
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                skipHtml
                components={{
                  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                  img: ({ src, alt }) => {
                    const localImage = resolvedMineruImage(src)
                    return localImage
                      ? <img src={localImage} alt={alt || ''} loading="lazy"/>
                      : <span className="markdown-image-missing">图片未包含在当前 MinerU 版本中{alt ? `：${alt}` : ''}</span>
                  },
                }}
              >{block.content}</ReactMarkdown>
            </section>)}
          </div>
          : <pre className="structured-plain-text">{text}</pre>}
    </> : <div className="reader-empty-state"><BookOpen size={28}/><strong>尚无结构化版本</strong><span>可先阅读原 PDF，或使用本地 MinerU 生成 Markdown。</span></div>}
  </article>
}
function AgentModalV2({
  embedded = false,
  settings,
  workspaceName,
  researchWorkspace,
  items,
  currentItemId,
  readerContext,
  onClose,
  onClearReaderSelection,
  onCreate,
  onOpenCitation,
}: {
  embedded?: boolean
  settings: AISettings
  workspaceName: string
  researchWorkspace?: ResearchWorkspace
  items: BibliographicSummary[]
  currentItemId?: string
  readerContext?: AgentReaderContext
  onClose: () => void
  onClearReaderSelection?: () => void
  onCreate: (draft: AgentActionPackDraft) => Promise<void>
  onOpenCitation: (sourceId: string, pageNumber?: number, anchor?: FragmentAnchor) => void
}) {
  const [question, setQuestion] = useState('当前证据能支持什么结论？还缺哪些关键证据？')
  const [scope, setScope] = useState<AgentScope>(readerContext?.selection?.text ? 'selection' : currentItemId ? 'current' : 'library')
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [turns, setTurns] = useState<AgentTurn[]>([])
  const [proposedActions, setProposedActions] = useState<AgentActionProposal[]>([])
  const [evidence, setEvidence] = useState<Array<DesktopLibrarySearchResult & { score: number }>>([])
  const [contexts, setContexts] = useState<Array<{ evidenceId: string }>>([])
  const [generationRunId, setGenerationRunId] = useState('')
  const [busy, setBusy] = useState(false)
  const [papers, setPapers] = useState<Array<{ title: string; doi?: string; year?: string }>>([])
  const [notice, setNotice] = useState('')

  const scopeItemIds = ['selection', 'page', 'current'].includes(scope)
    ? currentItemId ? [currentItemId] : []
    : scope === 'selected'
      ? selectedItemIds
      : []
  const scopeLabel = scope === 'selection'
    ? `当前选区${readerContext?.pageNumber ? ` · 第 ${readerContext.pageNumber} 页` : ''}`
    : scope === 'page'
      ? `当前页 · 第 ${readerContext?.pageNumber ?? '?'} 页`
      : scope === 'current'
        ? '当前论文'
    : scope === 'selected'
      ? `选中的 ${selectedItemIds.length} 篇论文`
      : `研究库“${workspaceName}”`

  function clearReaderSelection() {
    onClearReaderSelection?.()
    if (scope === 'selection') setScope(currentItemId ? 'current' : readerContext?.pageNumber ? 'page' : 'library')
  }

  useEffect(() => {
    if (readerContext?.selection?.text) setScope('selection')
  }, [readerContext?.sourceId, readerContext?.pageNumber, readerContext?.selection?.text])

  function toggleItem(itemId: string) {
    setSelectedItemIds(current => current.includes(itemId)
      ? current.filter(id => id !== itemId)
      : [...current, itemId])
  }

  async function retrieveAndAnswer() {
    const desktop = window.readerDesktop
    if (!desktop) {
      setNotice('研究库检索 Agent 需要在桌面客户端中运行。')
      return
    }
    if (!question.trim()) {
      setNotice('请先输入要研究的问题。')
      return
    }
    if ((scope !== 'library') && !scopeItemIds.length) {
      setNotice(scope === 'selected' ? '请至少选择一篇论文。' : '当前没有可关联的论文。')
      return
    }
    const retrievalQuestion = agentRetrievalQuestion(question, turns.map(turn => turn.question))
    const terms = agentQueryTerms(retrievalQuestion)
    const directEvidence = [
      ...readerContextEvidence(readerContext, scope),
      ...researchWorkspaceEvidence(researchWorkspace as unknown as { milestones?: Array<Record<string, unknown>>; runs?: Array<Record<string, unknown>> } | undefined, 12),
    ] as unknown as DesktopLibrarySearchResult[]
    if (!terms.length && !directEvidence.length) {
      setNotice('问题中没有提取到可用于本地检索的关键词，请写得更具体一些。')
      return
    }
    setBusy(true)
    setProposedActions([])
    setEvidence([])
    setContexts([])
    setNotice(`正在本机检索 ${scopeLabel}；尚未向 AI 发送内容。`)
    const taskId = crypto.randomUUID()
    const unsubscribe = desktop.onWorkspaceSemanticProgress(progress => {
      if (progress.taskId === taskId) setNotice(progress.text)
    })
    try {
      let searchModeLabel = scope === 'selection' ? '当前选区' : '当前页原文'
      let searchMessage = ''
      let ranked: Array<DesktopLibrarySearchResult & { score: number }>
      if (scope === 'selection' || scope === 'page') {
        ranked = mergeAgentSearchResponses([{ results: directEvidence }], terms, 12)
      } else {
        const filters: DesktopLibrarySearchFilters = scopeItemIds.length ? { itemIds: scopeItemIds } : {}
        const searchResponse = await desktop.searchWorkspaceHybrid({
          taskId,
          query: retrievalQuestion,
          filters,
          limit: 60,
          rebuildIfNeeded: true,
        })
        ranked = mergeAgentSearchResponses([{ results: directEvidence }, searchResponse], terms, 12)
        searchModeLabel = searchResponse.mode === 'hybrid' ? '精确 + 语义' : '精确'
        searchMessage = searchResponse.semantic.message || ''
      }
      setEvidence(ranked)
      if (!ranked.length) {
        setNotice(scope === 'selection'
          ? '当前没有保留可用选区，请重新划词后再打开 Agent。'
          : scope === 'page'
            ? '当前页文字层尚未读取完成，不能把这一页当作证据。'
            : `本地检索没有找到证据。${searchMessage || '可以换用论文中的术语再试。'}`)
        return
      }
      if (!settings.baseUrl || !settings.model || !settings.apiKey) {
        setNotice(`已通过${searchModeLabel}在本机找到 ${ranked.length} 条候选证据。尚未配置 AI，因此只展示证据，不生成回答。`)
        return
      }
      const request = buildResearchAgentRequest({
        question,
        evidence: ranked,
        scopeLabel,
        readerContext,
        researchContext: researchWorkspace,
        history: turns.slice(-3).flatMap(turn => [
          { role: 'user' as const, content: turn.question },
          { role: 'assistant' as const, content: turn.sections.map(section => section.content).join('\n') },
        ]),
      })
      setContexts(request.contexts)
      setNotice(`已通过${searchModeLabel}找到 ${ranked.length} 条本地证据；正在向 ${settings.model} 发送问题、最近对话和证据片段，不发送原 PDF。`)
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      })
      if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`)
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const rawAnswer = data.choices?.[0]?.message?.content || ''
      const sections = parseResearchAgentAnswer(rawAnswer, request.contexts)
      const actions = parseResearchAgentActions(rawAnswer, request.contexts)
      setTurns(current => [...current, {
        id: crypto.randomUUID(),
        question: question.trim(),
        scopeLabel,
        sections,
        evidence: ranked,
        contexts: request.contexts,
      }].slice(-12))
      setProposedActions(actions)
      setGenerationRunId(crypto.randomUUID())
      setQuestion('')
      setNotice(`已生成 ${sections.length} 个带证据引用的回答区块和 ${actions.length} 条可审查行动；无引用内容已丢弃。`)
    } catch (error) {
      setNotice(error instanceof Error ? `处理失败：${error.message}` : '处理失败。')
    } finally {
      unsubscribe()
      setBusy(false)
    }
  }

  async function searchPapers() {
    const terms = agentQueryTerms(question)
    if (!terms.length) {
      setNotice('请先输入更具体的问题，再检索公开文献。')
      return
    }
    setBusy(true)
    setNotice('正在按问题关键词检索 Crossref；只发送检索词，不发送研究库内容。')
    try {
      const response = await fetch(`https://api.crossref.org/works?rows=5&query=${encodeURIComponent(terms.join(' '))}`)
      if (!response.ok) throw new Error(`Crossref 返回 ${response.status}`)
      const data = await response.json() as { message?: { items?: Array<{ title?: string[]; DOI?: string; published?: { 'date-parts'?: number[][] } }> } }
      setPapers((data.message?.items ?? []).map(item => ({ title: item.title?.[0] ?? '未提供标题', doi: item.DOI, year: item.published?.['date-parts']?.[0]?.[0]?.toString() })))
      setNotice('公开检索完成；候选文献尚未导入研究库，也没有参与当前回答。')
    } catch (error) {
      setNotice(error instanceof Error ? `检索失败：${error.message}` : '检索失败。')
    } finally {
      setBusy(false)
    }
  }

  function evidenceForCitation(citationId: string) {
    const contextIndex = contexts.findIndex(context => context.evidenceId === citationId)
    return contextIndex >= 0 ? evidence[contextIndex] : undefined
  }

  function evidenceForTurnCitation(turn: AgentTurn, citationId: string) {
    const contextIndex = turn.contexts.findIndex(context => context.evidenceId === citationId)
    return contextIndex >= 0 ? turn.evidence[contextIndex] : undefined
  }

  function actionEvidenceForCitation(citationId: string): ActionEvidenceInput | undefined {
    const entry = evidenceForCitation(citationId)
    if (!entry) return undefined
    const evidenceType: ActionEvidenceInput['evidenceType'] = entry.origin === 'run'
      ? 'run'
      : entry.origin === 'milestone'
        ? 'milestone'
        : entry.kind === 'fragment'
          ? 'fragment'
          : entry.kind === 'review'
            ? 'review'
            : entry.kind === 'paper'
              ? 'bibliography'
              : 'source'
    return {
      evidenceType,
      entityId: entry.entityId,
      sourceId: entry.sourceId,
      itemId: entry.itemId,
      milestoneId: evidenceType === 'milestone' ? entry.entityId : undefined,
      runId: evidenceType === 'run' ? entry.entityId : undefined,
      reviewDocumentId: entry.reviewDocumentId,
      label: entry.title,
      excerpt: entry.excerpt,
      pageNumber: entry.pageNumber,
      anchor: entry.anchor,
    }
  }

  async function saveActionPack() {
    const actions = proposedActions.flatMap(action => {
      const actionEvidence = action.citationIds.map(actionEvidenceForCitation).filter(Boolean) as ActionEvidenceInput[]
      return actionEvidence.length ? [{
        actionType: action.actionType,
        title: action.title,
        rationale: action.rationale,
        evidence: actionEvidence,
      }] : []
    })
    if (!actions.length) {
      setNotice('当前回答没有可追溯的行动建议，不能生成行动包。')
      return
    }
    setBusy(true)
    try {
      await onCreate({
        title: `行动建议 · ${question.trim().slice(0, 80)}`,
        objective: question.trim(),
        scope: {
          kind: scope === 'selected' || scope === 'library' ? scope : 'current',
          label: scopeLabel,
          itemIds: scopeItemIds,
        },
        provider: 'openai-compatible',
        model: settings.model,
        generationRunId,
        actions,
      })
    } finally {
      setBusy(false)
    }
  }

  const panel = <section className={`agent-modal agent-modal-v2 research-agent-modal ${embedded ? 'embedded' : ''}`}>
    {!embedded && <header><div><span className="agent-orb"><MessageSquareText size={18}/></span><div><p className="section-kicker">研究助手</p><h2>基于研究库证据回答</h2></div></div><button className="icon-button" onClick={onClose}><X/></button></header>}
    <div className="agent-context">
      <span><Files size={15}/><b>{scopeLabel}</b></span>
      {readerContext?.pageNumber && <span>第 {readerContext.pageNumber} 页 · {readingStatusLabel(readerContext.readingStatus ?? 'unread')}</span>}
      <span><Globe2 size={15}/>公开检索始终单独触发</span>
    </div>
    {readerContext?.selection?.text && <blockquote className="agent-pinned-selection">
      <div><span>已添加到对话</span>{onClearReaderSelection && <button type="button" onClick={clearReaderSelection} aria-label="移除对话选区"><X size={13}/></button>}</div>
      <p>{readerContext.selection.text}</p>
      <small>{readerContext.pageNumber ? `原文第 ${readerContext.pageNumber} 页 · 回答将引用此处` : '结构化文本选区 · 回答将引用此处'}</small>
    </blockquote>}
    <div className="agent-answer">
      <div className="agent-scope-switch">
        {readerContext?.selection?.text && <button className={scope === 'selection' ? 'active' : ''} onClick={() => setScope('selection')}>选区</button>}
        {readerContext?.pageNumber && <button className={scope === 'page' ? 'active' : ''} onClick={() => setScope('page')}>当前页</button>}
        {currentItemId && <button className={scope === 'current' ? 'active' : ''} onClick={() => setScope('current')}>本篇论文</button>}
        <button className={scope === 'selected' ? 'active' : ''} onClick={() => setScope('selected')}>选择多篇</button>
        <button className={scope === 'library' ? 'active' : ''} onClick={() => setScope('library')}>整个研究库</button>
      </div>
      {scope === 'selected' && <div className="agent-paper-picker">
        <div><button onClick={() => setSelectedItemIds(items.map(item => item.id))}>全选</button><button onClick={() => setSelectedItemIds([])}>清空</button><span>{selectedItemIds.length}/{items.length}</span></div>
        <section>{items.map(item => <label key={item.id}>
          <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={() => toggleItem(item.id)}/>
          <span><strong>{item.title}</strong><small>{readingStateLabel(item.readingState)} · {item.annotationCount} 条批注</small></span>
        </label>)}</section>
      </div>}
      {!turns.length && <div className="agent-starter-questions">
        <button onClick={() => setQuestion('这段原文在论证什么？有哪些前提？')}>解释论证</button>
        <button onClick={() => setQuestion('当前证据能支持哪些结论？哪些还只是推断？')}>核对结论</button>
        <button onClick={() => setQuestion('不同论文的结论、方法和实验条件有哪些冲突？')}>比较论文</button>
      </div>}
      {turns.length > 0 && <div className="agent-conversation">
        {turns.map((turn, turnIndex) => <article key={turn.id} className="agent-turn">
          <div className="agent-user-message"><span>{String(turnIndex + 1).padStart(2, '0')} · {turn.scopeLabel}</span><p>{turn.question}</p></div>
          <div className="traceable-agent-answer">
            {turn.sections.map((section, index) => <section key={`${turn.id}-${index}`}>
              <p>{section.content}</p>
              <div>{section.citationIds.map(citationId => {
                const entry = evidenceForTurnCitation(turn, citationId)
                if (!entry) return null
                return <button
                  key={citationId}
                  disabled={!entry.sourceId}
                  onClick={() => entry.sourceId && onOpenCitation(entry.sourceId, entry.pageNumber, entry.anchor as FragmentAnchor | undefined)}
                ><BookOpen size={12}/>{citationId} · {entry.title}{entry.pageNumber ? ` · 第 ${entry.pageNumber} 页` : ''}</button>
              })}</div>
            </section>)}
          </div>
        </article>)}
      </div>}
      <label className="agent-question">{turns.length ? '继续追问' : '你想让 Agent 基于这些证据回答什么？'}<textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder={turns.length ? '可以直接说“比较一下”“为什么”“证据够吗”…' : '例如：这些论文对刚度扰动采用了哪些评价指标？'}/></label>
      <div className="agent-actions">
        <button className="primary-button" disabled={busy} onClick={() => void retrieveAndAnswer()}><Search size={15}/> 检索证据并回答</button>
        <button className="outline-button" disabled={busy} onClick={() => void searchPapers()}><Globe2 size={15}/> 检索公开文献</button>
      </div>
      {notice && <p className="agent-notice">{notice}</p>}
      {proposedActions.length > 0 && <div className="agent-action-proposals">
        <h3>待你审查的下一步 <span>{proposedActions.length}</span></h3>
        {proposedActions.map((action, index) => <section key={`${action.title}-${index}`}>
          <span>{agentActionTypeLabel(action.actionType)}</span>
          <strong>{action.title}</strong>
          <p>{action.rationale}</p>
          <small>{action.citationIds.join('、')} · 保存后仍需逐条确认</small>
        </section>)}
      </div>}
      {evidence.length > 0 && <details className="agent-evidence-list">
        <summary>查看本轮证据 <span>{evidence.length}</span></summary>
        <div>{evidence.map((entry, index) => <button
          key={entry.id}
          disabled={!entry.sourceId}
          onClick={() => entry.sourceId && onOpenCitation(entry.sourceId, entry.pageNumber, entry.anchor as FragmentAnchor | undefined)}
        >
          <span>{`E${index + 1}`} · {entry.originLabel}</span>
          <strong>{entry.title}</strong>
          <p>{entry.excerpt}</p>
          <small>{entry.pageNumber ? `第 ${entry.pageNumber} 页 · 点击回到原文` : entry.sourceId ? '页码待核对 · 点击打开资料' : '仅题录信息'}</small>
        </button>)}</div>
      </details>}
      {papers.length > 0 && <div className="paper-results"><h3>公开检索候选</h3>{papers.map(paper => <a key={`${paper.title}-${paper.doi}`} href={paper.doi ? `https://doi.org/${paper.doi}` : undefined} target="_blank" rel="noreferrer"><strong>{paper.title}</strong><small>{paper.year ?? '年份未知'}{paper.doi ? ` · DOI: ${paper.doi}` : ''}</small></a>)}</div>}
    </div>
    <footer><p><strong>先本地检索，再发送证据片段。</strong>对话只留在当前窗口；保存只建立建议草稿，不会改写研究记录。</p><button className="primary-button" disabled={busy || !proposedActions.length} onClick={() => void saveActionPack()}><ClipboardCheck size={16}/> 保存为待确认行动包</button></footer>
  </section>
  return embedded ? panel : <div className="modal-backdrop">{panel}</div>
}
function SettingsModal({
  settings,
  uiSettings,
  credentialState,
  onboarding = false,
  workspaceOpen,
  onClose,
  onSave,
}: {
  settings: AISettings
  uiSettings: UISettings
  credentialState: 'empty' | 'encrypted' | 'unavailable'
  onboarding?: boolean
  workspaceOpen: boolean
  onClose: () => void
  onSave: (settings: AISettings, uiSettings: UISettings) => Promise<void>
}) {
  const [tab, setTab] = useState<'ai' | 'appearance'>('ai')
  const [draft, setDraft] = useState({ ...defaultAISettings, ...settings })
  const [uiDraft, setUIDraft] = useState({ ...defaultUISettings, ...uiSettings })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [embeddingStatus, setEmbeddingStatus] = useState<LocalEmbeddingStatus>()
  const [semanticIndexStatus, setSemanticIndexStatus] = useState<DesktopSemanticIndexStatus>()
  const [embeddingInstalling, setEmbeddingInstalling] = useState(false)
  const [semanticIndexing, setSemanticIndexing] = useState(false)
  const [embeddingProgress, setEmbeddingProgress] = useState('')
  const previewAccent = ({
    slate: { main: '#42474b', soft: '#e9ebec' },
    blue: { main: '#476b86', soft: '#e6eef4' },
    plum: { main: '#6d5c75', soft: '#eee8f1' },
  } as const)[(uiDraft.accentColor === 'green' ? 'plum' : uiDraft.accentColor) as 'slate' | 'blue' | 'plum']
  const previewSurface = ({
    neutral: { page: '#f5f5f3', paper: '#ffffff' },
    warm: { page: '#f7f5f0', paper: '#fffefb' },
    cool: { page: '#f3f5f6', paper: '#fcfdfe' },
  } as const)[uiDraft.surfaceTone]

  useEffect(() => {
    let alive = true
    const desktop = window.readerDesktop
    if (!desktop) {
      setEmbeddingStatus({
        available: false,
        provider: 'fastembed-local',
        model: 'BAAI/bge-small-zh-v1.5',
        localOnly: true,
        message: '网页预览不能安装本地组件，请在桌面客户端中使用。',
      })
      return () => { alive = false }
    }
    if (!workspaceOpen) {
      setEmbeddingStatus({
        available: false,
        provider: 'fastembed-local',
        model: 'BAAI/bge-small-zh-v1.5',
        localOnly: true,
        message: '创建或打开研究库后，可以建立当前研究库的本地语义索引。',
      })
      return () => { alive = false }
    }
    desktop.getWorkspaceSemanticStatus()
      .then(status => {
        if (!alive) return
        setEmbeddingStatus(status)
        setSemanticIndexStatus(status)
      })
      .catch(statusError => {
        if (!alive) return
        setEmbeddingStatus({
          available: false,
          provider: 'fastembed-local',
          model: 'BAAI/bge-small-zh-v1.5',
          localOnly: true,
          message: statusError instanceof Error ? statusError.message : '无法检查本地语义组件。',
        })
      })
    return () => { alive = false }
  }, [workspaceOpen])

  async function installEmbedding() {
    const desktop = window.readerDesktop
    if (!desktop) {
      setError('请使用桌面客户端安装本地语义组件。')
      return
    }
    const taskId = crypto.randomUUID()
    setError('')
    setEmbeddingInstalling(true)
    setEmbeddingProgress('正在准备独立运行环境…')
    const unsubscribe = desktop.onLocalEmbeddingProgress(progress => {
      if (progress.taskId !== taskId) return
      const lines = progress.text.trim().split(/\r?\n/).filter(Boolean)
      const latest = lines[lines.length - 1]
      if (latest) setEmbeddingProgress(latest.slice(0, 300))
    })
    try {
      await desktop.installLocalEmbedding({ taskId })
      const status = await desktop.getWorkspaceSemanticStatus()
      setEmbeddingStatus(status)
      setSemanticIndexStatus(status)
      setEmbeddingProgress('本地语义模型已就绪，可继续建立当前研究库索引。')
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : '本地语义组件安装失败。')
    } finally {
      unsubscribe()
      setEmbeddingInstalling(false)
    }
  }

  async function rebuildSemanticIndex() {
    const desktop = window.readerDesktop
    if (!desktop) {
      setError('请使用桌面客户端建立研究库语义索引。')
      return
    }
    const taskId = crypto.randomUUID()
    setError('')
    setSemanticIndexing(true)
    setEmbeddingProgress('正在整理当前研究库的可追溯内容分块…')
    const unsubscribe = desktop.onWorkspaceSemanticProgress(progress => {
      if (progress.taskId === taskId) setEmbeddingProgress(progress.text)
    })
    try {
      const status = await desktop.rebuildWorkspaceSemanticIndex({ taskId })
      setSemanticIndexStatus(status)
      setEmbeddingProgress(`研究库语义索引已就绪，共 ${status.chunkCount} 个分块。`)
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : '研究库语义索引建立失败。')
    } finally {
      unsubscribe()
      setSemanticIndexing(false)
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      if (onboarding && (!draft.baseUrl.trim() || !draft.model.trim() || !draft.apiKey.trim())) {
        throw new Error('首次使用请完整填写服务地址、模型名称和 API 密钥。')
      }
      await onSave(draft, uiDraft)
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '设置保存失败。')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop"><section className="annotation-modal settings-modal settings-center">
    <header>
      <div><p className="section-kicker">{onboarding ? '首次使用' : '本机设置'}</p><h2>{onboarding ? '先接入你的 AI 服务' : '设置'}</h2></div>
      {!onboarding && <button className="icon-button" onClick={onClose}><X/></button>}
    </header>
    <nav className="settings-tabs">
      <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}><Sparkles size={14}/> AI 与翻译</button>
      <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}><Settings2 size={14}/> 界面与阅读</button>
    </nav>
    <div className="settings-content">
      {tab === 'ai' ? <section className="settings-panel">
        <div className="settings-intro">
          <strong>{onboarding ? '接入后，科研助手才可以进行问答、阅读卡和章节整理' : '本地优先，云端调用必须手动触发'}</strong>
          <p>MinerU 转 Markdown 在本机完成，不依赖 AI。AI 用于章节整理、论文问答、阅读卡和课题推进；整篇派生 Markdown 仍需单独授权和再次确认。</p>
        </div>
        <div className={`local-component-card ${embeddingStatus?.available ? 'ready' : 'missing'}`}>
          <div className="local-component-copy">
            <span className="status-dot"/>
            <div>
              <strong>本地语义检索引擎</strong>
              <small>{embeddingStatus?.message ?? '正在检查 FastEmbed 本地模型…'}</small>
              <small>{embeddingStatus?.available
                ? `${embeddingStatus.model} · ${embeddingStatus.dimension} 维 · FastEmbed ${embeddingStatus.fastembedVersion} · Apache-2.0 / MIT`
                : '首次安装需要联网下载独立 Python、FastEmbed 和约 90 MB 模型；安装后可离线。'}</small>
            </div>
          </div>
          {!embeddingStatus?.available && <button type="button" disabled={embeddingInstalling || !window.readerDesktop} onClick={() => void installEmbedding()}>{embeddingInstalling ? '正在安装…' : '安装本地语义组件'}</button>}
          {embeddingStatus?.available && <div className="local-component-actions">
            <em>{semanticIndexStatus?.ready
              ? `当前研究库索引已就绪 · ${semanticIndexStatus.chunkCount} 个分块`
              : semanticIndexStatus?.stale
                ? '研究库内容已变化，需要更新语义索引'
                : '向量引擎已就绪，尚未建立当前研究库索引'}</em>
            <button type="button" disabled={semanticIndexing || !workspaceOpen} onClick={() => void rebuildSemanticIndex()}>{semanticIndexing ? '正在建立…' : semanticIndexStatus?.ready ? '重新建立索引' : workspaceOpen ? '建立研究库索引' : '请先打开研究库'}</button>
          </div>}
          {embeddingProgress && <p>{embeddingProgress}</p>}
        </div>
        <label>划词翻译方式<select value={draft.translationProvider} onChange={event => setDraft({ ...draft, translationProvider: event.target.value as AISettings['translationProvider'] })}>
          <option value="local">本地 Argos（推荐，不消耗 Token）</option>
          <option value="ai">已配置的 AI 服务（会发送选区）</option>
        </select></label>
        <label>OpenAI 兼容服务地址<input value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1"/></label>
        <label>模型名称<input value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} placeholder="例如 gpt-4.1-mini 或本地模型名"/></label>
        <label>API 密钥<input type="password" value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} placeholder="桌面端使用系统加密保存"/></label>
        <div className={`credential-state ${credentialState}`}>
          <span className="status-dot"/>
          <div><strong>{credentialState === 'encrypted' ? '密钥已由系统加密保存' : credentialState === 'unavailable' ? '系统凭据暂不可用' : '尚未保存密钥'}</strong><small>密钥不写入研究库、导出文件、README 或源码。</small></div>
        </div>
        <label className="toggle-label"><input type="checkbox" checked={draft.allowFullDocument} onChange={event => setDraft({ ...draft, allowFullDocument: event.target.checked })}/>允许在每次再次确认后，发送整篇派生 Markdown 做章节识别</label>
      </section> : <section className="settings-panel appearance-settings">
        <div className="settings-intro">
          <strong>让界面适合长时间科研工作</strong>
          <p>选择会立即显示在下方预览中；保存后应用到课题驾驶舱、资料库、阅读与复查界面。</p>
        </div>
        <div className="settings-two-column">
          <label>界面文字与控件<select value={Math.max(1, uiDraft.uiScale)} onChange={event => setUIDraft({ ...uiDraft, uiScale: Number(event.target.value) })}>
            <option value={1}>舒适（最小 13px）</option>
            <option value={1.05}>清晰（约大 5%）</option>
            <option value={1.1}>大字（约大 10%）</option>
          </select></label>
          <label>信息密度<select value={uiDraft.density} onChange={event => setUIDraft({ ...uiDraft, density: event.target.value as UISettings['density'] })}>
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
          </select></label>
        </div>
        <fieldset className="visual-choice-group">
          <legend>界面底色</legend>
          <div>{([
            ['neutral', '中性灰', '#f0f0ee'],
            ['warm', '暖米色', '#f1eee7'],
            ['cool', '冷灰蓝', '#edf0f2'],
          ] as const).map(([value, label, color]) => <button
            className={uiDraft.surfaceTone === value ? 'active' : ''}
            key={value}
            onClick={() => setUIDraft({ ...uiDraft, surfaceTone: value })}
          ><i style={{ background: color }}/><span>{label}</span></button>)}</div>
        </fieldset>
        <fieldset className="visual-choice-group accent-choices">
          <legend>强调色</legend>
          <div>{([
            ['slate', '石墨', '#42474b'],
            ['blue', '沉静蓝', '#476b86'],
            ['plum', '柔和紫', '#6d5c75'],
          ] as const).map(([value, label, color]) => <button
            className={uiDraft.accentColor === value ? 'active' : ''}
            key={value}
            onClick={() => setUIDraft({ ...uiDraft, accentColor: value })}
          ><i style={{ background: color }}/><span>{label}</span></button>)}</div>
        </fieldset>
        <label className="range-setting"><span>Markdown 正文字号 <b>{uiDraft.readerFontSize}px</b></span><input type="range" min="14" max="22" step="1" value={uiDraft.readerFontSize} onChange={event => setUIDraft({ ...uiDraft, readerFontSize: Number(event.target.value) })}/></label>
        <label className="range-setting"><span>Markdown 正文行距 <b>{uiDraft.readerLineHeight.toFixed(1)}</b></span><input type="range" min="1.5" max="2.2" step=".1" value={uiDraft.readerLineHeight} onChange={event => setUIDraft({ ...uiDraft, readerLineHeight: Number(event.target.value) })}/></label>
        <label className="range-setting"><span>Markdown 正文宽度 <b>{uiDraft.readerWidth}px</b></span><input type="range" min="680" max="980" step="20" value={uiDraft.readerWidth} onChange={event => setUIDraft({ ...uiDraft, readerWidth: Number(event.target.value) })}/></label>
        <article className="reading-settings-preview" style={{
          maxWidth: `${Math.min(540, uiDraft.readerWidth * .62)}px`,
          fontSize: `${Math.max(12, uiDraft.readerFontSize * .8)}px`,
          lineHeight: uiDraft.readerLineHeight,
          '--ui-accent': previewAccent.main,
          '--ui-accent-soft': previewAccent.soft,
          '--ui-paper': previewSurface.paper,
          '--ui-page': previewSurface.page,
        } as CSSProperties}>
          <span>阅读效果预览</span>
          <h3>2. Experimental Method</h3>
          <p>论文正文应当保持稳定的行宽、清楚的章节层级和足够的行距，让长时间精读不容易疲劳。</p>
        </article>
      </section>}
    </div>
    {error && <p className="settings-save-error">{error}</p>}
    <footer>{!onboarding && <button className="outline-button" disabled={busy} onClick={onClose}>取消</button>}<button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : onboarding ? '保存并进入 H’s 科研助手' : '保存本机设置'}</button></footer>
  </section></div>
}

function WorkspaceCreationModal({
  directory,
  suggestedName,
  existingPaperCount,
  existingPaperNames,
  busy,
  onClose,
  onCreate,
}: {
  directory: string
  suggestedName: string
  existingPaperCount: number
  existingPaperNames: string[]
  busy: boolean
  onClose: () => void
  onCreate: (name: string, manageExistingPapers: boolean) => void
}) {
  const [step, setStep] = useState<'confirm' | 'name'>('confirm')
  const [name, setName] = useState(suggestedName)
  const [manageExistingPapers, setManageExistingPapers] = useState(existingPaperCount > 0)
  return <div className="modal-backdrop"><section className="annotation-modal workspace-create-modal">
    <header><div><p className="section-kicker">新建研究库</p><h2>{step === 'confirm' ? '这个文件夹还不是研究库' : '给研究库起个名字'}</h2></div><button className="icon-button" disabled={busy} onClick={onClose}><X/></button></header>
    {step === 'confirm' ? <div className="workspace-create-copy">
      <p>是否直接在这个文件夹中创建科研阅读工作库？</p>
      <code title={directory}>{directory}</code>
      <small>软件只会新增 vault.json、library.sqlite、papers、exports 和缓存目录，不会删除文件夹里已有的内容。</small>
      {existingPaperCount > 0 && <label className="workspace-paper-import"><input type="checkbox" checked={manageExistingPapers} onChange={event => setManageExistingPapers(event.target.checked)}/><span><strong>一键管理发现的 {existingPaperCount} 篇 PDF</strong><small>{existingPaperNames.join('、')}{existingPaperCount > existingPaperNames.length ? '…' : ''}<br/>软件会复制论文到研究库，原文件保持不动。</small></span></label>}
    </div> : <label>研究库名称<input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="例如：柔顺装配控制"/></label>}
    <footer>
      <button className="outline-button" disabled={busy} onClick={step === 'name' ? () => setStep('confirm') : onClose}>{step === 'name' ? '上一步' : '取消'}</button>
      {step === 'confirm'
        ? <button className="primary-button" onClick={() => setStep('name')}>在这里创建</button>
        : <button className="primary-button" disabled={busy || !name.trim()} onClick={() => onCreate(name.trim(), manageExistingPapers)}>{busy ? '正在创建…' : manageExistingPapers && existingPaperCount ? `创建并纳入 ${existingPaperCount} 篇论文` : '创建并打开'}</button>}
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
    <header><div><p className="section-kicker">本地解析</p><h2>使用本地 MinerU 深度解析</h2></div><button className="icon-button" disabled={installing} onClick={onClose}><X/></button></header>
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
function AnnotationEditModal({ annotation, onClose, onSave }: { annotation: Annotation; onClose:()=>void; onSave:(category:string,note:string)=>void }) {
  const [category, setCategory] = useState(annotation.category)
  const [note, setNote] = useState(annotation.note)
  const changed = category !== annotation.category || note !== annotation.note
  return <div className="modal-backdrop"><section className="annotation-modal">
    <header><div><p className="section-kicker">APPEND-ONLY REVISION</p><h2>编辑研究批注</h2></div><button className="icon-button" onClick={onClose}><X/></button></header>
    <div className="annotation-provenance"><BookOpen size={17}/><div><strong>{annotation.paperTitle ?? '论文信息待补充'}</strong><span>{annotation.sourceName ?? '未关联附件'} · {annotation.page || '位置待核对'}</span></div></div>
    <blockquote className="annotation-evidence-quote">“{annotation.text}”<small>原文证据保持不变</small></blockquote>
    <label>这段内容对研究的意义<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select></label>
    <label>你的备注<textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="允许留空；保存后仍会形成一条可追溯修订。"/></label>
    <p className="annotation-storage-note">保存会新增一个笔记版本并指向旧版本，不会覆盖原文、旧笔记或已生成复查文档中的引用。</p>
    <footer><button className="outline-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!changed} onClick={()=>onSave(category,note)}>保存新版本</button></footer>
  </section></div>
}
function AnnotationModalV2({ source, paper, draft, onClose, onSave }: { source?: Source; paper?: BibliographicSummary; draft: AnnotationDraft; onClose:()=>void; onSave:(category:string,note:string,text:string,location:string)=>void }) {
  const [category, setCategory] = useState(categories[0])
  const [note, setNote] = useState('')
  const [text, setText] = useState(draft.text ?? '')
  const [location, setLocation] = useState(draft.location ?? (source?.kind === 'PDF' ? '第 1 页' : '段落/位置（可选）'))
  const anchoredEvidence = Boolean(draft.text && draft.anchor?.state === 'resolved')
  const paperTitle = paper?.title ?? source?.name.replace(/\.pdf$/i, '') ?? '论文信息待补充'
  return <div className="modal-backdrop"><section className="annotation-modal">
    <header><div><p className="section-kicker">TRACEABLE ANNOTATION</p><h2>添加研究批注</h2></div><button className="icon-button" onClick={onClose}><X/></button></header>
    <div className="annotation-provenance">
      <BookOpen size={17}/>
      <div>
        <strong>{paperTitle}</strong>
        <span>原始附件：{source?.name ?? '未关联附件'}</span>
        <span>原文位置：{location || '位置待补充'}</span>
      </div>
    </div>
    {anchoredEvidence
      ? <blockquote className="annotation-evidence-quote">“{text}”<small>{location} · 已保存原文选区锚点</small></blockquote>
      : <label>原文摘录<textarea value={text} onChange={event => setText(event.target.value)} placeholder="建议取消并直接在原文中拖选；这里只为旧资料保留手动录入。"/></label>}
    <label>页码或位置<input readOnly={anchoredEvidence} value={location} onChange={event => setLocation(event.target.value)} placeholder="例如第 7 页 · 图 5"/></label>
    <label>这段内容对研究的意义<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select></label>
    <label>你的备注（可选）<textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="例如：可作为在线辨识方案的理论依据，但需要核对实验条件。"/></label>
    <p className="annotation-storage-note">保存后会同时关联论文记录、原始附件、页码/位置和原文选区；AI 整理不会覆盖这条原始笔记。</p>
    <footer><button className="outline-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!text.trim()} onClick={()=>onSave(category,note,text.trim(),location.trim() || '未标注位置')}>保存并关联原文</button></footer>
  </section></div>
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
