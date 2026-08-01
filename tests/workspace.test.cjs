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
    assert.equal(schema.schemaVersion, 7)
    for (const table of ['bibliographic_items', 'note_fragments', 'fragment_relation_events', 'review_documents', 'review_blocks', 'review_citations', 'action_packs', 'action_items', 'action_item_evidence', 'action_pack_events', 'migration_runs', 'migration_map', 'bibliographic_reading_states', 'reading_state_events', 'search_index_state', 'library_search_fts', 'annotation_events', 'annotation_exports', 'semantic_index_state', 'semantic_chunks']) {
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

test('已发布的 v1 研究库会事务升级到 v7，并同步清单版本', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '升级测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      for (const row of database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE 'search_%_dirty'
      `).all()) database.exec(`DROP TRIGGER ${row.name}`)
      database.exec(`
        DROP TABLE action_item_evidence;
        DROP TABLE action_pack_events;
        DROP TABLE action_items;
        DROP TABLE action_packs;
        DROP TABLE reading_state_events;
        DROP TABLE bibliographic_reading_states;
        DROP TABLE library_search_fts;
        DROP TABLE search_index_state;
        DROP TABLE annotation_events;
        DROP TABLE annotation_exports;
        DROP TABLE semantic_chunks;
        DROP TABLE semantic_index_state;
        DROP TABLE fragment_relation_events;
        DROP INDEX idx_annotations_project_active;
        ALTER TABLE annotations DROP COLUMN current_note_fragment_id;
        ALTER TABLE annotations DROP COLUMN updated_at;
        DROP INDEX idx_fragment_relations_status;
        ALTER TABLE fragment_relations DROP COLUMN reviewed_at;
        ALTER TABLE fragment_relations DROP COLUMN rationale;
        ALTER TABLE fragment_relations DROP COLUMN status;
        ALTER TABLE fragment_relations DROP COLUMN created_by;
        DELETE FROM schema_migrations WHERE version IN (2, 3, 4, 5, 6, 7);
        PRAGMA user_version = 1;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 1
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 7)
    assert.ok(schema.tables.includes('bibliographic_reading_states'))
    assert.ok(schema.tables.includes('reading_state_events'))
    assert.ok(schema.tables.includes('library_search_fts'))
    assert.ok(schema.tables.includes('search_index_state'))
    assert.ok(schema.tables.includes('annotation_events'))
    assert.ok(schema.tables.includes('annotation_exports'))
    assert.ok(schema.tables.includes('semantic_chunks'))
    assert.ok(schema.tables.includes('semantic_index_state'))
    assert.ok(schema.tables.includes('fragment_relation_events'))
    assert.ok(schema.tables.includes('action_packs'))
    assert.ok(schema.tables.includes('action_item_evidence'))
    assert.ok(schema.tables.includes('action_pack_events'))
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 7)
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
      bibliographicItemId: 'legacy-item:legacy-source',
      sourceName: 'Robust Control.pdf',
      paperTitle: 'Robust Control',
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
        readerState: { viewMode: 'parallel', zoom: 1.42 },
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
    assert.deepEqual(restored.sources[0].readerState, { viewMode: 'parallel', zoom: 1.42 })
    assert.equal(restored.annotations[0].page, '第 2 页')
    assert.equal(restored.annotations[0].bibliographicItemId, 'item:source-local')
    assert.equal(restored.annotations[0].sourceName, 'paper_.pdf')
    assert.equal(restored.annotations[0].paperTitle, 'paper_')
    const storedNote = fixture.service.database.prepare(`
      SELECT bibliographic_item_id, source_id, anchor_json
      FROM note_fragments
      WHERE annotation_id = ? AND origin = 'user'
    `).get('annotation-local')
    assert.equal(storedNote.bibliographic_item_id, 'item:source-local')
    assert.equal(storedNote.source_id, 'source-local')
    assert.equal(JSON.parse(storedNote.anchor_json).pageNumber, 2)
    assert.deepEqual(Buffer.from(fixture.service.readSourceFile('source-local').bytes), bytes)

    fixture.service.close()
    fixture.service.open(vault.path)
    const reopened = fixture.service.loadLibraryState()
    assert.equal(reopened.annotations[0].note, 'user note')
    assert.deepEqual(reopened.sources[0].readerState, { viewMode: 'parallel', zoom: 1.42 })
  } finally {
    fixture.close()
  }
})

