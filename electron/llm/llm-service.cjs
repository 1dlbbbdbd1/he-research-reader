const { listProviders, normalizeProviderId, providerById } = require('./provider-registry.cjs')

const PURPOSES = new Set([
  'connection-test',
  'review-document',
  'selection-assistant',
  'paper-reading-card',
  'structured-reading',
  'research-agent',
  'bilingual-translation',
])
const MAX_MESSAGES = 16
const MAX_MESSAGE_CHARACTERS = 180_000
const MAX_TOTAL_CHARACTERS = 240_000
const DEFAULT_TIMEOUT_MS = 60_000

function privateNetworkHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.localhost')) return true
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)) return true
  const match = normalized.match(/^172\.(\d{1,3})\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim()
  if (!text) throw new Error('Base URL 不能为空。')
  if (text.length > 2048) throw new Error('Base URL 过长。')
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('Base URL 不是有效网址。')
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Base URL 只支持 HTTPS 或本机 HTTP。')
  if (parsed.username || parsed.password) throw new Error('Base URL 不能包含用户名或密码。')
  if (parsed.search || parsed.hash) throw new Error('Base URL 不能包含查询参数或片段。')
  if (parsed.protocol === 'http:' && !privateNetworkHostname(parsed.hostname)) {
    throw new Error('公网 AI 服务必须使用 HTTPS；HTTP 只允许本机或私有网络地址。')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/$/, '')
}

function normalizeModel(value) {
  const model = String(value || '').trim()
  if (!model) throw new Error('模型名称不能为空。')
  if (model.length > 200) throw new Error('模型名称不能超过 200 个字符。')
  if (/[\r\n\u0000]/.test(model)) throw new Error('模型名称包含无效字符。')
  return model
}

function normalizedMessages(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('AI 请求至少需要一条消息。')
  if (value.length > MAX_MESSAGES) throw new Error(`AI 请求不能超过 ${MAX_MESSAGES} 条消息。`)
  let total = 0
  const messages = value.map(message => {
    const role = ['system', 'user', 'assistant'].includes(message?.role) ? message.role : ''
    if (!role) throw new Error('AI 消息角色无效。')
    const content = String(message?.content ?? '')
    if (!content.trim()) throw new Error('AI 消息内容不能为空。')
    if (content.length > MAX_MESSAGE_CHARACTERS) throw new Error('单条 AI 消息超过安全长度限制。')
    total += content.length
    return { role, content }
  })
  if (total > MAX_TOTAL_CHARACTERS) throw new Error('本次发送内容超过安全长度限制。')
  return messages
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function errorMessageFromPayload(payload, status) {
  const candidate = payload?.error?.message || payload?.message || payload?.error
  const message = typeof candidate === 'string' ? candidate.replace(/[\r\n]+/g, ' ').trim().slice(0, 400) : ''
  return message ? `AI 服务返回 ${status}：${message}` : `AI 服务返回 ${status}。`
}

function contentFromResponse(payload, protocol) {
  if (protocol === 'anthropic') {
    const content = Array.isArray(payload?.content)
      ? payload.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
      : ''
    if (content.trim()) return content
  } else if (protocol === 'gemini') {
    const parts = payload?.candidates?.[0]?.content?.parts
    const content = Array.isArray(parts)
      ? parts.filter(part => typeof part?.text === 'string').map(part => part.text).join('\n')
      : ''
    if (content.trim()) return content
  } else {
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) return content
  }
  throw new Error('AI 服务没有返回可用文本。')
}

