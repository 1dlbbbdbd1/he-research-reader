import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, CircleDot,
  Clock3, FilePlus2, Files, FlaskConical, FolderOpen, GitBranch, History, ListChecks,
  Download, Pencil, Plus, RotateCcw, Sparkles, Target, X,
} from 'lucide-react'
import { synthesizeResearchWorkspace, type ResearchWorkspaceSynthesis } from './research-synthesis.mjs'
import { useDialogKeyboard } from './use-dialog-keyboard'

type PaperSummary = { id: string; readingState: { readingStatus: string } }
type SourceSummary = { id: string; status: string }

type Props = {
  workspace?: DesktopResearchWorkspace
  fallbackName: string
  papers: PaperSummary[]
  sources: SourceSummary[]
  onSaveProject: (project: Pick<DesktopResearchProject, 'name' | 'researchQuestion' | 'currentHypothesis' | 'stage' | 'mode'>) => Promise<void>
  onSaveMilestone: (input: DesktopResearchMilestoneInput) => Promise<void>
  onSaveRun: (input: DesktopResearchRunInput) => Promise<DesktopResearchWorkspace | void>
  onSaveTemplate: (input: DesktopResearchRunTemplateInput) => Promise<void>
  onRegisterArtifact: (runId: string, kind: 'file' | 'directory') => Promise<void>
  onExportRun: (runId: string) => Promise<void>
  onOpenPapers: () => void
  onOpenReports: () => void
  onAskAgent: () => void
}

const outcomes: Array<{ value: DesktopResearchRunOutcome; label: string }> = [
  { value: 'planned', label: '计划中' },
  { value: 'running', label: '进行中' },
  { value: 'success', label: '结果有效' },
  { value: 'failure', label: '未达到预期' },
  { value: 'invalid', label: '数据无效' },
  { value: 'interrupted', label: '中断' },
]

const statusLabel: Record<DesktopResearchRecordStatus, string> = {
  planned: '待开始', active: '进行中', completed: '已完成', blocked: '受阻', archived: '已归档',
}

const outcomeLabel = Object.fromEntries(outcomes.map(item => [item.value, item.label])) as Record<DesktopResearchRunOutcome, string>

const emptyProject = (name: string): DesktopResearchProject => ({
  id: 'preview-project', name: name || '我的工程研究', researchQuestion: '', currentHypothesis: '',
  stage: '探索中', mode: 'exploration', updatedAt: '',
})

const projectDraftFrom = (project: DesktopResearchProject) => ({
  name: project.name,
  researchQuestion: project.researchQuestion,
  currentHypothesis: project.currentHypothesis,
  stage: project.stage,
  mode: project.mode,
})

const emptyMilestone = (): DesktopResearchMilestoneInput & { criteriaText: string } => ({
  title: '', description: '', status: 'active', acceptanceCriteria: [], criteriaText: '', dueAt: '',
})

type RunDraft = {
  id?: string
  title: string
  templateId: string
  milestoneId: string
  outcome: DesktopResearchRunOutcome
  purpose: string
  hypothesis: string
  variablesText: string
  command: string
  environment: string
  procedure: string
  observations: string
  anomaly: string
  nextStep: string
}

const emptyRun = (milestoneId = ''): RunDraft => ({
  title: '', templateId: '', milestoneId, outcome: 'success', purpose: '', hypothesis: '', variablesText: '',
  command: '', environment: '', procedure: '', observations: '', anomaly: '', nextStep: '',
})

function parseVariableLines(value: string): DesktopResearchVariableChange[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [namePart, rest = ''] = line.split(/[:=：]/, 2)
    const unitMatch = rest.trim().match(/^(.*?)(?:\s*\[([^\]]+)\])?$/)
    return { name: namePart.trim(), currentValue: unitMatch?.[1]?.trim() ?? rest.trim(), unit: unitMatch?.[2]?.trim() || undefined }
  }).filter(item => item.name && item.currentValue)
}

function variablesToText(value: DesktopResearchVariableChange[]) {
  return value.map(item => `${item.name} = ${item.currentValue}${item.unit ? ` [${item.unit}]` : ''}`).join('\n')
}

