const assert = require('node:assert/strict')
const test = require('node:test')

test('批注优先使用已解析 PDF 页码，旧页码只作为兼容回退', async () => {
  const { annotationPage } = await import('../src/annotation-anchor.mjs')
  assert.equal(annotationPage({
    page: 'p. 2',
    anchor: { type: 'pdf', state: 'resolved', pageNumber: 7 },
  }), 7)
  assert.equal(annotationPage({ page: '第 4 页' }), 4)
  assert.equal(annotationPage({ page: '未标注位置' }), undefined)
  assert.equal(annotationPage({
    anchor: { type: 'markdown', state: 'resolved', pageNumber: 9 },
  }), 9)
})

test('高亮矩形会裁剪到页面范围并拒绝无效坐标', async () => {
  const { normalizedAnnotationRects } = await import('../src/annotation-anchor.mjs')
  assert.deepEqual(normalizedAnnotationRects({
    anchor: {
      rects: [
        { x: -.1, y: .2, width: .4, height: .05 },
        { x: .95, y: .9, width: .2, height: .2 },
        { x: Number.NaN, y: 0, width: 1, height: 1 },
        { x: .2, y: .2, width: 0, height: .1 },
      ],
    },
  }), [
    { x: 0, y: .2, width: .30000000000000004, height: .04999999999999999 },
    { x: .95, y: .9, width: .050000000000000044, height: .09999999999999998 },
  ])
})

test('页面高亮只返回对应页且拥有有效矩形的批注', async () => {
  const { annotationHighlightsForPage } = await import('../src/annotation-anchor.mjs')
  const result = annotationHighlightsForPage([
    { id: 'a1', anchor: { type: 'pdf', state: 'resolved', pageNumber: 3, rects: [{ x: .1, y: .2, width: .3, height: .04 }] } },
    { id: 'a2', anchor: { type: 'pdf', state: 'resolved', pageNumber: 4, rects: [{ x: .1, y: .2, width: .3, height: .04 }] } },
    { id: 'a3', anchor: { type: 'pdf', state: 'resolved', pageNumber: 3, rects: [] } },
    { id: 'a4', anchor: { type: 'markdown', state: 'resolved', pageNumber: 3, rects: [{ x: .2, y: .3, width: .4, height: .05 }] } },
  ], 3)
  assert.deepEqual(result.map(item => item.id), ['a1', 'a4'])
})
