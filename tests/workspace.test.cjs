const assert = require('node:assert/strict')
const crypto = require('node:crypto')
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
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 })
      } catch (error) {
        // node:sqlite can retain a closed statement handle until process exit on Windows.
        // The test data remains under the OS temp directory and is removable immediately
        // after the runner exits; do not turn that runtime cleanup quirk into a migration failure.
        if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
      }
    },
  }
}

function bilingualSourceHash(value) {
  const normalized = String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${normalized.length}`
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
    for (const directory of ['database', 'notes', 'evidence', 'experiments', 'datasets', 'reports', 'attachments', 'config']) {
      assert.ok(fs.existsSync(path.join(vault.path, directory)), `missing vault directory ${directory}`)
    }
    assert.ok(fs.existsSync(path.join(vault.path, 'VAULT_INDEX.generated.md')))
    assert.equal(JSON.parse(fs.readFileSync(path.join(vault.path, 'vault.json'), 'utf8')).vaultFormatVersion, 2)

    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    for (const table of ['bibliographic_items', 'bibliographic_external_refs', 'bibliographic_sync_runs', 'portable_markdown_exports', 'note_fragments', 'fragment_relation_events', 'review_documents', 'review_blocks', 'review_citations', 'action_packs', 'action_items', 'action_item_evidence', 'action_item_research_evidence', 'action_pack_events', 'migration_runs', 'migration_map', 'bibliographic_reading_states', 'reading_state_events', 'search_index_state', 'library_search_fts', 'annotation_events', 'annotation_exports', 'semantic_index_state', 'semantic_chunks', 'research_records', 'research_project_history', 'research_milestones', 'research_run_templates', 'research_runs', 'research_artifacts', 'reading_translation_segments', 'reading_translation_overrides', 'reading_translation_terms', 'research_reports', 'research_report_revisions', 'research_report_exports', 'research_claims', 'research_claim_revisions', 'structured_reading_documents', 'structured_reading_versions', 'research_resume_state', 'research_resume_events', 'research_tasks', 'research_task_events', 'agent_memory_items', 'agent_sessions', 'agent_turns', 'agent_plans', 'agent_plan_steps', 'agent_tool_events', 'evidence_cards', 'evidence_card_events', 'knowledge_nodes', 'knowledge_edges', 'knowledge_graph_events']) {
      assert.ok(schema.tables.includes(table), `missing ${table}`)
    }
  } finally {
    fixture.close()
  }
})

test('Research Vault v2 投影可重复重建且不覆盖用户文件', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '可携带研究库')
    const userReadme = path.join(vault.path, 'notes', 'README.md')
    fs.writeFileSync(userReadme, '# 我的笔记约定\n', 'utf8')
    fs.writeFileSync(path.join(vault.path, 'notes', '我的想法.md'), '# 不受软件管理\n', 'utf8')
    fixture.service.saveResearchRecord({
      recordType: 'dataset',
      title: '刚度扰动原始数据',
      content: '采样频率 1000 Hz；保留原始 CSV。',
      status: 'active',
      occurredAt: '2026-08-09T08:00:00+08:00',
      filePath: 'E:\\data\\stiffness.csv',
      tags: ['raw', 'assembly'],
    })

    const first = fixture.service.rebuildVaultProjections()
    const second = fixture.service.rebuildVaultProjections()
    assert.equal(first.vaultFormatVersion, 2)
    assert.deepEqual(second.counts, first.counts)
    assert.equal(second.counts.datasets, 1)
    assert.equal(fs.readFileSync(userReadme, 'utf8'), '# 我的笔记约定\n')
    assert.equal(fs.readFileSync(path.join(vault.path, 'notes', '我的想法.md'), 'utf8'), '# 不受软件管理\n')
    assert.match(fs.readFileSync(path.join(vault.path, 'datasets', 'index.generated.md'), 'utf8'), /刚度扰动原始数据/)
    assert.match(fs.readFileSync(path.join(vault.path, 'datasets', 'index.generated.md'), 'utf8'), /E:\\data\\stiffness\.csv/)
    assert.match(fs.readFileSync(path.join(vault.path, 'VAULT_INDEX.generated.md'), 'utf8'), /Research Vault v2/)
    const schema = JSON.parse(fs.readFileSync(path.join(vault.path, 'database', 'schema.generated.json'), 'utf8'))
    assert.equal(schema.database, '../library.sqlite')
    assert.equal(schema.schemaVersion, 19)
    assert.ok(schema.tables.includes('research_records'))
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

test('普通文件夹里的现有 PDF 可按用户确认一键复制纳入研究库', () => {
  const fixture = withService()
  try {
    const selectedFolder = path.join(fixture.root, '已有论文')
    fs.mkdirSync(path.join(selectedFolder, '子目录'), { recursive: true })
    const original = path.join(selectedFolder, '子目录', 'paper.pdf')
    fs.writeFileSync(original, Buffer.from('%PDF-1.4 existing paper'))
    fixture.service.createAt(selectedFolder, '已有论文研究')
    const result = fixture.service.importExistingPdfFiles([original, original])
    assert.equal(result.imported.length, 1)
    assert.equal(result.skipped.length, 1)
    assert.equal(fs.readFileSync(original, 'utf8'), '%PDF-1.4 existing paper')
    const library = fixture.service.loadLibraryState()
    assert.equal(library.sources.length, 1)
    assert.equal(library.sources[0].name, 'paper.pdf')
    assert.ok(fs.existsSync(path.join(selectedFolder, 'papers', library.sources[0].id, 'original', 'paper.pdf')))
  } finally {
    fixture.close()
  }
})

test('已发布的 v1 研究库会事务升级到 v19，并同步清单版本', () => {
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
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DROP TABLE research_resume_events;
        DROP TABLE research_resume_state;
        DROP TABLE research_report_exports;
        DROP TABLE research_report_revisions;
        DROP TABLE research_reports;
        DROP TABLE research_claim_revisions;
        DROP TABLE research_claims;
        DROP TABLE action_item_research_evidence;
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE reading_translation_segments;
        DROP TABLE research_artifacts;
        DROP TABLE research_runs;
        DROP TABLE research_run_templates;
        DROP TABLE research_milestones;
        DROP TABLE research_project_history;
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
        DROP TABLE research_records;
        DROP INDEX idx_annotations_project_active;
        ALTER TABLE annotations DROP COLUMN current_note_fragment_id;
        ALTER TABLE annotations DROP COLUMN updated_at;
        DROP INDEX idx_fragment_relations_status;
        ALTER TABLE fragment_relations DROP COLUMN reviewed_at;
        ALTER TABLE fragment_relations DROP COLUMN rationale;
        ALTER TABLE fragment_relations DROP COLUMN status;
        ALTER TABLE fragment_relations DROP COLUMN created_by;
        ALTER TABLE projects DROP COLUMN research_question;
        ALTER TABLE projects DROP COLUMN current_hypothesis;
        ALTER TABLE projects DROP COLUMN stage;
        ALTER TABLE projects DROP COLUMN mode;
        ALTER TABLE bibliographic_items DROP COLUMN accessed;
        ALTER TABLE bibliographic_items DROP COLUMN publisher;
        ALTER TABLE bibliographic_items DROP COLUMN publisher_place;
        DELETE FROM schema_migrations WHERE version IN (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
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
    assert.equal(schema.schemaVersion, 19)
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
    assert.ok(schema.tables.includes('research_records'))
    assert.ok(schema.tables.includes('research_runs'))
    assert.ok(schema.tables.includes('research_artifacts'))
    assert.ok(schema.tables.includes('reading_translation_segments'))
    assert.ok(schema.tables.includes('reading_translation_overrides'))
    assert.ok(schema.tables.includes('reading_translation_terms'))
    assert.ok(schema.tables.includes('research_reports'))
    assert.ok(schema.tables.includes('research_claims'))
    assert.ok(schema.tables.includes('research_resume_state'))
    assert.ok(schema.tables.includes('research_resume_events'))
    assert.ok(schema.tables.includes('research_tasks'))
    assert.ok(schema.tables.includes('research_task_events'))
    const projectColumns = fixture.service.database.prepare('PRAGMA table_info(projects)').all().map(row => row.name)
    assert.ok(projectColumns.includes('research_question'))
    assert.ok(projectColumns.includes('current_hypothesis'))
    assert.ok(projectColumns.includes('stage'))
    assert.ok(projectColumns.includes('mode'))
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
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

test('课题中心会本地保存课题资料和五类科研记录', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '机器人装配课题')
    const initial = fixture.service.getResearchWorkspace()
    assert.deepEqual(initial.project, {
      id: vault.projectId,
      name: '机器人装配课题',
      researchQuestion: '',
      currentHypothesis: '',
      stage: '探索中',
      mode: 'exploration',
      updatedAt: initial.project.updatedAt,
    })
    assert.deepEqual(initial.records, [])

    const updated = fixture.service.saveResearchWorkspace({
      projectId: vault.projectId,
      name: '柔顺装配课题',
      researchQuestion: '如何降低插接过程中的卡滞率？',
      currentHypothesis: '力位混合控制可以降低接触峰值。',
      stage: '实验验证',
    })
    assert.equal(updated.project.name, '柔顺装配课题')
    assert.equal(updated.project.stage, '实验验证')
    assert.equal(JSON.parse(fs.readFileSync(path.join(vault.path, 'vault.json'), 'utf8')).name, '柔顺装配课题')
    assert.equal(fixture.service.saveResearchProject({ stage: '实验验证' }).project.stage, '实验验证')

    const sourceTimestamp = new Date().toISOString()
    fixture.service.database.prepare(`
      INSERT INTO sources(id, project_id, name, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('research-source-1', vault.projectId, '控制论文.pdf', 'PDF', '已解析', sourceTimestamp, sourceTimestamp)

    const types = ['log', 'experiment', 'dataset', 'decision', 'milestone']
    for (const [index, recordType] of types.entries()) {
      fixture.service.saveResearchRecord({
        projectId: vault.projectId,
        recordType,
        title: `${recordType} 记录`,
        content: `第 ${index + 1} 条研究过程`,
        status: index === 0 ? 'planned' : 'active',
        occurredAt: `2026-08-0${index + 1}T08:00:00+08:00`,
        filePath: recordType === 'dataset' ? 'data/run-01.csv' : undefined,
        sourceIds: ['research-source-1'],
        tags: ['装配', recordType, '装配'],
      })
    }
    const workspace = fixture.service.getResearchWorkspace()
    assert.deepEqual(new Set(workspace.records.map(record => record.recordType)), new Set(types))
    assert.equal(workspace.records[0].recordType, 'milestone')
    assert.deepEqual(workspace.records.find(record => record.recordType === 'dataset').tags, ['装配', 'dataset'])
    assert.equal(workspace.records.find(record => record.recordType === 'dataset').filePath, 'data/run-01.csv')

    const experiment = workspace.records.find(record => record.recordType === 'experiment')
    fixture.service.saveResearchRecord({
      ...experiment,
      title: '实验记录（已完成）',
      status: 'completed',
    })
    assert.equal(
      fixture.service.getResearchWorkspace().records.find(record => record.id === experiment.id).status,
      'completed',
    )
    fixture.service.saveResearchRecord({ ...experiment, status: 'archived' })
    assert.equal(fixture.service.getResearchWorkspace().records.some(record => record.id === experiment.id), false)
  } finally {
    fixture.close()
  }
})

