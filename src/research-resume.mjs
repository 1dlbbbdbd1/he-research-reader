const VIEW_LABELS = {
  today: '今日科研',
  'research-workspace': '课题与实验',
  'research-review': '复盘与写作',
  sources: '资料库',
  reader: '阅读器',
  dashboard: '文献综述',
  evidence: '证据关系',
  actions: '研究任务',
}

const READER_MODE_LABELS = {
  original: 'PDF 原文',
  markdown: '整理稿',
  parallel: '版面对照',
  bilingual: '中英对照',
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function byNewest(left, right) {
  return text(right.updatedAt || right.startedAt || right.occurredAt || right.createdAt)
    .localeCompare(text(left.updatedAt || left.startedAt || left.occurredAt || left.createdAt))
}

export function formatResearchAbsence(previousActiveAt, currentAt = new Date().toISOString()) {
  const previous = previousActiveAt ? new Date(previousActiveAt) : undefined
  const current = new Date(currentAt)
  if (!previous || Number.isNaN(previous.valueOf()) || Number.isNaN(current.valueOf()) || current <= previous) {
    return {
      firstVisit: true,
      durationLabel: '第一次见面',
      message: '研究库已经准备好。今天从一件最重要的事开始。',
    }
  }
  const minutes = Math.max(0, Math.floor((current.valueOf() - previous.valueOf()) / 60_000))
  let durationLabel
  if (minutes < 1) durationLabel = '不到 1 分钟'
  else if (minutes < 60) durationLabel = `${minutes} 分钟`
  else if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    durationLabel = `${hours} 小时${remainder ? ` ${remainder} 分钟` : ''}`
  } else {
    const days = Math.floor(minutes / (24 * 60))
    const hours = Math.floor((minutes % (24 * 60)) / 60)
    durationLabel = `${days} 天${days < 7 && hours ? ` ${hours} 小时` : ''}`
  }
  return {
    firstVisit: false,
    durationLabel,
    message: `这里等了你 ${durationLabel}，终于回来了。`,
  }
}

export function buildTodayResearch({ workspace, papers = [], sources = [], actionPacks = [], resume } = {}) {
  const runs = [...(workspace?.runs ?? [])].sort(byNewest)
  const records = [...(workspace?.records ?? [])].sort(byNewest)
  const milestones = [...(workspace?.milestones ?? [])].sort(byNewest)
  const artifacts = workspace?.artifacts ?? []
  const source = sources.find(item => item.id === resume?.sourceId)
  const paperForSource = papers.find(item => item.sourceId === source?.id)
  const activeRun = runs.find(item => item.id === resume?.activeRunId)
    ?? runs.find(item => item.outcome === 'running')
    ?? runs.find(item => item.outcome === 'planned')

  let lastWork
  if (resume?.activeView === 'reader' && source) {
    const page = Number.isInteger(resume.pageNumber) ? `第 ${resume.pageNumber} 页` : '页码待记录'
    const mode = READER_MODE_LABELS[resume.readerMode] ?? '阅读模式'
    lastWork = {
      kind: 'paper',
      title: text(paperForSource?.title, source.name),
      detail: `${page} · ${mode}`,
      sourceId: source.id,
      pageNumber: resume.pageNumber,
    }
  } else if (activeRun) {
    lastWork = {
      kind: 'run',
      title: activeRun.title,
      detail: activeRun.outcome === 'running' ? '进行中的 Run' : '尚未开始的 Run',
      runId: activeRun.id,
    }
  } else {
    const latest = records[0] ?? runs[0]
    lastWork = latest
      ? { kind: 'record', title: latest.title, detail: `上次位于${VIEW_LABELS[resume?.activeView] ?? '研究现场'}` }
      : { kind: 'empty', title: '尚未留下研究现场', detail: '记录第一条进展后，这里会成为下次继续工作的入口。' }
  }

  const nextRun = [activeRun, ...runs].find((item, index, all) => item?.nextStep && all.indexOf(item) === index)
  const activeRecord = records.find(item => ['active', 'planned'].includes(item.status))
  const activeMilestone = milestones.find(item => ['active', 'planned'].includes(item.status))
  const nextStep = nextRun?.nextStep
    ? { title: nextRun.nextStep, source: `Run · ${nextRun.title}`, runId: nextRun.id }
    : activeRecord
      ? { title: activeRecord.title, source: '进行中的科研记录', recordId: activeRecord.id }
      : activeMilestone
        ? { title: activeMilestone.acceptanceCriteria?.[0] || activeMilestone.title, source: `里程碑 · ${activeMilestone.title}`, milestoneId: activeMilestone.id }
        : { title: '尚未记录下一步', source: '用“记录进展/问题”留下一个可执行动作。' }

  const readingPapers = papers.filter(item => ['title_only', 'skimming', 'reading'].includes(item.readingState?.readingStatus))
  const halfRead = readingPapers.find(item => item.sourceId === resume?.sourceId) ?? readingPapers[0]
  const paper = halfRead
    ? {
        title: halfRead.title,
        detail: halfRead.readingState?.lastPage
          ? `读到第 ${halfRead.readingState.lastPage}${halfRead.readingState.totalPages ? ` / ${halfRead.readingState.totalPages}` : ''} 页`
          : '阅读位置尚未形成页码',
        sourceId: halfRead.sourceId,
        pageNumber: halfRead.readingState?.lastPage,
      }
    : { title: '没有读到一半的论文', detail: '开始阅读后会在这里保留论文、页码和模式。' }

  const missingArtifacts = artifacts.filter(item => ['missing', 'denied'].includes(item.existsState))
  const blockedRecord = records.find(item => item.status === 'blocked')
  const blockedMilestone = milestones.find(item => item.status === 'blocked')
  const anomalousRun = runs.find(item => item.anomaly || ['failure', 'invalid', 'interrupted'].includes(item.outcome))
  const blocker = blockedRecord
    ? { title: blockedRecord.title, detail: text(blockedRecord.content, '这条科研记录已标记为受阻。'), kind: 'record' }
    : blockedMilestone
      ? { title: blockedMilestone.title, detail: text(blockedMilestone.description, '这个里程碑已标记为受阻。'), kind: 'milestone' }
      : anomalousRun
        ? { title: anomalousRun.title, detail: text(anomalousRun.anomaly, '这个 Run 尚未得到有效结果。'), kind: 'run', runId: anomalousRun.id }
        : missingArtifacts.length
          ? { title: `${missingArtifacts.length} 份文件或结果需要整理`, detail: missingArtifacts.slice(0, 2).map(item => item.label).join('、'), kind: 'artifact' }
          : { title: '当前没有已记录的阻塞', detail: '没有结果、方向不匹配和暂时放弃也可以如实记录。', kind: 'none' }

  const pendingAIPacks = actionPacks.filter(pack => pack.createdBy === 'ai' && pack.proposedCount > 0 && pack.status !== 'dismissed')
    .sort(byNewest)
  const pendingCount = pendingAIPacks.reduce((total, pack) => total + pack.proposedCount, 0)
  const pendingAI = pendingAIPacks[0]
    ? { title: pendingAIPacks[0].title, detail: `${pendingCount} 条 AI 建议等待人工确认`, count: pendingCount, packId: pendingAIPacks[0].id }
    : { title: '没有待确认的 AI 建议', detail: 'AI 建议不会自动进入正式记录。', count: 0 }

  return {
    lastWork,
    nextStep,
    paper,
    blocker,
    pendingAI,
    activeRun,
    missingArtifactCount: missingArtifacts.length,
    resumeViewLabel: VIEW_LABELS[resume?.activeView] ?? '今日科研',
  }
}
