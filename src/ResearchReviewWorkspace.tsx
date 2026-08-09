import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle, Archive, BookOpen, Check, ChevronRight, ClipboardCheck, Download,
  FileText, Files, FlaskConical, GitBranch, History, Link2, Plus, Save, ShieldCheck,
  Sparkles, Target, X,
} from 'lucide-react'
import {
  auditClaimEvidence,
  generateTraceableResearchReport,
  type ClaimEvidenceAudit,
  type TraceableResearchReport,
} from './research-synthesis.mjs'

type PaperEvidence = { id: string; title: string; sourceId?: string }

type Props = {
  workspace?: DesktopResearchWorkspace
  bibliography: PaperEvidence[]
  onSaveReport: (input: DesktopResearchReportInput) => Promise<DesktopResearchReport>
  onConfirmReport: (id: string) => Promise<DesktopResearchReport>
  onExportReport: (id: string) => Promise<void>
  onPortableExportReport: (id: string) => Promise<void>
  onSaveClaim: (input: DesktopResearchClaimInput) => Promise<DesktopResearchClaim>
  onArchiveClaim: (id: string) => Promise<void>
  onOpenReader: (sourceId: string) => void
}

type ReportDraft = {
  id?: string
  title: string
  type: DesktopResearchReportType
  from: string
  to: string
  markdown: string
  sourceRefs: DesktopResearchEvidenceRef[]
  preview?: TraceableResearchReport
}

type ClaimDraft = {
  id?: string
  section: string
  text: string
  status: DesktopResearchClaimStatus
  requiredEvidence: string[]
  evidenceRefs: DesktopResearchEvidenceRef[]
}

const reportTypeLabel: Record<DesktopResearchReportType, string> = { weekly: '科研周报', meeting: '组会材料', stage_review: '阶段复盘' }
const requirementOptions = [
  { value: 'bibliography', label: '文献依据' },
  { value: 'run', label: '测试运行' },
  { value: 'raw_data', label: '原始数据' },
  { value: 'figure', label: '图表文件' },
  { value: 'artifact', label: '可用产物' },
]
const allowedReportRefTypes = new Set<DesktopResearchEvidenceRefType>(['bibliography', 'source', 'run', 'artifact', 'milestone'])

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function initialReportDraft(type: DesktopResearchReportType = 'weekly'): ReportDraft {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { title: `${reportTypeLabel[type]} · ${dateValue(end)}`, type, from: dateValue(start), to: dateValue(end), markdown: '', sourceRefs: [] }
}

function initialClaimDraft(): ClaimDraft {
  return { section: '结果', text: '', status: 'draft', requiredEvidence: ['run', 'raw_data'], evidenceRefs: [] }
}

