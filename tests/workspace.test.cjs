const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const { WorkspaceService, ensureVaultName } = require('../electron/workspace-service.cjs')

function withService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-reader-workspace-'))
  const service = new WorkspaceService({ registryPath: path.join(root, 'app-data', 'workspaces.json') })
  return {
    root,
    service,
    close() {
      service.close()
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

test('研究库会创建固定目录、清单和当前数据模型', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '装配研究')
    assert.equal(vault.name, '装配研究')
    assert.ok(fs.existsSync(path.join(vault.path, 'vault.json')))
    assert.ok(fs.existsSync(path.join(vault.path, 'library.sqlite')))
    assert.ok(fs.existsSync(path.join(vault.path, 'papers')))
    assert.ok(fs.existsSync(path.join(vault.path, 'exports')))
    assert.ok(fs.existsSync(path.join(vault.path, '.reader-cache')))

    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 3)
    for (const table of ['bibliographic_items', 'note_fragments', 'review_documents', 'review_blocks', 'review_citations', 'migration_runs', 'migration_map', 'bibliographic_reading_states', 'reading_state_events', 'search_index_state', 'library_search_fts']) {
      assert.ok(schema.tables.includes(table), `missing ${table}`)
    }
  } finally {
    fixture.close()
  }
})

test('普通文件夹可原地创建研究库且不删除已有资料', () => {
  const fixture = withService()
  try {
    const selectedFolder = path.join(fixture.root, '用户刚选的文件夹')
    fs.mkdirSync(selectedFolder)
    fs.writeFileSync(path.join(selectedFolder, '原有说明.txt'), '请保留')
    const vault = fixture.service.createAt(selectedFolder, '柔顺装配研究')
    assert.equal(vault.path, path.resolve(selectedFolder))
    assert.equal(vault.name, '柔顺装配研究')
    assert.equal(fs.readFileSync(path.join(selectedFolder, '原有说明.txt'), 'utf8'), '请保留')
    assert.ok(fs.existsSync(path.join(selectedFolder, 'vault.json')))
    assert.ok(fs.existsSync(path.join(selectedFolder, 'library.sqlite')))
    assert.throws(() => fixture.service.createAt(selectedFolder, '重复创建'), /已经是研究库/)
  } finally {
    fixture.close()
  }
})

