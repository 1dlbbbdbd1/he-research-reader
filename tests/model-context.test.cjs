const assert = require('node:assert/strict')
const test = require('node:test')
const { buildModelContext } = require('../electron/workbench/model-context.cjs')

test('模型上下文保留每份已完成观察，并保持 JSON 完整且有界', () => {
  const result = buildModelContext({
    project: { id: 'project-a', name: '当前项目' },
    session: { id: 'session-a', title: '当前会话', turns: [{ role: 'user', content: '延续问题' }] },
    memories: [{ id: 'confirmed', kind: 'fact', content: '已确认事实', sourceType: 'user', importance: 5 }],
    observations: Array.from({ length: 6 }, (_, index) => ({ id: `step-${index + 1}`, title: `论文 ${index + 1}`, output: { document: { source: { sourceId: `paper-${index + 1}` }, text: `论文 ${index + 1} 开头 ${'证据'.repeat(6000)} 末尾唯一实验数值=${index + 101}` } } })),
    maximumChars: 18000,
  })
  assert.doesNotThrow(() => JSON.parse(result.serialized))
  assert.ok(result.serialized.length <= 18000)
  assert.equal(result.context.completedStepObservations.length, 6)
  assert.ok(result.context.completedStepObservations.every((item, index) => item.bodyTruncated && item.body.includes('内容已截断') && item.body.includes(`末尾唯一实验数值=${index + 101}`) && item.originalChars > item.shownChars))
  assert.equal(result.context.confirmedMemories.length, 1)
  assert.equal(result.context.session.id, 'session-a')
})

test('过小预算会明确拒绝，避免截断循环', () => {
  assert.throws(() => buildModelContext({ project: {}, maximumChars: 128 }), /预算至少需要/)
})

test('引号和反斜杠占用预算时仍收敛，短材料不误报截断', () => {
  for (const maximumChars of [512, 600, 800, 1200]) {
    const result = buildModelContext({ project: {}, observations: [{ id: 'one', output: { document: { text: '\\"'.repeat(10000) } } }], maximumChars })
    assert.ok(result.serialized.length <= maximumChars)
    assert.ok(result.truncated)
  }
  assert.equal(buildModelContext({ project: {}, observations: [{ output: { document: { text: '短材料' } } }] }).truncated, false)
})
