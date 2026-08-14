const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

test('Windows 打包清理只保留最新三个 release 目录', { skip: process.platform !== 'win32' }, () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-release-retention-'))
  const scriptPath = path.join(__dirname, '..', 'scripts', 'cleanup-release-directories.ps1')
  const releaseNames = ['release-old', 'release-middle', 'release-new', 'release-newest']

  try {
    releaseNames.forEach((name, index) => {
      const directory = path.join(fixtureRoot, name)
      fs.mkdirSync(directory)
      fs.writeFileSync(path.join(directory, 'artifact.txt'), name)
      const timestamp = new Date(Date.UTC(2026, 0, index + 1))
      fs.utimesSync(directory, timestamp, timestamp)
    })
    fs.mkdirSync(path.join(fixtureRoot, 'research-data'))

    const result = spawnSync('pwsh', [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-ProjectRoot',
      fixtureRoot,
      '-Keep',
      '3',
    ], { encoding: 'utf8' })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'release-old')), false)
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'release-middle')), true)
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'release-new')), true)
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'release-newest')), true)
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'research-data')), true)
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

