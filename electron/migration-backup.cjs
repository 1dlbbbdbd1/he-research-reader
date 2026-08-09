const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function readDatabaseVersion(databasePath) {
  if (!fs.existsSync(databasePath)) return 0
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try { return Number(database.prepare('PRAGMA user_version').get().user_version) || 0 }
  finally { database.close() }
}

function safeTimestamp() { return new Date().toISOString().replace(/[:.]/g, '-') }

function migrationBackupRoot(root) {
  return path.join(path.resolve(root), '.reader-cache', 'migration-backups')
}

function createMigrationBackup({ root, targetVersion }) {
  const resolvedRoot = path.resolve(root)
  const databasePath = path.join(resolvedRoot, 'library.sqlite')
  const vaultPath = path.join(resolvedRoot, 'vault.json')
  if (!fs.existsSync(databasePath) || !fs.existsSync(vaultPath)) return undefined
  const sourceVersion = readDatabaseVersion(databasePath)
  if (sourceVersion >= targetVersion) return undefined
  const databaseSha256 = sha256File(databasePath)
  const id = `v${sourceVersion}-to-v${targetVersion}-${databaseSha256.slice(0, 12)}`
  const directory = path.join(migrationBackupRoot(resolvedRoot), id)
  const metadataPath = path.join(directory, 'migration-backup.json')
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (metadata.databaseSha256 === databaseSha256 && fs.existsSync(path.join(directory, 'library.sqlite'))) return metadata
    throw new Error(`迁移备份 ${id} 已存在但校验不一致，已停止升级。`)
  }
  fs.mkdirSync(directory, { recursive: true })
  fs.copyFileSync(databasePath, path.join(directory, 'library.sqlite'))
  fs.copyFileSync(vaultPath, path.join(directory, 'vault.json'))
  const sidecars = ['library.sqlite-wal', 'library.sqlite-shm'].filter(name => fs.existsSync(path.join(resolvedRoot, name)))
  for (const name of sidecars) fs.copyFileSync(path.join(resolvedRoot, name), path.join(directory, name))
  const metadata = {
    id,
    sourceVersion,
    targetVersion,
    createdAt: new Date().toISOString(),
    databaseSha256,
    vaultSha256: sha256File(vaultPath),
    files: ['library.sqlite', 'vault.json', ...sidecars],
    status: 'rollback-ready',
  }
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8')
  return metadata
}

function listMigrationBackups(root) {
  const directory = migrationBackupRoot(root)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^v\d+-to-v\d+-[a-f0-9]{12}$/.test(entry.name))
    .map(entry => {
      const metadataPath = path.join(directory, entry.name, 'migration-backup.json')
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        const databasePath = path.join(directory, entry.name, 'library.sqlite')
        return { ...metadata, valid: fs.existsSync(databasePath) && sha256File(databasePath) === metadata.databaseSha256, directory: path.join(directory, entry.name) }
      } catch { return { id: entry.name, valid: false, directory: path.join(directory, entry.name) } }
    })
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
}

function verifyMigratedDatabase(database, expectedVersion) {
  const version = Number(database.prepare('PRAGMA user_version').get().user_version)
  if (version !== expectedVersion) throw new Error(`数据库迁移版本异常：期望 v${expectedVersion}，实际 v${version}。`)
  const quickCheck = database.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0])
  if (quickCheck.length !== 1 || quickCheck[0] !== 'ok') throw new Error(`数据库完整性检查失败：${quickCheck.join('；')}`)
  const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyErrors.length) throw new Error(`数据库外键检查失败：${foreignKeyErrors.length} 项。`)
  return { version, quickCheck: 'ok', foreignKeyErrors: 0 }
}

module.exports = { createMigrationBackup, listMigrationBackups, migrationBackupRoot, readDatabaseVersion, sha256File, verifyMigratedDatabase }
