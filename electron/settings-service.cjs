const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { normalizeBaseUrl } = require('./llm/llm-service.cjs')
const { normalizeProviderId, providerById } = require('./llm/provider-registry.cjs')

const DEFAULT_PROVIDER = providerById('deepseek')
const MODEL_ROLES = Object.freeze(['planner', 'executor', 'vision', 'verifier', 'embedding'])
function defaultRole(role) {
  return {
    providerId: DEFAULT_PROVIDER.id,
    baseUrl: DEFAULT_PROVIDER.baseUrl,
    model: '',
    hasCredential: false,
    capabilities: role === 'vision' ? ['vision'] : role === 'embedding' ? ['embedding'] : ['text'],
    fallbackRole: role === 'verifier' ? 'planner' : '',
    inputPricePerMillion: undefined,
    outputPricePerMillion: undefined,
  }
}
const DEFAULT_SETTINGS = Object.freeze({
  ai: {
    providerId: DEFAULT_PROVIDER.id,
    baseUrl: DEFAULT_PROVIDER.baseUrl,
    model: '',
    hasCredential: false,
    allowFullDocument: false,
    translationProvider: 'local',
  },
  modelRoles: Object.fromEntries(MODEL_ROLES.map(role => [role, defaultRole(role)])),
  ui: {
    theme: 'light',
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

function normalizedBaseUrlOrFallback(value, providerId) {
  const preset = providerById(providerId)
  const fallback = preset?.baseUrl || DEFAULT_SETTINGS.ai.baseUrl
  try {
    return normalizeBaseUrl(value || fallback)
  } catch {
    return String(value || fallback).trim().slice(0, 2048)
  }
}

function normalizeSettings(input = {}) {
  const ai = input.ai && typeof input.ai === 'object' ? input.ai : {}
  const ui = input.ui && typeof input.ui === 'object' ? input.ui : {}
  const initialBaseUrl = String(ai.baseUrl ?? DEFAULT_SETTINGS.ai.baseUrl).trim().slice(0, 2048)
  const providerId = normalizeProviderId(ai.providerId, initialBaseUrl)
  const incomingRoles = input.modelRoles && typeof input.modelRoles === 'object' ? input.modelRoles : {}
  const legacyProfile = {
    providerId,
    baseUrl: normalizedBaseUrlOrFallback(initialBaseUrl, providerId),
    model: String(ai.model ?? '').trim().slice(0, 200),
  }
  const modelRoles = Object.fromEntries(MODEL_ROLES.map(role => {
    const value = incomingRoles[role] && typeof incomingRoles[role] === 'object' ? incomingRoles[role] : {}
    const seed = Object.keys(value).length ? value : (role === 'planner' || role === 'executor' || role === 'verifier' ? legacyProfile : {})
    const roleBaseUrl = String(seed.baseUrl ?? DEFAULT_PROVIDER.baseUrl).trim().slice(0, 2048)
    const roleProviderId = normalizeProviderId(seed.providerId, roleBaseUrl)
    const price = raw => Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : undefined
    return [role, {
      ...defaultRole(role),
      providerId: roleProviderId,
      baseUrl: normalizedBaseUrlOrFallback(roleBaseUrl, roleProviderId),
      model: String(seed.model ?? '').trim().slice(0, 200),
      hasCredential: Boolean(seed.hasCredential),
      capabilities: Array.isArray(seed.capabilities) ? seed.capabilities.map(String).filter(Boolean).slice(0, 12) : defaultRole(role).capabilities,
      fallbackRole: role === 'verifier' && seed.fallbackRole !== '' ? 'planner' : '',
      inputPricePerMillion: price(seed.inputPricePerMillion),
      outputPricePerMillion: price(seed.outputPricePerMillion),
    }]
  }))
  return {
    ai: {
      providerId,
      baseUrl: normalizedBaseUrlOrFallback(initialBaseUrl, providerId),
      model: String(ai.model ?? '').trim().slice(0, 200),
      hasCredential: Boolean(ai.hasCredential),
      allowFullDocument: Boolean(ai.allowFullDocument),
      translationProvider: enumValue(ai.translationProvider, ['local', 'ai'], 'local'),
    },
    modelRoles,
    ui: {
      theme: enumValue(ui.theme, ['light', 'dark'], 'light'),
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

function credentialId({ providerId, baseUrl }) {
  const normalizedProviderId = normalizeProviderId(providerId, baseUrl)
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  return crypto.createHash('sha256').update(`${normalizedProviderId}\n${normalizedBaseUrl}`, 'utf8').digest('hex').slice(0, 24)
}

function readJson(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizedCredentialEntries(stored, ai) {
  const entries = Array.isArray(stored.credentials) ? stored.credentials : []
  const normalized = entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || !entry.encryptedApiKey) return []
    try {
      const baseUrl = normalizeBaseUrl(entry.baseUrl)
      const providerId = normalizeProviderId(entry.providerId, baseUrl)
      return [{
        id: credentialId({ providerId, baseUrl }),
        providerId,
        baseUrl,
        encryptedApiKey: String(entry.encryptedApiKey),
        updatedAt: String(entry.updatedAt || stored.updatedAt || ''),
      }]
    } catch {
      return []
    }
  })
  if (stored.encryptedApiKey) {
    const legacy = {
      id: credentialId(ai),
      providerId: ai.providerId,
      baseUrl: ai.baseUrl,
      encryptedApiKey: String(stored.encryptedApiKey),
      updatedAt: String(stored.updatedAt || ''),
    }
    if (!normalized.some(entry => entry.id === legacy.id)) normalized.push(legacy)
  }
  return normalized
}

class AppSettingsStore {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath
    this.safeStorage = safeStorage
  }

  #state() {
    const stored = readJson(this.filePath)
    const normalized = normalizeSettings({ ai: stored.ai, modelRoles: stored.modelRoles, ui: stored.ui })
    const credentials = normalizedCredentialEntries(stored, normalized.ai)
    return { stored, normalized, credentials }
  }

  #decrypt(entry) {
    if (!entry) return ''
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('当前系统无法解密已保存的 API Key。')
    }
    try {
      return this.safeStorage.decryptString(Buffer.from(entry.encryptedApiKey, 'base64'))
    } catch {
      throw new Error('已保存的 API Key 无法解密，请重新填写。')
    }
  }

  load() {
    const { normalized, credentials } = this.#state()
    const activeId = credentialId(normalized.ai)
    const active = credentials.find(entry => entry.id === activeId)
    const encryptionAvailable = Boolean(this.safeStorage?.isEncryptionAvailable?.())
    const credentialState = !active ? 'empty' : encryptionAvailable ? 'encrypted' : 'unavailable'
    const publicRoles = Object.fromEntries(MODEL_ROLES.map(role => {
      const profile = normalized.modelRoles[role]
      const entry = credentials.find(candidate => candidate.id === credentialId(profile))
      return [role, { ...profile, hasCredential: Boolean(entry && encryptionAvailable) }]
    }))
    return {
      ...normalized,
      ai: { ...normalized.ai, hasCredential: Boolean(active && encryptionAvailable) },
      modelRoles: publicRoles,
      credentialState,
    }
  }

  credentialFor(input) {
    const { credentials } = this.#state()
    const id = credentialId(input)
    return this.#decrypt(credentials.find(entry => entry.id === id))
  }

  loadActiveAIConfig() {
    const settings = this.load()
    const apiKey = this.credentialFor(settings.ai)
    return { ...settings.ai, apiKey }
  }

  loadModelRoleConfig(roleValue) {
    const role = MODEL_ROLES.includes(roleValue) ? roleValue : 'executor'
    const settings = this.load()
    let profile = settings.modelRoles[role]
    if ((!profile.model || !profile.hasCredential) && role === 'verifier' && settings.modelRoles.planner.model) profile = settings.modelRoles.planner
    const apiKey = this.credentialFor(profile)
    return { ...profile, role, apiKey }
  }

  save(input = {}) {
    const previous = this.#state()
    const normalized = normalizeSettings(input)
    normalized.ai.baseUrl = normalizeBaseUrl(normalized.ai.baseUrl)
    normalized.ai.providerId = normalizeProviderId(normalized.ai.providerId, normalized.ai.baseUrl)
    if (!normalized.ai.model) throw new Error('模型名称不能为空。')

    const activeId = credentialId(normalized.ai)
    let credentials = previous.credentials.filter((entry, index, all) => (
      all.findIndex(candidate => candidate.id === entry.id) === index
    ))
    if (input.ai?.clearApiKey === true) {
      credentials = credentials.filter(entry => entry.id !== activeId)
    }
    const nextKey = String(input.ai?.apiKey || '').trim()
    if (nextKey) {
      if (nextKey.length > 8192) throw new Error('API Key 过长。')
      if (!this.safeStorage?.isEncryptionAvailable?.()) {
        throw new Error('当前系统无法使用安全凭据加密，因此没有保存 API Key。')
      }
      const entry = {
        id: activeId,
        providerId: normalized.ai.providerId,
        baseUrl: normalized.ai.baseUrl,
        encryptedApiKey: this.safeStorage.encryptString(nextKey).toString('base64'),
        updatedAt: new Date().toISOString(),
      }
      credentials = [...credentials.filter(candidate => candidate.id !== activeId), entry]
    }

    for (const role of MODEL_ROLES) {
      const profileInput = input.modelRoles?.[role]
      if (!profileInput || typeof profileInput !== 'object') continue
      const profile = normalized.modelRoles[role]
      const id = credentialId(profile)
      if (profileInput.clearApiKey === true) credentials = credentials.filter(entry => entry.id !== id)
      const roleKey = String(profileInput.apiKey || '').trim()
      if (!roleKey) continue
      if (roleKey.length > 8192) throw new Error(`${role} 的 API Key 过长。`)
      if (!this.safeStorage?.isEncryptionAvailable?.()) throw new Error('当前系统无法使用安全凭据加密，因此没有保存 API Key。')
      credentials = [...credentials.filter(candidate => candidate.id !== id), {
        id,
        providerId: profile.providerId,
        baseUrl: profile.baseUrl,
        encryptedApiKey: this.safeStorage.encryptString(roleKey).toString('base64'),
        updatedAt: new Date().toISOString(),
      }]
    }

    const timestamp = new Date().toISOString()
    const payload = {
      version: 3,
      ai: {
        providerId: normalized.ai.providerId,
        baseUrl: normalized.ai.baseUrl,
        model: normalized.ai.model,
        allowFullDocument: normalized.ai.allowFullDocument,
        translationProvider: normalized.ai.translationProvider,
      },
      modelRoles: Object.fromEntries(MODEL_ROLES.map(role => {
        const { hasCredential: _ignored, ...profile } = normalized.modelRoles[role]
        return [role, profile]
      })),
      ui: normalized.ui,
      credentials,
      updatedAt: timestamp,
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    fs.renameSync(temporaryPath, this.filePath)
    return this.load()
  }
}

module.exports = {
  AppSettingsStore,
  DEFAULT_SETTINGS,
  MODEL_ROLES,
  credentialId,
  normalizeSettings,
  normalizedCredentialEntries,
}