test('科研记录校验输入并阻止跨课题覆盖和关联', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '隔离测试')
    const timestamp = new Date().toISOString()
    fixture.service.database.prepare(
      'INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('other-project', '另一个课题', timestamp, timestamp)
    fixture.service.database.prepare(`
      INSERT INTO sources(id, project_id, name, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('other-source', 'other-project', '其他课题论文.pdf', 'PDF', '已解析', timestamp, timestamp)
    fixture.service.database.prepare(`
      INSERT INTO research_records(
        id, project_id, record_type, title, content, status, occurred_at,
        source_ids_json, tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('other-record', 'other-project', 'log', '其他课题日志', '', 'active', timestamp, '[]', '[]', timestamp, timestamp)

    assert.throws(
      () => fixture.service.saveResearchWorkspace({ projectId: 'other-project', stage: '完成' }),
      /课题已切换/,
    )
    assert.throws(
      () => fixture.service.saveResearchRecord({ id: 'other-record', recordType: 'log', title: '越权覆盖' }),
      /不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchRecord({ recordType: 'dataset', title: '越权关联', sourceIds: ['other-source'] }),
      /不存在或不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchRecord({ recordType: 'unknown', title: '错误类型' }),
      /类型无效/,
    )
    assert.throws(
      () => fixture.service.saveResearchRecord({ recordType: 'log', title: '错误时间', occurredAt: 'not-a-date' }),
      /时间无效/,
    )
    assert.throws(
      () => fixture.service.saveResearchRecord({ recordType: 'log', title: '', tags: '不是列表' }),
      /标题不能为空/,
    )
    assert.throws(
      () => fixture.service.saveResearchWorkspace({ projectId: vault.projectId, researchQuestion: 42 }),
      /必须是文本/,
    )
    assert.equal(fixture.service.getResearchWorkspace().records.length, 0)
  } finally {
    fixture.close()
  }
})

test('已发布的 v8 研究库会原位升级到 v19 并获得通用工科数据表和内置模板', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v8 升级测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DROP TABLE research_resume_events;
        DROP TABLE research_resume_state;
        DROP TABLE research_report_exports;
        DROP TABLE research_report_revisions;
        DROP TABLE research_reports;
        DROP TABLE research_claim_revisions;
        DROP TABLE research_claims;
        DROP TABLE action_item_research_evidence;
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE reading_translation_segments;
        DROP TABLE research_artifacts;
        DROP TABLE research_runs;
        DROP TABLE research_run_templates;
        DROP TABLE research_milestones;
        DROP TABLE research_project_history;
        ALTER TABLE projects DROP COLUMN mode;
        ALTER TABLE bibliographic_items DROP COLUMN accessed;
        ALTER TABLE bibliographic_items DROP COLUMN publisher;
        ALTER TABLE bibliographic_items DROP COLUMN publisher_place;
        DELETE FROM schema_migrations WHERE version IN (9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
        PRAGMA user_version = 8;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 8
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const workspace = fixture.service.getResearchWorkspace()
    assert.equal(fixture.service.inspectSchema().schemaVersion, 19)
    assert.equal(workspace.project.mode, 'exploration')
    assert.deepEqual(
      new Set(workspace.runTemplates.filter(template => template.builtIn).map(template => template.category)),
      new Set(['general', 'ros', 'python', 'data-analysis', 'simulation', 'physical']),
    )
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('已发布的 v9 研究库会事务升级到 v19 并获得报告、论文论断、引用、结构化阅读、现场恢复、统一任务、Agent、知识图谱、翻译状态与工作台模型', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v9 升级测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DROP TABLE research_resume_events;
        DROP TABLE research_resume_state;
        DROP TABLE research_report_exports;
        DROP TABLE research_report_revisions;
        DROP TABLE research_reports;
        DROP TABLE research_claim_revisions;
        DROP TABLE research_claims;
        ALTER TABLE bibliographic_items DROP COLUMN accessed;
        ALTER TABLE bibliographic_items DROP COLUMN publisher;
        ALTER TABLE bibliographic_items DROP COLUMN publisher_place;
        DELETE FROM schema_migrations WHERE version IN (10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
        PRAGMA user_version = 9;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 9
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    assert.ok(schema.tables.includes('research_reports'))
    assert.ok(schema.tables.includes('research_report_revisions'))
    assert.ok(schema.tables.includes('research_report_exports'))
    assert.ok(schema.tables.includes('research_claims'))
    assert.ok(schema.tables.includes('research_claim_revisions'))
    const workspace = fixture.service.getResearchWorkspace()
    assert.deepEqual(workspace.reports, [])
    assert.deepEqual(workspace.claims, [])
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v10 研究库原位升级到 v19 后获得引用出版项且不改写既有题录', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v10 引用迁移测试')
    const timestamp = new Date().toISOString()
    fixture.service.database.prepare(`
      INSERT INTO bibliographic_items(
        id, project_id, item_type, title, authors_json, issued, keywords_json, identifiers_json,
        needs_metadata_review, import_format, import_batch_id, record_ordinal, raw_payload,
        raw_fields_json, parser_name, parser_version, imported_at, created_at, updated_at
      ) VALUES (?, ?, 'book', '迁移前题名', '[]', '2024', '[]', '{}', 1, 'manual', 'v10', 1, '', '{}', 'test', '1', ?, ?, ?)
    `).run('v10-item', vault.projectId, timestamp, timestamp, timestamp)
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DROP TABLE research_resume_events;
        DROP TABLE research_resume_state;
        ALTER TABLE bibliographic_items DROP COLUMN accessed;
        ALTER TABLE bibliographic_items DROP COLUMN publisher;
        ALTER TABLE bibliographic_items DROP COLUMN publisher_place;
        DELETE FROM schema_migrations WHERE version IN (11, 12, 13, 14, 15, 16, 17, 18, 19);
        PRAGMA user_version = 10;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 10
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    assert.equal(fixture.service.inspectSchema().schemaVersion, 19)
    const columns = fixture.service.database.prepare('PRAGMA table_info(bibliographic_items)').all().map(row => row.name)
    assert.ok(columns.includes('accessed'))
    assert.ok(columns.includes('publisher'))
    assert.ok(columns.includes('publisher_place'))
    assert.equal(fixture.service.database.prepare('SELECT title FROM bibliographic_items WHERE id = ?').get('v10-item').title, '迁移前题名')
  } finally {
    fixture.close()
  }
})

