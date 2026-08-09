const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const { createMigrationBackup, listMigrationBackups, verifyMigratedDatabase } = require('../electron/migration-backup.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-backup-'))
  fs.writeFileSync(path.join(root, 'vault.json'), JSON.stringify({ id: 'vault', projectId: 'project', name: '迁移测试', schemaVersion: 17 }))
  const database = new DatabaseSync(path.join(root, 'library.sqlite'))
  database.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); PRAGMA user_version = 17;')
  database.close()
  return root
}

test('升级前快照按原数据库哈希幂等创建并可重新校验', () => {
  const root = fixture()
  try {
    const first = createMigrationBackup({ root, targetVersion: 18 })
    const second = createMigrationBackup({ root, targetVersion: 18 })
    assert.equal(first.id, second.id)
    assert.equal(first.sourceVersion, 17)
    const listed = listMigrationBackups(root)
    assert.equal(listed.length, 1)
    assert.equal(listed[0].valid, true)
    assert.equal(fs.readFileSync(path.join(listed[0].directory, 'library.sqlite')).subarray(0, 15).toString(), 'SQLite format 3')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('已是目标版本时不重复创建备份，迁移后执行 quick_check 与外键检查', () => {
  const root = fixture()
  try {
    const databasePath = path.join(root, 'library.sqlite')
    const database = new DatabaseSync(databasePath)
    database.exec('PRAGMA user_version = 18; PRAGMA foreign_keys = ON;')
    assert.deepEqual(verifyMigratedDatabase(database, 18), { version: 18, quickCheck: 'ok', foreignKeyErrors: 0 })
    database.close()
    assert.equal(createMigrationBackup({ root, targetVersion: 18 }), undefined)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('备份数据库被改动后标记为无效而不是继续声称可回滚', () => {
  const root = fixture()
  try {
    const created = createMigrationBackup({ root, targetVersion: 18 })
    fs.appendFileSync(path.join(root, '.reader-cache', 'migration-backups', created.id, 'library.sqlite'), 'tampered')
    assert.equal(listMigrationBackups(root)[0].valid, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
