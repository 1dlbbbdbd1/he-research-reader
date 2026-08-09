const assert = require('node:assert/strict')
const test = require('node:test')

test('返场提示按真实上次活动时间生成，不伪造首次间隔', async () => {
  const { formatResearchAbsence } = await import('../src/research-resume.mjs')
  assert.deepEqual(formatResearchAbsence(undefined, '2026-08-08T10:00:00.000Z'), {
    firstVisit: true,
    durationLabel: '第一次见面',
    message: '研究库已经准备好。今天从一件最重要的事开始。',
  })
  assert.deepEqual(formatResearchAbsence('2026-08-08T07:45:00.000Z', '2026-08-08T10:00:00.000Z'), {
    firstVisit: false,
    durationLabel: '2 小时 15 分钟',
    message: '这里等了你 2 小时 15 分钟，终于回来了。',
  })
  assert.equal(formatResearchAbsence('2026-08-01T10:00:00.000Z', '2026-08-08T10:00:00.000Z').durationLabel, '7 天')
})

test('今日科研只从已保存论文、Run、阻塞和 AI 行动包生成五项现场', async () => {
  const { buildTodayResearch } = await import('../src/research-resume.mjs')
  const result = buildTodayResearch({
    resume: { activeView: 'reader', sourceId: 'source-1', pageNumber: 7, readerMode: 'markdown', activeRunId: 'run-1' },
    sources: [{ id: 'source-1', name: 'paper.pdf' }],
    papers: [{ id: 'paper-1', sourceId: 'source-1', title: '真实论文', readingState: { readingStatus: 'reading', lastPage: 7, totalPages: 12 } }],
    workspace: {
      records: [{ id: 'blocked-1', title: '传感器输出异常', content: '零点漂移尚未定位', status: 'blocked', updatedAt: '2026-08-08T09:00:00Z' }],
      milestones: [],
      runs: [{ id: 'run-1', title: '装配基线', outcome: 'running', nextStep: '只改变刚度参数再跑一次', startedAt: '2026-08-08T08:00:00Z' }],
      artifacts: [{ id: 'file-1', label: 'run.csv', existsState: 'missing' }],
    },
    actionPacks: [{ id: 'pack-1', title: '核对工况', createdBy: 'ai', status: 'draft', proposedCount: 2, updatedAt: '2026-08-08T09:30:00Z' }],
  })
  assert.equal(result.lastWork.title, '真实论文')
  assert.equal(result.lastWork.detail, '第 7 页 · 整理稿')
  assert.equal(result.nextStep.title, '只改变刚度参数再跑一次')
  assert.equal(result.paper.detail, '读到第 7 / 12 页')
  assert.equal(result.blocker.title, '传感器输出异常')
  assert.equal(result.pendingAI.count, 2)
  assert.equal(result.missingArtifactCount, 1)
  assert.equal(JSON.stringify(result).includes('%'), false)
})

test('今日科研空状态诚实显示未记录，不编造课题和进度', async () => {
  const { buildTodayResearch } = await import('../src/research-resume.mjs')
  const result = buildTodayResearch()
  assert.equal(result.lastWork.kind, 'empty')
  assert.equal(result.nextStep.title, '尚未记录下一步')
  assert.equal(result.paper.title, '没有读到一半的论文')
  assert.equal(result.pendingAI.count, 0)
})
