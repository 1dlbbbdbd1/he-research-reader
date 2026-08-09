export type AICompletionPurpose =
  | 'review-document'
  | 'selection-assistant'
  | 'paper-reading-card'
  | 'structured-reading'
  | 'research-agent'
  | 'bilingual-translation'

export type AIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AICompletionRequest = {
  purpose: AICompletionPurpose
  messages: AIMessage[]
  temperature?: number
  maxTokens?: number
}

export type PublicAISettings = {
  providerId: string
  baseUrl: string
  model: string
  hasCredential: boolean
  allowFullDocument: boolean
  translationProvider: 'local' | 'ai'
}

export function hasConfiguredAI(settings: Pick<PublicAISettings, 'baseUrl' | 'model' | 'hasCredential'>) {
  return Boolean(settings.baseUrl.trim() && settings.model.trim() && settings.hasCredential)
}

export async function completeAI(input: AICompletionRequest) {
  const desktop = window.readerDesktop
  if (!desktop?.completeAI) {
    throw new Error('云端 AI 只在桌面客户端中运行；网页预览不会读取或发送 API Key。')
  }
  return desktop.completeAI(input)
}
