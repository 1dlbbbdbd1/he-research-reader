const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { AppSettingsStore, normalizeSettings } = require('../electron/settings-service.cjs')

function safeStorageDouble() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: buffer => buffer.toString('utf8').replace(/^protected:/, ''),
  }
}

function withTemporaryStore(run, safeStorage = safeStorageDouble()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-settings-'))
  const filePath = path.join(root, 'settings.json')
  try {
    return run({ filePath, store: new AppSettingsStore({ filePath, safeStorage }) })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('界面与阅读设置会裁剪到产品允许范围', () => {
  const normalized = normalizeSettings({
    ui: {
      theme: 'dark',
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
    theme: 'dark',
    uiScale: 1.1,
    density: 'comfortable',
    surfaceTone: 'warm',
    accentColor: 'plum',
    readerFontSize: 22,
    readerLineHeight: 1.5,
    readerWidth: 980,
  })
})

test('公开设置绝不向渲染进程返回 API Key，主进程仍可按需解密', () => withTemporaryStore(({ filePath, store }) => {
  const saved = store.save({
    ai: {
      providerId: 'custom',
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
  assert.equal(Object.hasOwn(saved.ai, 'apiKey'), false)
  assert.equal(saved.ai.hasCredential, true)
  assert.equal(saved.credentialState, 'encrypted')
  assert.equal(saved.ui.accentColor, 'blue')
  assert.equal(store.credentialFor(saved.ai), 'top-secret')
  assert.equal(store.loadActiveAIConfig().apiKey, 'top-secret')
}))

test('不同服务商和 Base URL 的凭据槽互相隔离并可切回', () => withTemporaryStore(({ store }) => {
  store.save({ ai: { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-model', apiKey: 'deepseek-key' } })
  store.save({ ai: { providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'openai-model', apiKey: 'openai-key' } })
  assert.equal(store.credentialFor({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }), 'deepseek-key')
  assert.equal(store.credentialFor({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1' }), 'openai-key')
  assert.equal(store.credentialFor({ providerId: 'custom', baseUrl: 'http://127.0.0.1:11434/v1' }), '')
  const switchedBack = store.save({ ai: { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-model' } })
  assert.equal(switchedBack.ai.hasCredential, true)
}))

test('旧版单一 encryptedApiKey 会无损迁移到 v2 凭据槽', () => withTemporaryStore(({ filePath, store }) => {
  fs.writeFileSync(filePath, JSON.stringify({
    ai: { baseUrl: 'https://api.openai.com/v1', model: 'legacy-model', translationProvider: 'ai' },
    encryptedApiKey: Buffer.from('protected:legacy-secret', 'utf8').toString('base64'),
    ui: { surfaceTone: 'warm' },
  }), 'utf8')
  const loaded = store.load()
  assert.equal(loaded.ai.providerId, 'openai')
  assert.equal(loaded.ai.hasCredential, true)
  assert.equal(store.loadActiveAIConfig().apiKey, 'legacy-secret')
  store.save({ ai: loaded.ai, ui: loaded.ui })
  const migrated = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  assert.equal(migrated.version, 3)
  assert.equal(Object.hasOwn(migrated, 'encryptedApiKey'), false)
  assert.equal(migrated.credentials.length, 1)
  assert.equal(store.loadActiveAIConfig().apiKey, 'legacy-secret')
}))

test('v3 为五个模型角色保留独立配置与加密凭据', () => withTemporaryStore(({ filePath, store }) => {
  const saved = store.save({
    ai: { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'legacy', apiKey: 'legacy-key' },
    modelRoles: {
      planner: { providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'planner-model', apiKey: 'planner-secret', inputPricePerMillion: 2, outputPricePerMillion: 8 },
      vision: { providerId: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'vision-model', apiKey: 'vision-secret', capabilities: ['vision'] },
    },
  })
  assert.equal(saved.modelRoles.planner.model, 'planner-model')
  assert.equal(saved.modelRoles.planner.hasCredential, true)
  assert.equal(saved.modelRoles.vision.hasCredential, true)
  assert.equal(saved.modelRoles.executor.model, 'legacy')
  assert.equal(store.loadModelRoleConfig('planner').apiKey, 'planner-secret')
  assert.equal(store.loadModelRoleConfig('vision').apiKey, 'vision-secret')
  const raw = fs.readFileSync(filePath, 'utf8')
  assert.doesNotMatch(raw, /planner-secret|vision-secret/)
  assert.equal(JSON.parse(raw).version, 3)
}))

test('清除密钥只删除当前连接的凭据槽', () => withTemporaryStore(({ store }) => {
  store.save({ ai: { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-model', apiKey: 'deepseek-key' } })
  store.save({ ai: { providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'openai-model', apiKey: 'openai-key' } })
  const cleared = store.save({ ai: { providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'openai-model', clearApiKey: true } })
  assert.equal(cleared.ai.hasCredential, false)
  assert.equal(store.credentialFor({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1' }), '')
  assert.equal(store.credentialFor({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }), 'deepseek-key')
}))

test('系统加密不可用时拒绝把 API Key 降级为明文', () => withTemporaryStore(({ filePath, store }) => {
  assert.throws(
    () => store.save({ ai: { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-model', apiKey: 'must-not-leak' } }),
    /没有保存 API Key/,
  )
  assert.equal(fs.existsSync(filePath), false)
}, { isEncryptionAvailable: () => false }))
