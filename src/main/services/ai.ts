import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { safeStorage } from 'electron'
import type {
  AiAskInput,
  AiAskResult,
  AiConfigInput,
  AiConfigView,
  AiMessage,
  AiProtocol,
  AiProvider,
  AiProviderInfo
} from '../../shared/contracts'
import { DEFAULT_AI_CONFIG } from '../../shared/defaults'
import { basePromptForPurpose, FEATURE_PROMPTS } from '../../shared/prompts'
import { DatabaseService } from './database'

interface StoredAiConfig {
  provider: AiProvider
  protocol: AiProtocol
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
}

interface RequestSpec {
  endpoint: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

const PROVIDERS: AiProviderInfo[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'qwen',
    name: '通义千问',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7-flash',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'doubao',
    name: '豆包 Ark',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-250615',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'google',
    name: 'Google Gemini',
    protocol: 'google-generate-content',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.6-flash',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5-mini',
    local: false,
    apiKeyRequired: true
  },
  {
    id: 'ollama',
    name: 'Ollama 本地服务',
    protocol: 'ollama-openai',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen3:8b',
    local: true,
    apiKeyRequired: false
  },
  {
    id: 'lmstudio',
    name: 'LM Studio 本地服务',
    protocol: 'openai-chat',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    local: true,
    apiKeyRequired: false
  },
  {
    id: 'openai-compatible',
    name: '自定义 OpenAI 兼容服务',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'model-name',
    local: false,
    apiKeyRequired: true
  }
]

function safeParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function providerInfo(provider: AiProvider): AiProviderInfo {
  return PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0]!
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
}

function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  if (normalized === '::' || normalized === '::1') return true
  if (/^(fc|fd)/i.test(normalized) || /^fe[89ab]/i.test(normalized)) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : '')
  if (!ipv4) return false
  const [a = -1, b = -1] = ipv4.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function parseBaseUrl(value: string, provider: AiProvider): URL {
  const trimmed = value.trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('模型服务地址不是有效 URL')
  }
  if (parsed.username || parsed.password) throw new Error('模型服务地址不能包含用户名或密码')
  const info = providerInfo(provider)
  const host = normalizeHostname(parsed.hostname)
  if (info.local) {
    if (!['localhost', '127.0.0.1', '::1'].includes(host))
      throw new Error('本地模型只允许连接本机回环地址')
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error('本地模型地址必须使用 http:// 或 https://')
  } else {
    if (parsed.protocol !== 'https:') throw new Error('远程模型服务必须使用 HTTPS')
    if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host))
      throw new Error('远程模型服务不能指向本机或私有网络')
  }
  return parsed
}

async function verifyNetworkTarget(value: string, provider: AiProvider): Promise<void> {
  const parsed = parseBaseUrl(value, provider)
  if (providerInfo(provider).local) return
  const results = await lookup(parsed.hostname, { all: true, verbatim: true })
  if (!results.length || results.some((result) => isPrivateAddress(result.address)))
    throw new Error('模型域名解析到了不可访问的私有或保留地址')
}

function appendEndpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

function openAiChatEndpoint(config: StoredAiConfig): string {
  if (/\/chat\/completions$/i.test(config.baseUrl)) return config.baseUrl
  if (/\/(v1|v3|v4)$/i.test(config.baseUrl))
    return appendEndpoint(config.baseUrl, 'chat/completions')
  if (config.provider === 'ollama') return appendEndpoint(config.baseUrl, 'v1/chat/completions')
  return appendEndpoint(config.baseUrl, 'chat/completions')
}

function responsesEndpoint(config: StoredAiConfig): string {
  if (/\/responses$/i.test(config.baseUrl)) return config.baseUrl
  return appendEndpoint(config.baseUrl, 'responses')
}

function anthropicEndpoint(config: StoredAiConfig): string {
  if (/\/messages$/i.test(config.baseUrl)) return config.baseUrl
  return appendEndpoint(config.baseUrl, /\/v1$/i.test(config.baseUrl) ? 'messages' : 'v1/messages')
}

function googleEndpoint(config: StoredAiConfig): string {
  const root = /\/v1beta$/i.test(config.baseUrl)
    ? config.baseUrl
    : appendEndpoint(config.baseUrl, 'v1beta')
  return appendEndpoint(root, `models/${encodeURIComponent(config.model)}:generateContent`)
}

function now(): string {
  return new Date().toISOString()
}

