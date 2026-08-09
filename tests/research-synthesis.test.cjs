const assert = require('node:assert/strict')
const test = require('node:test')

const baseProject = {
  id: 'project-robot',
  name: '移动机器人算法探索',
  mode: 'exploration',
  stage: '方向探索',
  researchQuestion: '',
  currentHypothesis: '',
  updatedAt: '2026-08-08T08:00:00.000Z',
}

test('空白探索课题可恢复且只提出待确认的方向建议', async () => {
  const { synthesizeResearchWorkspace } = await import('../src/research-synthesis.mjs')
  const result = synthesizeResearchWorkspace({ project: baseProject, milestones: [], runs: [], artifacts: [], records: [] })

  assert.equal(result.isExplorationEmpty, true)
  assert.equal(result.currentMilestone, null)
  assert.equal(result.resume.headline, '尚未开始记录探索过程')
  assert.deepEqual(result.acceptance, { satisfied: [], missing: [] })
  assert.equal(result.suggestedActions[0].actionType, 'define_direction')
  assert.equal(result.suggestedActions[0].requiresConfirmation, true)
  assert.equal(result.suggestedActions[0].writesFormalRecord, false)
  assert.equal('progress' in result, false)
  assert.equal('percentage' in result, false)
})

test('ROS 参数 Run 恢复现场时区分已满足和缺失的里程碑验收条件', async () => {
  const { synthesizeResearchWorkspace } = await import('../src/research-synthesis.mjs')
  const workspace = {
    project: baseProject,
    milestones: [{
      id: 'milestone-baseline', title: '完成 ROS 2 导航仿真基线', status: 'active',
      acceptanceCriteria: [
        { id: 'criterion-config', text: '保存参数快照', satisfied: true, evidenceRefs: [{ kind: 'artifact', id: 'artifact-yaml' }] },
        '关联轨迹图',
      ],
      updatedAt: '2026-08-08T09:00:00.000Z',
    }],
    runs: [{
      id: 'run-ros-007', milestoneId: 'milestone-baseline', title: '提高 max_vel_x',
      purpose: '观察速度变化对跟踪误差的影响', hypothesis: '速度提高可能增加转弯超调',
      changedVariables: [{ name: 'max_vel_x', before: '0.25', after: '0.35' }],
      command: 'ros2 launch nav2_bringup tb3_simulation_launch.py', environment: 'ROS 2 / Gazebo',
      outcome: 'running', observations: '', anomaly: '', nextStep: '',
      startedAt: '2026-08-08T10:00:00.000Z', updatedAt: '2026-08-08T10:01:00.000Z',
    }],
    artifacts: [{
      id: 'artifact-yaml', runId: 'run-ros-007', label: '参数快照', role: 'config',
      filePath: 'params/nav2.yaml', existsState: 'found', updatedAt: '2026-08-08T10:02:00.000Z',
    }],
    records: [],
  }
  const result = synthesizeResearchWorkspace(workspace)

  assert.equal(result.activeMilestone.id, 'milestone-baseline')
  assert.deepEqual(result.acceptance.satisfied.map(item => item.id), ['criterion-config'])
  assert.deepEqual(result.acceptance.missing.map(item => item.label), ['关联轨迹图'])
  assert.equal(result.unfinishedRuns[0].id, 'run-ros-007')
  assert.match(result.unfinishedRuns[0].reasons.join('；'), /仍在进行/)
  assert.equal(result.lastActivity.kind, 'artifact')
  assert.equal(result.lastActivity.id, 'artifact-yaml')
  assert.equal(result.resume.headline, '上次停在“参数快照”')
  assert.ok(result.suggestedActions.some(action => action.actionType === 'close_run'))
  assert.ok(result.suggestedActions.some(action => action.actionType === 'satisfy_criterion'))
})