test('批注编辑会追加笔记修订，归档可撤销且 Markdown 导出保留来源', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '批注生命周期测试')
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [{
        id: 'annotation-source',
        fileId: 'annotation-source',
        name: 'traceable-paper.pdf',
        kind: 'PDF',
        version: 1,
        status: '已解析',
        hash: 'pdf-sha256',
      }],
      annotations: [{
        id: 'annotation-lifecycle',
        sourceId: 'annotation-source',
        text: 'Original evidence must remain unchanged.',
        note: '第一版笔记',
        category: '研究背景',
        page: '第 3 页',
        anchor: { type: 'pdf', state: 'resolved', pageNumber: 3 },
      }],
    })

    const revised = fixture.service.reviseAnnotation({
      annotationId: 'annotation-lifecycle',
      category: '试验方法',
      note: '第二版笔记：用于方法比较。',
    })
    assert.equal(revised.category, '试验方法')
    assert.equal(revised.note, '第二版笔记：用于方法比较。')
    assert.equal(revised.text, 'Original evidence must remain unchanged.')
    const revisions = fixture.service.database.prepare(`
      SELECT id, content, supersedes_id
      FROM note_fragments
      WHERE annotation_id = ? AND origin = 'user'
      ORDER BY created_at, rowid
    `).all('annotation-lifecycle')
    assert.equal(revisions.length, 2)
    assert.equal(revisions[0].content, '第一版笔记')
    assert.equal(revisions[1].content, '第二版笔记：用于方法比较。')
    assert.equal(revisions[1].supersedes_id, revisions[0].id)
    assert.deepEqual(
      fixture.service.database.prepare(`
        SELECT event_type FROM annotation_events
        WHERE annotation_id = ? ORDER BY created_at, rowid
      `).all('annotation-lifecycle').map(row => row.event_type),
      ['created', 'category_changed', 'note_revised'],
    )

    fixture.service.archiveAnnotation({ annotationId: 'annotation-lifecycle' })
    assert.equal(fixture.service.loadLibraryState().annotations.length, 0)
    assert.equal(fixture.service.loadLibraryState().bibliographicItems[0].annotationCount, 0)
    assert.equal(
      fixture.service.searchLibrary({ query: '第二版笔记' }).results.some(result => result.origin === 'user'),
      false,
    )

    const restored = fixture.service.restoreAnnotation({ annotationId: 'annotation-lifecycle' })
    assert.equal(restored.note, '第二版笔记：用于方法比较。')
    assert.equal(fixture.service.loadLibraryState().bibliographicItems[0].annotationCount, 1)

    const exported = fixture.service.exportAnnotations({ sourceId: 'annotation-source' })
    assert.equal(exported.annotationCount, 1)
    assert.ok(fs.existsSync(exported.filePath))
    const markdown = fs.readFileSync(exported.filePath, 'utf8')
    assert.match(markdown, /Original evidence must remain unchanged\./)
    assert.match(markdown, /第二版笔记：用于方法比较。/)
    assert.match(markdown, /research-reader:\/\/open\?/)
    assert.match(markdown, /笔记修订数：2/)
    assert.equal(fixture.service.database.prepare('SELECT count(*) AS count FROM annotation_exports').get().count, 1)
    assert.throws(
      () => fixture.service.database.prepare('DELETE FROM annotation_events WHERE annotation_id = ?').run('annotation-lifecycle'),
      /cannot be deleted/,
    )
  } finally {
    fixture.close()
  }
})

