const assert = require('node:assert/strict')
const test = require('node:test')
const { planZoteroMetadataSync, zoteroSyncCapabilities } = require('../electron/bibliography-sync.cjs')
const { portableMarkdownFileName, renderPortableMarkdown } = require('../electron/portable-markdown.cjs')

test('Zotero 适配器只接受明确 item key，预览新增、更新、未变和冲突', () => {
  assert.equal(zoteroSyncCapabilities().writesZoteroDatabase, false)
  assert.throws(() => planZoteroMetadataSync({ incoming: [{ localItemId: 'local-1' }] }), /明确的 item key/)
  const plan = planZoteroMetadataSync({
    incoming: [
      { itemKey: 'AAAA1111', localItemId: 'local-1', version: 2, collections: ['核心论文'] },
      { itemKey: 'BBBB2222', localItemId: 'local-2', attachmentKeys: ['ATTACH1'] },
      { itemKey: 'CCCC3333', rawRecordId: 'RIS-3', importFormat: 'ris' },
      { itemKey: 'DUPL4444', localItemId: 'local-4' },
      { itemKey: 'DUPL4444', localItemId: 'local-5' },
    ],
    existing: [{ itemId: 'local-1', libraryId: 'personal', itemKey: 'AAAA1111', fingerprint: 'old' }],
    resolveLocalItem: record => record.localItemId,
  })
  assert.deepEqual(plan.counts, { added: 1, updated: 1, unchanged: 0, unmatched: 1, conflicts: 2 })
  assert.equal(plan.updated[0].itemKey, 'AAAA1111')
  assert.equal(plan.added[0].attachmentKeys[0], 'ATTACH1')
  assert.equal(plan.unmatched[0].reason, 'local-item-not-found')
  assert.ok(plan.conflicts.every(item => item.reason === 'duplicate-external-key'))
})

test('可迁移 Markdown 使用稳定文件名、可读 YAML、wikilink 和普通来源引用', () => {
  const first = portableMarkdownFileName('research_report', '第 3 周 / 科研周报', 'report-1')
  assert.equal(first, portableMarkdownFileName('research_report', '第 3 周 / 科研周报', 'report-1'))
  assert.match(first, /^report--第-3-周-科研周报--[a-f0-9]{12}\.md$/)
  const markdown = renderPortableMarkdown({
    kind: 'research_report', id: 'report-1', title: '第 3 周科研周报', status: 'confirmed',
    project: { id: 'project-1', name: '机器人课题' }, createdAt: '2026-08-09T00:00:00.000Z',
    body: '## 本周进展\n\n完成基线。',
    links: [{ fileName: 'run--基线--abc123.md', label: '实验复盘 · 基线' }],
    references: [{ label: '原始日志', runTitle: '基线', originalFile: 'E:\\evidence\\run.log', id: 'artifact-1' }],
  })
  assert.match(markdown, /source_of_truth: "H's 科研助手 SQLite"/)
  assert.match(markdown, /export_direction: "one-way-snapshot"/)
  assert.match(markdown, /\[\[run--基线--abc123\|实验复盘 · 基线\]\]/)
  assert.match(markdown, /原始文件：`E:\\evidence\\run\.log`/)
  assert.match(markdown, /这是从本地 SQLite 主数据生成的单向 Markdown 快照/)
})