test('已发布的 v1 研究库会事务升级到 v3，并同步清单版本', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '升级测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    database.exec(`
      DROP TABLE reading_state_events;
      DROP TABLE bibliographic_reading_states;
      DROP TABLE library_search_fts;
      DROP TABLE search_index_state;
      DELETE FROM schema_migrations WHERE version IN (2, 3);
      PRAGMA user_version = 1;
    `)
    database.close()
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 1
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 3)
    assert.ok(schema.tables.includes('bibliographic_reading_states'))
    assert.ok(schema.tables.includes('reading_state_events'))
    assert.ok(schema.tables.includes('library_search_fts'))
    assert.ok(schema.tables.includes('search_index_state'))
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 3)
  } finally {
    fixture.close()
  }
})

test('研究库最近列表和切换指向各自数据库', () => {
  const fixture = withService()
  try {
    const first = fixture.service.create(fixture.root, '第一研究库')
    const second = fixture.service.create(fixture.root, '第二研究库')
    assert.equal(fixture.service.getCurrent().id, second.id)
    assert.equal(fixture.service.listRecent().length, 2)
    assert.equal(fixture.service.switch(first.id).id, first.id)
    assert.equal(fixture.service.listRecent().find(item => item.id === first.id).isCurrent, true)
  } finally {
    fixture.close()
  }
})

test('原文证据和用户笔记由数据库强制采用追加修订', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '不可覆盖测试')
    const database = fixture.service.database
    const timestamp = new Date().toISOString()
    database.prepare(`
      INSERT INTO sources(id, project_id, name, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('source-1', vault.projectId, 'paper.pdf', 'PDF', '已解析', timestamp, timestamp)
    database.prepare(`
      INSERT INTO note_fragments(
        id, project_id, source_id, origin, kind, content, content_sha256,
        purpose_tags_json, anchor_json, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'fragment-1',
      vault.projectId,
      'source-1',
      'user',
      'note',
      '原始用户笔记',
      'hash-1',
      '[]',
      '{"type":"pdf","state":"resolved","pageNumber":1}',
      timestamp,
      'user',
    )
    assert.throws(
      () => database.prepare('UPDATE note_fragments SET content = ? WHERE id = ?').run('被覆盖', 'fragment-1'),
      /append-only/,
    )
    assert.throws(
      () => database.prepare('DELETE FROM note_fragments WHERE id = ?').run('fragment-1'),
      /cannot be deleted/,
    )
  } finally {
    fixture.close()
  }
})

test('研究库名称拒绝空值和非法路径字符', () => {
  assert.equal(ensureVaultName('  我的课题  '), '我的课题')
  assert.throws(() => ensureVaultName(''), /不能为空/)
  assert.throws(() => ensureVaultName('课题/一'), /不支持的字符/)
})

test('旧资料迁移会区分原文证据与用户笔记，并且重复执行幂等', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '迁移测试')
    const snapshot = {
      sources: [{
        id: 'legacy-source',
        fileId: 'legacy-file',
        name: 'Robust Control.pdf',
        kind: 'PDF',
        version: 1,
        status: '已解析',
        hash: 'source-hash',
        extractedText: 'paper body',
      }],
      annotations: [{
        id: 'legacy-annotation',
        sourceId: 'legacy-source',
        text: '原文摘录',
        note: '我的想法',
        category: '方法',
        page: '第 7 页',
      }],
    }
    const first = fixture.service.importLegacySnapshot(snapshot)
    const second = fixture.service.importLegacySnapshot(snapshot)
    assert.equal(first.alreadyImported, false)
    assert.equal(second.alreadyImported, true)
    assert.equal(second.sources.length, 1)
    assert.deepEqual(second.annotations, [{
      id: 'legacy-annotation',
      sourceId: 'legacy-source',
      text: '原文摘录',
      note: '我的想法',
      category: '方法',
      anchor: { type: 'pdf', state: 'resolved', pageNumber: 7 },
      page: '第 7 页',
    }])
    assert.equal(fixture.service.database.prepare('SELECT count(*) AS count FROM note_fragments').get().count, 2)
    assert.equal(fixture.service.database.prepare('SELECT count(*) AS count FROM migration_runs').get().count, 1)
  } finally {
    fixture.close()
  }
})

test('桌面导入会把原文件放入研究库，资料与批注可在重开后恢复', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '持久化测试')
    const bytes = Buffer.from('%PDF-local-test')
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
    fixture.service.importSourceFile({
      id: 'source-local',
      fileName: '../paper?.pdf',
      kind: 'PDF',
      version: 1,
      contentSha256: hash,
      bytes,
    })
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [{
        id: 'source-local',
        fileId: 'source-local',
        name: 'paper_.pdf',
        kind: 'PDF',
        version: 1,
        status: '已解析',
        hash,
        extractedText: 'local extracted text',
      }],
      annotations: [{
        id: 'annotation-local',
        sourceId: 'source-local',
        text: 'source quote',
        note: 'user note',
        category: '方法',
        page: 'p. 2',
        anchor: { type: 'pdf', state: 'resolved', pageNumber: 2, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }] },
      }],
    })
    const restored = fixture.service.loadLibraryState()
    assert.equal(restored.sources[0].extractedText, 'local extracted text')
    assert.equal(restored.annotations[0].page, '第 2 页')
    assert.deepEqual(Buffer.from(fixture.service.readSourceFile('source-local').bytes), bytes)

    fixture.service.close()
    fixture.service.open(vault.path)
    assert.equal(fixture.service.loadLibraryState().annotations[0].note, 'user note')
  } finally {
    fixture.close()
  }
})

test('RIS 题录导入保留原编号和附件原路径，并复制可读 PDF', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '题录导入测试')
    const importDirectory = path.join(fixture.root, 'incoming')
    fs.mkdirSync(importDirectory)
    fs.writeFileSync(path.join(importDirectory, 'paper.pdf'), '%PDF-bibliography-test')
    const risPath = path.join(importDirectory, 'library.ris')
    fs.writeFileSync(risPath, [
      'TY  - JOUR',
      'ID  - ORIGINAL-88',
      'AU  - Doe, Jane',
      'TI  - Imported with attachment',
      'L1  - paper.pdf',
      'ER  - ',
      '',
    ].join('\r\n'))

    const first = fixture.service.importBibliographyFile(risPath)
    const second = fixture.service.importBibliographyFile(risPath)
    assert.equal(first.itemCount, 1)
    assert.equal(first.copiedSourceCount, 1)
    assert.equal(second.alreadyImported, true)
    const item = fixture.service.database.prepare(`
      SELECT raw_record_id, raw_record_id_field, raw_payload, raw_fields_json
      FROM bibliographic_items
    `).get()
    assert.equal(item.raw_record_id, 'ORIGINAL-88')
    assert.equal(item.raw_record_id_field, 'ID')
    assert.match(item.raw_payload, /^TY {2}- JOUR/)
    assert.deepEqual(JSON.parse(item.raw_fields_json).L1, ['paper.pdf'])
    const attachment = fixture.service.database.prepare(`
      SELECT path_original, path_resolved, exists_state, source_id
      FROM bibliographic_attachments
    `).get()
    assert.equal(attachment.path_original, 'paper.pdf')
    assert.equal(attachment.path_resolved, path.join(importDirectory, 'paper.pdf'))
    assert.equal(attachment.exists_state, 'found')
    assert.ok(attachment.source_id)
    assert.equal(fixture.service.loadLibraryState().sources.length, 1)
  } finally {
    fixture.close()
  }
})

test('论文阅读状态、相关性、想法、疑问与用途独立保存并追加历史', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '阅读状态测试')
    const bytes = Buffer.from('%PDF-reading-state')
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
    fixture.service.importSourceFile({
      id: 'reading-source',
      fileName: 'reading.pdf',
      kind: 'PDF',
      contentSha256: hash,
      bytes,
    })
    const itemId = fixture.service.database.prepare(
      'SELECT bibliographic_item_id FROM sources WHERE id = ?',
    ).get('reading-source').bibliographic_item_id
    const first = fixture.service.updateReadingState({
      itemId,
      readingStatus: 'title_only',
      relevance: 'relevant',
      purposeTags: ['国内外研究现状', '研究背景', '研究背景'],
      lastPage: 1,
      totalPages: 12,
    })
    assert.equal(first.readingStatus, 'title_only')
    assert.deepEqual(first.purposeTags, ['国内外研究现状', '研究背景'])
    const eventCount = fixture.service.database.prepare(
      'SELECT count(*) AS count FROM reading_state_events WHERE item_id = ?',
    ).get(itemId).count
    assert.equal(eventCount, 4)

    const second = fixture.service.updateReadingState({
      itemId,
      readingStatus: 'finished',
      relevance: 'mismatched',
      ideaState: 'no_new_ideas',
      questionState: 'no_questions',
      decisionNote: '题目相关，但实验对象与当前方向不一致。',
      lastPage: 12,
      totalPages: 12,
    })
    assert.equal(second.relevance, 'mismatched')
    assert.equal(second.ideaState, 'no_new_ideas')
    assert.equal(second.questionState, 'no_questions')
    const loaded = fixture.service.loadLibraryState().bibliographicItems.find(item => item.id === itemId)
    assert.equal(loaded.readingState.readingStatus, 'finished')
    assert.equal(loaded.readingState.relevance, 'mismatched')
    assert.equal(loaded.readingState.ideaState, 'no_new_ideas')
    assert.equal(loaded.readingState.questionState, 'no_questions')
    assert.equal(loaded.readingState.decisionNote, '题目相关，但实验对象与当前方向不一致。')
    assert.throws(
      () => fixture.service.updateReadingState({ itemId, readingStatus: 'pretend-finished' }),
      /取值无效/,
    )
    assert.throws(
      () => fixture.service.database.prepare('DELETE FROM reading_state_events WHERE item_id = ?').run(itemId),
      /cannot be deleted/,
    )
  } finally {
    fixture.close()
  }
})

test('SQLite 统一本地检索覆盖题录、正文、批注、阅读结果、用途和复查文档', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '统一本地检索')
    for (const [index, sourceId] of ['search-source-1', 'search-source-2'].entries()) {
      const bytes = Buffer.from(`%PDF-search-${index + 1}`)
      const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
      fixture.service.importSourceFile({
        id: sourceId,
        fileName: index ? 'unrelated-material.pdf' : 'adaptive-control.pdf',
        kind: 'PDF',
        contentSha256: hash,
        bytes,
      })
    }
    const library = fixture.service.loadLibraryState()
    const firstSource = library.sources.find(source => source.id === 'search-source-1')
    const secondSource = library.sources.find(source => source.id === 'search-source-2')
    firstSource.status = '已解析'
    firstSource.extractedText = '实验比较了接触刚度变化与自适应阻抗控制。'
    firstSource.mineruMarkdown = '# Method\nForce feedback adaptation improves robustness.'
    secondSource.status = '已解析'
    secondSource.extractedText = 'This paper studies an unrelated optical setup.'
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [firstSource, secondSource],
      annotations: [{
        id: 'search-annotation-1',
        sourceId: firstSource.id,
        text: '接触刚度变化会影响装配成功率。',
        note: '我的想法：可以复现这组对照实验。',
        category: '试验方法',
        page: '第 4 页',
        anchor: {
          type: 'pdf',
          state: 'resolved',
          pageNumber: 4,
          rects: [{ x: .12, y: .24, width: .35, height: .04 }],
        },
      }],
    })
    const firstItemId = `item:${firstSource.id}`
    const secondItemId = `item:${secondSource.id}`
    fixture.service.database.prepare(`
      UPDATE bibliographic_items
      SET authors_json = ?, identifiers_json = ?, container_title = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify([{ family: 'Zhang', given: 'Wei' }]),
      JSON.stringify({ DOI: ['10.1234/robot.2026.1'] }),
      'Journal of Assembly Research',
      new Date().toISOString(),
      firstItemId,
    )
    fixture.service.updateReadingState({
      itemId: firstItemId,
      readingStatus: 'finished',
      relevance: 'core',
      ideaState: 'has_ideas',
      questionState: 'no_questions',
      purposeTags: ['试验方法'],
    })
    fixture.service.updateReadingState({
      itemId: secondItemId,
      readingStatus: 'title_only',
      relevance: 'mismatched',
      ideaState: 'no_new_ideas',
      questionState: 'undecided',
      purposeTags: ['研究背景'],
    })

    const reviewInputs = fixture.service.getReviewInputs({
      itemIds: [firstItemId],
      annotationIds: ['search-annotation-1'],
    })
    const evidenceId = reviewInputs.fragments.find(fragment => fragment.origin === 'source_evidence').id
    fixture.service.createReviewDocument({
      title: '装配方法专题复查',
      itemIds: [firstItemId],
      annotationIds: ['search-annotation-1'],
      aiSections: [{ content: '复查归纳：刚度扰动需要对照实验。', citationFragmentIds: [evidenceId] }],
    })

    const doi = fixture.service.searchLibrary({ query: '10.1234/robot' })
    assert.equal(doi.results[0].origin, 'bibliography')
    assert.equal(doi.results[0].itemId, firstItemId)
    const chineseShortTerm = fixture.service.searchLibrary({ query: '刚度' })
    assert.ok(chineseShortTerm.results.some(result => result.origin === 'document'))
    const userNote = fixture.service.searchLibrary({ query: '我的想法' })
    assert.equal(userNote.results[0].origin, 'user')
    assert.equal(userNote.results[0].pageNumber, 4)
    assert.deepEqual(userNote.results[0].anchor.rects, [{ x: .12, y: .24, width: .35, height: .04 }])
    const finishedMethods = fixture.service.searchLibrary({
      filters: { readingStatuses: ['finished'], purposeTags: ['试验方法'] },
    })
    assert.equal(finishedMethods.filteredItemCount, 1)
    assert.equal(finishedMethods.results[0].itemId, firstItemId)
    const noNotes = fixture.service.searchLibrary({ filters: { hasAnnotations: false } })
    assert.equal(noNotes.results.length, 1)
    assert.equal(noNotes.results[0].itemId, secondItemId)
    const reviews = fixture.service.searchLibrary({
      query: '复查归纳',
      filters: { origins: ['review'] },
    })
    assert.equal(reviews.results.length, 1)
    assert.ok(reviews.results[0].reviewDocumentId)
    assert.throws(
      () => fixture.service.searchLibrary({ filters: { readingStatuses: ['finished); DROP TABLE projects;--'] } }),
      /阅读状态筛选值无效/,
    )

    assert.equal(
      fixture.service.database.prepare(
        'SELECT dirty FROM search_index_state WHERE project_id = ?',
      ).get(vault.projectId).dirty,
      0,
    )
    fixture.service.updateReadingState({ itemId: secondItemId, readingStatus: 'finished' })
    assert.equal(
      fixture.service.database.prepare(
        'SELECT dirty FROM search_index_state WHERE project_id = ?',
      ).get(vault.projectId).dirty,
      1,
    )
    assert.equal(
      fixture.service.searchLibrary({ filters: { readingStatuses: ['finished'] } }).filteredItemCount,
      2,
    )
  } finally {
    fixture.close()
  }
})

