const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_SETTINGS = Object.freeze({
  ai: {
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    apiKey: '',
    allowFullDocument: false,
    translationProvider: 'local',
  },
  ui: {
    uiScale: 1,
    density: 'comfortable',
    surfaceTone: 'neutral',
    accentColor: 'slate',
    readerFontSize: 16,
    readerLineHeight: 1.8,
    readerWidth: 820,
  },
})

function boundedNumber(value, minimum, maximum, fallback, step = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const bounded = Math.min(maximum, Math.max(minimum, number))
  return Math.round(bounded / step) * step
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function normalizeSettings(input = {}) {
  const ai = input.ai && typeof input.ai === 'object' ? input.ai : {}
  const ui = input.ui && typeof input.ui === 'object' ? input.ui : {}
  return {
    ai: {
      baseUrl: String(ai.baseUrl ?? DEFAULT_SETTINGS.ai.baseUrl).trim().slice(0, 2048),
      model: String(ai.model ?? '').trim().slice(0, 200),
      apiKey: String(ai.apiKey ?? '').slice(0, 8192),
      allowFullDocument: Boolean(ai.allowFullDocument),
      translationProvider: enumValue(ai.translationProvider, ['local', 'ai'], 'local'),
    },
    ui: {
      uiScale: boundedNumber(ui.uiScale, .9, 1.1, 1, .1),
      density: enumValue(ui.density, ['compact', 'comfortable'], 'comfortable'),
      surfaceTone: enumValue(ui.surfaceTone, ['neutral', 'warm', 'cool'], 'neutral'),
      accentColor: enumValue(ui.accentColor, ['slate', 'blue', 'green', 'plum'], 'slate'),
      readerFontSize: boundedNumber(ui.readerFontSize, 14, 22, 16),
      readerLineHeight: boundedNumber(ui.readerLineHeight, 1.5, 2.2, 1.8, .1),
      readerWidth: boundedNumber(ui.readerWidth, 680, 980, 820, 20),
    },
  }
}

class AppSettingsStore {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath
    this.safeStorage = safeStorage
  }

  load() {
    let stored = {}
    try {
      stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
    } catch {
      stored = {}
    }
    let apiKey = ''
    let credentialState = 'empty'
    if (stored.encryptedApiKey) {
      if (this.safeStorage?.isEncryptionAvailable?.()) {
        try {
          apiKey = this.safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'))
          credentialState = apiKey ? 'encrypted' : 'empty'
        } catch {
          credentialState = 'unavailable'
        }
      } else {
        credentialState = 'unavailable'
      }
    }
    const normalized = normalizeSettings({
      ai: { ...(stored.ai || {}), apiKey },
      ui: stored.ui,
    })
    return { ...normalized, credentialState }
  }

  save(input) {
    const normalized = normalizeSettings(input)
    let encryptedApiKey = ''
    let credentialState = 'empty'
    if (normalized.ai.apiKey) {
      if (!this.safeStorage?.isEncryptionAvailable?.()) {
        throw new Error('当前系统无法使用安全凭据加密，因此没有保存 API 密钥。')
      }
      encryptedApiKey = this.safeStorage.encryptString(normalized.ai.apiKey).toString('base64')
      credentialState = 'encrypted'
    }
    const payload = {
      version: 1,
      ai: {
        baseUrl: normalized.ai.baseUrl,
        model: normalized.ai.model,
        allowFullDocument: normalized.ai.allowFullDocument,
        translationProvider: normalized.ai.translationProvider,
      },
      ui: normalized.ui,
      encryptedApiKey,
      updatedAt: new Date().toISOString(),
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    fs.renameSync(temporaryPath, this.filePath)
    return { ...normalized, credentialState }
  }
}

module.exports = {
  AppSettingsStore,
  DEFAULT_SETTINGS,
  normalizeSettings,
}