test('schema v11 研究库事务升级到 v19 并创建结构化阅读、现场恢复、统一任务、Agent、知识图谱、翻译状态与工作台表', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v11 结构化阅读迁移测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DROP TABLE research_resume_events;
        DROP TABLE research_resume_state;
        DROP TABLE structured_reading_versions;
        DROP TABLE structured_reading_documents;
        DELETE FROM schema_migrations WHERE version IN (12, 13, 14, 15, 16, 17, 18, 19);
        PRAGMA user_version = 11;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 11
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    assert.ok(schema.tables.includes('structured_reading_documents'))
    assert.ok(schema.tables.includes('structured_reading_versions'))
    assert.ok(schema.tables.includes('research_resume_state'))
    assert.ok(schema.tables.includes('research_resume_events'))
    assert.ok(schema.tables.includes('research_tasks'))
  } finally {
    fixture.close()
  }
})

test('schema v12 研究库事务升级到 v19 并创建只追加现场、任务、Agent、知识图谱事件、翻译状态与工作台审计', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v12 现场恢复迁移测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DROP TABLE research_resume_events;
        DROP TABLE research_resume_state;
        DELETE FROM schema_migrations WHERE version IN (13, 14, 15, 16, 17, 18, 19);
        PRAGMA user_version = 12;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 12
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    assert.ok(schema.tables.includes('research_resume_state'))
    assert.ok(schema.tables.includes('research_resume_events'))
    assert.ok(schema.tables.includes('research_tasks'))
    assert.ok(schema.tables.includes('research_task_events'))
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v13 研究库事务升级到 v19 并保留现场状态', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v13 统一任务迁移测试')
    fixture.service.beginResearchSession()
    fixture.service.saveResearchResume({ activeView: 'research-workspace' })
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DROP TABLE research_task_events;
        DROP TABLE research_tasks;
        DELETE FROM schema_migrations WHERE version IN (14, 15, 16, 17, 18, 19);
        PRAGMA user_version = 13;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 13
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    assert.equal(fixture.service.inspectSchema().schemaVersion, 19)
    assert.equal(fixture.service.getResearchResume().activeView, 'research-workspace')
    assert.ok(fixture.service.inspectSchema().tables.includes('research_tasks'))
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v14 研究库原位升级到 v19 并保留既有翻译缓存', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v14 翻译状态迁移测试')
    const timestamp = new Date().toISOString()
    fixture.service.database.prepare(`
      INSERT INTO sources(id, project_id, name, kind, status, created_at, updated_at)
      VALUES (?, ?, 'migration.pdf', 'PDF', '已解析', ?, ?)
    `).run('v14-translation-source', vault.projectId, timestamp, timestamp)
    const text = 'Existing translation cache remains readable.'
    const hash = bilingualSourceHash(text)
    fixture.service.saveReadingTranslationSegment({
      sourceId: 'v14-translation-source', segmentId: 'segment-1', sourceHash: hash,
      sourceText: text, translatedText: '既有翻译缓存仍可读取。', provider: 'local', status: 'translated',
    })
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DROP TABLE reading_translation_terms;
        DROP TABLE reading_translation_overrides;
        DELETE FROM schema_migrations WHERE version IN (15, 16, 17, 18, 19);
        PRAGMA user_version = 14;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 14
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    assert.equal(fixture.service.inspectSchema().schemaVersion, 19)
    assert.ok(fixture.service.inspectSchema().tables.includes('reading_translation_overrides'))
    assert.ok(fixture.service.inspectSchema().tables.includes('reading_translation_terms'))
    const restored = fixture.service.getReadingTranslationSegments({
      sourceId: 'v14-translation-source', segments: [{ segmentId: 'segment-1', sourceHash: hash }],
    })
    assert.equal(restored.segments[0].translatedText, '既有翻译缓存仍可读取。')
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v15 研究库原位升级到 v19 并增加 Zotero、Agent、知识图谱边界、可迁移导出与工作台记录', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v15 兼容接口迁移测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE portable_markdown_exports;
        DROP TABLE bibliographic_sync_runs;
        DROP TABLE bibliographic_external_refs;
        DELETE FROM schema_migrations WHERE version IN (16, 17, 18, 19);
        PRAGMA user_version = 15;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 15
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    assert.ok(schema.tables.includes('bibliographic_external_refs'))
    assert.ok(schema.tables.includes('bibliographic_sync_runs'))
    assert.ok(schema.tables.includes('portable_markdown_exports'))
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v16 研究库事务升级到 v19 并新增持久化 Agent、知识图谱与工作台审计模型', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v16 Agent 升级测试')
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE knowledge_graph_events;
        DROP TABLE knowledge_edges;
        DROP TABLE knowledge_nodes;
        DROP TABLE evidence_card_events;
        DROP TABLE evidence_cards;
        DROP TABLE agent_tool_events;
        DROP TABLE agent_plan_steps;
        DROP TABLE agent_plans;
        DROP TABLE agent_turns;
        DROP TABLE agent_sessions;
        DROP TABLE agent_memory_items;
        DELETE FROM schema_migrations WHERE version IN (17, 18, 19);
        PRAGMA user_version = 16;
      `)
    } finally {
      database.close()
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 16
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    for (const table of ['agent_memory_items', 'agent_sessions', 'agent_turns', 'agent_plans', 'agent_plan_steps', 'agent_tool_events']) {
      assert.ok(schema.tables.includes(table), `missing ${table}`)
    }
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v17 研究库原位升级到 v19 后新增 Evidence Card、知识图谱与工作台且迁移幂等', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v17 知识图谱升级测试')
    fixture.service.close()
    let database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE knowledge_graph_events;
        DROP TABLE knowledge_edges;
        DROP TABLE knowledge_nodes;
        DROP TABLE evidence_card_events;
        DROP TABLE evidence_cards;
        DELETE FROM schema_migrations WHERE version IN (18, 19);
        PRAGMA user_version = 17;
      `)
    } finally {
      database.close()
      database = undefined
    }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 17
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    let schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    for (const table of ['evidence_cards', 'evidence_card_events', 'knowledge_nodes', 'knowledge_edges', 'knowledge_graph_events']) {
      assert.ok(schema.tables.includes(table), `missing ${table}`)
    }
    let backups = fixture.service.listMigrationBackups()
    assert.equal(backups.length, 1)
    assert.equal(backups[0].sourceVersion, 17)
    assert.equal(backups[0].targetVersion, 19)
    assert.equal(backups[0].valid, true)
    fixture.service.close()
    fixture.service.open(vault.path)
    schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    backups = fixture.service.listMigrationBackups()
    assert.equal(backups.length, 1)
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).schemaVersion, 19)
  } finally {
    fixture.close()
  }
})