test('复查文档严格分离证据、用户笔记和 AI 整理，并导出可回跳 Markdown/Word', async () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '复查文档测试')
    const sourceIds = ['review-source-1', 'review-source-2']
    for (const [index, sourceId] of sourceIds.entries()) {
      const bytes = Buffer.from(`%PDF-review-${index + 1}`)
      const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
      fixture.service.importSourceFile({
        id: sourceId,
        fileName: `paper-${index + 1}.pdf`,
        kind: 'PDF',
        contentSha256: hash,
        bytes,
      })
    }
    const sources = fixture.service.loadLibraryState().sources
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources,
      annotations: sourceIds.map((sourceId, index) => ({
        id: `review-annotation-${index + 1}`,
        sourceId,
        text: `原文证据 ${index + 1}`,
        note: `用户笔记 ${index + 1}`,
        category: index ? '方法' : '研究背景',
        page: `p. ${index + 2}`,
        anchor: {
          type: 'pdf',
          state: 'resolved',
          pageNumber: index + 2,
          rects: [{ x: .1, y: .2, width: .3, height: .04 }],
        },
      })),
    })
    const items = fixture.service.loadLibraryState().bibliographicItems
    const inputs = fixture.service.getReviewInputs({
      itemIds: items.map(item => item.id),
      annotationIds: ['review-annotation-1', 'review-annotation-2'],
    })
    assert.equal(inputs.fragments.length, 4)
    const quoteIds = inputs.fragments.filter(fragment => fragment.origin === 'source_evidence').map(fragment => fragment.id)
    const document = fixture.service.createReviewDocument({
      title: '装配控制复查',
      itemIds: items.map(item => item.id),
      annotationIds: ['review-annotation-1', 'review-annotation-2'],
      generationRunId: 'ai-run-1',
      aiSections: [
        { content: '两篇论文都讨论了可追溯方法。', citationFragmentIds: quoteIds },
        { content: '这是一条没有证据的推断。', citationFragmentIds: [] },
      ],
    })
    assert.deepEqual(
      [...new Set(document.blocks.map(block => block.blockType))].sort(),
      ['ai_organization', 'heading', 'source_evidence', 'user_note'].sort(),
    )
    const supportedAi = document.blocks.find(block => block.blockType === 'ai_organization' && !block.unsupported)
    assert.equal(supportedAi.citations.length, 2)
    const citationTarget = fixture.service.resolveDeepLink({
      sourceId: supportedAi.citations[0].sourceId,
      pageNumber: 99,
      fragmentId: supportedAi.citations[0].fragmentId,
    })
    assert.equal(citationTarget.pageNumber, supportedAi.citations[0].anchor.pageNumber)
    assert.deepEqual(citationTarget.anchor.rects, supportedAi.citations[0].anchor.rects)
    const wrongSourceId = sourceIds.find(sourceId => sourceId !== supportedAi.citations[0].sourceId)
    assert.throws(
      () => fixture.service.resolveDeepLink({
        sourceId: wrongSourceId,
        fragmentId: supportedAi.citations[0].fragmentId,
      }),
      /找不到这条引用对应的证据片段/,
    )
    assert.ok(document.blocks.find(block => block.blockType === 'ai_organization' && block.unsupported))
    assert.throws(
      () => fixture.service.database.prepare(
        "UPDATE review_blocks SET content = '覆盖' WHERE block_type = 'user_note'",
      ).run(),
      /append-only/,
    )

    const markdown = await fixture.service.exportReviewDocument({ documentId: document.id, format: 'markdown' })
    const markdownText = fs.readFileSync(markdown.filePath, 'utf8')
    assert.match(markdownText, /\[原文证据\]/)
    assert.match(markdownText, /\[用户笔记\]/)
    assert.match(markdownText, /\[AI 整理\]/)
    assert.match(markdownText, /research-reader:\/\/open\?sourceId=/)
    assert.doesNotMatch(markdownText, /没有证据的推断/)
    const word = await fixture.service.exportReviewDocument({ documentId: document.id, format: 'docx' })
    assert.equal(fs.readFileSync(word.filePath).subarray(0, 2).toString(), 'PK')
    assert.equal(fixture.service.database.prepare('SELECT count(*) AS count FROM export_records').get().count, 2)
  } finally {
    fixture.close()
  }
})
