import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, CalendarClock, Check, ChevronDown, CircleSlash2,
  Clock3, History, Inbox, ListChecks, PauseCircle, Plus, Sparkles, X,
} from 'lucide-react'
import { useDialogKeyboard } from './use-dialog-keyboard'

const buckets: Array<{ value: DesktopResearchTaskStatus; label: string }> = [
  { value: 'today', label: '今日任务' },
  { value: 'inbox', label: '快速收件箱' },
  { value: 'waiting', label: '等待条件' },
  { value: 'deferred', label: '已推迟' },
  { value: 'later', label: '以后处理' },
  { value: 'completed', label: '已完成' },
  { value: 'abandoned', label: '已放弃' },
]

const sourceLabels: Record<DesktopResearchTaskSourceType, string> = {
  manual: '手动记录', paper: '论文', annotation: '批注', ai_suggestion: 'AI 建议',
  run: 'Run 下一步', anomaly: 'Run 异常', milestone: '里程碑', review_document: '复查文档',
}

type Props = {
  data?: DesktopResearchTaskList
  busy?: boolean
  error?: string
  onCreate: (input: DesktopResearchTaskInput) => Promise<void>
  onUpdate: (input: {
    taskId: string
    status?: DesktopResearchTaskStatus
    decision?: 'confirm' | 'reject'
    waitCondition?: string
    deferredUntil?: string
    note?: string
  }) => Promise<void>
  onReturn: (task: DesktopResearchTask) => void
}

