const assert = require('node:assert/strict')
const test = require('node:test')
const {
  legacyTaskId,
  milestoneStatusFromTask,
  taskApprovalFromActionItem,
  taskStatusFromActionItem,
  taskStatusFromMilestone,
  taskStatusFromReading,
  validateTaskStatus,
} = require('../electron/research-task.cjs')

test('旧模型映射为稳定 ResearchTask ID，不复制或猜测来源', () => {
  assert.equal(legacyTaskId('run', 'run-1', 'next_step'), legacyTaskId('run', 'run-1', 'next_step'))
  assert.notEqual(legacyTaskId('run', 'run-1', 'next_step'), legacyTaskId('run', 'run-1', 'anomaly'))
  assert.match(legacyTaskId('annotation', 'note-1'), /^legacy-task-[a-f0-9]{24}$/)
})

test('ActionPack 建议在人工确认前只能处于等待状态且不是正式任务', () => {
  assert.equal(taskStatusFromActionItem('proposed'), 'waiting')
  assert.equal(taskApprovalFromActionItem('proposed'), 'proposed')
  assert.equal(taskStatusFromActionItem('confirmed'), 'today')
  assert.equal(taskApprovalFromActionItem('confirmed'), 'confirmed')
  assert.equal(taskStatusFromActionItem('dismissed'), 'abandoned')
  assert.equal(taskStatusFromActionItem('completed'), 'completed')
})

test('里程碑和论文状态双向映射到统一任务桶', () => {
  assert.equal(taskStatusFromMilestone('active'), 'today')
  assert.equal(taskStatusFromMilestone('blocked'), 'waiting')
  assert.equal(milestoneStatusFromTask('deferred'), 'planned')
  assert.equal(milestoneStatusFromTask('completed'), 'completed')
  assert.equal(taskStatusFromReading('reading'), 'today')
  assert.equal(taskStatusFromReading('finished'), 'completed')
  assert.throws(() => validateTaskStatus('fake-progress'), /状态无效/)
})