test('MinerU Markdown、图片和清单按论文版本保存，并可在重开后安全加载', () => {
  const fixture = withService()
  const mineruOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'research-reader-mineru-output-'))
  try {
    const vault = fixture.service.create(fixture.root, 'MinerU 版本化测试')
    const bytes = Buffer.from('%PDF-mineru-version')
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
    fixture.service.importSourceFile({
      id: 'mineru-source',
      fileName: 'mineru-paper.pdf',
      kind: 'PDF',
      contentSha256: hash,
      bytes,
    })
    const autoDirectory = path.join(mineruOutput, 'paper', 'auto')
    const imageDirectory = path.join(autoDirectory, 'images')
    fs.mkdirSync(imageDirectory, { recursive: true })
    const markdown = '# Abstract\n\nMinerU local result.\n\n![Figure 1](images/figure%201.png)\n'
    const markdownPath = path.join(autoDirectory, 'paper.md')
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    fs.writeFileSync(markdownPath, markdown)
    fs.writeFileSync(path.join(imageDirectory, 'figure 1.png'), imageBytes)
    fs.writeFileSync(path.join(autoDirectory, 'paper_content_list.json'), JSON.stringify([
      { type: 'text', text: 'Abstract', text_level: 2, page_idx: 0, bbox: [10, 20, 30, 40] },
      { type: 'text', text: 'MinerU local result.', page_idx: 1, bbox: [100, 500, 800, 700] },
      { type: 'text', text: 'Invalid layout still keeps its page.', page_idx: 1, bbox: [-1, 0, 1200, 50] },
    ]))

    const result = fixture.service.persistMineruResult({
      taskId: 'mineru-task',
      sourceId: 'mineru-source',
      outputDirectory: mineruOutput,
      markdownPath,
      markdown,
      backend: 'pipeline',
    })
    const versionRoot = path.join(vault.path, result.outputDirectory)
    assert.match(result.revision, /^\d{4}-\d{2}-\d{2}T/)
    assert.ok(result.outputDirectory.startsWith(path.join('papers', 'mineru-source', 'derived', 'mineru')))
    assert.ok(fs.existsSync(path.join(versionRoot, 'manifest.json')))
    assert.ok(fs.existsSync(path.join(vault.path, result.markdownPath)))
    assert.equal(result.manifest.markdownSha256, result.markdownSha256)
    assert.ok(result.manifest.files.some(file => file.path === 'paper/auto/images/figure 1.png'))

    const firstAssets = fixture.service.loadMineruAssets('mineru-source')
    assert.equal(firstAssets.revision, result.revision)
    assert.equal(
      firstAssets.assets['images/figure 1.png'],
      `data:image/png;base64,${imageBytes.toString('base64')}`,
    )
    assert.equal(firstAssets.assets['images/figure%201.png'], undefined)
    assert.equal(firstAssets.layoutSource, 'paper/auto/paper_content_list.json')
    assert.deepEqual(firstAssets.layoutBlocks, [
      { id: 'mineru-content-000001', type: 'text', text: 'Abstract', pageNumber: 1, bbox: [0.01, 0.02, 0.03, 0.04] },
      { id: 'mineru-content-000002', type: 'text', text: 'MinerU local result.', pageNumber: 2, bbox: [0.1, 0.5, 0.8, 0.7] },
      { id: 'mineru-content-000003', type: 'text', text: 'Invalid layout still keeps its page.', pageNumber: 2 },
    ])

    fixture.service.close()
    fixture.service.open(vault.path)
    const restoredSource = fixture.service.loadLibraryState().sources.find(source => source.id === 'mineru-source')
    assert.equal(restoredSource.mineruMarkdown, markdown)
    assert.equal(restoredSource.mineruRevision, result.revision)
    assert.equal(fixture.service.loadMineruAssets('mineru-source').assets['images/figure 1.png'], firstAssets.assets['images/figure 1.png'])

    const stored = fixture.service.database.prepare(
      'SELECT source_metadata_json FROM sources WHERE id = ?',
    ).get('mineru-source')
    const metadata = JSON.parse(stored.source_metadata_json)
    metadata.mineruAssetRootRelative = path.join('..', 'outside-vault')
    fixture.service.database.prepare(
      'UPDATE sources SET source_metadata_json = ? WHERE id = ?',
    ).run(JSON.stringify(metadata), 'mineru-source')
    assert.throws(() => fixture.service.loadMineruAssets('mineru-source'), /越过研究库边界/)
  } finally {
    fs.rmSync(mineruOutput, { recursive: true, force: true })
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

test('单篇 AI 阅读卡复用 NoteFragment 保存草稿、来源关系和用户采纳状态', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '阅读卡测试')
    const bytes = Buffer.from('%PDF-reading-card')
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
    fixture.service.importSourceFile({
      id: 'reading-card-source',
      fileName: 'reading-card.pdf',
      kind: 'PDF',
      contentSha256: hash,
      bytes,
    })
    const source = fixture.service.loadLibraryState().sources.find(item => item.id === 'reading-card-source')
    source.status = '已解析'
    source.mineruMarkdown = [
      '# Abstract',
      '',
      'This paper studies force-feedback assembly under stiffness uncertainty.',
      '',
      '# Method',
      '',
      'The controller adapts impedance parameters using measured contact force.',
      '',
      '# Limitation',
      '',
      'The evaluation uses one laboratory velocity range.',
    ].join('\n')
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [source],
      annotations: [{
        id: 'reading-card-annotation',
        sourceId: source.id,
        text: 'The controller adapts impedance parameters using measured contact force.',
        note: '可以考虑复现实验并增加速度范围。',
        category: '试验方法',
        page: '第 3 页',
        anchor: { type: 'pdf', state: 'resolved', pageNumber: 3 },
      }],
    })
    const itemId = `item:${source.id}`
    fixture.service.updateReadingState({
      itemId,
      readingStatus: 'finished',
      relevance: 'core',
      ideaState: 'has_ideas',
      questionState: 'has_questions',
      purposeTags: ['试验方法', '研究局限'],
      decisionNote: '保留并复现。',
    })

    const inputs = fixture.service.getPaperReadingCard(itemId)
    assert.ok(inputs.contexts.some(context => context.origin === 'document'))
    assert.ok(inputs.contexts.some(context => context.origin === 'source_evidence' && context.pageNumber === 3))
    assert.ok(inputs.contexts.some(context => context.origin === 'user'))
    assert.ok(inputs.contexts.some(context => context.origin === 'user_state'))
    const documentContext = inputs.contexts.find(context => context.origin === 'document')
    const userContext = inputs.contexts.find(context => context.origin === 'user')
    assert.throws(
      () => fixture.service.savePaperReadingCardDraft({
        itemId,
        sections: [{ key: 'method', content: '无来源内容', citationIds: ['UNKNOWN'] }],
      }),
      /没有任何带可验证来源/,
    )
    assert.throws(
      () => fixture.service.savePaperReadingCardDraft({
        itemId,
        sections: [{ key: 'findings', content: '把用户想法冒充论文结论', citationIds: [userContext.contextId] }],
      }),
      /没有任何带可验证来源/,
    )

    const draft = fixture.service.savePaperReadingCardDraft({
      itemId,
      provider: 'openai-compatible',
      model: 'test-model',
      promptFingerprint: 'prompt-sha',
      sections: [
        { key: 'method', content: '论文采用接触力反馈自适应调整阻抗参数。', citationIds: [documentContext.contextId] },
        { key: 'next_steps', content: '用户计划扩大速度范围后复现实验。', citationIds: [userContext.contextId] },
      ],
    })
    assert.equal(draft.card.status, 'draft')
    assert.equal(draft.card.sections.length, 2)
    assert.equal(draft.card.sections[0].citations.length, 1)
    assert.equal(draft.card.sections[1].citations[0].origin, 'user')
    const aiFragments = fixture.service.database.prepare(`
      SELECT origin, ai_provenance_json FROM note_fragments
      WHERE bibliographic_item_id = ? AND origin = 'ai'
    `).all(itemId)
    assert.equal(aiFragments.length, 2)
    assert.ok(aiFragments.every(fragment => JSON.parse(fragment.ai_provenance_json).status === 'draft'))
    const draftGraph = fixture.service.getEvidenceGraph({ itemIds: [itemId] })
    assert.ok(draftGraph.edges.filter(edge => edge.relation === 'derived_from').every(edge => edge.status === 'proposed'))
    assert.ok(draftGraph.edges.filter(edge => edge.relation === 'derived_from').every(edge => edge.provenance === 'ai_proposed'))

    fixture.service.close()
    fixture.service.open(vault.path)
    const restored = fixture.service.getPaperReadingCard(itemId)
    assert.equal(restored.card.generationRunId, draft.card.generationRunId)
    const accepted = fixture.service.acceptPaperReadingCard({
      itemId,
      generationRunId: draft.card.generationRunId,
    })
    assert.equal(accepted.card.status, 'accepted')
    const originalUserNote = fixture.service.database.prepare(`
      SELECT content FROM note_fragments
      WHERE annotation_id = 'reading-card-annotation' AND origin = 'user'
    `).get()
    assert.equal(originalUserNote.content, '可以考虑复现实验并增加速度范围。')
    const graph = fixture.service.getEvidenceGraph({ itemIds: [itemId] })
    assert.equal(graph.scope.itemIds[0], itemId)
    assert.equal(graph.summary.aiAccepted, 2)
    assert.ok(graph.nodes.some(node => node.origin === 'source_evidence' && node.pageNumber === 3))
    assert.ok(graph.nodes.some(node => node.origin === 'user' && node.locationLabel === '第 3 页'))
    assert.ok(graph.edges.some(edge => edge.relation === 'comments_on' && edge.provenance === 'user_confirmed'))
    assert.equal(graph.edges.filter(edge => edge.relation === 'derived_from').length, 2)
    assert.ok(graph.edges.filter(edge => edge.relation === 'derived_from').every(edge => edge.provenance === 'ai_accepted'))
    assert.ok(graph.edges.filter(edge => edge.relation === 'derived_from').every(edge => edge.status === 'confirmed'))
    assert.ok(fixture.service.database.prepare(`
      SELECT count(*) AS count FROM fragment_relation_events
      WHERE event_type = 'confirmed' AND actor = 'user'
    `).get().count >= 2)
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
    firstSource.markdownLayout = {
      version: '1.0.0',
      mode: 'ai-classified',
      sourceFingerprint: 'fnv1a-example',
      boundaries: [{ beforeBlockId: 'block-0001', section: '方法' }],
      model: 'local-test-model',
    }
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
    const reloadedSource = fixture.service.loadLibraryState().sources.find(source => source.id === firstSource.id)
    assert.deepEqual(reloadedSource.markdownLayout, firstSource.markdownLayout)
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
    const scopedPaper = fixture.service.searchLibrary({
      query: 'optical',
      filters: { itemIds: [secondItemId] },
    })
    assert.equal(scopedPaper.filteredItemCount, 1)
    assert.ok(scopedPaper.results.every(result => result.itemId === secondItemId))
    assert.equal(
      fixture.service.searchLibrary({
        query: 'optical',
        filters: { itemIds: [firstItemId] },
      }).results.length,
      0,
    )
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