function systemText(messages: AiMessage[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
}

function requestSpec(config: StoredAiConfig, messages: AiMessage[], apiKey: string): RequestSpec {
  const commonHeaders = { 'Content-Type': 'application/json' }
  switch (config.protocol) {
    case 'openai-responses':
      return {
        endpoint: responsesEndpoint(config),
        headers: { ...commonHeaders, Authorization: `Bearer ${apiKey}` },
        body: {
          model: config.model,
          input: messages,
          temperature: config.temperature,
          max_output_tokens: config.maxTokens
        }
      }
    case 'anthropic-messages':
      return {
        endpoint: anthropicEndpoint(config),
        headers: { ...commonHeaders, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: {
          model: config.model,
          system: systemText(messages) || undefined,
          messages: messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({ role: message.role, content: message.content })),
          temperature: config.temperature,
          max_tokens: config.maxTokens
        }
      }
    case 'google-generate-content':
      return {
        endpoint: googleEndpoint(config),
        headers: { ...commonHeaders, 'x-goog-api-key': apiKey },
        body: {
          systemInstruction: systemText(messages)
            ? { parts: [{ text: systemText(messages) }] }
            : undefined,
          contents: messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: message.content }]
            })),
          generationConfig: { temperature: config.temperature, maxOutputTokens: config.maxTokens }
        }
      }
    case 'ollama-openai':
    case 'openai-chat':
      return {
        endpoint: openAiChatEndpoint(config),
        headers: { ...commonHeaders, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: {
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          stream: false
        }
      }
  }
}

function responseError(payload: Record<string, unknown>, raw: string): string {
  const error = payload.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return raw.slice(0, 300) || '未知错误'
}

function textFromResponse(protocol: AiProtocol, payload: Record<string, unknown>): string {
  if (protocol === 'openai-responses') {
    if (typeof payload.output_text === 'string') return payload.output_text
    const output = Array.isArray(payload.output) ? payload.output : []
    return output
      .flatMap((item) =>
        item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).content)
          ? ((item as Record<string, unknown>).content as unknown[])
          : []
      )
      .flatMap((part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as Record<string, unknown>).text === 'string'
          ? [(part as Record<string, unknown>).text as string]
          : []
      )
      .join('\n')
  }
  if (protocol === 'anthropic-messages') {
    return (Array.isArray(payload.content) ? payload.content : [])
      .flatMap((part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as Record<string, unknown>).text === 'string'
          ? [(part as Record<string, unknown>).text as string]
          : []
      )
      .join('\n')
  }
  if (protocol === 'google-generate-content') {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
    const first = candidates[0]
    if (!first || typeof first !== 'object') return ''
    const content = (first as Record<string, unknown>).content
    if (!content || typeof content !== 'object') return ''
    const parts = (content as Record<string, unknown>).parts
    return (Array.isArray(parts) ? parts : [])
      .flatMap((part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as Record<string, unknown>).text === 'string'
          ? [(part as Record<string, unknown>).text as string]
          : []
      )
      .join('\n')
  }
  const choices = Array.isArray(payload.choices)
    ? (payload.choices as Array<Record<string, unknown>>)
    : []
  const message =
    choices[0]?.message && typeof choices[0].message === 'object'
      ? (choices[0].message as Record<string, unknown>)
      : undefined
  return typeof message?.content === 'string' ? message.content : ''
}

function usageFromResponse(
  protocol: AiProtocol,
  payload: Record<string, unknown>
): AiAskResult['usage'] {
  const source = protocol === 'google-generate-content' ? payload.usageMetadata : payload.usage
  if (!source || typeof source !== 'object') return undefined
  const usage = source as Record<string, unknown>
  const prompt = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? usage.inputTokens
  )
  const completion = Number(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.candidatesTokenCount ??
      usage.outputTokens
  )
  const total = Number(usage.total_tokens ?? usage.totalTokenCount ?? usage.totalTokens)
  return {
    promptTokens: Number.isFinite(prompt) && prompt > 0 ? prompt : undefined,
    completionTokens: Number.isFinite(completion) && completion > 0 ? completion : undefined,
    totalTokens: Number.isFinite(total) && total > 0 ? total : undefined
  }
}

export class AiService {
  constructor(private readonly database: DatabaseService) {}

  providers(): AiProviderInfo[] {
    return PROVIDERS.map((provider) => ({ ...provider }))
  }

  getConfig(): AiConfigView {
    const record = this.database.getAiRecord()
    if (!record) return { ...DEFAULT_AI_CONFIG }
    const fallback = this.toStored(DEFAULT_AI_CONFIG)
    const raw = safeParse<Partial<StoredAiConfig>>(record.payload_json, fallback)
    const info = providerInfo(raw.provider ?? fallback.provider)
    const stored: StoredAiConfig = {
      provider: raw.provider ?? fallback.provider,
      protocol: raw.protocol ?? info.protocol,
      baseUrl: raw.baseUrl ?? info.defaultBaseUrl,
      model: raw.model ?? info.defaultModel,
      temperature: raw.temperature ?? fallback.temperature,
      maxTokens: raw.maxTokens ?? fallback.maxTokens
    }
    return {
      ...stored,
      hasApiKey: typeof record.encrypted_key === 'string' && record.encrypted_key.length > 0,
      verified: Boolean(record.verified),
      lastCheckedAt: record.last_checked_at ? String(record.last_checked_at) : undefined,
      lastError: record.last_error ? String(record.last_error) : undefined
    }
  }

