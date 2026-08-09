const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { configureDesktopRuntime } = require('../electron/desktop-runtime.cjs')

function fakeApp(isPackaged = false) {
  const calls = []
  return {
    isPackaged,
    calls,
    disableHardwareAcceleration() { calls.push(['disableHardwareAcceleration']) },
    commandLine: {
      appendSwitch(name) { calls.push(['appendSwitch', name]) },
    },
  }
}

test('isolated Windows desktop tests use the documented testing fallback', () => {
  const app = fakeApp(false)
  const result = configureDesktopRuntime(app, {
    platform: 'win32',
    smokeRequested: true,
    isolatedTestRequested: true,
    managedCodexSession: false,
  })

  assert.equal(result.isDesktopSmoke, true)
  assert.equal(result.usesIsolatedWindowsTestCompatibility, true)
  assert.deepEqual(app.calls, [
    ['disableHardwareAcceleration'],
    ['appendSwitch', 'in-process-gpu'],
    ['appendSwitch', 'no-sandbox'],
  ])

  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /sandbox:\s*true/)
})

test('packaged applications keep the normal isolated GPU process', () => {
  const app = fakeApp(true)
  const result = configureDesktopRuntime(app, {
    platform: 'win32',
    smokeRequested: true,
    isolatedTestRequested: true,
    managedCodexSession: true,
    packagedSmokeRequested: false,
  })

  assert.equal(result.isDesktopSmoke, false)
  assert.equal(result.usesIsolatedWindowsTestCompatibility, false)
  assert.deepEqual(app.calls, [])
})

test('显式成品 smoke 才能在受管 Windows 使用测试兼容模式', () => {
  const app = fakeApp(true)
  const result = configureDesktopRuntime(app, {
    platform: 'win32',
    smokeRequested: true,
    isolatedTestRequested: true,
    managedCodexSession: true,
    packagedSmokeRequested: true,
  })

  assert.equal(result.isDesktopSmoke, true)
  assert.equal(result.packagedSmokeRequested, true)
  assert.equal(result.usesIsolatedWindowsTestCompatibility, true)
  assert.deepEqual(app.calls, [
    ['disableHardwareAcceleration'],
    ['appendSwitch', 'in-process-gpu'],
    ['appendSwitch', 'no-sandbox'],
    ['appendSwitch', 'single-process'],
  ])
})

test('normal development does not disable Chromium sandboxing', () => {
  const app = fakeApp(false)
  const result = configureDesktopRuntime(app, {
    platform: 'win32',
    smokeRequested: false,
    isolatedTestRequested: false,
    managedCodexSession: false,
  })

  assert.equal(result.usesIsolatedWindowsTestCompatibility, false)
  assert.deepEqual(app.calls, [])
})

test('managed Codex development sessions automatically use the isolated compatibility path', () => {
  const app = fakeApp(false)
  const result = configureDesktopRuntime(app, {
    platform: 'win32',
    smokeRequested: false,
    isolatedTestRequested: false,
    managedCodexSession: true,
  })

  assert.equal(result.managedCodexSession, true)
  assert.equal(result.usesIsolatedWindowsTestCompatibility, true)
  assert.deepEqual(app.calls, [
    ['disableHardwareAcceleration'],
    ['appendSwitch', 'in-process-gpu'],
    ['appendSwitch', 'no-sandbox'],
  ])
})