test('schema v18 研究库升级到 v19 只新增工作台模型并保留既有课题', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, 'v18 工作台升级测试')
    const originalProject = fixture.service.getResearchWorkspace().project
    fixture.service.close()
    const database = new DatabaseSync(path.join(vault.path, 'library.sqlite'))
    try {
      database.exec(`
        DROP TABLE model_call_metrics;
        DROP TABLE agent_evaluations;
        DROP TABLE agent_checkpoints;
        DROP TABLE agent_decisions;
        DROP TABLE agent_artifacts;
        DROP TABLE agent_events;
        DROP TABLE agent_permission_grants;
        DROP TABLE agent_run_steps;
        DROP TABLE agent_runs;
        DROP TABLE workbench_projects;
        DELETE FROM schema_migrations WHERE version = 19;
        PRAGMA user_version = 18;
      `)
    } finally { database.close() }
    const manifestPath = path.join(vault.path, 'vault.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.schemaVersion = 18
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    fixture.service.open(vault.path)
    const schema = fixture.service.inspectSchema()
    assert.equal(schema.schemaVersion, 19)
    for (const table of ['workbench_projects', 'agent_runs', 'agent_run_steps', 'agent_permission_grants', 'agent_events', 'agent_artifacts', 'agent_decisions', 'agent_checkpoints', 'agent_evaluations', 'model_call_metrics']) assert.ok(schema.tables.includes(table), `missing ${table}`)
    const migratedProject = fixture.service.getResearchWorkspace().project
    assert.equal(migratedProject.id, originalProject.id)
    assert.equal(migratedProject.name, originalProject.name)
    fixture.service.close()
    fixture.service.open(vault.path)
    assert.equal(fixture.service.inspectSchema().schemaVersion, 19)
    assert.equal(fixture.service.listMigrationBackups().filter(item => item.sourceVersion === 18 && item.targetVersion === 19).length, 1)
  } finally { fixture.close() }
})

test('统一科研任务兼容 ActionPack、里程碑、Run、论文和批注，并把完成状态回写来源', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '统一任务测试')
    fixture.service.importSourceFile({
      id: 'task-source', fileName: 'task-paper.pdf', kind: 'PDF', bytes: Buffer.from('%PDF-task-source'),
    })
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [{ id: 'task-source', fileId: 'task-source', name: 'task-paper.pdf', kind: 'PDF', version: 1, status: '已解析' }],
      annotations: [{
        id: 'task-annotation', sourceId: 'task-source', text: '需要复核的原文', note: '把这条批注转为任务',
        category: '待核实', anchor: { type: 'pdf', state: 'resolved', pageNumber: 3 }, page: '第 3 页',
      }],
    })
    const item = fixture.service.loadLibraryState().bibliographicItems.find(entry => entry.sourceId === 'task-source')
    fixture.service.updateReadingState({ itemId: item.id, readingStatus: 'reading', lastPage: 3, totalPages: 10 })
    const milestone = fixture.service.saveResearchMilestone({ title: '完成基线验证', status: 'active' }).milestones[0]
    const run = fixture.service.saveResearchRun({
      title: '基线 Run', outcome: 'running', anomaly: '日志存在时间戳跳变', nextStep: '固定随机种子后再运行',
    }).runs[0]
    const pack = fixture.service.createActionPack({
      title: 'AI 待确认建议', objective: '补齐证据', createdBy: 'ai',
      scope: { kind: 'current', label: '当前论文', itemIds: [item.id] },
      actions: [{
        actionType: 'verify', title: '核对实验工况', rationale: '论文与 Run 的工况可能不同。',
        evidence: [{ evidenceType: 'source', entityId: 'task-source', sourceId: 'task-source', itemId: item.id, label: item.title, excerpt: 'source evidence' }],
      }],
    })

    let listed = fixture.service.listResearchTasks()
    const aiTask = listed.tasks.find(task => task.sourceType === 'ai_suggestion')
    const milestoneTask = listed.tasks.find(task => task.sourceType === 'milestone' && task.sourceId === milestone.id)
    const runTask = listed.tasks.find(task => task.sourceType === 'run' && task.sourceId === run.id)
    const anomalyTask = listed.tasks.find(task => task.sourceType === 'anomaly' && task.sourceId === run.id)
    const paperTask = listed.tasks.find(task => task.sourceType === 'paper' && task.sourceId === item.id)
    assert.equal(aiTask.approvalStatus, 'proposed')
    assert.equal(aiTask.isFormal, false)
    assert.equal(milestoneTask.status, 'today')
    assert.equal(runTask.title, '固定随机种子后再运行')
    assert.equal(anomalyTask.status, 'waiting')
    assert.equal(paperTask.returnTarget.pageNumber, 3)
    assert.throws(() => fixture.service.updateResearchTask({ taskId: aiTask.id, status: 'today' }), /必须人工确认/)

    listed = fixture.service.updateResearchTask({ taskId: aiTask.id, decision: 'confirm' })
    assert.equal(listed.tasks.find(task => task.id === aiTask.id).isFormal, true)
    listed = fixture.service.updateResearchTask({ taskId: aiTask.id, status: 'completed' })
    assert.equal(fixture.service.getActionPack(pack.id).items[0].status, 'completed')

    assert.throws(() => fixture.service.updateResearchTask({ taskId: milestoneTask.id, status: 'waiting' }), /等待条件/)
    fixture.service.updateResearchTask({ taskId: milestoneTask.id, status: 'waiting', waitCondition: '等待传感器返修' })
    assert.equal(fixture.service.getResearchWorkspace().milestones.find(entry => entry.id === milestone.id).status, 'blocked')
    fixture.service.updateResearchTask({ taskId: milestoneTask.id, status: 'completed' })
    assert.equal(fixture.service.getResearchWorkspace().milestones.find(entry => entry.id === milestone.id).status, 'completed')

    fixture.service.updateResearchTask({ taskId: paperTask.id, status: 'completed' })
    assert.equal(fixture.service.loadLibraryState().bibliographicItems.find(entry => entry.id === item.id).readingState.readingStatus, 'finished')
    fixture.service.updateResearchTask({ taskId: runTask.id, status: 'completed' })
    assert.equal(fixture.service.listResearchTasks().tasks.find(task => task.id === runTask.id).status, 'completed')

    const converted = fixture.service.createResearchTask({
      sourceType: 'annotation', sourceId: 'task-annotation', title: '复核批注中的实验条件', status: 'today',
    })
    assert.equal(converted.task.returnTarget.pageNumber, 3)
    assert.equal(fixture.service.createResearchTask({ sourceType: 'annotation', sourceId: 'task-annotation' }).alreadyExists, true)
    const manual = fixture.service.createResearchTask({ title: '整理今天的运行日志', status: 'inbox' })
    assert.equal(manual.task.sourceType, 'manual')
    assert.throws(() => fixture.service.updateResearchTask({ taskId: manual.task.id, status: 'deferred' }), /恢复时间/)
    listed = fixture.service.updateResearchTask({ taskId: manual.task.id, status: 'deferred', deferredUntil: '2026-08-15T09:00:00+08:00' })
    assert.equal(listed.tasks.find(task => task.id === manual.task.id).status, 'deferred')

    const event = fixture.service.database.prepare('SELECT id FROM research_task_events ORDER BY rowid DESC LIMIT 1').get()
    assert.throws(() => fixture.service.database.prepare("UPDATE research_task_events SET note = '覆盖' WHERE id = ?").run(event.id), /append-only/)
    assert.throws(() => fixture.service.database.prepare('DELETE FROM research_task_events WHERE id = ?').run(event.id), /cannot be deleted/)
  } finally {
    fixture.close()
  }
})