function formatWhen(value?: string) {
  if (!value) return '未确认'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function refKey(ref: DesktopResearchEvidenceRef) { return `${ref.type}:${ref.id}` }

function convertReportRefs(report: TraceableResearchReport): DesktopResearchEvidenceRef[] {
  const refs = new Map<string, DesktopResearchEvidenceRef>()
  for (const item of report.sourceRefs) {
    const type = item.kind as DesktopResearchEvidenceRefType
    if (!allowedReportRefTypes.has(type)) continue
    refs.set(`${type}:${item.id}`, { type, id: item.id, label: item.tag })
  }
  return [...refs.values()]
}

export default function ResearchReviewWorkspace({
  workspace: data, bibliography, onSaveReport, onConfirmReport, onExportReport, onPortableExportReport, onSaveClaim, onArchiveClaim, onOpenReader,
}: Props) {
  const reports = data?.reports ?? []
  const claims = data?.claims ?? []
  const runs = data?.runs ?? []
  const artifacts = data?.artifacts ?? []
  const milestones = data?.milestones ?? []
  const [tab, setTab] = useState<'reports' | 'claims'>('reports')
  const [reportDraft, setReportDraft] = useState<ReportDraft>(() => initialReportDraft())
  const [selectedReportId, setSelectedReportId] = useState<string>()
  const [claimDraft, setClaimDraft] = useState<ClaimDraft>()
  const [selectedClaimId, setSelectedClaimId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedReport = reports.find(item => item.id === selectedReportId)
  const selectedClaim = claims.find(item => item.id === selectedClaimId)
  const claimAudit = useMemo(() => auditClaimEvidence({ claims, bibliography, runs, artifacts }), [claims, bibliography, runs, artifacts])
  const draftAudit = useMemo(() => claimDraft ? auditClaimEvidence({ claims: [{ ...claimDraft, id: claimDraft.id ?? 'draft' }], bibliography, runs, artifacts }).claims[0] : undefined, [claimDraft, bibliography, runs, artifacts])
  const confirmedCount = claims.filter(item => item.status === 'confirmed').length
  const brokenArtifactCount = artifacts.filter(item => item.existsState !== 'found').length

  async function execute<T>(task: () => Promise<T>, fallback: string): Promise<T | undefined> {
    setBusy(true); setError('')
    try { return await task() } catch (caught) { setError(caught instanceof Error ? caught.message : fallback); return undefined }
    finally { setBusy(false) }
  }

  function generatePreview() {
    const generated = generateTraceableResearchReport(data as unknown as Parameters<typeof generateTraceableResearchReport>[0], {
      from: reportDraft.from ? `${reportDraft.from}T00:00:00.000Z` : undefined,
      to: reportDraft.to ? `${reportDraft.to}T23:59:59.999Z` : undefined,
      title: reportDraft.title,
    })
    setReportDraft({ ...reportDraft, markdown: generated.markdown, sourceRefs: convertReportRefs(generated), preview: generated })
  }

  function editReport(report: DesktopResearchReport) {
    setReportDraft({ id: report.id, title: report.title, type: report.type, from: '', to: '', markdown: report.markdown, sourceRefs: report.sourceRefs })
    setSelectedReportId(undefined)
  }

  async function saveReport() {
    if (!reportDraft.title.trim() || !reportDraft.markdown.trim()) return
    const saved = await execute(() => onSaveReport({
      id: reportDraft.id, title: reportDraft.title.trim(), type: reportDraft.type,
      period: [reportDraft.from, reportDraft.to].filter(Boolean).join(' 至 ') || '未指定',
      markdown: reportDraft.markdown, sourceRefs: reportDraft.sourceRefs, status: 'draft',
    }), '报告保存失败。')
    if (!saved) return
    setReportDraft(initialReportDraft(reportDraft.type))
    setSelectedReportId(saved.id)
  }

  async function confirmReport(report: DesktopResearchReport) {
    if (!window.confirm(`确认“${report.title}”内容与来源无误，并写入正式科研记录？\n\n确认后仍可修改，但修改会生成修订历史并退回草稿。`)) return
    await execute(() => onConfirmReport(report.id), '报告确认失败。')
  }

  function editClaim(claim: DesktopResearchClaim) {
    setClaimDraft({ id: claim.id, section: claim.section, text: claim.text, status: claim.status, requiredEvidence: claim.requiredEvidence, evidenceRefs: claim.evidenceRefs })
    setSelectedClaimId(undefined)
  }

  function toggleRequirement(value: string) {
    if (!claimDraft) return
    const requiredEvidence = claimDraft.requiredEvidence.includes(value) ? claimDraft.requiredEvidence.filter(item => item !== value) : [...claimDraft.requiredEvidence, value]
    setClaimDraft({ ...claimDraft, requiredEvidence })
  }

  function toggleEvidence(ref: DesktopResearchEvidenceRef) {
    if (!claimDraft) return
    const key = refKey(ref)
    const evidenceRefs = claimDraft.evidenceRefs.some(item => refKey(item) === key) ? claimDraft.evidenceRefs.filter(item => refKey(item) !== key) : [...claimDraft.evidenceRefs, ref]
    setClaimDraft({ ...claimDraft, evidenceRefs })
  }

  async function saveClaim(status: DesktopResearchClaimStatus) {
    if (!claimDraft?.text.trim()) return
    if (status === 'confirmed') {
      if (draftAudit?.status !== 'supported') return
      if (!window.confirm('确认这条论文论断已经由所选证据充分支持？\n\n此操作会写入正式论断；后续修改会保留修订历史并退回草稿。')) return
    }
    const saved = await execute(() => onSaveClaim({
      id: claimDraft.id, section: claimDraft.section.trim(), text: claimDraft.text.trim(),
      requiredEvidence: claimDraft.requiredEvidence, evidenceRefs: claimDraft.evidenceRefs, status,
    }), '论文论断保存失败。')
    if (!saved) return
    setClaimDraft(undefined)
    setSelectedClaimId(saved.id)
  }

  return <div className="research-review-workspace">
    <section className="research-review-hero">
      <div><p className="section-kicker">Research output & provenance</p><h1>让汇报和论文结论都能回到证据</h1><p>周报从真实记录生成；论文论断逐条连接文献、测试、原始数据和图表。AI 建议与正式结论始终分开。</p></div>
      <div className="research-integrity-summary"><div><strong>{reports.filter(item => item.status === 'confirmed').length}</strong><span>份正式复盘</span></div><div><strong>{confirmedCount}</strong><span>条正式论断</span></div><div className={claimAudit.counts.unsupported ? 'warn' : ''}><strong>{claimAudit.counts.unsupported}</strong><span>条无证据论断</span></div><div className={brokenArtifactCount ? 'danger' : ''}><strong>{brokenArtifactCount}</strong><span>份产物不可用</span></div></div>
    </section>

    <div className="research-review-tabs"><button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}><ClipboardCheck/>复盘与组会</button><button className={tab === 'claims' ? 'active' : ''} onClick={() => setTab('claims')}><GitBranch/>论文论断证据</button></div>

    {tab === 'reports' && <div className="research-output-grid">
      <aside className="research-output-list"><header><div><p className="section-kicker">Saved outputs</p><h2>正式记录</h2></div><span>{reports.length}</span></header>{reports.length ? reports.map(report => <button key={report.id} className={selectedReportId === report.id ? 'active' : ''} onClick={() => setSelectedReportId(report.id)}><span className={report.status}>{report.status === 'confirmed' ? <ShieldCheck/> : <FileText/>}</span><div><strong>{report.title}</strong><small>{reportTypeLabel[report.type]} · {report.period}</small><em>{report.status === 'confirmed' ? '已确认' : '草稿'} · v{report.revisionNumber}</em></div><ChevronRight/></button>) : <div className="research-output-empty"><FileText/><p>还没有保存复盘。先从右侧生成一份带来源的预览。</p></div>}</aside>
      <section className="research-report-studio">
        {selectedReport ? <ReportDetail report={selectedReport} onEdit={() => editReport(selectedReport)} onConfirm={() => void confirmReport(selectedReport)} onExport={() => void execute(() => onExportReport(selectedReport.id), '报告导出失败。')} onPortableExport={() => void execute(() => onPortableExportReport(selectedReport.id), '可迁移 Markdown 导出失败。')} busy={busy}/> : <>
          <header><div><p className="section-kicker">Evidence-grounded draft</p><h2>{reportDraft.id ? '编辑报告草稿' : '生成科研复盘'}</h2></div><span>本地记录 → 可核对预览 → 人工确认</span></header>
          <div className="research-report-controls"><label>类型<select value={reportDraft.type} onChange={event => { const type = event.target.value as DesktopResearchReportType; setReportDraft({ ...reportDraft, type, title: `${reportTypeLabel[type]} · ${dateValue(new Date())}` }) }}>{Object.entries(reportTypeLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>开始日期<input type="date" value={reportDraft.from} onChange={event => setReportDraft({ ...reportDraft, from: event.target.value })}/></label><label>结束日期<input type="date" value={reportDraft.to} onChange={event => setReportDraft({ ...reportDraft, to: event.target.value })}/></label><button className="primary-button" onClick={generatePreview}><Sparkles/>从科研记录生成预览</button></div>
          <label className="research-report-title">标题<input value={reportDraft.title} onChange={event => setReportDraft({ ...reportDraft, title: event.target.value })}/></label>
          {reportDraft.markdown ? <div className="research-report-editor-grid"><label>可编辑 Markdown<textarea value={reportDraft.markdown} onChange={event => setReportDraft({ ...reportDraft, markdown: event.target.value })}/></label><div className="research-report-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reportDraft.markdown}</ReactMarkdown></div></div> : <div className="research-report-placeholder"><ClipboardCheck/><strong>报告不是一键编造的总结</strong><p>它只整理日期范围内已有的测试、产物、决策、阻塞和下一步，并给每项标出事实、用户观察或待确认建议。</p></div>}
          {reportDraft.sourceRefs.length > 0 && <div className="research-source-ref-strip"><Link2/><span>已解析 {reportDraft.sourceRefs.length} 个正式来源引用</span>{reportDraft.sourceRefs.slice(0, 12).map(ref => <code key={refKey(ref)}>{ref.type}:{ref.label || ref.id}</code>)}</div>}
          <footer className="research-studio-actions"><button className="outline-button" onClick={() => setReportDraft(initialReportDraft(reportDraft.type))}>清空预览</button><button className="primary-button" disabled={busy || !reportDraft.markdown.trim()} onClick={() => void saveReport()}><Save/>保存为草稿</button></footer>
        </>}
      </section>
    </div>}

    {tab === 'claims' && <div className="research-output-grid claims">
      <aside className="research-output-list"><header><div><p className="section-kicker">Writing claims</p><h2>论断清单</h2></div><button onClick={() => { setClaimDraft(initialClaimDraft()); setSelectedClaimId(undefined) }}><Plus/></button></header>{claims.length ? claims.map(claim => {
        const audit = claimAudit.claims.find(item => item.id === claim.id)
        return <button key={claim.id} className={selectedClaimId === claim.id ? 'active' : ''} onClick={() => { setSelectedClaimId(claim.id); setClaimDraft(undefined) }}><span className={audit?.status ?? 'unsupported'}>{audit?.status === 'supported' ? <Check/> : <AlertTriangle/>}</span><div><strong>{claim.text}</strong><small>{claim.section} · {claim.evidenceRefs.length} 条证据</small><em>{audit?.status === 'supported' ? '证据完整' : audit?.status === 'partial' ? '证据不完整' : '缺少证据'} · {claim.status === 'confirmed' ? '已确认' : '草稿'}</em></div><ChevronRight/></button>
      }) : <div className="research-output-empty"><GitBranch/><p>把论文中的关键判断逐条放进来，才能知道还缺哪次实验或哪份原始数据。</p><button onClick={() => setClaimDraft(initialClaimDraft())}>添加第一条论断</button></div>}</aside>
      <section className="research-claim-studio">
        {selectedClaim ? <ClaimDetail claim={selectedClaim} audit={claimAudit.claims.find(item => item.id === selectedClaim.id)} bibliography={bibliography} runs={runs} artifacts={artifacts} onReader={onOpenReader} onEdit={() => editClaim(selectedClaim)} onArchive={() => void execute(() => onArchiveClaim(selectedClaim.id), '论断归档失败。')} busy={busy}/> : claimDraft ? <>
          <header><div><p className="section-kicker">Claim evidence audit</p><h2>{claimDraft.id ? '修改论断与证据' : '新建论文论断'}</h2></div><button className="icon-button" onClick={() => setClaimDraft(undefined)}><X/></button></header>
          <div className="research-claim-main-fields"><label>论文位置<input value={claimDraft.section} onChange={event => setClaimDraft({ ...claimDraft, section: event.target.value })} placeholder="例如 结果 3.2 / 讨论"/></label><label>论断<textarea value={claimDraft.text} onChange={event => setClaimDraft({ ...claimDraft, text: event.target.value })} placeholder="例如：降低最大线速度后，路径跟踪振荡在三个场景中均明显减少。"/></label></div>
          <fieldset className="research-requirements"><legend>这条论断必须具备什么证据？</legend>{requirementOptions.map(item => <label key={item.value}><input type="checkbox" checked={claimDraft.requiredEvidence.includes(item.value)} onChange={() => toggleRequirement(item.value)}/><span><Check/>{item.label}</span></label>)}</fieldset>
          <EvidencePicker draft={claimDraft} bibliography={bibliography} runs={runs} artifacts={artifacts} milestones={milestones} onToggle={toggleEvidence}/>
          <ClaimAuditBanner audit={draftAudit}/>
          <footer className="research-studio-actions"><button className="outline-button" disabled={busy || !claimDraft.text.trim()} onClick={() => void saveClaim('draft')}><Save/>保存草稿</button><button className="primary-button" disabled={busy || !claimDraft.text.trim() || draftAudit?.status !== 'supported'} onClick={() => void saveClaim('confirmed')}><ShieldCheck/>确认正式论断</button></footer>
        </> : <div className="research-claim-placeholder"><GitBranch/><strong>一张图从哪里来，一条结论就应该回到哪里</strong><p>选择左侧论断查看证据，或创建论断并关联文献、测试运行、原始数据和图表。证据不完整时不能确认为正式论断。</p><button className="primary-button" onClick={() => setClaimDraft(initialClaimDraft())}><Plus/>创建论文论断</button></div>}
      </section>
    </div>}

    {error && <div className="research-global-error"><AlertTriangle/>{error}<button onClick={() => setError('')}><X/></button></div>}
  </div>
}

function ReportDetail({ report, onEdit, onConfirm, onExport, onPortableExport, busy }: { report: DesktopResearchReport; onEdit: () => void; onConfirm: () => void; onExport: () => void; onPortableExport: () => void; busy: boolean }) {
  return <><header><div><p className="section-kicker">{reportTypeLabel[report.type]} · {report.period}</p><h2>{report.title}</h2></div><span className={`research-formal-status ${report.status}`}>{report.status === 'confirmed' ? <ShieldCheck/> : <FileText/>}{report.status === 'confirmed' ? '正式记录' : '草稿'}</span></header><div className="research-report-detail-meta"><span>版本 v{report.revisionNumber}</span><span>更新 {formatWhen(report.updatedAt)}</span><span>{report.sourceRefs.length} 个可回溯来源</span>{report.revisions.length > 0 && <span><History/> {report.revisions.length} 个历史版本</span>}</div><article className="research-report-preview detail"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown></article><div className="research-source-ref-strip"><Link2/>{report.sourceRefs.length ? report.sourceRefs.map(ref => <code key={refKey(ref)}>{ref.type}:{ref.label || ref.id}</code>) : <span>这份报告没有结构化来源引用，不能确认为正式记录。</span>}</div><footer className="research-studio-actions"><button className="outline-button" onClick={onEdit}>修改（自动退回草稿）</button>{report.status === 'confirmed' ? <button className="outline-button" disabled={busy} onClick={onPortableExport}><Download/>可迁移 Markdown</button> : <button className="outline-button" disabled={busy} onClick={onExport}><Download/>导出草稿</button>}{report.status === 'draft' && <button className="primary-button" disabled={busy || report.sourceRefs.length === 0} onClick={onConfirm}><ShieldCheck/>{report.sourceRefs.length ? '人工确认正式记录' : '缺少来源，不能确认'}</button>}</footer></>
}

function EvidencePicker({ draft, bibliography, runs, artifacts, milestones, onToggle }: { draft: ClaimDraft; bibliography: PaperEvidence[]; runs: DesktopResearchRun[]; artifacts: DesktopResearchArtifact[]; milestones: DesktopResearchMilestone[]; onToggle: (ref: DesktopResearchEvidenceRef) => void }) {
  const selected = new Set(draft.evidenceRefs.map(refKey))
  return <div className="research-evidence-picker"><h3><Link2/>选择证据来源</h3><div className="research-evidence-columns"><section><header><BookOpen/><b>文献</b><span>{bibliography.length}</span></header>{bibliography.length ? bibliography.map(item => <label key={item.id}><input type="checkbox" checked={selected.has(`bibliography:${item.id}`)} onChange={() => onToggle({ type: 'bibliography', id: item.id, label: item.title })}/><span>{item.title}</span></label>) : <small>资料库暂无规范文献条目。</small>}</section><section><header><FlaskConical/><b>测试运行</b><span>{runs.length}</span></header>{runs.length ? runs.map(item => <label key={item.id}><input type="checkbox" checked={selected.has(`run:${item.id}`)} onChange={() => onToggle({ type: 'run', id: item.id, label: item.title })}/><span>{item.title}<em>{item.outcome}</em></span></label>) : <small>还没有测试记录。</small>}</section><section><header><Files/><b>数据与图表</b><span>{artifacts.length}</span></header>{artifacts.length ? artifacts.map(item => <label key={item.id} className={item.existsState !== 'found' ? 'unavailable' : ''}><input type="checkbox" disabled={item.existsState !== 'found'} checked={selected.has(`artifact:${item.id}`)} onChange={() => onToggle({ type: 'artifact', id: item.id, label: item.label })}/><span>{item.label}<em>{item.role} · {item.existsState === 'found' ? '原位置可用' : '不可用'}</em></span></label>) : <small>还没有关联文件产物。</small>}</section><section><header><Target/><b>里程碑</b><span>{milestones.length}</span></header>{milestones.length ? milestones.map(item => <label key={item.id}><input type="checkbox" checked={selected.has(`milestone:${item.id}`)} onChange={() => onToggle({ type: 'milestone', id: item.id, label: item.title })}/><span>{item.title}<em>{item.status}</em></span></label>) : <small>还没有里程碑。</small>}</section></div></div>
}

function ClaimAuditBanner({ audit }: { audit?: ClaimEvidenceAudit['claims'][number] }) {
  if (!audit) return null
  const labels: Record<string, string> = { bibliography: '文献依据', run: '测试运行', raw_data: '原始数据', figure: '图表文件', artifact: '可用产物', linked_evidence: '至少一条证据', available_artifact_file: '原位置可用的产物' }
  return <div className={`research-claim-audit ${audit.status}`}>{audit.status === 'supported' ? <ShieldCheck/> : <AlertTriangle/>}<div><strong>{audit.status === 'supported' ? '证据要求已满足，可以人工确认' : audit.status === 'partial' ? '已有证据，但仍有缺口' : '当前论断没有有效证据'}</strong>{audit.missing.length > 0 && <p>缺少：{audit.missing.map(item => labels[item] ?? item).join('、')}</p>}{audit.brokenRefs.length > 0 && <p>{audit.brokenRefs.length} 个来源引用已失效。</p>}</div></div>
}

function ClaimDetail({ claim, audit, bibliography, runs, artifacts, onReader, onEdit, onArchive, busy }: { claim: DesktopResearchClaim; audit?: ClaimEvidenceAudit['claims'][number]; bibliography: PaperEvidence[]; runs: DesktopResearchRun[]; artifacts: DesktopResearchArtifact[]; onReader: (id: string) => void; onEdit: () => void; onArchive: () => void; busy: boolean }) {
  const evidenceName = (ref: DesktopResearchEvidenceRef) => ref.label || (ref.type === 'bibliography' ? bibliography.find(item => item.id === ref.id)?.title : ref.type === 'run' ? runs.find(item => item.id === ref.id)?.title : ref.type === 'artifact' ? artifacts.find(item => item.id === ref.id)?.label : undefined) || ref.id
  return <><header><div><p className="section-kicker">{claim.section}</p><h2>论断证据详情</h2></div><span className={`research-formal-status ${claim.status}`}>{claim.status === 'confirmed' ? <ShieldCheck/> : <FileText/>}{claim.status === 'confirmed' ? '正式论断' : '草稿'}</span></header><blockquote className="research-claim-text">{claim.text}</blockquote><ClaimAuditBanner audit={audit}/><section className="research-claim-evidence-list"><h3>已连接证据</h3>{claim.evidenceRefs.map(ref => <article key={refKey(ref)}><span>{ref.type === 'bibliography' ? <BookOpen/> : ref.type === 'run' ? <FlaskConical/> : ref.type === 'artifact' ? <Files/> : <Target/>}</span><div><strong>{evidenceName(ref)}</strong><code>{ref.type}:{ref.id}</code></div>{ref.type === 'bibliography' && bibliography.find(item => item.id === ref.id)?.sourceId && <button onClick={() => onReader(bibliography.find(item => item.id === ref.id)!.sourceId!)}>回到原文 <ChevronRight/></button>}</article>)}</section>{claim.revisions.length > 0 && <div className="research-revision-note"><History/>已保留 {claim.revisions.length} 个历史版本；当前为 v{claim.revisionNumber}。</div>}<footer className="research-studio-actions"><button className="outline-button danger" disabled={busy} onClick={onArchive}><Archive/>归档</button><button className="primary-button" onClick={onEdit}>修改论断与证据</button></footer></>
}