function formatWhen(value?: string) {
  if (!value) return '未记录时间'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ResearchTasks({ data, busy, error, onCreate, onUpdate, onReturn }: Props) {
  const [bucket, setBucket] = useState<DesktopResearchTaskStatus>('today')
  const [quickTitle, setQuickTitle] = useState('')
  const [editor, setEditor] = useState<{ task: DesktopResearchTask; status: 'waiting' | 'deferred'; value: string }>()
  const closeEditor = useCallback(() => setEditor(undefined), [])
  const editorDialogRef = useDialogKeyboard<HTMLElement>(closeEditor, Boolean(editor))
  const tasks = useMemo(() => (data?.tasks ?? []).filter(task => task.status === bucket), [data, bucket])

  async function createQuickTask() {
    if (!quickTitle.trim()) return
    await onCreate({ title: quickTitle.trim(), status: 'inbox', sourceType: 'manual' })
    setQuickTitle('')
    setBucket('inbox')
  }

  async function changeStatus(task: DesktopResearchTask, status: DesktopResearchTaskStatus) {
    if (status === 'waiting') {
      setEditor({ task, status, value: task.waitCondition || '' })
      return
    }
    if (status === 'deferred') {
      setEditor({ task, status, value: task.deferredUntil?.slice(0, 16) || '' })
      return
    }
    await onUpdate({ taskId: task.id, status })
  }

  async function saveEditor() {
    if (!editor?.value.trim()) return
    await onUpdate(editor.status === 'waiting'
      ? { taskId: editor.task.id, status: 'waiting', waitCondition: editor.value.trim() }
      : { taskId: editor.task.id, status: 'deferred', deferredUntil: new Date(editor.value).toISOString() })
    setEditor(undefined)
  }

  return <div className="research-tasks-workspace">
    <header className="research-tasks-head">
      <div><p className="section-kicker">RESEARCH TASK / NEXT ACTION</p><h1>研究任务</h1><p>论文、批注、AI 建议、Run、异常、里程碑和复查文档共用一个任务生命周期；原来源仍保留。</p></div>
      <div className="research-task-trust"><Check/><span><b>人工确认边界</b><small>AI 建议确认前不是正式任务</small></span></div>
    </header>

    <section className="research-quick-inbox">
      <Inbox/><div><b>快速收件箱</b><small>先把下一步记下来，稍后再决定今天、以后或等待条件。</small></div>
      <input value={quickTitle} maxLength={240} onChange={event => setQuickTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void createQuickTask() }} placeholder="输入一条真实、可执行的下一步…"/>
      <button className="primary-button" disabled={!quickTitle.trim() || busy} onClick={() => void createQuickTask()}><Plus/>收下</button>
    </section>

    <nav className="research-task-buckets" aria-label="科研任务状态">
      {buckets.map(item => <button key={item.value} className={bucket === item.value ? 'active' : ''} onClick={() => setBucket(item.value)}><span>{item.label}</span><b>{data?.summary[item.value] ?? 0}</b></button>)}
    </nav>

    {error && <p className="research-task-error"><AlertTriangle/>{error}</p>}
    <section className="research-task-list" data-task-bucket={bucket}>
      {tasks.length ? tasks.map(task => <article className={`research-task-card source-${task.sourceType} ${task.approvalStatus === 'proposed' ? 'proposed' : ''}`} key={task.id} data-research-task={task.id}>
        <div className="research-task-source-icon">{task.sourceType === 'ai_suggestion' ? <Sparkles/> : task.status === 'waiting' ? <PauseCircle/> : task.status === 'deferred' ? <CalendarClock/> : <ListChecks/>}</div>
        <div className="research-task-main">
          <div className="research-task-meta"><span>{sourceLabels[task.sourceType]}</span>{task.origin === 'ai' && <em>AI 建议</em>}{task.isFormal ? <small>正式任务</small> : <small className="pending">等待人工确认</small>}</div>
          <h2>{task.title}</h2>
          {task.detail && <p>{task.detail}</p>}
          {task.waitCondition && <div className="research-task-condition"><Clock3/>等待：{task.waitCondition}</div>}
          {task.deferredUntil && <div className="research-task-condition"><CalendarClock/>恢复于：{formatWhen(task.deferredUntil)}</div>}
          <footer>
            <button className="task-source-return" onClick={() => onReturn(task)} disabled={!task.returnTarget.view}><ArrowUpRight/>返回来源</button>
            <details><summary><History/>变更历史 {task.events.length}<ChevronDown/></summary><div>{task.events.map(event => <p key={event.id}><b>{formatWhen(event.occurredAt)}</b><span>{event.note || event.eventType}</span></p>)}</div></details>
          </footer>
        </div>
        <div className="research-task-actions">
          {task.approvalStatus === 'proposed' ? <>
            <button className="confirm" disabled={busy} onClick={() => void onUpdate({ taskId: task.id, decision: 'confirm' })}><Check/>确认进入任务</button>
            <button className="reject" disabled={busy} onClick={() => void onUpdate({ taskId: task.id, decision: 'reject' })}><X/>拒绝建议</button>
          </> : <>
            {task.status !== 'completed' && task.status !== 'abandoned' && <button className="complete" disabled={busy} onClick={() => void changeStatus(task, 'completed')}><Check/>完成并回写来源</button>}
            <label>移动到<select disabled={busy} value={task.status} onChange={event => void changeStatus(task, event.target.value as DesktopResearchTaskStatus)}>{buckets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </>}
        </div>
      </article>) : <div className="research-task-empty"><CircleSlash2/><h2>这里暂时没有任务</h2><p>{bucket === 'abandoned' ? '“没有结果”“方向不匹配”“暂时放弃”都是合法科研结果，会保留在这里。' : '从快速收件箱开始，或在论文批注中选择“转为任务”。'}</p></div>}
    </section>

    {editor && <div className="research-task-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeEditor() }}><section ref={editorDialogRef} className="research-task-editor" role="dialog" aria-modal="true" aria-label={editor.status === 'waiting' ? '设置等待条件' : '设置推迟时间'}><header><h2>{editor.status === 'waiting' ? '这条任务在等待什么？' : '推迟到什么时候？'}</h2><button className="icon-button" aria-label="关闭" onClick={closeEditor}><X/></button></header>{editor.status === 'waiting' ? <textarea autoFocus value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} placeholder="例如：等待传感器返修后才能复测"/> : <input autoFocus type="datetime-local" value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })}/>}<footer><button className="outline-button" onClick={closeEditor}>取消</button><button className="primary-button" disabled={!editor.value.trim() || busy} onClick={() => void saveEditor()}>保存状态</button></footer></section></div>}
  </div>
}
