const assert = require('node:assert/strict')
const test = require('node:test')

test('Figure Explorer 识别图、表、算法并通过 MinerU 版面回填页码', async () => {
  const { extractFigureExplorerItems } = await import('../src/figure-explorer.mjs')
  const markdown = [
    '# Results',
    '![contact force](images/force.png)',
    'Figure 3. Contact force under disturbance.',
    '',
    'Table 2. Success rate.',
    '| Method | Rate |',
    '| --- | ---: |',
    '| Baseline | 82% |',
    '| Ours | 92% |',
    '',
    'Algorithm 1. Online stiffness adaptation.',
    '```pseudocode',
    'Require: target force',
    'Ensure: stable contact',
    '```',
  ].join('\n')
  const layout = [
    { id: 'caption-figure', type: 'caption', text: 'Figure 3. Contact force under disturbance.', pageNumber: 6 },
    { id: 'caption-table', type: 'caption', text: 'Table 2. Success rate.', pageNumber: 7 },
    { id: 'caption-algorithm', type: 'caption', text: 'Algorithm 1. Online stiffness adaptation.', pageNumber: 8 },
  ]
  const items = extractFigureExplorerItems(markdown, layout)
  assert.deepEqual(items.map(item => [item.kind, item.label, item.pageNumber]), [
    ['figure', 'Figure 3', 6],
    ['table', 'Table 2', 7],
    ['algorithm', 'Algorithm 1', 8],
  ])
  assert.equal(items[0].assetPath, 'images/force.png')
  assert.match(items[1].preview, /Ours \| 92%/)
  assert.match(items[2].preview, /Require: target force/)
})

test('普通代码块不冒充 Algorithm，未匹配页码保持未知', async () => {
  const { extractFigureExplorerItems } = await import('../src/figure-explorer.mjs')
  const items = extractFigureExplorerItems('```js\nconsole.log("hello")\n```\n\n![curve](curve.png)')
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'figure')
  assert.equal(items[0].pageNumber, undefined)
})
