const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { candidateExecutables, safeFileName } = require('../electron/mineru.cjs')

test('safeFileName removes path traversal and Windows-invalid characters', () => {
  assert.equal(safeFileName('..\\unsafe:name?.pdf'), 'unsafe_name_.pdf')
  assert.equal(safeFileName(''), 'document.pdf')
})

test('development runtime is resolved inside the project', () => {
  const candidates = candidateExecutables({
    projectRoot: 'C:\\projects\\research-reader',
    resourcesPath: 'E:\\app\\resources',
  })
  assert.ok(candidates.includes(path.join('C:\\projects\\research-reader', '.runtime', 'mineru', '.venv', 'Scripts', 'mineru.exe')))
})

test('packaged runtime is resolved from the writable user data directory', () => {
  const candidates = candidateExecutables({
    runtimeRoot: 'C:\\Users\\researcher\\AppData\\Roaming\\ResearchReader\\mineru-runtime',
    resourcesPath: 'C:\\Program Files\\ResearchReader\\resources',
  })
  assert.ok(candidates.includes(path.join(
    'C:\\Users\\researcher\\AppData\\Roaming\\ResearchReader\\mineru-runtime',
    'mineru',
    '.venv',
    'Scripts',
    'mineru.exe',
  )))
})

test('MinerU setup script accepts an explicit runtime root for packaged installs', () => {
  const setupScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-mineru.ps1'), 'utf8')
  assert.match(setupScript, /\[string\]\$RuntimeRoot/)
  assert.match(setupScript, /\[System\.IO\.Path\]::GetFullPath\(\$RuntimeRoot\)/)
})
