const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    description: '适合中文科研问答与推理，使用官方 OpenAI 兼容接口。',
    baseUrl: 'https://api.deepseek.com',
    modelPlaceholder: '例如 deepseek-v4-flash（以控制台为准）',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
    recommended: true,
    protocol: 'openai-compatible',
  }),
  Object.freeze({
    id: 'siliconflow',
    label: '硅基流动',
    shortLabel: 'SiliconFlow',
    description: '一个 Key 可选择多家模型，模型名称必须从当前控制台复制。',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelPlaceholder: '从硅基流动模型列表复制完整名称',
    docsUrl: 'https://docs.siliconflow.cn/cn/userguide/quickstart',
    recommended: false,
    protocol: 'openai-compatible',
  }),
  Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    description: 'OpenAI 官方 API；模型名称以 API 控制台当前可用列表为准。',
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: '从 OpenAI API 控制台复制模型名称',
    docsUrl: 'https://platform.openai.com/docs/quickstart',
    recommended: false,
    protocol: 'openai-compatible',
  }),
  Object.freeze({
    id: 'bailian',
    label: '阿里云百炼',
    shortLabel: '百炼',
    description: '默认使用华北 2（北京）兼容地址；其他地域请改为对应 Base URL。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelPlaceholder: '从百炼当前地域的模型列表复制名称',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/getting-started/first-api-call-to-qwen',
    recommended: false,
    protocol: 'openai-compatible',
  }),
  Object.freeze({
    id: 'kimi',
    label: 'Kimi / Moonshot',
    shortLabel: 'Kimi',
    description: 'Moonshot 开放平台兼容接口；请使用开放平台 API Key。',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelPlaceholder: '从 Moonshot 开放平台复制模型名称',
    docsUrl: 'https://platform.moonshot.cn/docs/intro',
    recommended: false,
    protocol: 'openai-compatible',
  }),
  Object.freeze({
    id: 'claude',
    label: 'Claude / Anthropic',
    shortLabel: 'Claude',
    description: 'Anthropic 官方 Messages API；使用 Claude Console 创建的 API Key。',
    baseUrl: 'https://api.anthropic.com/v1',
    modelPlaceholder: '从 Claude Console 复制当前模型名称',
    docsUrl: 'https://platform.claude.com/docs/en/api/messages',
    recommended: false,
    protocol: 'anthropic',
  }),
  Object.freeze({
    id: 'gemini',
    label: 'Gemini / Google AI',
    shortLabel: 'Gemini',
    description: 'Google Gemini 原生 generateContent API；使用 Google AI Studio API Key。',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelPlaceholder: '从 Google AI Studio 复制当前模型名称',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    recommended: false,
    protocol: 'gemini',
  }),
  Object.freeze({
    id: 'custom',
    label: '自定义兼容服务',
    shortLabel: '自定义',
    description: '适用于其他 OpenAI 兼容平台、Ollama 网关或本机服务。',
    baseUrl: '',
    modelPlaceholder: '填写该服务实际使用的模型名称',
    docsUrl: '',
    recommended: false,
    protocol: 'openai-compatible',
  }),
])

const PROVIDER_IDS = new Set(PROVIDERS.map(provider => provider.id))

function listProviders() {
  return PROVIDERS.map(provider => ({ ...provider }))
}

function providerById(value) {
  return PROVIDERS.find(provider => provider.id === value)
}

function providerIdForBaseUrl(value) {
  let hostname = ''
  try {
    hostname = new URL(String(value || '')).hostname.toLowerCase()
  } catch {
    return 'custom'
  }
  if (hostname === 'api.openai.com') return 'openai'
  if (hostname === 'api.deepseek.com') return 'deepseek'
  if (hostname === 'api.siliconflow.cn') return 'siliconflow'
  if (hostname === 'api.moonshot.cn') return 'kimi'
  if (hostname === 'api.anthropic.com') return 'claude'
  if (hostname === 'generativelanguage.googleapis.com') return 'gemini'
  if (hostname === 'dashscope.aliyuncs.com' || hostname.endsWith('.maas.aliyuncs.com')) return 'bailian'
  return 'custom'
}

function normalizeProviderId(value, baseUrl) {
  const normalized = String(value || '').trim().toLowerCase()
  return PROVIDER_IDS.has(normalized) ? normalized : providerIdForBaseUrl(baseUrl)
}

module.exports = {
  PROVIDERS,
  listProviders,
  normalizeProviderId,
  providerById,
  providerIdForBaseUrl,
}