test('科研现场保存阅读位置、模式和当前 Run，重开后可恢复且事件不可覆盖', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '今日科研恢复测试')
    const firstSession = fixture.service.beginResearchSession()
    assert.equal(firstSession.firstVisit, true)
    assert.equal(firstSession.activeView, 'today')

    fixture.service.importSourceFile({
      id: 'resume-source',
      fileName: 'half-read.pdf',
      kind: 'PDF',
      bytes: Buffer.from('%PDF-1.4 resume state'),
    })
    fixture.service.syncLibraryState({
      workspaceId: vault.id,
      sources: [{
        id: 'resume-source', fileId: 'resume-source', name: 'half-read.pdf', kind: 'PDF', version: 1,
        status: '已解析', readerState: { viewMode: 'markdown', zoom: 1.1 },
      }],
      annotations: [],
    })
    const workspace = fixture.service.saveResearchRun({
      title: '进行中的装配复测',
      outcome: 'running',
      nextStep: '只改变接触刚度后复测',
    })
    const run = workspace.runs.find(item => item.title === '进行中的装配复测')
    const saved = fixture.service.saveResearchResume({
      projectId: vault.projectId,
      activeView: 'reader',
      sourceId: 'resume-source',
      pageNumber: 17,
      readerMode: 'markdown',
      activeRunId: run.id,
    })
    assert.equal(saved.sourceId, 'resume-source')
    assert.equal(saved.pageNumber, 17)
    assert.equal(saved.readerMode, 'markdown')
    assert.equal(saved.activeRunId, run.id)
    assert.throws(() => fixture.service.saveResearchResume({ sourceId: 'other-source' }), /不存在或不属于/)
    assert.throws(() => fixture.service.saveResearchResume({ activeRunId: 'other-run' }), /不存在或不属于/)

    fixture.service.close()
    fixture.service.open(vault.path)
    const returned = fixture.service.beginResearchSession()
    assert.equal(returned.firstVisit, false)
    assert.ok(returned.previousActiveAt)
    assert.equal(returned.activeView, 'reader')
    assert.equal(returned.sourceId, 'resume-source')
    assert.equal(returned.pageNumber, 17)
    assert.equal(returned.readerMode, 'markdown')
    assert.equal(returned.activeRunId, run.id)
    const event = fixture.service.database.prepare(
      'SELECT id FROM research_resume_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT 1',
    ).get(vault.projectId)
    assert.throws(
      () => fixture.service.database.prepare("UPDATE research_resume_events SET event_type = 'closed' WHERE id = ?").run(event.id),
      /append-only/,
    )
    assert.throws(
      () => fixture.service.database.prepare('DELETE FROM research_resume_events WHERE id = ?').run(event.id),
      /cannot be deleted/,
    )
  } finally {
    fixture.close()
  }
})

test('周报先保存草稿再确认，并可带来源追溯导出 Markdown', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '报告工作台')
    fixture.service.importSourceFile({
      id: 'source-weekly-evidence',
      fileName: 'navigation-paper.pdf',
      kind: 'PDF',
      bytes: Buffer.from('%PDF-1.4 weekly evidence'),
    })
    const draft = fixture.service.saveResearchReport({
      title: '第 3 周科研周报',
      type: 'weekly',
      period: '2026-08-03 至 2026-08-09',
      markdown: '## 本周进展\n\n完成 ROS 导航基线阅读。',
      sourceRefs: [{ type: 'source', id: 'source-weekly-evidence' }],
    })
    assert.equal(draft.status, 'draft')
    assert.equal(draft.sourceRefs[0].label, 'navigation-paper.pdf')
    assert.equal(fixture.service.getResearchWorkspace().reports[0].id, draft.id)

    const confirmed = fixture.service.confirmResearchReport({ id: draft.id })
    assert.equal(confirmed.status, 'confirmed')
    assert.ok(confirmed.confirmedAt)
    const exported = fixture.service.exportResearchReport({ id: draft.id })
    assert.equal(exported.format, 'markdown')
    assert.ok(fs.existsSync(exported.filePath))
    const markdown = fs.readFileSync(exported.filePath, 'utf8')
    assert.match(markdown, /第 3 周科研周报/)
    assert.match(markdown, /来源追溯/)
    assert.match(markdown, /source-weekly-evidence/)
    assert.equal(crypto.createHash('sha256').update(markdown).digest('hex'), exported.fileSha256)
    const portableDirectory = path.join(fixture.root, 'portable-notes')
    fs.mkdirSync(portableDirectory)
    const portable = fixture.service.exportPortableMarkdown({ kind: 'research_report', id: draft.id, directory: portableDirectory })
    const portableAgain = fixture.service.exportPortableMarkdown({ kind: 'research_report', id: draft.id, directory: portableDirectory })
    assert.equal(portable.filePath, portableAgain.filePath)
    assert.equal(portableAgain.overwritten, true)
    const portableText = fs.readFileSync(portable.filePath, 'utf8')
    assert.match(portableText, /source_of_truth: "小何的科研助手本地记录"/)
    assert.match(portableText, /export_direction: "one-way-snapshot"/)
    assert.match(portableText, /source-weekly-evidence/)
  } finally {
    fixture.close()
  }
})

test('科研论断允许无证据草稿但拒绝无证据确认，并保留已确认内容的修订历史', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '论文论断工作台')
    fixture.service.importSourceFile({
      id: 'source-claim-evidence',
      fileName: 'controller.pdf',
      kind: 'PDF',
      bytes: Buffer.from('%PDF-1.4 claim evidence'),
    })
    const draft = fixture.service.saveResearchClaim({
      section: '结果 / 稳定性',
      text: '提高速度后稳定性下降。',
      status: 'draft',
      requiredEvidence: ['run', 'figure'],
    })
    assert.equal(draft.status, 'draft')
    assert.deepEqual(draft.requiredEvidence, ['run', 'figure'])
    assert.throws(
      () => fixture.service.saveResearchClaim({ id: draft.id, status: 'confirmed' }),
      /没有已验证证据.*不能确认/,
    )

    const confirmed = fixture.service.saveResearchClaim({
      id: draft.id,
      status: 'confirmed',
      evidenceRefs: [{ type: 'source', id: 'source-claim-evidence' }],
    })
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.revisionNumber, 2)
    assert.equal(confirmed.revisions.length, 1)
    assert.equal(confirmed.evidenceRefs[0].label, 'controller.pdf')

    const revised = fixture.service.saveResearchClaim({
      id: draft.id,
      text: '在当前参数范围内，提高速度后稳定裕量下降。',
    })
    assert.equal(revised.status, 'draft')
    assert.equal(revised.revisionNumber, 3)
    assert.equal(revised.revisions.length, 2)
    assert.equal(revised.revisions[0].snapshot.text, '提高速度后稳定性下降。')
    assert.equal(revised.revisions[0].snapshot.status, 'confirmed')

    const reconfirmed = fixture.service.saveResearchClaim({ id: draft.id, status: 'confirmed' })
    assert.equal(reconfirmed.status, 'confirmed')
    assert.equal(reconfirmed.revisionNumber, 4)
    assert.equal(reconfirmed.revisions[0].snapshot.status, 'draft')

    const archived = fixture.service.archiveResearchClaim({ id: draft.id })
    assert.equal(archived.alreadyArchived, false)
    assert.equal(fixture.service.listResearchClaims().length, 0)
    assert.equal(fixture.service.listResearchClaims({ includeArchived: true })[0].id, draft.id)
  } finally {
    fixture.close()
  }
})

test('报告和论断拒绝引用另一个研究库的文献、测试与成果', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '第一课题')
    fixture.service.importSourceFile({
      id: 'source-foreign',
      fileName: 'foreign.pdf',
      kind: 'PDF',
      bytes: Buffer.from('%PDF-1.4 foreign'),
    })
    const firstWorkspace = fixture.service.getResearchWorkspace()
    fixture.service.saveResearchMilestone({ title: '第一课题里程碑' })
    const firstMilestoneId = fixture.service.getResearchWorkspace().milestones[0].id
    fixture.service.create(fixture.root, '第二课题')

    assert.throws(() => fixture.service.saveResearchReport({
      title: '错误周报',
      type: 'weekly',
      markdown: '不应写入。',
      sourceRefs: [{ type: 'source', id: 'source-foreign' }],
    }), /不存在或不属于当前课题/)
    assert.throws(() => fixture.service.saveResearchClaim({
      section: '结果',
      text: '错误论断',
      status: 'confirmed',
      evidenceRefs: [{ type: 'milestone', id: firstMilestoneId }],
    }), /不存在或不属于当前课题/)
    assert.ok(firstWorkspace.project.id)
    assert.equal(fixture.service.getResearchWorkspace().reports.length, 0)
    assert.equal(fixture.service.getResearchWorkspace().claims.length, 0)
  } finally {
    fixture.close()
  }
})