test('本地语义索引保留来源位置、支持范围筛选，并在研究库变化后立即失效', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '本地语义索引')
    const bytes = Buffer.from('%PDF-semantic-lifecycle')
    fixture.service.importSourceFile({
      id: 'semantic-source-1',
      fileName: 'adaptive-assembly.pdf',
      kind: 'PDF',
      contentSha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
      bytes,
    })
    const source = fixture.service.loadLibraryState().sources.find(entry => entry.id === 'semantic-source-1')
    source.status = '已解析'
    source.extractedText = '实验通过接触力反馈自适应调整阻抗参数，提高柔顺装配成功率。'
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [source],
      annotations: [{
        id: 'semantic-annotation-1',
        sourceId: source.id,
        text: '接触刚度扰动需要单独设置对照组。',
        note: '这条证据可以用于试验方法设计。',
        category: '试验方法',
        page: '第 6 页',
        anchor: {
          type: 'pdf',
          state: 'resolved',
          pageNumber: 6,
          rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
        },
      }],
    })

    const prepared = fixture.service.prepareSemanticIndex({ model: 'test-local-model' })
    assert.ok(prepared.documents.length >= 3)
    const vectors = prepared.documents.map(document => (
      /接触|刚度|阻抗|装配/.test(document.text) ? [1, 0] : [0, 1]
    ))
    const ready = fixture.service.commitSemanticIndex({
      model: 'test-local-model',
      dimension: 2,
      sourceIndexedAt: prepared.sourceIndexedAt,
      documents: prepared.documents,
      vectors,
    })
    assert.equal(ready.ready, true)
    assert.equal(ready.chunkCount, prepared.documents.length)

    const itemId = `item:${source.id}`
    const semantic = fixture.service.searchSemanticIndex({
      model: 'test-local-model',
      vector: [1, 0],
      filters: { itemIds: [itemId] },
    })
    assert.equal(semantic.ready, true)
    assert.ok(semantic.results.every(result => result.itemId === itemId))
    const annotation = semantic.results.find(result => result.origin === 'user')
    assert.equal(annotation.sourceId, source.id)
    assert.equal(annotation.pageNumber, 6)
    assert.deepEqual(annotation.anchor.rects, [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }])

    fixture.service.updateReadingState({ itemId, purposeTags: ['试验方法', '柔顺装配'] })
    const stale = fixture.service.semanticIndexStatus({ model: 'test-local-model' })
    assert.equal(stale.ready, false)
    assert.equal(stale.stale, true)
    assert.notEqual(stale.sourceIndexedAt, prepared.sourceIndexedAt)
    assert.throws(
      () => fixture.service.commitSemanticIndex({
        model: 'test-local-model',
        dimension: 2,
        sourceIndexedAt: prepared.sourceIndexedAt,
        documents: prepared.documents,
        vectors,
      }),
      /发生变化/,
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
    const graph = fixture.service.getEvidenceGraph({ documentId: document.id })
    assert.equal(graph.scope.documentId, document.id)
    assert.equal(graph.summary.reviewConclusions, 2)
    assert.equal(graph.summary.unsupported, 1)
    assert.equal(graph.edges.filter(edge => edge.relation === 'cites').length, 2)
    const supportedConclusion = graph.nodes.find(node => node.origin === 'review' && node.trust !== 'unsupported')
    const unsupportedConclusion = graph.nodes.find(node => node.origin === 'review' && node.trust === 'unsupported')
    assert.ok(graph.edges.some(edge => edge.fromNodeId === supportedConclusion.id && edge.provenance === 'ai_proposed'))
    assert.ok(graph.unlinkedNodeIds.includes(unsupportedConclusion.id))
    const relation = fixture.service.createEvidenceRelation({
      fromFragmentId: quoteIds[0],
      toFragmentId: quoteIds[1],
      relation: 'supports',
      rationale: '两条原文证据共同支持方法具有可追溯性。',
    })
    assert.equal(relation.change, 'created')
    let relationGraph = fixture.service.getEvidenceGraph({ documentId: document.id })
    const manualEdge = relationGraph.edges.find(edge => edge.relationId === relation.relationId)
    assert.equal(manualEdge.status, 'confirmed')
    assert.equal(manualEdge.provenance, 'user_confirmed')
    assert.equal(manualEdge.rationale, '两条原文证据共同支持方法具有可追溯性。')
    assert.equal(manualEdge.canReject, true)
    const rejected = fixture.service.reviewEvidenceRelation({ relationId: relation.relationId, decision: 'reject' })
    assert.equal(rejected.status, 'rejected')
    relationGraph = fixture.service.getEvidenceGraph({ documentId: document.id })
    assert.ok(!relationGraph.edges.some(edge => edge.relationId === relation.relationId))
    const reopened = fixture.service.createEvidenceRelation({
      fromFragmentId: quoteIds[0],
      toFragmentId: quoteIds[1],
      relation: 'supports',
      rationale: '复核原文后确认两条证据确实能够相互支持。',
    })
    assert.equal(reopened.change, 'reopened')
    assert.equal(fixture.service.database.prepare(`
      SELECT count(*) AS count FROM fragment_relation_events WHERE relation_id = ?
    `).get(relation.relationId).count, 3)
    assert.throws(
      () => fixture.service.createEvidenceRelation({
        fromFragmentId: quoteIds[0],
        toFragmentId: quoteIds[0],
        relation: 'supports',
        rationale: '不能自己支持自己。',
      }),
      /不能让一个内容节点与自己建立关系/,
    )
    assert.throws(
      () => fixture.service.createEvidenceRelation({
        fromFragmentId: quoteIds[0],
        toFragmentId: quoteIds[1],
        relation: 'derived_from',
        rationale: '不允许人工伪造来源关系。',
      }),
      /只能人工建立支持、反驳或补充关系/,
    )
    assert.throws(
      () => fixture.service.database.prepare(
        "UPDATE fragment_relation_events SET rationale = '覆盖审计记录' WHERE relation_id = ?",
      ).run(relation.relationId),
      /append-only/,
    )
    const actionPack = fixture.service.createActionPack({
      title: '装配控制证据复核',
      objective: '确认两篇论文的方法条件是否可以直接比较。',
      scope: { kind: 'selected', label: '所选两篇论文', itemIds: items.map(item => item.id) },
      createdBy: 'ai',
      provider: 'openai-compatible',
      model: 'test-model',
      generationRunId: 'agent-run-1',
      actions: [{
        actionType: 'verify',
        title: '核对两篇论文的试验速度范围',
        rationale: '现有证据没有证明两篇论文采用相同工况。',
        evidence: [{ evidenceType: 'fragment', entityId: quoteIds[0], label: '伪造标题会被数据库内容覆盖' }],
      }, {
        actionType: 'review',
        title: '重新审查综合结论的适用边界',
        rationale: '复查结论依赖两条原文证据，需要逐项核对。',
        evidence: [{ evidenceType: 'review', entityId: supportedAi.id }],
      }],
    })
    assert.equal(actionPack.status, 'draft')
    assert.equal(actionPack.items.length, 2)
    assert.ok(actionPack.items.every(item => item.status === 'proposed'))
    assert.equal(actionPack.items[0].evidence[0].excerpt, '原文证据 1')
    assert.equal(actionPack.items[0].evidence[0].pageNumber, 2)
    assert.equal(actionPack.items[1].evidence[0].reviewDocumentId, document.id)
    assert.equal(fixture.service.listActionPacks()[0].proposedCount, 2)
    assert.throws(
      () => fixture.service.completeActionItem({ itemId: actionPack.items[0].id }),
      /必须先由用户确认/,
    )
    let reviewedPack = fixture.service.reviewActionItem({ itemId: actionPack.items[0].id, decision: 'confirm' })
    assert.equal(reviewedPack.status, 'draft')
    reviewedPack = fixture.service.reviewActionItem({ itemId: actionPack.items[1].id, decision: 'dismiss' })
    assert.equal(reviewedPack.status, 'confirmed')
    reviewedPack = fixture.service.reviewActionItem({ itemId: actionPack.items[1].id, decision: 'confirm' })
    assert.equal(reviewedPack.items[1].status, 'confirmed')
    reviewedPack = fixture.service.completeActionItem({ itemId: actionPack.items[0].id })
    assert.equal(reviewedPack.status, 'confirmed')
    reviewedPack = fixture.service.completeActionItem({ itemId: actionPack.items[1].id })
    assert.equal(reviewedPack.status, 'completed')
    assert.ok(reviewedPack.events.some(event => event.eventType === 'item_reopened'))
    assert.ok(reviewedPack.events.some(event => event.eventType === 'pack_status_changed'))
    assert.throws(
      () => fixture.service.createActionPack({
        title: '无证据行动包',
        objective: '这个请求必须失败。',
        actions: [{ actionType: 'verify', title: '凭空核验', rationale: '没有证据。', evidence: [] }],
      }),
      /没有可追溯证据/,
    )
    assert.throws(
      () => fixture.service.createActionPack({
        title: '伪造来源行动包',
        objective: '这个请求也必须失败。',
        actions: [{
          actionType: 'verify',
          title: '引用其他研究库内容',
          rationale: '伪造片段不能进入行动包。',
          evidence: [{ evidenceType: 'fragment', entityId: 'unknown-fragment' }],
        }],
      }),
      /不属于当前研究库/,
    )
    assert.throws(
      () => fixture.service.database.prepare(
        "UPDATE action_items SET title = '覆盖建议' WHERE id = ?",
      ).run(actionPack.items[0].id),
      /immutable/,
    )
    assert.throws(
      () => fixture.service.database.prepare(
        "UPDATE action_pack_events SET note = '覆盖审计' WHERE pack_id = ?",
      ).run(actionPack.id),
      /append-only/,
    )
    assert.throws(() => fixture.service.getEvidenceGraph({ documentId: 'unknown-document' }), /找不到要查看证据关系/)
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
