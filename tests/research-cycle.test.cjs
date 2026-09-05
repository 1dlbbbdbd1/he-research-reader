const test = require('node:test')
const assert = require('node:assert/strict')
const { CONVERSATION_WORKFLOWS, inferConversationWorkflow, buildConversationWorkflowSteps } = require('../electron/workbench/conversation-workflows.cjs')
const { loadBundledSkill } = require('../electron/workbench/skill-library.cjs')

test('科研阶段可通过自然任务选择，普通任务保留自由规划', () => {
  const examples = { '帮我立项': 'research-kickoff', '从导师角度看看这份计划': 'mentor-review', '帮我找点思路': 'idea-discovery', '整理散乱的实验日志': 'experiment-intake' }
  for (const [objective, id] of Object.entries(examples)) assert.equal(inferConversationWorkflow(objective)?.id, id)
  assert.equal(inferConversationWorkflow('解释这个方程'), undefined)
})

test('实验散乱材料与六份已选资料分别读取，原文保持不变', () => {
  const workflow = CONVERSATION_WORKFLOWS.find(item => item.id === 'experiment-intake')
  const raw = '  run A\r\nseed=7\r\n结果失败\nrun B：未知时间  '
  const sources = Array.from({ length: 6 }, (_, i) => `source-${i}`)
  const steps = buildConversationWorkflowSteps(workflow, '整理实验', { vaultPath: 'E:\\test', externalRoots: [] }, { sourceIds: sources, pastedText: raw })
  assert.equal(steps[1].input.pastedText, raw)
  assert.deepEqual(steps.filter(step => step.input.sourceId).map(step => step.input.sourceId), sources)
  assert.equal(steps.at(-1).kind, 'verify')
  assert.equal(steps.at(-2).kind, 'model')
  for (const entry of CONVERSATION_WORKFLOWS) assert.ok(loadBundledSkill(entry.skillId).instructions)
})