  saveConfig(input: AiConfigInput): AiConfigView {
    const baseUrl = parseBaseUrl(input.baseUrl, input.provider).toString().replace(/\/$/, '')
    const config: StoredAiConfig = {
      provider: input.provider,
      protocol: input.protocol,
      baseUrl,
      model: input.model.trim(),
      temperature: Math.max(0, Math.min(2, input.temperature)),
      maxTokens: Math.max(256, Math.min(32768, Math.round(input.maxTokens)))
    }
    if (!config.model) throw new Error('模型名称不能为空')
    let encryptedKey: string | null = null
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('当前系统安全存储不可用，API Key 未保存')
      encryptedKey = safeStorage.encryptString(input.apiKey.trim()).toString('base64')
    }
    this.database.saveAiRecord(JSON.stringify(config), encryptedKey, false)
    return this.getConfig()
  }

  clearCredential(): AiConfigView {
    this.database.clearAiCredential()
    return this.getConfig()
  }

  async discoverModels(): Promise<string[]> {
    const config = this.toStored(this.getConfig())
    const apiKey = this.readApiKey()
    if (providerInfo(config.provider).apiKeyRequired && !apiKey) throw new Error('请先保存 API Key')
    await verifyNetworkTarget(config.baseUrl, config.provider)
    let endpoint: string
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (config.protocol === 'google-generate-content') {
      const root = /\/v1beta$/i.test(config.baseUrl)
        ? config.baseUrl
        : appendEndpoint(config.baseUrl, 'v1beta')
      endpoint = appendEndpoint(root, 'models')
      headers['x-goog-api-key'] = apiKey
    } else {
      endpoint = appendEndpoint(
        config.baseUrl,
        /\/(v1|v3|v4)$/i.test(config.baseUrl) ? 'models' : 'v1/models'
      )
      if (config.protocol === 'anthropic-messages') {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    }
    const response = await fetch(endpoint, { headers, redirect: 'error' })
    const raw = await response.text()
    const payload = safeParse<Record<string, unknown>>(raw, {})
    if (!response.ok)
      throw new Error(`模型列表返回 ${response.status}：${responseError(payload, raw)}`)
    const values = config.protocol === 'google-generate-content' ? payload.models : payload.data
    return [
      ...new Set(
        (Array.isArray(values) ? values : []).flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const key = config.protocol === 'google-generate-content' ? 'name' : 'id'
          const value = (item as Record<string, unknown>)[key]
          return typeof value === 'string' ? [value.replace(/^models\//, '')] : []
        })
      )
    ].sort((a, b) => a.localeCompare(b))
  }

  async test(): Promise<AiConfigView> {
    try {
      const result = await this.ask(
        {
          messages: [
            { role: 'system', content: FEATURE_PROMPTS.connectivity },
            { role: 'user', content: '执行连接测试。' }
          ],
          purpose: 'chat'
        },
        20_000
      )
      if (result.content.trim() !== 'OK')
        throw new Error('模型已连接，但未按连接测试协议返回 OK，请检查模型兼容性')
      const view = this.getConfig()
      this.database.saveAiRecord(JSON.stringify(this.toStored(view)), null, true, now())
    } catch (error) {
      const view = this.getConfig()
      this.database.saveAiRecord(
        JSON.stringify(this.toStored(view)),
        null,
        false,
        now(),
        error instanceof Error ? error.message : '连接失败'
      )
    }
    return this.getConfig()
  }

  async ask(input: AiAskInput, timeoutMs = 60_000): Promise<AiAskResult> {
    const config = this.toStored(this.getConfig())
    const apiKey = this.readApiKey()
    if (providerInfo(config.provider).apiKeyRequired && !apiKey)
      throw new Error('请先在模型设置中保存 API Key')
    if (input.messages.length === 0) throw new Error('消息不能为空')
    const messages: AiMessage[] = [
      { role: 'system', content: basePromptForPurpose(input.purpose) },
      ...input.messages
    ]
    await verifyNetworkTarget(config.baseUrl, config.provider)
    const request = requestSpec(config, messages, apiKey)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
        redirect: 'error'
      })
      const raw = await response.text()
      const payload = safeParse<Record<string, unknown>>(raw, {})
      if (!response.ok)
        throw new Error(`模型服务返回 ${response.status}：${responseError(payload, raw)}`)
      const content = textFromResponse(config.protocol, payload)
      if (!content.trim()) throw new Error('模型返回了空内容')
      return {
        content,
        provider: config.provider,
        model: config.model,
        usage: usageFromResponse(config.protocol, payload)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error('模型请求超时，请检查网络或服务地址')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private toStored(view: AiConfigView): StoredAiConfig {
    return {
      provider: view.provider,
      protocol: view.protocol,
      baseUrl: view.baseUrl,
      model: view.model,
      temperature: view.temperature,
      maxTokens: view.maxTokens
    }
  }

  private readApiKey(): string {
    const record = this.database.getAiRecord()
    if (!record?.encrypted_key || typeof record.encrypted_key !== 'string') return ''
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('当前系统安全存储不可用，无法读取 API Key')
    try {
      return safeStorage.decryptString(Buffer.from(record.encrypted_key, 'base64'))
    } catch {
      throw new Error('API Key 无法解密，请重新保存')
    }
  }
}