test('科研项目支持探索和执行模式、里程碑、内置及当前研究库自定义测试模板', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '通用工科项目')
    const initial = fixture.service.getResearchWorkspace()
    assert.equal(initial.runTemplates.filter(template => template.builtIn).length, 6)
    assert.ok(initial.runTemplates.some(template => template.id === 'builtin-ros-parameter'))

    const project = fixture.service.saveResearchProject({
      projectId: vault.projectId,
      mode: 'execution',
      stage: '基线验证',
      createdBy: 'user',
    })
    assert.equal(project.project.mode, 'execution')
    assert.deepEqual(new Set(project.history[0].changedFields), new Set(['stage', 'mode']))

    const withMilestone = fixture.service.saveResearchMilestone({
      projectId: vault.projectId,
      title: '完成导航算法基线',
      description: '形成可重复的仿真基准。',
      status: 'active',
      acceptanceCriteria: ['完成默认参数测试', '轨迹图可追溯到原始数据'],
    })
    assert.equal(withMilestone.milestones[0].status, 'active')
    assert.equal(withMilestone.milestones[0].acceptanceCriteria.length, 2)

    const customized = fixture.service.saveResearchRunTemplate({
      projectId: vault.projectId,
      name: '我的 Gazebo 重复性测试',
      category: 'custom-ros',
      description: '固定地图与种子，重复运行三次。',
      defaults: {
        environment: 'ROS 2 Jazzy / Gazebo',
        command: 'ros2 launch demo baseline.launch.py',
        changedVariables: [{ name: 'random_seed', currentValue: '42' }],
      },
    })
    const custom = customized.runTemplates.find(template => !template.builtIn)
    assert.equal(custom.projectId, vault.projectId)
    assert.equal(custom.defaults.changedVariables[0].name, 'random_seed')
    assert.throws(
      () => fixture.service.saveResearchRunTemplate({ id: 'builtin-ros-parameter', name: '篡改内置模板' }),
      /内置测试模板不可修改/,
    )
    assert.throws(() => fixture.service.saveResearchProject({ mode: 'unknown' }), /课题模式无效/)
  } finally {
    fixture.close()
  }
})

