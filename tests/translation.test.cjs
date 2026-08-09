const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  MAX_TRANSLATION_CHARACTERS,
  candidatePythonExecutables,
  normalizeLanguageCode,
  parseBridgeResult,
  translationEnvironment,
} = require('../electron/local-translation.cjs')

test('translation runtime resolves development and packaged Python paths', () => {
  const development = candidatePythonExecutables({ projectRoot: 'C:\\projects\\research-reader' })
  assert.ok(development.includes(path.join(
    'C:\\projects\\research-reader',
    '.runtime',
    'translation',
    'argos',
    '.venv',
    'Scripts',
    'python.exe',
  )))

  const packaged = candidatePythonExecutables({
    runtimeRoot: 'C:\\Users\\researcher\\AppData\\Roaming\\ResearchReader\\translation-runtime',
  })
  assert.ok(packaged.includes(path.join(
    'C:\\Users\\researcher\\AppData\\Roaming\\ResearchReader\\translation-runtime',
    'argos',
    '.venv',
    'Scripts',
    'python.exe',
  )))
})

test('translation language codes are constrained and normalized', () => {
  assert.equal(normalizeLanguageCode('EN', 'en'), 'en')
  assert.equal(normalizeLanguageCode(undefined, 'zh'), 'zh')
  assert.throws(() => normalizeLanguageCode('../en', 'en'), /语言代码/)
})

test('translation bridge parses the explicit result marker only', () => {
  const output = [
    'dependency log line',
    'READER_ARGOS_RESULT:{"ok":true,"result":{"text":"你好","localOnly":true}}',
  ].join('\n')
  assert.deepEqual(parseBridgeResult(output), { text: '你好', localOnly: true })
  assert.throws(
    () => parseBridgeResult('READER_ARGOS_RESULT:{"ok":false,"error":"missing model"}'),
    /missing model/,
  )
})

test('translation environment keeps packages and profile under the chosen runtime', () => {
  const runtimeRoot = 'C:\\ReaderData\\translation-runtime'
  const environment = translationEnvironment(runtimeRoot)
  assert.equal(environment.ARGOS_PACKAGES_DIR, path.join(runtimeRoot, 'packages'))
  assert.equal(environment.XDG_DATA_HOME, path.join(runtimeRoot, 'data'))
  assert.equal(environment.XDG_CONFIG_HOME, path.join(runtimeRoot, 'config'))
  assert.equal(environment.XDG_CACHE_HOME, path.join(runtimeRoot, 'cache'))
  assert.equal(environment.LOCALAPPDATA, path.join(runtimeRoot, 'profile', 'LocalAppData'))
  assert.equal(environment.APPDATA, path.join(runtimeRoot, 'profile', 'AppData'))
  assert.equal(MAX_TRANSLATION_CHARACTERS, 50000)
})

test('bundled translation keeps model read-only and writes caches into user data', () => {
  const runtimeRoot = 'C:\\Program Files\\ResearchReader\\resources\\translation-runtime'
  const stateRoot = 'C:\\Users\\researcher\\AppData\\Roaming\\H’s 科研助手\\translation-state'
  const environment = translationEnvironment(runtimeRoot, stateRoot)
  assert.equal(environment.ARGOS_PACKAGES_DIR, path.join(runtimeRoot, 'packages'))
  assert.equal(environment.XDG_DATA_HOME, path.join(stateRoot, 'data'))
  assert.equal(environment.XDG_CONFIG_HOME, path.join(stateRoot, 'config'))
  assert.equal(environment.XDG_CACHE_HOME, path.join(stateRoot, 'cache'))
  assert.equal(environment.APPDATA, path.join(stateRoot, 'profile', 'AppData'))
})

test('Argos setup and bridge use explicit runtime and stdin translation', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-argos.ps1'), 'utf8')
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'argos-bridge.py'), 'utf8')
  assert.match(setup, /\[string\]\$RuntimeRoot/)
  assert.match(setup, /argostranslate==1\.11\.0/)
  assert.match(setup, /ARGOS_PACKAGES_DIR/)
  assert.match(bridge, /sys\.stdin\.read/)
  assert.match(bridge, /update_package_index/)
  assert.match(bridge, /install_from_path/)
})

test('Windows installer exposes an optional bundled translation page', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8')
  assert.match(installer, /customPageAfterChangeDir/)
  assert.match(installer, /InstallLocalTranslation/)
  assert.match(installer, /translation-runtime/)
  assert.match(installer, /pyvenv\.cfg/)
  assert.match(installer, /customUnInstall/)
  assert.match(installer, /RMDir \/r "\$INSTDIR\\resources\\translation-runtime"/)
})
