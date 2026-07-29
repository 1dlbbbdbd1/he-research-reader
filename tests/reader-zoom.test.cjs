const assert = require('node:assert/strict')
const test = require('node:test')

test('Ctrl 加滚轮按固定步长缩放并限制范围', async () => {
  const { readerZoomAfterWheel } = await import('../src/reader-zoom.mjs')
  assert.equal(readerZoomAfterWheel(1, -120, true), 1.1)
  assert.equal(readerZoomAfterWheel(1, 120, true), 0.9)
  assert.equal(readerZoomAfterWheel(3, -120, true), 3)
  assert.equal(readerZoomAfterWheel(0.5, 120, true), 0.5)
})

test('未按 Ctrl 时滚轮不改变阅读缩放', async () => {
  const { readerZoomAfterWheel } = await import('../src/reader-zoom.mjs')
  assert.equal(readerZoomAfterWheel(1.4, -120, false), 1.4)
})