test('失败测试、异常和丢失产物不会被当作成功进展', async () => {
  const { synthesizeResearchWorkspace } = await import('../src/research-synthesis.mjs')
  const result = synthesizeResearchWorkspace({
    project: baseProject,
    milestones: [],
    runs: [{
      id: 'run-failure', title: '角速度参数测试', outcome: 'failure', observations: '转弯时发生振荡',
      anomaly: '轨迹超调 32%', nextStep: '', endedAt: '2026-08-08T11:00:00.000Z', updatedAt: '2026-08-08T11:01:00.000Z',
    }],
    artifacts: [{
      id: 'artifact-bag', runId: 'run-failure', label: 'ROS bag', role: 'raw_data', filePath: 'bags/run-7',
      existsState: 'missing', updatedAt: '2026-08-08T11:02:00.000Z',
    }],
    records: [],
  })

  assert.equal(result.unfinishedRuns[0].id, 'run-failure')
  assert.match(result.unfinishedRuns[0].reasons.join('；'), /后续处置/)
  assert.equal(result.anomalies[0].detail, '轨迹超调 32%')
  assert.equal(result.blockers[0].kind, 'artifact')
  assert.ok(result.suggestedActions.some(action => action.actionType === 'review_anomaly'))
  assert.ok(result.suggestedActions.some(action => action.actionType === 'relink_artifact'))
})

