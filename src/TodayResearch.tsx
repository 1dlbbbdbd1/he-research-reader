import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ClipboardList, Clock3,
  FileWarning, FlaskConical, ListChecks, NotebookPen, Sparkles, X,
} from 'lucide-react'
import {
  buildTodayResearch,
  formatResearchAbsence,
  type TodayResearchSummary,
} from './research-resume.mjs'
import { useDialogKeyboard } from './use-dialog-keyboard'

type TodayPaper = {
  id: string
  title: string
  sourceId?: string
  readingState: {
    readingStatus: string
    lastPage?: number
    totalPages?: number
  }
}

type TodaySource = { id: string; name: string }
type TodayRecordInput = DesktopResearchRecordInput & { status: DesktopResearchRecordStatus }

type Props = {
  workspace?: DesktopResearchWorkspace
  papers: TodayPaper[]
  sources: TodaySource[]
  actionPacks: ActionPackSummary[]
  resume?: DesktopResearchResumeState
  onContinue: () => void
  onSaveRecord: (input: TodayRecordInput) => Promise<void>
  onOpenTasks: () => void
  onOpenWorkspace: () => void
}

export function ResearchReturnGreeting({
  resume,
  onDismiss,
  onContinue,
}: {
  resume: DesktopResearchResumeState
  onDismiss: () => void
  onContinue: () => void
}) {
  const greeting = formatResearchAbsence(resume.previousActiveAt)
  const dialogRef = useDialogKeyboard<HTMLElement>(onDismiss)
  return <div className="research-return-backdrop" role="presentation">
    <section ref={dialogRef} className="research-return-dialog" role="dialog" aria-modal="true" aria-label="欢迎回到科研现场">
      <button className="research-return-close" onClick={onDismiss} aria-label="关闭欢迎提示"><X/></button>
      <div className="research-return-orbit"><Clock3/></div>
      <p>WELCOME BACK</p>
      <h2>{greeting.message}</h2>
      <span>{greeting.firstVisit ? '这是这座研究库的第一次科研现场记录。' : `上次科研活动：${new Date(resume.previousActiveAt || '').toLocaleString('zh-CN')}`}</span>
      <div>
        <button className="outline-button" onClick={onDismiss}>先看今日科研</button>
        <button className="primary-button" onClick={onContinue}>继续上次工作 <ArrowRight/></button>
      </div>
    </section>
  </div>
}