function formatWhen(value?: string) {
  if (!value) return '未记录时间'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ResearchCommandCenter({
  workspace: data, fallbackName, papers, sources, onSaveProject, onSaveMilestone, onSaveRun, onSaveTemplate,
  onRegisterArtifact, onExportRun, onOpenPapers, onOpenReports, onAskAgent,
}: Props) {
  const project = data?.project ?? emptyProject(fallbackName)
  const milestones = data?.milestones ?? []
  const runs = data?.runs ?? []
  const artifacts = data?.artifacts ?? []
  const templates = data?.runTemplates ?? []
  const summary = useMemo(
    () => synthesizeResearchWorkspace(data as unknown as Parameters<typeof synthesizeResearchWorkspace>[0]) as ResearchWorkspaceSynthesis,
    [data],
  )
  const [projectEditor, setProjectEditor] = useState(false)
  const [projectDraft, setProjectDraft] = useState(projectDraftFrom(project))
  const [milestoneDraft, setMilestoneDraft] = useState<ReturnType<typeof emptyMilestone>>()
  const [runDraft, setRunDraft] = useState<RunDraft>()
  const [templateDraft, setTemplateDraft] = useState({ name: '', category: '自定义', description: '', purpose: '', procedure: '' })
  const [templateEditor, setTemplateEditor] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [advancedRun, setAdvancedRun] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectEditor) setProjectDraft(projectDraftFrom(project))
  }, [project.id, project.name, project.researchQuestion, project.currentHypothesis, project.stage, project.mode, project.updatedAt, projectEditor])

  const activeMilestone = milestones.find(item => item.status === 'active') ?? milestones.find(item => item.status === 'planned')
  const selectedRun = runs.find(item => item.id === selectedRunId)
  const selectedArtifacts = selectedRun ? artifacts.filter(item => item.runId === selectedRun.id) : []
  const completedPapers = papers.filter(paper => paper.readingState.readingStatus === 'finished').length
  const parsedSources = sources.filter(source => source.status === '已解析').length

  function beginRun(template?: DesktopResearchRunTemplate) {
    const base = emptyRun(activeMilestone?.id)
    if (!template) {
      setRunDraft(base)
    } else {
      setRunDraft({
        ...base,
        templateId: template.id,
        title: `${template.name} · ${new Date().toLocaleDateString('zh-CN')}`,
        purpose: template.defaults.purpose ?? '',
        hypothesis: template.defaults.hypothesis ?? '',
        variablesText: variablesToText(template.defaults.changedVariables ?? []),
        command: template.defaults.command ?? '',
        environment: template.defaults.environment ?? '',
        procedure: template.defaults.procedure ?? '',
        observations: template.defaults.observations ?? '',
        anomaly: template.defaults.anomaly ?? '',
        nextStep: template.defaults.nextStep ?? '',
      })
    }
    setAdvancedRun(false)
    setError('')
  }

  function editRun(run: DesktopResearchRun) {
    setRunDraft({
      id: run.id, title: run.title, templateId: run.templateId ?? '', milestoneId: run.milestoneId ?? '', outcome: run.outcome,
      purpose: run.purpose, hypothesis: run.hypothesis, variablesText: variablesToText(run.changedVariables), command: run.command,
      environment: run.environment, procedure: run.procedure, observations: run.observations, anomaly: run.anomaly, nextStep: run.nextStep,
    })
    setAdvancedRun(Boolean(run.command || run.environment || run.procedure || run.hypothesis))
    setSelectedRunId(undefined)
  }

  async function execute(task: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setError('')
    try { await task() } catch (caught) { setError(caught instanceof Error ? caught.message : fallback) }
    finally { setBusy(false) }
  }

  async function saveProjectDraft() {
    await execute(async () => {
      await onSaveProject(projectDraft)
      setProjectEditor(false)
    }, '课题定位保存失败。')
  }

  async function saveMilestoneDraft() {
    if (!milestoneDraft?.title?.trim()) return
    await execute(async () => {
      await onSaveMilestone({
        id: milestoneDraft.id,
        title: milestoneDraft.title?.trim(),
        description: milestoneDraft.description?.trim(),
        status: milestoneDraft.status,
        dueAt: milestoneDraft.dueAt || undefined,
        acceptanceCriteria: milestoneDraft.criteriaText.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
      })
      setMilestoneDraft(undefined)
    }, '里程碑保存失败。')
  }

  async function confirmMilestone(milestone: DesktopResearchMilestone) {
    const criteria = milestone.acceptanceCriteria.length ? `\n\n验收条件：\n- ${milestone.acceptanceCriteria.join('\n- ')}` : ''
    if (!window.confirm(`确认“${milestone.title}”已达到验收条件？${criteria}\n\n这会写入正式阶段记录。`)) return
    await execute(() => onSaveMilestone({ ...milestone, status: 'completed' }), '里程碑确认失败。')
  }

  async function saveRunDraft() {
    if (!runDraft?.title.trim()) return
    await execute(async () => {
      await onSaveRun({
        id: runDraft.id,
        title: runDraft.title.trim(),
        templateId: runDraft.templateId || undefined,
        milestoneId: runDraft.milestoneId || undefined,
        outcome: runDraft.outcome,
        purpose: runDraft.purpose.trim(),
        hypothesis: runDraft.hypothesis.trim(),
        changedVariables: parseVariableLines(runDraft.variablesText),
        command: runDraft.command.trim(),
        environment: runDraft.environment.trim(),
        procedure: runDraft.procedure.trim(),
        observations: runDraft.observations.trim(),
        anomaly: runDraft.anomaly.trim(),
        nextStep: runDraft.nextStep.trim(),
        endedAt: runDraft.outcome === 'running' || runDraft.outcome === 'planned' ? undefined : new Date().toISOString(),
      })
      setRunDraft(undefined)
    }, '测试记录保存失败。')
  }

  async function saveTemplateDraft() {
    if (!templateDraft.name.trim()) return
    await execute(async () => {
      await onSaveTemplate({
        name: templateDraft.name.trim(), category: templateDraft.category.trim(), description: templateDraft.description.trim(),
        defaults: { purpose: templateDraft.purpose.trim(), procedure: templateDraft.procedure.trim() },
      })
      setTemplateEditor(false)
      setTemplateDraft({ name: '', category: '自定义', description: '', purpose: '', procedure: '' })
    }, '模板保存失败。')
  }

  return <div className="research-command-center">
    <section className="research-resume-card">
      <div className="research-resume-copy">
        <div className="research-mode-line">
          <span className={`research-mode ${project.mode}`}>{project.mode === 'exploration' ? '方向探索' : '课题执行'}</span>
          <span>{project.stage}</span>
          <span>更新于 {formatWhen(project.updatedAt)}</span>
        </div>
        <p className="section-kicker">Resume research context</p>
        <h1>{summary.resume.headline}</h1>
        <p className="research-resume-detail">
          {summary.lastActivity ? <>上次停在 <b>{summary.lastActivity.title}</b> · {formatWhen(summary.lastActivity.at)}</> : '先定义一个可检查的研究问题，或者直接登记第一次探索测试。'}
        </p>
        <div className="research-resume-signals">
          <span><Clock3/> {summary.resume.unfinishedRunCount} 次测试待收尾</span>
          <span className={summary.resume.blockerCount ? 'danger' : ''}><AlertTriangle/> {summary.resume.blockerCount} 个阻塞</span>
          <span className={summary.resume.anomalyCount ? 'warn' : ''}><CircleDot/> {summary.resume.anomalyCount} 条异常</span>
        </div>
      </div>
      <div className="research-resume-actions">
        <button className="research-primary-action" onClick={() => beginRun()}><FlaskConical/>记录一次测试<small>约 2 分钟</small></button>
        <button className="outline-button" onClick={onAskAgent}><Sparkles/>让助手检查缺口</button>
      </div>
    </section>

    <section className="research-definition-card">
      <header><div><p className="section-kicker">Research definition</p><h2>{project.name}</h2></div><button className="text-button" onClick={() => setProjectEditor(true)}><Pencil/>修改定位</button></header>
      <div className="research-definition-grid">
        <div><small>研究问题</small><p>{project.researchQuestion || '尚未确定：现在可以保留探索模式，用测试和文献逐步收敛。'}</p></div>
        <div><small>当前假设</small><p>{project.currentHypothesis || '尚未形成可证伪假设。助手会把它视为缺口，而不是替你编造结论。'}</p></div>
      </div>
      {data?.history?.length ? <footer><History/>定位修改已保留 {data.history.length} 个历史版本，不会覆盖旧结论。</footer> : null}
    </section>

    <div className={`research-command-grid ${milestones.length ? 'has-milestones' : 'is-empty'}`}>
      <section className="research-milestone-panel">
        <header><div><p className="section-kicker">Milestones</p><h2>里程碑与验收</h2></div><button className="outline-button compact" onClick={() => setMilestoneDraft(emptyMilestone())}><Plus/>新建</button></header>
        {milestones.length ? <div className="research-milestone-list">{milestones.map(milestone => {
          const runCount = runs.filter(run => run.milestoneId === milestone.id).length
          return <article key={milestone.id} className={`research-milestone-item ${milestone.status}`}>
            <div className="evidence-spine-dot"><Target/></div>
            <div className="research-milestone-body">
              <div className="research-item-meta"><span>{statusLabel[milestone.status]}</span>{milestone.dueAt && <small>截止 {milestone.dueAt}</small>}</div>
              <h3>{milestone.title}</h3>
              {milestone.description && <p>{milestone.description}</p>}
              <ul>{milestone.acceptanceCriteria.map(criterion => <li key={criterion}><ListChecks/>{criterion}</li>)}</ul>
              <footer><span>{runCount} 次测试关联</span><button onClick={() => setMilestoneDraft({ ...milestone, criteriaText: milestone.acceptanceCriteria.join('\n') })}>编辑</button>{milestone.status !== 'completed' && <button className="confirm" onClick={() => void confirmMilestone(milestone)}>确认达标</button>}</footer>
            </div>
          </article>
        })}</div> : <div className="research-guided-empty"><Target/><strong>先定义“怎样才算阶段完成”</strong><p>里程碑不填百分比，只记录可检查的验收条件。</p><button onClick={() => setMilestoneDraft(emptyMilestone())}>创建第一个里程碑 <ArrowRight/></button></div>}
      </section>

      <aside className="research-next-panel">
        <section>
          <div className="research-panel-title"><p className="section-kicker">Evidence gaps</p><h2>助手发现的缺口</h2></div>
          {summary.suggestedActions.length ? <div className="research-suggestion-list">{summary.suggestedActions.slice(0, 5).map(action => <article key={action.id}><Sparkles/><div><strong>{action.title}</strong><p>{action.rationale}</p><small>建议 · 待你确认</small></div></article>)}</div> : <div className="research-mini-empty"><Check/>当前结构化记录没有明显断点。继续登记真实测试与产物。</div>}
          <button className="text-button" onClick={onAskAgent}>结合文献继续审视 <ArrowRight/></button>
        </section>
        <section className="research-literature-bridge">
          <div className="research-panel-title"><p className="section-kicker">Literature evidence</p><h2>文献证据入口</h2></div>
          <p><b>{completedPapers}</b> / {papers.length} 篇完成精读</p>
          <small>{parsedSources} 份资料已解析，可被科研助手检索并回到原文。</small>
          <button className="text-button" onClick={onOpenPapers}><BookOpen/>进入资料库</button>
        </section>
      </aside>
    </div>

    <section className="research-run-workbench">
      <header>
        <div><p className="section-kicker">Run ledger</p><h2>测试记录与证据链</h2><p>一次运行是最小记录单位：为什么做、改了什么、观察到什么、原始数据在哪里。</p></div>
        <button className="primary-button" onClick={() => beginRun()}><Plus/>记录测试</button>
      </header>
      <div className="research-template-strip">
        <span>从模板开始</span>
        {templates.map(template => <button key={template.id} onClick={() => beginRun(template)}><FlaskConical/><b>{template.name}</b><small>{template.category}</small></button>)}
        <button className="new-template" onClick={() => setTemplateEditor(true)}><Plus/>自定义模板</button>
      </div>
      {runs.length ? <div className="research-run-list">{runs.map(run => {
        const linkedArtifacts = artifacts.filter(artifact => artifact.runId === run.id)
        const milestone = milestones.find(item => item.id === run.milestoneId)
        return <article key={run.id} className={`research-run-row outcome-${run.outcome}`} onClick={() => setSelectedRunId(run.id)}>
          <div className="run-evidence-node"><FlaskConical/></div>
          <div className="research-run-main"><div className="research-item-meta"><span>{outcomeLabel[run.outcome]}</span>{milestone && <small>{milestone.title}</small>}</div><h3>{run.title}</h3><p>{run.observations || run.purpose || '尚未填写观察结果。'}</p></div>
          <div className="research-run-proof"><strong>{linkedArtifacts.length}</strong><small>份产物</small></div>
          <div className="research-run-time"><span>{formatWhen(run.startedAt)}</span>{run.anomaly && <b><AlertTriangle/>有异常</b>}</div>
          <ChevronRight/>
        </article>
      })}</div> : <div className="research-guided-empty wide"><FlaskConical/><strong>还没有可追溯的测试</strong><p>选择 ROS、Python、仿真/CAE、数据分析、实物试验或通用模板，也可以自己定义。</p><button onClick={() => beginRun(templates[0])}>登记第一次测试 <ArrowRight/></button></div>}
    </section>

    <section className="research-evidence-spine">
      <div><span><Target/></span><b>里程碑</b><small>{activeMilestone?.title || '待定义'}</small></div><i/>
      <div><span><FlaskConical/></span><b>测试运行</b><small>{runs.length} 次</small></div><i/>
      <div><span><Files/></span><b>原始产物</b><small>{artifacts.filter(item => item.existsState === 'found').length} 份可定位</small></div><i/>
      <div><span><GitBranch/></span><b>结论与写作</b><small>逐条核验证据</small></div>
      <button onClick={onOpenReports}>进入复盘与写作 <ArrowRight/></button>
    </section>

    {error && <div className="research-global-error"><AlertTriangle/>{error}<button onClick={() => setError('')}><X/></button></div>}

    {projectEditor && <Modal title="修改课题定位" kicker="Human confirmed project state" onClose={() => setProjectEditor(false)}>
      <div className="research-mode-picker"><button className={projectDraft.mode === 'exploration' ? 'active' : ''} onClick={() => setProjectDraft({ ...projectDraft, mode: 'exploration', stage: projectDraft.stage || '探索中' })}><Sparkles/><b>方向探索</b><small>暂未分配具体课题，用文献和小测试收敛方向</small></button><button className={projectDraft.mode === 'execution' ? 'active' : ''} onClick={() => setProjectDraft({ ...projectDraft, mode: 'execution' })}><Target/><b>课题执行</b><small>已有研究问题，按里程碑推进并保留证据</small></button></div>
      <label>课题名称<input value={projectDraft.name} onChange={event => setProjectDraft({ ...projectDraft, name: event.target.value })}/></label>
      <label>阶段<input value={projectDraft.stage} onChange={event => setProjectDraft({ ...projectDraft, stage: event.target.value })} placeholder="例如 方案设计、算法验证、论文写作"/></label>
      <label>研究问题<textarea value={projectDraft.researchQuestion} onChange={event => setProjectDraft({ ...projectDraft, researchQuestion: event.target.value })} placeholder="还不确定时可以留空，不会强迫你编造课题。"/></label>
      <label>当前假设<textarea value={projectDraft.currentHypothesis} onChange={event => setProjectDraft({ ...projectDraft, currentHypothesis: event.target.value })} placeholder="写成能被数据或文献推翻的判断。"/></label>
      <ModalActions busy={busy} disabled={!projectDraft.name.trim()} onCancel={() => setProjectEditor(false)} onSave={() => void saveProjectDraft()} saveLabel="确认并保存定位"/>
    </Modal>}

    {milestoneDraft && <Modal title={milestoneDraft.id ? '编辑里程碑' : '新建里程碑'} kicker="Measurable milestone" onClose={() => setMilestoneDraft(undefined)}>
      <label>里程碑名称<input autoFocus value={milestoneDraft.title ?? ''} onChange={event => setMilestoneDraft({ ...milestoneDraft, title: event.target.value })} placeholder="例如 ROS2 基线控制器可稳定复现"/></label>
      <label>状态<select value={milestoneDraft.status} onChange={event => setMilestoneDraft({ ...milestoneDraft, status: event.target.value as DesktopResearchRecordStatus })}><option value="planned">待开始</option><option value="active">进行中</option><option value="blocked">受阻</option><option value="completed">已完成</option></select></label>
      <label>说明<textarea value={milestoneDraft.description ?? ''} onChange={event => setMilestoneDraft({ ...milestoneDraft, description: event.target.value })} placeholder="这个阶段要回答什么问题？"/></label>
      <label>验收条件（每行一条）<textarea className="tall" value={milestoneDraft.criteriaText} onChange={event => setMilestoneDraft({ ...milestoneDraft, criteriaText: event.target.value })} placeholder={'三次相同参数运行结果一致\n异常时能找到完整 rosbag 与日志\n关键指标达到预设范围'}/></label>
      <label>目标日期（可选）<input type="date" value={milestoneDraft.dueAt ?? ''} onChange={event => setMilestoneDraft({ ...milestoneDraft, dueAt: event.target.value })}/></label>
      <ModalActions busy={busy} disabled={!milestoneDraft.title?.trim()} onCancel={() => setMilestoneDraft(undefined)} onSave={() => void saveMilestoneDraft()} saveLabel="保存里程碑"/>
    </Modal>}

    {runDraft && <Modal title={runDraft.id ? '补充测试记录' : '记录一次测试'} kicker="Two-minute research run" onClose={() => setRunDraft(undefined)} wide>
      <div className="research-run-form-head"><label>标题<input autoFocus value={runDraft.title} onChange={event => setRunDraft({ ...runDraft, title: event.target.value })} placeholder="例如 调低局部规划器最大速度后复测"/></label><label>结果<select value={runDraft.outcome} onChange={event => setRunDraft({ ...runDraft, outcome: event.target.value as DesktopResearchRunOutcome })}>{outcomes.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label></div>
      <div className="research-form-grid"><label>所属里程碑<select value={runDraft.milestoneId} onChange={event => setRunDraft({ ...runDraft, milestoneId: event.target.value })}><option value="">暂不关联</option>{milestones.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>采用模板<select value={runDraft.templateId} onChange={event => { const next = templates.find(item => item.id === event.target.value); if (next) beginRun(next); else setRunDraft({ ...runDraft, templateId: '' }) }}><option value="">无模板</option>{templates.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
      <label>为什么做<textarea value={runDraft.purpose} onChange={event => setRunDraft({ ...runDraft, purpose: event.target.value })} placeholder="本次测试想回答什么？"/></label>
      <label>改了哪些参数（每行“名称 = 值 [单位]”）<textarea value={runDraft.variablesText} onChange={event => setRunDraft({ ...runDraft, variablesText: event.target.value })} placeholder={'max_vel_x = 0.35 [m/s]\ninflation_radius = 0.55 [m]'}/></label>
      <div className="research-form-grid"><label>观察与结果<textarea value={runDraft.observations} onChange={event => setRunDraft({ ...runDraft, observations: event.target.value })} placeholder="只写你实际观察到的内容。"/></label><label>异常或偏离<textarea value={runDraft.anomaly} onChange={event => setRunDraft({ ...runDraft, anomaly: event.target.value })} placeholder="没有异常可以留空。"/></label></div>
      <label>下一步<textarea value={runDraft.nextStep} onChange={event => setRunDraft({ ...runDraft, nextStep: event.target.value })} placeholder="下一次最值得验证什么？"/></label>
      <button className="research-advanced-toggle" onClick={() => setAdvancedRun(open => !open)}><ChevronDown className={advancedRun ? 'open' : ''}/> {advancedRun ? '收起复现信息' : '补充命令、环境与过程（推荐）'}</button>
      {advancedRun && <div className="research-advanced-fields"><label>可证伪假设<textarea value={runDraft.hypothesis} onChange={event => setRunDraft({ ...runDraft, hypothesis: event.target.value })}/></label><label>运行命令或入口<textarea className="code" value={runDraft.command} onChange={event => setRunDraft({ ...runDraft, command: event.target.value })} placeholder="ros2 launch ... / python ..."/></label><label>环境与版本<textarea value={runDraft.environment} onChange={event => setRunDraft({ ...runDraft, environment: event.target.value })} placeholder="ROS 2 发行版、工作空间、代码提交、设备、仿真器…"/></label><label>操作过程<textarea value={runDraft.procedure} onChange={event => setRunDraft({ ...runDraft, procedure: event.target.value })}/></label></div>}
      <p className="research-form-notice"><Check/>保存后可继续关联文件或目录。原文件留在原位置，应用只登记路径、状态与哈希。</p>
      <ModalActions busy={busy} disabled={!runDraft.title.trim()} onCancel={() => setRunDraft(undefined)} onSave={() => void saveRunDraft()} saveLabel="保存本次测试"/>
    </Modal>}

    {templateEditor && <Modal title="自定义测试模板" kicker="Reusable engineering workflow" onClose={() => setTemplateEditor(false)}>
      <div className="research-form-grid"><label>模板名称<input value={templateDraft.name} onChange={event => setTemplateDraft({ ...templateDraft, name: event.target.value })} placeholder="例如 机器人导航参数扫描"/></label><label>类别<input value={templateDraft.category} onChange={event => setTemplateDraft({ ...templateDraft, category: event.target.value })} placeholder="ROS / CAE / 实物试验…"/></label></div>
      <label>适用说明<textarea value={templateDraft.description} onChange={event => setTemplateDraft({ ...templateDraft, description: event.target.value })}/></label>
      <label>默认目的<textarea value={templateDraft.purpose} onChange={event => setTemplateDraft({ ...templateDraft, purpose: event.target.value })}/></label>
      <label>默认过程<textarea className="tall" value={templateDraft.procedure} onChange={event => setTemplateDraft({ ...templateDraft, procedure: event.target.value })}/></label>
      <ModalActions busy={busy} disabled={!templateDraft.name.trim()} onCancel={() => setTemplateEditor(false)} onSave={() => void saveTemplateDraft()} saveLabel="保存到当前课题"/>
    </Modal>}

    {selectedRun && <Modal title={selectedRun.title} kicker="Traceable run evidence" onClose={() => setSelectedRunId(undefined)} wide>
      <div className="research-run-detail-summary"><span className={`outcome-${selectedRun.outcome}`}>{outcomeLabel[selectedRun.outcome]}</span><small>{formatWhen(selectedRun.startedAt)}</small>{!['planned', 'running'].includes(selectedRun.outcome) && <button className="text-button" disabled={busy} onClick={() => void execute(() => onExportRun(selectedRun.id), '实验复盘导出失败。')}><Download/>导出复盘</button>}<button className="text-button" onClick={() => editRun(selectedRun)}><Pencil/>补充记录</button></div>
      <div className="research-run-detail-grid"><div><small>目的</small><p>{selectedRun.purpose || '未记录'}</p></div><div><small>假设</small><p>{selectedRun.hypothesis || '未记录'}</p></div><div><small>观察</small><p>{selectedRun.observations || '未记录'}</p></div><div><small>异常</small><p>{selectedRun.anomaly || '无'}</p></div><div><small>下一步</small><p>{selectedRun.nextStep || '未记录'}</p></div><div><small>环境</small><p>{selectedRun.environment || '未记录'}</p></div></div>
      {selectedRun.changedVariables.length > 0 && <div className="research-variable-table">{selectedRun.changedVariables.map((item, index) => <div key={`${item.name}-${index}`}><b>{item.name}</b><span>{item.previousValue ? `${item.previousValue} → ` : ''}{item.currentValue} {item.unit}</span></div>)}</div>}
      <section className="research-artifact-section"><header><div><p className="section-kicker">Original evidence</p><h3>关联数据与文件</h3></div><div><button className="outline-button compact" onClick={() => void execute(() => onRegisterArtifact(selectedRun.id, 'file'), '文件登记失败。')}><FilePlus2/>登记文件</button><button className="outline-button compact" onClick={() => void execute(() => onRegisterArtifact(selectedRun.id, 'directory'), '目录登记失败。')}><FolderOpen/>登记目录</button></div></header>
        {selectedArtifacts.length ? <div className="research-artifact-list">{selectedArtifacts.map(artifact => <article key={artifact.id} className={artifact.existsState}><Files/><div><strong>{artifact.label}</strong><code>{artifact.filePath}</code><small>{artifact.existsState === 'found' ? `原位置可用${artifact.contentSha256 ? ` · SHA-256 ${artifact.contentSha256.slice(0, 12)}…` : ''}` : artifact.existsState === 'missing' ? '原位置已找不到，请重新关联' : '当前无权访问原位置'}</small></div><span>{artifact.role}</span></article>)}</div> : <div className="research-mini-empty"><Files/>尚未关联原始数据、图表、日志或工程目录。</div>}
      </section>
    </Modal>}
  </div>
}

function Modal({ title, kicker, onClose, wide, children }: { title: string; kicker: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const dialogRef = useDialogKeyboard<HTMLElement>(onClose)
  return <div className="research-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className={`research-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><div><p className="section-kicker">{kicker}</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X/></button></header>{children}</section></div>
}

function ModalActions({ busy, disabled, onCancel, onSave, saveLabel }: { busy: boolean; disabled?: boolean; onCancel: () => void; onSave: () => void; saveLabel: string }) {
  return <footer className="research-modal-actions"><button className="outline-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={busy || disabled} onClick={onSave}>{busy ? '正在保存…' : saveLabel}</button></footer>
}