function requestForProtocol({ protocol, baseUrl, model, apiKey, messages, temperature, maxTokens }) {
  if (protocol === 'anthropic') {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    return {
      url: `${baseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: maxTokens ?? 1024,
        temperature,
        ...(system ? { system } : {}),
        messages: messages.filter(message => message.role !== 'system').map(message => ({ role: message.role, content: message.content })),
      },
    }
  }
  if (protocol === 'gemini') {
    const systemText = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    return {
      url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: {
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents: messages.filter(message => message.role !== 'system').map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature,
          ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
        },
      },
    }
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      temperature,
      messages,
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    },
  }
}

function usageFromResponse(payload, protocol) {
  if (protocol === 'anthropic') {
    return payload?.usage && typeof payload.usage === 'object' ? {
      promptTokens: Number(payload.usage.input_tokens) || undefined,
      completionTokens: Number(payload.usage.output_tokens) || undefined,
      totalTokens: (Number(payload.usage.input_tokens) || 0) + (Number(payload.usage.output_tokens) || 0) || undefined,
    } : undefined
  }
  if (protocol === 'gemini') {
    return payload?.usageMetadata && typeof payload.usageMetadata === 'object' ? {
      promptTokens: Number(payload.usageMetadata.promptTokenCount) || undefined,
      completionTokens: Number(payload.usageMetadata.candidatesTokenCount) || undefined,
      totalTokens: Number(payload.usageMetadata.totalTokenCount) || undefined,
    } : undefined
  }
  return payload?.usage && typeof payload.usage === 'object' ? {
    promptTokens: Number(payload.usage.prompt_tokens) || undefined,
    completionTokens: Number(payload.usage.completion_tokens) || undefined,
    totalTokens: Number(payload.usage.total_tokens) || undefined,
  } : undefined
}

class LLMService {
  constructor({ settingsStore, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!settingsStore) throw new Error('LLMService 需要设置存储。')
    if (typeof fetchImpl !== 'function') throw new Error('当前运行时不支持网络请求。')
    this.settingsStore = settingsStore
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  listProviders() {
    return listProviders()
  }

  async complete(input = {}) {
    const purpose = PURPOSES.has(input.purpose) ? input.purpose : ''
    if (!purpose || purpose === 'connection-test') throw new Error('AI 请求用途无效。')
    const role = ['planner', 'executor', 'vision', 'verifier', 'embedding'].includes(input.role) ? input.role : undefined
    const profileRole = ['planner', 'executor', 'vision', 'verifier'].includes(input.profileRole) ? input.profileRole : role
    const active = profileRole ? this.settingsStore.loadModelRoleConfig(profileRole) : this.settingsStore.loadActiveAIConfig()
    if (!active.apiKey) throw new Error('当前供应商尚未保存 API Key。')
    if (!active.model) throw new Error(`${role || '当前'}模型尚未配置。`)
    return this.#request({
      purpose,
      role,
      providerId: active.providerId,
      baseUrl: active.baseUrl,
      model: active.model,
      apiKey: active.apiKey,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    })
  }

  async testConnection(input = {}) {
    const publicSettings = this.settingsStore.load()
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? publicSettings.ai.baseUrl)
    const providerId = normalizeProviderId(input.providerId ?? publicSettings.ai.providerId, baseUrl)
    const model = normalizeModel(input.model ?? publicSettings.ai.model)
    const suppliedKey = String(input.apiKey || '')
    const apiKey = suppliedKey || this.settingsStore.credentialFor({ providerId, baseUrl })
    if (!apiKey) throw new Error('请填写这个供应商的 API Key 后再测试。')
    const result = await this.#request({
      purpose: 'connection-test',
      providerId,
      baseUrl,
      model,
      apiKey,
      temperature: 0,
      // Connection test uses a small but non-trivial token budget.
      // Reasoning models may consume completion tokens for reasoning_content
      // before producing final content, so avoid very small values like 8.
      maxTokens: 256,
      messages: [
        { role: 'system', content: '这是连接测试。只回复 OK，不处理任何科研内容。' },
        { role: 'user', content: 'OK' },
      ],
    })
    return {
      connected: true,
      providerId: result.providerId,
      providerLabel: result.providerLabel,
      model: result.model,
      baseUrl,
      latencyMs: result.latencyMs,
    }
  }

  async #request(input) {
    const baseUrl = normalizeBaseUrl(input.baseUrl)
    const providerId = normalizeProviderId(input.providerId, baseUrl)
    const provider = providerById(providerId) || providerById('custom')
    const model = normalizeModel(input.model)
    const apiKey = String(input.apiKey || '')
    if (!apiKey || apiKey.length > 8192) throw new Error('API Key 无效。')
    const messages = normalizedMessages(input.messages)
    const temperature = boundedNumber(input.temperature, 0, 1, 0.1)
    const maxTokens = input.maxTokens === undefined ? undefined : Math.round(boundedNumber(input.maxTokens, 1, 8192, 1024))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const startedAt = Date.now()
    try {
      const request = requestForProtocol({
        protocol: provider.protocol,
        baseUrl,
        model,
        apiKey,
        messages,
        temperature,
        maxTokens,
      })
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
      let payload = {}
      try {
        payload = await response.json()
      } catch {
        payload = {}
      }
      if (!response.ok) throw new Error(errorMessageFromPayload(payload, response.status))
      return {
        content: contentFromResponse(payload, provider.protocol),
        providerId,
        providerLabel: provider.label,
        model,
        purpose: input.purpose,
        role: input.role,
        latencyMs: Date.now() - startedAt,
        usage: usageFromResponse(payload, provider.protocol),
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`AI 服务在 ${Math.round(this.timeoutMs / 1000)} 秒内没有响应。`)
      if (error instanceof Error) throw error
      throw new Error('AI 服务调用失败。')
    } finally {
      clearTimeout(timeout)
    }
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  LLMService,
  MAX_MESSAGE_CHARACTERS,
  MAX_TOTAL_CHARACTERS,
  normalizeBaseUrl,
  normalizeModel,
  normalizedMessages,
  privateNetworkHostname,
  requestForProtocol,
  usageFromResponse,
}
