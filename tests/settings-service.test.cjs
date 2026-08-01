const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { AppSettingsStore, normalizeSettings } = require('../electron/settings-service.cjs')

test('界面与阅读设置会裁剪到产品允许范围', () => {
  const normalized = normalizeSettings({
    ui: {
      uiScale: 4,
      density: 'unknown',
      surfaceTone: 'warm',
      accentColor: 'plum',
      readerFontSize: 99,
      readerLineHeight: .2,
      readerWidth: 3000,
    },
  })
  assert.deepEqual(normalized.ui, {
    uiScale: 1.1,
    density: 'comfortable',
    surfaceTone: 'warm',
    accentColor: 'plum',
    readerFontSize: 22,
    readerLineHeight: 1.5,
    readerWidth: 980,
  })
})

test('API 密钥只以系统加密后的内容写入设置文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-settings-'))
  const filePath = path.join(root, 'settings.json')
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: buffer => buffer.toString('utf8').replace(/^protected:/, ''),
  }
  try {
    const store = new AppSettingsStore({ filePath, safeStorage })
    store.save({
      ai: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'local-model',
        apiKey: 'top-secret',
        translationProvider: 'local',
      },
      ui: { accentColor: 'blue' },
    })
    const raw = fs.readFileSync(filePath, 'utf8')
    assert.doesNotMatch(raw, /top-secret/)
    assert.match(raw, /encryptedApiKey/)
    const loaded = store.load()
    assert.equal(loaded.ai.apiKey, 'top-secret')
    assert.equal(loaded.credentialState, 'encrypted')
    assert.equal(loaded.ui.accentColor, 'blue')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('系统加密不可用时拒绝把 API 密钥降级为明文', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-settings-'))
  try {
    const store = new AppSettingsStore({
      filePath: path.join(root, 'settings.json'),
      safeStorage: { isEncryptionAvailable: () => false },
    })
    assert.throws(
      () => store.save({ ai: { apiKey: 'must-not-leak' } }),
      /没有保存 API 密钥/,
    )
    assert.equal(fs.existsSync(path.join(root, 'settings.json')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