test('周报按固定栏目区分事实、用户观察和建议，并为每项保留来源 ID', async () => {
  const { generateTraceableResearchReport } = await import('../src/research-synthesis.mjs')
  const workspace = {
    project: { ...baseProject, mode: 'execution', researchQuestion: '速度参数如何影响轨迹误差？' },
    milestones: [{
      id: 'milestone-1', title: '形成基线', status: 'active',
      acceptanceCriteria: [{ id: 'criterion-figure', text: '关联轨迹图', satisfied: false }],
      updatedAt: '2026-08-08T09:00:00.000Z',
    }],
    runs: [
      {
        id: 'run-success', title: '基准参数测试', outcome: 'success', observations: '轨迹可重复',
        sourceIds: ['source-paper-1'], endedAt: '2026-08-08T10:00:00.000Z', updatedAt: '2026-08-08T10:01:00.000Z',
      },
      {
        id: 'run-invalid', title: '高速度测试', outcome: 'invalid', observations: '定位节点中途退出',
        anomaly: '日志出现 lost transform', nextStep: '修复 TF 后重测', endedAt: '2026-08-08T11:00:00.000Z', updatedAt: '2026-08-08T11:01:00.000Z',
      },
    ],
    artifacts: [{
      id: 'artifact-figure', runId: 'run-success', label: '基线轨迹图', role: 'figure', existsState: 'found', updatedAt: '2026-08-08T10:02:00.000Z',
    }],
    records: [
      { id: 'record-evidence', recordType: 'log', title: '补充核心论文', content: '加入速度稳定性论文', sourceIds: ['source-paper-1'], status: 'active', occurredAt: '2026-08-08T09:30:00.000Z' },
      { id: 'record-decision', recordType: 'decision', title: '保留低速基线', content: '下一阶段先使用 0.25 m/s', status: 'active', occurredAt: '2026-08-08T12:00:00.000Z' },
    ],
  }
  const first = generateTraceableResearchReport(workspace, { title: '第 1 周组会记录' })
  const second = generateTraceableResearchReport(workspace, { title: '第 1 周组会记录' })

  assert.deepEqual(first, second)
  assert.match(first.markdown, /^# 第 1 周组会记录/m)
  for (const heading of ['新增证据', '测试结果', '失败或无效测试', '产物', '决策变化', '阻塞', '下周建议']) {
    assert.match(first.markdown, new RegExp(`## ${heading}`))
  }
  assert.match(first.markdown, /\[事实\].*\[来源 run:run-success\]/)
  assert.match(first.markdown, /\[用户观察\].*轨迹可重复.*\[来源 run:run-success\]/)
  assert.match(first.markdown, /\[建议·待确认\].*\[来源/)
  assert.match(first.markdown, /\[来源 artifact:artifact-figure, run:run-success\]/)
  assert.ok(first.sections.flatMap(section => section.items).every(item => item.sourceRefs.length > 0))
})

test('论文论断在文献、Run、原始数据和图表齐全时才标记为 supported', async () => {
  const { auditClaimEvidence } = await import('../src/research-synthesis.mjs')
  const result = auditClaimEvidence({
    claims: [{
      id: 'claim-supported', text: '提高速度会增大转弯跟踪误差',
      requiredEvidence: ['bibliography', 'run', 'raw_data', 'figure'],
      evidenceRefs: [{ kind: 'bibliography', id: 'paper-1' }, { kind: 'run', id: 'run-1' }],
    }],
    bibliography: [{ id: 'paper-1', title: 'Velocity and tracking stability' }],
    runs: [{ id: 'run-1', title: '速度扫描' }],
    artifacts: [
      { id: 'raw-1', runId: 'run-1', role: 'raw_data', existsState: 'found' },
      { id: 'figure-1', runId: 'run-1', role: 'figure', existsState: 'found' },
    ],
  })

  assert.equal(result.claims[0].status, 'supported')
  assert.deepEqual(result.claims[0].missing, [])
  assert.deepEqual(result.claims[0].resolvedEvidence.map(item => item.tag), ['bibliography:paper-1', 'run:run-1'])
  assert.deepEqual(result.counts, { supported: 1, partial: 0, unsupported: 0 })
})

test('缺失图表、原始数据或物理文件时只标记 partial 并列出缺口', async () => {
  const { auditClaimEvidence } = await import('../src/research-synthesis.mjs')
  const result = auditClaimEvidence({
    claims: [{
      id: 'claim-partial', text: '控制器已经达到稳定状态', kind: 'figure-result',
      evidenceRefs: [{ kind: 'run', id: 'run-2' }, { kind: 'artifact', id: 'raw-missing' }],
    }],
    runs: [{ id: 'run-2' }],
    artifacts: [{ id: 'raw-missing', runId: 'run-2', role: 'raw_data', existsState: 'missing' }],
  })

  assert.equal(result.claims[0].status, 'partial')
  assert.deepEqual(result.claims[0].requirements, ['run', 'raw_data', 'figure'])
  assert.ok(result.claims[0].missing.includes('raw_data'))
  assert.ok(result.claims[0].missing.includes('figure'))
  assert.ok(result.claims[0].missing.includes('available_artifact_file'))
})

test('无证据论断保持 unsupported，且不会凭文本伪造文献或实验', async () => {
  const { auditClaimEvidence } = await import('../src/research-synthesis.mjs')
  const result = auditClaimEvidence({
    claims: [{ id: 'claim-empty', text: '该算法一定优于所有基线' }],
    bibliography: [{ id: 'unlinked-paper', title: '看似相关但未关联的论文' }],
    runs: [{ id: 'unlinked-run', title: '未关联测试' }],
    artifacts: [],
  })

  assert.equal(result.claims[0].status, 'unsupported')
  assert.deepEqual(result.claims[0].resolvedEvidence, [])
  assert.deepEqual(result.claims[0].missing, ['linked_evidence'])
})

test('题录证据可用 sourceId 回溯且未知来源 ID 会明确列为 brokenRefs', async () => {
  const { auditClaimEvidence } = await import('../src/research-synthesis.mjs')
  const result = auditClaimEvidence({
    claims: [{
      id: 'claim-source-id', text: '论文报告了相同的振荡现象', requiredEvidence: ['bibliography'],
      evidenceRefs: [{ kind: 'source', id: 'source-1' }, { kind: 'run', id: 'run-does-not-exist' }],
    }],
    bibliography: [{ id: 'paper-1', sourceId: 'source-1', title: 'Navigation oscillation' }],
  })

  assert.equal(result.claims[0].status, 'partial')
  assert.deepEqual(result.claims[0].resolvedEvidence.map(item => item.tag), ['bibliography:source-1'])
  assert.deepEqual(result.claims[0].brokenRefs.map(item => item.tag), ['run:run-does-not-exist'])
})