export default function TodayResearch({
  workspace,
  papers,
  sources,
  actionPacks,
  resume,
  onContinue,
  onSaveRecord,
  onOpenTasks,
  onOpenWorkspace,
}: Props) {
  const summary = useMemo(
    () => buildTodayResearch({ workspace, papers, sources, actionPacks, resume }) as TodayResearchSummary,
    [workspace, papers, sources, actionPacks, resume],
  )
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordKind, setRecordKind] = useState<'progress' | 'problem'>('progress')
  const [recordTitle, setRecordTitle] = useState('')
  const [recordContent, setRecordContent] = useState('')
  const [recordBusy, setRecordBusy] = useState(false)
  const [recordError, setRecordError] = useState('')
  const closeRecord = useCallback(() => setRecordOpen(false), [])
  const recordDialogRef = useDialogKeyboard<HTMLElement>(closeRecord, recordOpen)

  async function saveRecord() {
    if (!recordTitle.trim()) return
    setRecordBusy(true)
    setRecordError('')
    try {
      await onSaveRecord({
        recordType: 'log',
        title: recordTitle.trim(),
        content: recordContent.trim(),
        status: recordKind === 'problem' ? 'blocked' : 'active',
        tags: [recordKind === 'problem' ? '问题' : '进展'],
      })
      setRecordOpen(false)
      setRecordTitle('')
      setRecordContent('')
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : '科研记录保存失败。')
    } finally {
      setRecordBusy(false)
    }
  }

  return <div className="today-research" data-active-view="today">
    <section className="today-hero">
      <div>
        <p className="section-kicker">TODAY · LOCAL RESEARCH CONTEXT</p>
        <h1>今日科研</h1>
        <p>{workspace?.project.name || '当前研究库'} · 只展示真实留下的现场、下一步和待确认事项。</p>
      </div>
      <div className="today-project-state">
        <span>{workspace?.project.mode === 'execution' ? '课题执行' : '方向探索'}</span>
        <strong>{workspace?.project.stage || '探索中'}</strong>
      </div>
    </section>

    <section className="today-primary-actions" aria-label="今日科研主要动作">
      <button className="today-continue" onClick={onContinue}><ArrowRight/><span><b>继续上次工作</b><small>{summary.lastWork.title}</small></span></button>
      <button onClick={() => setRecordOpen(true)}><NotebookPen/><span><b>记录进展/问题</b><small>留下下次能接续的现场</small></span></button>
      <button onClick={onOpenTasks}><ListChecks/><span><b>查看今日研究任务</b><small>{summary.pendingAI.count ? `${summary.pendingAI.count} 条 AI 建议待确认` : '查看已确认与待处理事项'}</small></span></button>
    </section>

    <section className="today-five-answers" aria-label="今日科研五项现场">
      <article className="today-answer-card last-work" data-today-answer="last-work">
        <div className="today-answer-icon"><Clock3/></div>
        <div><small>上次工作做到哪里</small><h2>{summary.lastWork.title}</h2><p>{summary.lastWork.detail}</p></div>
        <span>{summary.resumeViewLabel}</span>
      </article>
      <article className="today-answer-card next-step" data-today-answer="next-step">
        <div className="today-answer-icon"><CheckCircle2/></div>
        <div><small>当前最重要的下一步</small><h2>{summary.nextStep.title}</h2><p>{summary.nextStep.source}</p></div>
      </article>
      <article className="today-answer-card paper" data-today-answer="half-read-paper">
        <div className="today-answer-icon"><BookOpen/></div>
        <div><small>读到一半的论文</small><h2>{summary.paper.title}</h2><p>{summary.paper.detail}</p></div>
      </article>
      <article className={`today-answer-card blocker ${summary.blocker.kind !== 'none' ? 'has-warning' : ''}`} data-today-answer="blocker">
        <div className="today-answer-icon">{summary.blocker.kind === 'none' ? <FlaskConical/> : <AlertTriangle/>}</div>
        <div><small>被阻塞的实验或需要整理的结果</small><h2>{summary.blocker.title}</h2><p>{summary.blocker.detail}</p>{summary.missingArtifactCount > 0 && <em><FileWarning/>另有 {summary.missingArtifactCount} 份原位置失效的文件/结果</em>}</div>
      </article>
      <article className="today-answer-card ai-review" data-today-answer="pending-ai">
        <div className="today-answer-icon"><Sparkles/></div>
        <div><small>等待确认的 AI 建议</small><h2>{summary.pendingAI.title}</h2><p>{summary.pendingAI.detail}</p></div>
        <span>{summary.pendingAI.count}</span>
      </article>
    </section>

    <footer className="today-secondary-entry">
      <div><ClipboardList/><span><b>需要管理课题、里程碑、Run 或实验产物？</b><small>这些完整工作面仍在，但不挤占每日入口。</small></span></div>
      <button className="text-button" onClick={onOpenWorkspace}>打开课题与实验 <ArrowRight/></button>
    </footer>

    {recordOpen && <div className="today-record-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) closeRecord() }}>
      <section ref={recordDialogRef} className="today-record-dialog" role="dialog" aria-modal="true" aria-label="记录科研进展或问题">
        <header><div><p className="section-kicker">HUMAN RESEARCH NOTE</p><h2>记录进展/问题</h2></div><button className="icon-button" onClick={closeRecord} aria-label="关闭"><X/></button></header>
        <div className="today-record-kinds"><button className={recordKind === 'progress' ? 'active' : ''} onClick={() => setRecordKind('progress')}><CheckCircle2/><b>进展</b><small>还在继续推进</small></button><button className={recordKind === 'problem' ? 'active problem' : ''} onClick={() => setRecordKind('problem')}><AlertTriangle/><b>问题/阻塞</b><small>需要后续处理</small></button></div>
        <label>一句话标题<input autoFocus value={recordTitle} maxLength={240} onChange={event => setRecordTitle(event.target.value)} placeholder={recordKind === 'problem' ? '例如：标定数据出现零点漂移' : '例如：完成基线参数复测'}/></label>
        <label>现场细节<textarea value={recordContent} maxLength={100000} onChange={event => setRecordContent(event.target.value)} placeholder="写下真实观察、文件位置或下一步；不知道的地方可以留空。"/></label>
        {recordError && <p className="today-record-error"><AlertTriangle/>{recordError}</p>}
        <footer><button className="outline-button" onClick={closeRecord}>取消</button><button className="primary-button" disabled={!recordTitle.trim() || recordBusy} onClick={() => void saveRecord()}>{recordBusy ? '正在保存…' : '保存到当前研究库'}</button></footer>
      </section>
    </div>}
  </div>
}
