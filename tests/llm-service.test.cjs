const assert = require('node:assert/strict')
const test = require('node:test')
const {
  LLMService,
  normalizeBaseUrl,
  normalizedMessages,
} = require('../electron/llm/llm-service.cjs')

function settingsStoreDouble(overrides = {}) {
  return {
    load: () => ({ ai: { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'model-a', hasCredential: true } }),
    credentialFor: () => 'stored-secret',
    loadActiveAIConfig: () => ({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'model-a', apiKey: 'stored-secret' }),
    ...overrides,
  }
}

test('Base URL 只允许 HTTPS 或本机与私有网络 HTTP', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(normalizeBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1')
  assert.equal(normalizeBaseUrl('http://192.168.1.20:8080/v1'), 'http://192.168.1.20:8080/v1')
  assert.throws(() => normalizeBaseUrl('http://api.example.com/v1'), /必须使用 HTTPS/)
  assert.throws(() => normalizeBaseUrl('https://user:pass@example.com/v1'), /用户名或密码/)
  assert.throws(() => normalizeBaseUrl('https://example.com/v1?token=secret'), /查询参数/)
})

test('消息会限制角色、数量和总长度', () => {
  assert.deepEqual(normalizedMessages([{ role: 'user', content: 'hello' }]), [{ role: 'user', content: 'hello' }])
  assert.throws(() => normalizedMessages([{ role: 'tool', content: 'hello' }]), /角色无效/)
  assert.throws(() => normalizedMessages(Array.from({ length: 17 }, () => ({ role: 'user', content: 'x' }))), /不能超过 16/)
})

test('连接测试只发送固定内容，结果和错误通道不回传密钥', async () => {
  let request
  const service = new LLMService({
    settingsStore: settingsStoreDouble(),
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) }
    },
  })
  const result = await service.testConnection({
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'current-model',
    apiKey: 'one-time-secret',
  })
  const body = JSON.parse(request.options.body)
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(request.options.headers.Authorization, 'Bearer one-time-secret')
  assert.deepEqual(body.messages, [
    { role: 'system', content: '这是连接测试。只回复 OK，不处理任何科研内容。' },
    { role: 'user', content: 'OK' },
  ])
  assert.equal(JSON.stringify(result).includes('one-time-secret'), false)
  assert.deepEqual(Object.keys(result).sort(), ['baseUrl', 'connected', 'latencyMs', 'model', 'providerId', 'providerLabel'].sort())
})

test('正式补全只读取主进程活动凭据并返回结构化用量', async () => {
  let request
  const service = new LLMService({
    settingsStore: settingsStoreDouble(),
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'answer' } }],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        }),
      }
    },
  })
  const result = await service.complete({ purpose: 'research-agent', messages: [{ role: 'user', content: 'question' }], maxTokens: 200 })
  assert.equal(request.options.headers.Authorization, 'Bearer stored-secret')
  assert.equal(JSON.parse(request.options.body).max_tokens, 200)
  assert.equal(result.content, 'answer')
  assert.equal(result.purpose, 'research-agent')
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 3, totalTokens: 15 })
  assert.equal(JSON.stringify(result).includes('stored-secret'), false)
  await assert.rejects(() => service.complete({ purpose: 'connection-test', messages: [{ role: 'user', content: 'x' }] }), /用途无效/)
})

test('对话中选择的模型配置会真正用于后续调用', async () => {
  let request
  const service = new LLMService({
    settingsStore: settingsStoreDouble({
      loadModelRoleConfig: role => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: `${role}-selected-model`, apiKey: `${role}-secret` }),
    }),
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'selected' } }] }) }
    },
  })
  const result = await service.complete({ purpose: 'research-agent', role: 'planner', profileRole: 'executor', messages: [{ role: 'user', content: 'question' }] })
  assert.equal(JSON.parse(request.options.body).model, 'executor-selected-model')
  assert.equal(request.options.headers.Authorization, 'Bearer executor-secret')
  assert.equal(result.model, 'executor-selected-model')
})

test('Claude 使用原生 Messages 协议并把 system 指令放到顶层', async () => {
  let request
  const service = new LLMService({
    settingsStore: settingsStoreDouble(),
    fetchImpl: async (url, options) => {
      request = { url, options }
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 4, output_tokens: 1 } }) }
    },
  })
  const result = await service.testConnection({ providerId: 'claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-current', apiKey: 'claude-secret' })
  const body = JSON.parse(request.options.body)
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(request.options.headers['x-api-key'], 'claude-secret')
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01')
  assert.match(body.system, /只回复 OK/)
  assert.deepEqual(body.messages, [{ role: 'user', content: 'OK' }])
  assert.equal(result.providerId, 'claude')
})

test('Gemini 使用原生 generateContent 协议且密钥不进入 URL', async () => {
  let request
  const service = new LLMService({
    settingsStore: settingsStoreDouble(),
    fetchImpl: async (url, options) => {
      request = { url, options }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1, totalTokenCount: 5 } }),
      }
    },
  })
  const result = await service.testConnection({ providerId: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-current', apiKey: 'gemini-secret' })
  const body = JSON.parse(request.options.body)
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-current:generateContent')
  assert.equal(request.url.includes('gemini-secret'), false)
  assert.equal(request.options.headers['x-goog-api-key'], 'gemini-secret')
  assert.match(body.systemInstruction.parts[0].text, /只回复 OK/)
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'OK' }] }])
  assert.equal(result.providerId, 'gemini')
})

test('超时会中止请求并给出可恢复错误', async () => {
  const service = new LLMService({
    settingsStore: settingsStoreDouble(),
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }),
  })
  await assert.rejects(
    () => service.complete({ purpose: 'research-agent', messages: [{ role: 'user', content: 'question' }] }),
    /没有响应/,
  )
})