test('一次测试会关联里程碑和模板，并原地登记文件或目录的可验证元数据', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '机器人测试项目')
    const milestone = fixture.service.saveResearchMilestone({
      title: '完成 ROS 导航基线',
      status: 'active',
      acceptanceCriteria: ['至少一次有效成功测试'],
    }).milestones[0]
    let workspace = fixture.service.saveResearchRun({
      milestoneId: milestone.id,
      templateId: 'builtin-ros-parameter',
      title: '调整最大线速度',
      purpose: '观察速度变化对轨迹跟踪的影响。',
      hypothesis: '更高速度会增大转弯误差。',
      changedVariables: [{ name: 'max_vel_x', previousValue: '0.25', currentValue: '0.35', unit: 'm/s' }],
      command: 'ros2 launch nav2_bringup tb3_simulation_launch.py',
      outcome: 'failure',
      observations: '直线速度提高。',
      anomaly: '转弯出现振荡。',
      nextStep: '保持线速度不变，仅降低角速度限制。',
      startedAt: '2026-08-08T10:00:00+08:00',
      endedAt: '2026-08-08T10:05:00+08:00',
    })
    const run = workspace.runs[0]
    assert.equal(run.milestoneId, milestone.id)
    assert.equal(run.templateId, 'builtin-ros-parameter')
    assert.equal(run.changedVariables[0].currentValue, '0.35')
    assert.match(run.environment, /ROS/)

    const resultFile = path.join(fixture.root, 'run-001.csv')
    fs.writeFileSync(resultFile, 't,x,y\n0,0,0\n1,1,2\n')
    const resultDirectory = path.join(fixture.root, 'rosbag-run-001')
    fs.mkdirSync(resultDirectory)
    fs.writeFileSync(path.join(resultDirectory, 'metadata.yaml'), 'version: 9')
    workspace = fixture.service.saveResearchArtifact({
      runId: run.id,
      label: '轨迹原始数据',
      role: 'raw_data',
      filePath: resultFile,
    })
    workspace = fixture.service.saveResearchArtifact({
      runId: run.id,
      label: 'ROS bag 目录',
      role: 'directory',
      filePath: resultDirectory,
    })
    const fileArtifact = workspace.artifacts.find(artifact => artifact.kind === 'file')
    const directoryArtifact = workspace.artifacts.find(artifact => artifact.kind === 'directory')
    assert.equal(fileArtifact.filePath, resultFile)
    assert.equal(fileArtifact.contentSha256, crypto.createHash('sha256').update(fs.readFileSync(resultFile)).digest('hex'))
    assert.equal(fileArtifact.sizeBytes, fs.statSync(resultFile).size)
    assert.equal(directoryArtifact.metadata.entryCount, 1)
    assert.equal(fs.readFileSync(resultFile, 'utf8'), 't,x,y\n0,0,0\n1,1,2\n')
    assert.equal(fs.existsSync(path.join(vault.path, 'papers', path.basename(resultFile))), false)
    const portable = fixture.service.exportPortableMarkdown({
      kind: 'experiment_retrospective', id: run.id, directory: fixture.root,
    })
    const portableText = fs.readFileSync(portable.filePath, 'utf8')
    assert.match(portableText, /type: "experiment_retrospective"/)
    assert.match(portableText, /max_vel_x: 0\.25 → 0\.35 m\/s/)
    assert.match(portableText, /原始文件：`.*run-001\.csv`/)
    assert.match(portableText, /Run：调整最大线速度/)

    const timestamp = new Date().toISOString()
    fixture.service.database.prepare(
      'INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('other-engineering-project', '其他工科项目', timestamp, timestamp)
    fixture.service.database.prepare(`
      INSERT INTO research_runs(id, project_id, title, started_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('other-run', 'other-engineering-project', '其他测试', timestamp, timestamp, timestamp)
    fixture.service.database.prepare(`
      INSERT INTO research_milestones(id, project_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('other-milestone', 'other-engineering-project', '其他里程碑', timestamp, timestamp)
    fixture.service.database.prepare(`
      INSERT INTO research_run_templates(id, project_id, name, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('other-template', 'other-engineering-project', '其他模板', 'custom', timestamp, timestamp)
    assert.throws(
      () => fixture.service.saveResearchArtifact({ runId: 'other-run', filePath: resultFile }),
      /不存在或不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchArtifact({ runId: run.id, filePath: 'relative.csv' }),
      /必须是绝对路径/,
    )
    assert.throws(
      () => fixture.service.saveResearchArtifact({ runId: run.id, filePath: path.join(fixture.root, 'missing.csv') }),
      /不存在/,
    )
    assert.throws(
      () => fixture.service.saveResearchRun({ title: '越权里程碑', milestoneId: 'other-milestone' }),
      /里程碑不存在或不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchRun({ title: '越权模板', templateId: 'other-template' }),
      /测试模板不存在或不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchMilestone({ id: 'other-milestone', title: '越权修改' }),
      /里程碑不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchRunTemplate({ id: 'other-template', name: '越权修改' }),
      /测试模板不属于当前课题/,
    )
    assert.throws(
      () => fixture.service.saveResearchRun({ title: '错误变量', changedVariables: [{ name: 'max_vel_x' }] }),
      /变量当前值不能为空/,
    )
  } finally {
    fixture.close()
  }
})

test('英文对照阅读缓存按当前课题、来源、分段和原文哈希精确命中', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '英文阅读项目')
    const timestamp = new Date().toISOString()
    fixture.service.database.prepare(`
      INSERT INTO sources(id, project_id, name, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('english-source', vault.projectId, 'paper.pdf', 'PDF', '已解析', timestamp, timestamp)
    fixture.service.database.prepare(
      'INSERT INTO projects(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('other-translation-project', '其他阅读项目', timestamp, timestamp)
    fixture.service.database.prepare(`
      INSERT INTO sources(id, project_id, name, kind, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('other-english-source', 'other-translation-project', 'other.pdf', 'PDF', '已解析', timestamp, timestamp)

    const sourceText = 'The controller remains stable under bounded disturbances.'
    const sourceHash = crypto.createHash('sha256').update(sourceText, 'utf8').digest('hex')
    const saved = fixture.service.saveReadingTranslationSegment({
      sourceId: 'english-source',
      segmentId: 'page-1-paragraph-3',
      sourceHash,
      sourceText,
      translatedText: '在有界扰动下，该控制器保持稳定。',
      provider: 'argos',
      model: 'en_zh',
      status: 'translated',
    })
    assert.equal(saved.translatedText, '在有界扰动下，该控制器保持稳定。')
    assert.equal(saved.status, 'translated')
    const uiHash = bilingualSourceHash('A second paragraph for the side-by-side reader.')
    assert.equal(fixture.service.saveReadingTranslationSegment({
      sourceId: 'english-source',
      segmentId: 'segment-ui-hash-1',
      sourceHash: uiHash,
      sourceText: 'A second paragraph for the side-by-side reader.',
      translatedText: '用于对照阅读的第二个段落。',
      provider: 'local',
      status: 'translated',
      attempts: 1,
    }).attempts, 1)
    const exact = fixture.service.getReadingTranslationSegments({
      sourceId: 'english-source',
      segments: [{ segmentId: 'page-1-paragraph-3', sourceHash }],
    })
    assert.equal(exact.segments.length, 1)
    assert.equal(exact.misses.length, 0)
    const changedHash = crypto.createHash('sha256').update(`${sourceText} changed`, 'utf8').digest('hex')
    const stale = fixture.service.getReadingTranslationSegments({
      sourceId: 'english-source',
      segments: [{ segmentId: 'page-1-paragraph-3', sourceHash: changedHash }],
    })
    assert.equal(stale.segments.length, 0)
    assert.deepEqual(stale.misses, [{ segmentId: 'page-1-paragraph-3', sourceHash: changedHash }])
    const extractedText = 'The controIler remains stable.'
    const baseSourceHash = bilingualSourceHash(extractedText)
    const correctedText = 'The controller remains stable.'
    const correctedHash = bilingualSourceHash(correctedText)
    const corrected = fixture.service.saveReadingTranslationSegment({
      sourceId: 'english-source', segmentId: 'corrected-segment', baseSourceHash,
      sourceHash: correctedHash, sourceText: correctedText, translatedText: '控制器保持稳定。',
      provider: 'local', status: 'translated', attempts: 1, locked: true,
    })
    assert.equal(corrected.baseSourceHash, baseSourceHash)
    assert.equal(corrected.sourceHash, correctedHash)
    assert.equal(corrected.sourceText, correctedText)
    assert.equal(corrected.locked, true)
    assert.equal(fixture.service.getReadingTranslationSegments({
      sourceId: 'english-source', segments: [{ segmentId: 'corrected-segment', sourceHash: baseSourceHash }],
    }).segments[0].translatedText, '控制器保持稳定。')
    assert.throws(() => fixture.service.saveReadingTranslationSegment({
      sourceId: 'english-source', segmentId: 'corrected-segment', baseSourceHash,
      sourceHash: correctedHash, sourceText: correctedText, translatedText: '试图覆盖锁定译文。',
      provider: 'ai', status: 'translated', attempts: 2,
    }), /已锁定/)
    const unlocked = fixture.service.saveReadingTranslationSegment({
      sourceId: 'english-source', segmentId: 'corrected-segment', baseSourceHash,
      sourceHash: correctedHash, sourceText: correctedText, translatedText: '控制器保持稳定。',
      provider: 'local', status: 'translated', attempts: 1, locked: false, unlock: true,
    })
    assert.equal(unlocked.locked, false)

    let glossary = fixture.service.saveReadingTranslationTerm({
      sourceId: 'english-source', sourceTerm: 'bounded disturbances', targetTerm: '有界扰动', note: '控制领域',
    })
    assert.equal(glossary.length, 1)
    glossary = fixture.service.saveReadingTranslationTerm({
      sourceId: 'english-source', sourceTerm: 'bounded disturbances', targetTerm: '有界干扰', note: '用户修订',
    })
    assert.equal(glossary.length, 1)
    assert.equal(glossary[0].targetTerm, '有界干扰')
    assert.equal(fixture.service.deleteReadingTranslationTerm({ sourceId: 'english-source', termId: glossary[0].id }).length, 0)
    assert.throws(
      () => fixture.service.saveReadingTranslationSegment({
        sourceId: 'english-source', segmentId: 'bad', sourceHash, sourceText: '不同原文', provider: 'argos', status: 'pending',
      }),
      /哈希与原文不一致/,
    )
    assert.throws(
      () => fixture.service.getReadingTranslationSegments({ sourceId: 'other-english-source', segments: [] }),
      /不属于当前研究库/,
    )
  } finally {
    fixture.close()
  }
})

test('行动建议可以直接引用当前课题的里程碑和测试证据', () => {
  const fixture = withService()
  try {
    fixture.service.create(fixture.root, '研究行动闭环')
    const milestone = fixture.service.saveResearchMilestone({
      title: '完成算法基线',
      description: '获得可重复的基线指标。',
      status: 'active',
    }).milestones[0]
    const run = fixture.service.saveResearchRun({
      milestoneId: milestone.id,
      title: '基线测试 01',
      purpose: '测量默认参数的基准误差。',
      outcome: 'success',
      observations: '平均误差为 2.1 cm。',
    }).runs[0]
    const pack = fixture.service.createActionPack({
      title: '下一步实验建议',
      objective: '降低轨迹误差',
      scope: { kind: 'library', label: '当前课题', itemIds: [] },
      createdBy: 'ai',
      actions: [{
        actionType: 'experiment',
        title: '只调整角速度限制',
        rationale: '基线已形成，下一次应只改变一个变量。',
        evidence: [
          { evidenceType: 'milestone', entityId: milestone.id, label: '', excerpt: '' },
          { evidenceType: 'run', entityId: run.id, label: '', excerpt: '' },
        ],
      }],
    })
    assert.deepEqual(new Set(pack.items[0].evidence.map(item => item.evidenceType)), new Set(['milestone', 'run']))
    assert.equal(pack.items[0].evidence.find(item => item.evidenceType === 'run').runId, run.id)
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
    const vault = fixture.service.create(fixture.root, '题录导入测试')
    const importDirectory = path.join(fixture.root, 'incoming')
    fs.mkdirSync(importDirectory)
    fs.writeFileSync(path.join(importDirectory, 'paper.pdf'), '%PDF-bibliography-test')
    const risPath = path.join(importDirectory, 'library.ris')
    fs.writeFileSync(risPath, [
      'TY  - JOUR',
      'ID  - ORIGINAL-88',
      'AU  - Doe, Jane',
      'TI  - Imported with attachment',
      'JO  - Journal of Import Tests',
      'PY  - 2025',
      'VL  - 4',
      'IS  - 2',
      'SP  - 10',
      'EP  - 20',
      'DO  - 10.1234/imported',
      'L1  - paper.pdf',
      'ER  - ',
      '',
    ].join('\r\n'))

    const first = fixture.service.importBibliographyFile(risPath)
    const second = fixture.service.importBibliographyFile(risPath)
    assert.equal(first.itemCount, 1)
    assert.equal(first.copiedSourceCount, 1)
    assert.equal(second.alreadyImported, true)
    assert.deepEqual(second.itemIds, first.itemIds)
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
    const library = fixture.service.loadLibraryState()
    assert.equal(library.sources.length, 1)
    assert.equal(
      library.bibliographicItems[0].citation.text,
      'DOE J. Imported with attachment[J]. Journal of Import Tests, 2025, 4(2): 10-20. DOI:10.1234/imported.',
    )
    assert.equal(library.bibliographicItems[0].citation.incomplete, false)
    const capabilities = fixture.service.getZoteroSyncCapabilities()
    assert.equal(capabilities.writesZoteroDatabase, false)
    const metadataRecord = {
      itemKey: 'ZOTERO88', libraryId: 'personal', rawRecordId: 'ORIGINAL-88',
      rawRecordIdField: 'ID', importFormat: 'ris', version: 4,
      collections: ['核心论文', '装配'], attachmentKeys: ['ATTACH-PDF-1'],
    }
    const preview = fixture.service.previewZoteroMetadataSync({ records: [metadataRecord] })
    assert.equal(preview.counts.added, 1)
    assert.equal(preview.added[0].localItemId, first.itemIds[0])
    const applied = fixture.service.applyZoteroMetadataSync({ records: [metadataRecord] })
    assert.equal(applied.counts.added, 1)
    assert.equal(fixture.service.previewZoteroMetadataSync({ records: [metadataRecord] }).counts.unchanged, 1)
    assert.equal(fixture.service.previewZoteroMetadataSync({ records: [{ ...metadataRecord, collections: ['核心论文'] }] }).counts.updated, 1)
    const external = fixture.service.database.prepare(`
      SELECT external_item_key, collections_json, attachment_keys_json
      FROM bibliographic_external_refs
    `).get()
    assert.equal(external.external_item_key, 'ZOTERO88')
    assert.deepEqual(JSON.parse(external.collections_json), ['核心论文', '装配'])
    assert.deepEqual(JSON.parse(external.attachment_keys_json), ['ATTACH-PDF-1'])
    assert.equal(fixture.service.database.prepare('SELECT count(*) AS count FROM bibliographic_sync_runs').get().count, 1)
    assert.throws(() => fixture.service.applyZoteroMetadataSync({ records: [metadataRecord, metadataRecord] }), /未执行.*冲突/)
    fixture.service.close()
    fixture.service.open(vault.path)
    assert.equal(fixture.service.previewZoteroMetadataSync({ records: [metadataRecord] }).counts.unchanged, 1)
  } finally {
    fixture.close()
  }
})

test('结构化阅读稿独立版本化、可手调和恢复，重启后仍不覆盖 MinerU 原始 Markdown', () => {
  const fixture = withService()
  try {
    const vault = fixture.service.create(fixture.root, '结构化阅读版本测试')
    fixture.service.importSourceFile({
      id: 'structured-source',
      fileName: 'structured.pdf',
      kind: 'PDF',
      bytes: Buffer.from('%PDF-structured-reading'),
    })
    const rawMarkdown = 'Abstract\n\nFirst evidence paragraph.\n\nSecond evidence paragraph.'
    fixture.service.database.prepare(`
      UPDATE sources SET derived_markdown = ?, updated_at = ? WHERE id = ?
    `).run(rawMarkdown, new Date().toISOString(), 'structured-source')

    const generated = fixture.service.generateStructuredReading({ sourceId: 'structured-source' })
    assert.equal(generated.currentVersion.versionNumber, 1)
    assert.equal(generated.currentVersion.createdBy, 'rules')
    assert.equal(generated.currentVersion.blocks[0].kind, 'heading')
    const originalIds = generated.currentVersion.blocks.map(block => block.id)

    const adjusted = fixture.service.saveStructuredReadingAdjustment({
      sourceId: 'structured-source',
      baseVersionId: generated.currentVersion.id,
      orderedBlockIds: [originalIds[0], originalIds[2], originalIds[1]],
      headingLevels: { [originalIds[2]]: 2 },
      note: '把第二段提升为方法标题并调整位置。',
    })
    assert.equal(adjusted.currentVersion.versionNumber, 2)
    assert.equal(adjusted.currentVersion.createdBy, 'user')
    assert.deepEqual(adjusted.currentVersion.blocks.map(block => block.id), [originalIds[0], originalIds[2], originalIds[1]])
    assert.equal(adjusted.currentVersion.blocks[1].content, 'Second evidence paragraph.')
    assert.equal(adjusted.currentVersion.blocks[1].headingLevel, 2)
    assert.equal(fixture.service.database.prepare('SELECT derived_markdown FROM sources WHERE id = ?').get('structured-source').derived_markdown, rawMarkdown)
    assert.throws(
      () => fixture.service.database.prepare("UPDATE structured_reading_versions SET note = '覆盖历史' WHERE id = ?").run(generated.currentVersion.id),
      /immutable/,
    )

    fixture.service.close()
    fixture.service.open(vault.path)
    const restoredAfterRestart = fixture.service.getStructuredReading({ sourceId: 'structured-source' })
    assert.equal(restoredAfterRestart.currentVersion.versionNumber, 2)
    assert.equal(restoredAfterRestart.versions.length, 2)
    const rolledBack = fixture.service.restoreStructuredReadingVersion({
      sourceId: 'structured-source',
      versionId: generated.currentVersion.id,
    })
    assert.equal(rolledBack.currentVersion.versionNumber, 3)
    assert.equal(rolledBack.currentVersion.createdBy, 'restore')
    assert.equal(rolledBack.currentVersion.restoredFromVersionId, generated.currentVersion.id)
    assert.deepEqual(rolledBack.currentVersion.blocks.map(block => block.id), originalIds)
    assert.equal(fixture.service.database.prepare('SELECT derived_markdown FROM sources WHERE id = ?').get('structured-source').derived_markdown, rawMarkdown)

    fixture.service.database.prepare('UPDATE sources SET derived_markdown = ?, updated_at = ? WHERE id = ?')
      .run(`${rawMarkdown}\n\nNew MinerU revision.`, new Date().toISOString(), 'structured-source')
    assert.equal(fixture.service.getStructuredReading({ sourceId: 'structured-source' }).stale, true)
    assert.throws(
      () => fixture.service.restoreStructuredReadingVersion({ sourceId: 'structured-source', versionId: generated.currentVersion.id }),
      /不同的 MinerU 原始 Markdown/,
    )
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
    const portableDirectory = path.join(fixture.root, 'reading-card-notes')
    fs.mkdirSync(portableDirectory)
    const portable = fixture.service.exportPortableMarkdown({ kind: 'reading_card', id: itemId, directory: portableDirectory })
    const portableText = fs.readFileSync(portable.filePath, 'utf8')
    assert.match(portableText, /type: "reading_card"/)
    assert.match(portableText, /第 3 页/)
    assert.match(portableText, /research-reader:\/\/open\?sourceId=/)
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
    assert.match(markdownText, /## 参考文献/)
    assert.match(markdownText, /\[1\].+\[J\]/)
    assert.doesNotMatch(markdownText, /没有证据的推断/)
    const word = await fixture.service.exportReviewDocument({ documentId: document.id, format: 'docx' })
    assert.equal(fs.readFileSync(word.filePath).subarray(0, 2).toString(), 'PK')
    const latex = fixture.service.exportReviewLatexPackage({ documentId: document.id, compilePdf: false })
    assert.equal(latex.compiled, false)
    assert.match(fs.readFileSync(latex.texPath, 'utf8'), /\\bibliography\{references\}/)
    assert.match(fs.readFileSync(latex.bibPath, 'utf8'), /@article\{/)
    assert.match(fs.readFileSync(latex.sourcePath, 'utf8'), /research-reader:\/\/open\?sourceId=/)
    const apa = fixture.service.formatCitation({ itemId: items[0].id, style: 'apa-7' })
    const ieee = fixture.service.formatCitation({ itemId: items[0].id, style: 'ieee', sequence: 1 })
    assert.equal(apa.styleId, 'apa-7')
    assert.equal(ieee.styleId, 'ieee')
    assert.equal(fixture.service.listCitationStyles().length, 4)
    assert.equal(fixture.service.database.prepare('SELECT count(*) AS count FROM export_records').get().count, 2)
    assert.throws(
      () => fixture.service.exportPortableMarkdown({ kind: 'review_document', id: document.id, directory: fixture.root }),
      /必须先由用户确认/,
    )
    const confirmedDocument = fixture.service.confirmReviewDocument({ documentId: document.id })
    assert.equal(confirmedDocument.status, 'reviewed')
    const portable = fixture.service.exportPortableMarkdown({ kind: 'review_document', id: document.id, directory: fixture.root })
    const portableText = fs.readFileSync(portable.filePath, 'utf8')
    assert.match(portableText, /type: "review_document"/)
    assert.match(portableText, /\[\[reading-card--/)
    assert.match(portableText, /research-reader:\/\/open\?sourceId=/)
    assert.doesNotMatch(portableText, /没有证据的推断/)
  } finally {
    fixture.close()
  }
})
