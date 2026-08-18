import { useEffect, useRef, useState } from 'react'
import { Button, Field, Input, Select, Slider, Spinner, Textarea } from '@fluentui/react-components'
import {
  ArrowRightIcon,
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
  WarningCircleIcon
} from '@phosphor-icons/react'
import type {
  AiAskResult,
  AiConfigInput,
  AiConfigView,
  AiMessage,
  AiProviderInfo,
  AiTrainingRecord,
  Question,
  QuestionOption
} from '@shared/contracts'
import { FEATURE_PROMPTS, taskDataEnvelope } from '@shared/prompts'
import { useNavigate } from 'react-router-dom'
import { formatFullDate, invoke } from '../api'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatusDot
} from '../components/ui'
import { useAppStore } from '../store'

function canUseModel(config: AiConfigView): boolean {
  return config.hasApiKey || config.provider === 'ollama' || config.provider === 'lmstudio'
}

export function AiPage(): React.JSX.Element {
  const navigate = useNavigate()
  const ai = useAppStore((state) => state.data!.ai)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])
  async function send(): Promise<void> {
    const content = input.trim()
    if (!content || busy) return
    const userMessage: AiMessage = { role: 'user', content }
    const next = [...messages, userMessage]
    setMessages(next)
    setInput('')
    setBusy(true)
    setError('')
    try {
      const response = await invoke<AiAskResult>({
        method: 'ai.ask',
        params: {
          purpose: 'chat',
          messages: [
            {
              role: 'system',
              content: FEATURE_PROMPTS.chat
            },
            ...next
          ]
        }
      })
      setMessages([...next, { role: 'assistant', content: response.content }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 请求失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="AI TUTOR"
        title="AI 助教"
        description="模型请求由主进程发出，API Key 只保存在系统加密存储中，不进入页面状态和日志。"
        actions={
          <span className="pill">
            <StatusDot status={ai.verified ? 'ok' : ai.hasApiKey ? 'warning' : 'neutral'} />{' '}
            {ai.model}
          </span>
        }
      />
      {!canUseModel(ai) ? (
        <EmptyState
          title="先配置模型凭据"
          description="本地训练、复习与报告无需 AI。要使用助教和变式训练，请在模型设置中单独保存 API Key。"
          actionLabel="前往模型设置"
          onAction={() => navigate('/model-settings')}
        />
      ) : (
        <>
          {error && <ErrorState message={error} />}
          <Section className="chat-shell">
            <div className="chat-messages">
              {!messages.length && (
                <div className="empty-state">
                  <SparkleIcon size={30} className="accent" />
                  <h3>从一道具体问题开始</h3>
                  <p>可以让我解释错题、比较方法，或把知识点整理成复习清单。</p>
                  <div className="button-row">
                    <Button onClick={() => setInput('请帮我总结资料分析中增长率题目的常见陷阱。')}>
                      增长率陷阱
                    </Button>
                    <Button onClick={() => setInput('如何区分言语理解中的主旨项和对策项？')}>
                      主旨与对策
                    </Button>
                  </div>
                </div>
              )}
              {messages.map((message, index) => (
                <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                  {message.content}
                </div>
              ))}
              {busy && (
                <div className="chat-message">
                  <Spinner size="tiny" label="助教正在整理" />
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div className="chat-compose">
              <Textarea
                value={input}
                resize="none"
                placeholder="输入你的学习问题，Ctrl+Enter 发送"
                onChange={(_, data) => setInput(data.value)}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.key === 'Enter') void send()
                }}
              />
              <Button
                appearance="primary"
                icon={<PaperPlaneTiltIcon />}
                disabled={!input.trim() || busy}
                onClick={() => void send()}
              >
                发送
              </Button>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

interface VariantQuestion {
  sourceQuestionId: string
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
}

function parseVariant(content: string, sourceQuestionId: string): VariantQuestion {
  const raw = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content
  const value = JSON.parse(raw.trim()) as Record<string, unknown>
  if (
    typeof value.stem !== 'string' ||
    !Array.isArray(value.options) ||
    !Array.isArray(value.answer) ||
    typeof value.explanation !== 'string'
  )
    throw new Error('模型返回格式不完整，请重新生成')
  const options = value.options.flatMap((item, index) => {
    if (typeof item === 'string') return [{ key: String.fromCharCode(65 + index), text: item }]
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      return typeof record.text === 'string'
        ? [
            {
              key: String(record.key ?? String.fromCharCode(65 + index)).toUpperCase(),
              text: record.text
            }
          ]
        : []
    }
    return []
  })
  if (options.length < 2) throw new Error('模型没有返回有效选项')
  return {
    sourceQuestionId,
    stem: value.stem,
    options,
    answer: value.answer.map(String).map((item) => item.toUpperCase()),
    explanation: value.explanation
  }
}

export function AiTrainingPage(): React.JSX.Element {
  const navigate = useNavigate()
  const ai = useAppStore((state) => state.data!.ai)
  const [variant, setVariant] = useState<VariantQuestion>()
  const [source, setSource] = useState<Question>()
  const [selected, setSelected] = useState<string[]>([])
  const [record, setRecord] = useState<AiTrainingRecord>()
  const [history, setHistory] = useState<AiTrainingRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void invoke<AiTrainingRecord[]>({ method: 'aiTraining.history' }).then(setHistory)
  }, [])

  async function generate(): Promise<void> {
    setBusy(true)
    setError('')
    setVariant(undefined)
    setRecord(undefined)
    setSelected([])
    try {
      const questions = await invoke<Question[]>({
        method: 'practice.select',
        params: { mode: 'adaptive', count: 1, filter: { subject: 'xingce' } }
      })
      const selectedSource = questions[0]
      if (!selectedSource) throw new Error('当前知识库没有可用于变式训练的行测题')
      setSource(selectedSource)
      const response = await invoke<AiAskResult>({
        method: 'ai.ask',
        params: {
          purpose: 'variant',
          messages: [
            {
              role: 'system',
              content: FEATURE_PROMPTS.variantCreate
            },
            {
              role: 'user',
              content: taskDataEnvelope('变式题生成输入', {
                sourceQuestion: {
                  subject: selectedSource.subject,
                  category: selectedSource.category,
                  type: selectedSource.type,
                  material: selectedSource.material ?? '',
                  stem: selectedSource.stem,
                  options: selectedSource.options,
                  answer: selectedSource.answer,
                  explanation: selectedSource.explanation
                }
              })
            }
          ]
        }
      })
      const draft = parseVariant(response.content, selectedSource.id)
      const review = await invoke<AiAskResult>({
        method: 'ai.ask',
        params: {
          purpose: 'variant',
          messages: [
            {
              role: 'system',
              content: FEATURE_PROMPTS.variantReview
            },
            {
              role: 'user',
              content: taskDataEnvelope('变式题终审输入', {
                sourceFocus: {
                  subject: selectedSource.subject,
                  category: selectedSource.category,
                  stem: selectedSource.stem
                },
                candidate: draft
              })
            }
          ]
        }
      })
      setVariant(parseVariant(review.content, selectedSource.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '变式题生成失败')
    } finally {
      setBusy(false)
    }
  }
  async function submit(): Promise<void> {
    if (!variant || !selected.length) return
    try {
      const saved = await invoke<AiTrainingRecord>({
        method: 'aiTraining.record',
        params: { ...variant, userAnswer: selected }
      })
      setRecord(saved)
      setHistory((items) => [saved, ...items])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '训练记录保存失败')
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="AI VARIANT"
        title="AI 变式训练"
        description="从当前薄弱模块抽取原题，再生成同考点新情境。每次结果单独保存，不混入官方题库。"
        actions={
          <Button
            appearance="primary"
            icon={<SparkleIcon />}
            disabled={busy || !canUseModel(ai)}
            onClick={() => void generate()}
          >
            {busy ? '生成中' : '生成变式题'}
          </Button>
        }
      />
      {!canUseModel(ai) ? (
        <EmptyState
          title="模型尚未配置"
          description="变式题依赖可用模型，本地核心训练不受影响。"
          actionLabel="前往模型设置"
          onAction={() => navigate('/model-settings')}
        />
      ) : (
        <>
          {error && <ErrorState message={error} />}
          {busy && (
            <Section>
              <Spinner label="正在核对考点并生成新题" />
            </Section>
          )}
          {!busy && !variant && (
            <Section>
              <EmptyState
                title="准备生成第一道变式题"
                description="系统会优先选择当前相对薄弱的模块，生成结果不会覆盖原题。"
                actionLabel="开始生成"
                onAction={() => void generate()}
              />
            </Section>
          )}
          {variant && (
            <div className="question-shell">
              <Section>
                <div className="question-meta">
                  <span className="pill">AI 变式</span>
                  {source && <span className="pill">源模块：{source.category}</span>}
                </div>
                <p className="question-stem">{variant.stem}</p>
                <div className="options">
                  {variant.options.map((option) => (
                    <button
                      type="button"
                      key={option.key}
                      className={`option-button ${selected.includes(option.key) ? 'selected' : ''}`}
                      disabled={Boolean(record)}
                      onClick={() => setSelected([option.key])}
                    >
                      <span className="option-key">{option.key}</span>
                      <span>{option.text}</span>
                    </button>
                  ))}
                </div>
                {record && (
                  <div className="answer-panel">
                    <h3 className={record.correct ? 'positive' : 'negative'}>
                      {record.correct ? '回答正确' : '回答错误'}
                    </h3>
                    <p>参考答案：{record.answer.join('、')}</p>
                    <p>{record.explanation}</p>
                  </div>
                )}
                <div className="question-footer">
                  <Button onClick={() => void generate()}>换一题</Button>
                  {!record && (
                    <Button
                      appearance="primary"
                      disabled={!selected.length}
                      onClick={() => void submit()}
                    >
                      提交答案
                    </Button>
                  )}
                </div>
              </Section>
              <Section title="源题对照" description="仅用于核对考点迁移，不显示在新题作答区。">
                <p className="muted" style={{ lineHeight: 1.7 }}>
                  {source?.stem}
                </p>
              </Section>
            </div>
          )}
          <Section title="最近变式记录">
            {history.length ? (
              <ul className="data-list">
                {history.slice(0, 8).map((item) => (
                  <li className="data-row" key={item.id}>
                    <div>
                      <strong>{item.stem}</strong>
                      <span>{formatFullDate(item.createdAt)}</span>
                    </div>
                    <span className={item.correct ? 'positive' : 'negative'}>
                      {item.correct ? '正确' : '错误'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="暂无变式训练记录" description="完成并提交一道变式题后显示。" />
            )}
          </Section>
        </>
      )}
    </div>
  )
}

export function ModelSettingsPage(): React.JSX.Element {
  const initial = useAppStore((state) => state.data!.ai)
  const initialize = useAppStore((state) => state.initialize)
  const [config, setConfig] = useState<AiConfigView>(initial)
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [models, setModels] = useState<string[]>([])
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void invoke<AiProviderInfo[]>({ method: 'ai.providers' })
      .then(setProviders)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '提供商列表加载失败'))
  }, [])

  const selectedProvider = providers.find((provider) => provider.id === config.provider)

  function inputConfig(): AiConfigInput {
    return {
      provider: config.provider,
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      apiKey: apiKey || undefined
    }
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setConfig(await invoke<AiConfigView>({ method: 'ai.config.save', params: inputConfig() }))
      await initialize()
      setApiKey('')
      setMessage('配置已保存，请继续测试连接。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置保存失败')
    } finally {
      setBusy(false)
    }
  }
  async function test(): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await invoke<AiConfigView>({ method: 'ai.test' })
      setConfig(result)
      await initialize()
      result.verified ? setMessage('连接测试通过。') : setError(result.lastError ?? '连接测试失败')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接测试失败')
    } finally {
      setBusy(false)
    }
  }

  async function discoverModels(): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const saved = await invoke<AiConfigView>({
        method: 'ai.config.save',
        params: inputConfig()
      })
      setConfig(saved)
      setApiKey('')
      const available = await invoke<string[]>({ method: 'ai.models.discover' })
      setModels(available)
      setMessage(
        available.length ? `已发现 ${available.length} 个可用模型。` : '服务未返回可选模型。'
      )
      await initialize()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型列表获取失败')
    } finally {
      setBusy(false)
    }
  }

  async function clearCredential(): Promise<void> {
    if (!window.confirm('确认删除此工作台保存的模型凭据？此操作不会影响提供商账户。')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setConfig(await invoke<AiConfigView>({ method: 'ai.config.clearCredential' }))
      setApiKey('')
      setMessage('已删除本机加密凭据。')
      await initialize()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '凭据删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="MODEL"
        title="模型设置"
        description="API Key 使用操作系统加密存储。保存状态和验证状态分开显示，避免把“写入成功”误认为“连接可用”。"
      />
      {error && <ErrorState message={error} />}
      {message && (
        <div className="answer-panel">
          <p className="positive">{message}</p>
        </div>
      )}
      <div className="grid two">
        <Section
          title="连接配置"
          description="内置国内外主流服务与本地模型适配，端点和模型名称仍可按账户实际情况调整。"
        >
          <div className="form-grid">
            <Field label="服务类型">
              <Select
                value={config.provider}
                onChange={(_, data) => {
                  const provider = providers.find((item) => item.id === data.value)
                  if (!provider) return
                  setModels([])
                  setConfig({
                    ...config,
                    provider: provider.id,
                    protocol: provider.protocol,
                    baseUrl: provider.defaultBaseUrl,
                    model: provider.defaultModel,
                    verified: false,
                    lastError: undefined
                  })
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="接口协议">
              <Select
                value={config.protocol}
                disabled={config.provider !== 'openai-compatible'}
                onChange={(_, data) =>
                  setConfig({ ...config, protocol: data.value as AiConfigView['protocol'] })
                }
              >
                <option value="openai-chat">OpenAI Chat Completions</option>
                <option value="openai-responses">OpenAI Responses</option>
                <option value="anthropic-messages">Anthropic Messages</option>
                <option value="google-generate-content">Google generateContent</option>
                <option value="ollama-openai">Ollama OpenAI</option>
              </Select>
            </Field>
            <Field label="模型名称">
              <Input
                value={config.model}
                onChange={(_, data) => setConfig({ ...config, model: data.value })}
              />
            </Field>
            {models.length > 0 && (
              <Field label="发现的模型">
                <Select
                  value={models.includes(config.model) ? config.model : ''}
                  onChange={(_, data) => setConfig({ ...config, model: data.value })}
                >
                  <option value="">选择服务返回的模型</option>
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field className="full" label="服务地址">
              <Input
                value={config.baseUrl}
                onChange={(_, data) => setConfig({ ...config, baseUrl: data.value })}
              />
            </Field>
            <Field
              className="full"
              label={config.hasApiKey ? 'API Key（已保存，留空保持不变）' : 'API Key'}
            >
              <Input
                type="password"
                value={apiKey}
                autoComplete="off"
                onChange={(_, data) => setApiKey(data.value)}
                placeholder={
                  selectedProvider && !selectedProvider.apiKeyRequired
                    ? '本地服务通常无需填写'
                    : '输入完整 API Key'
                }
              />
            </Field>
            <Field label={`温度 ${config.temperature.toFixed(1)}`}>
              <Slider
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(_, data) => setConfig({ ...config, temperature: data.value })}
              />
            </Field>
            <Field label="最大输出 Token">
              <Input
                type="number"
                min={256}
                max={32768}
                value={String(config.maxTokens)}
                onChange={(_, data) =>
                  setConfig({ ...config, maxTokens: Number(data.value) || 4096 })
                }
              />
            </Field>
          </div>
          <div className="button-row" style={{ marginTop: 18 }}>
            <Button appearance="primary" disabled={busy} onClick={() => void save()}>
              保存配置
            </Button>
            <Button disabled={busy} onClick={() => void discoverModels()}>
              获取模型列表
            </Button>
            <Button
              disabled={busy || (selectedProvider?.apiKeyRequired !== false && !config.hasApiKey)}
              onClick={() => void test()}
            >
              测试连接
            </Button>
            {config.hasApiKey && (
              <Button disabled={busy} onClick={() => void clearCredential()}>
                删除凭据
              </Button>
            )}
          </div>
        </Section>
        <Section title="当前状态">
          <ul className="data-list">
            <li className="data-row">
              <div>
                <strong>凭据</strong>
                <span>只显示是否存在，不回传密文</span>
              </div>
              <span>
                <StatusDot
                  status={
                    config.hasApiKey || selectedProvider?.apiKeyRequired === false
                      ? 'ok'
                      : 'warning'
                  }
                />{' '}
                {config.hasApiKey
                  ? '已保存'
                  : selectedProvider?.apiKeyRequired === false
                    ? '无需凭据'
                    : '未配置'}
              </span>
            </li>
            <li className="data-row">
              <div>
                <strong>连接验证</strong>
                <span>
                  {config.lastCheckedAt ? formatFullDate(config.lastCheckedAt) : '尚未测试'}
                </span>
              </div>
              <span>
                <StatusDot status={config.verified ? 'ok' : 'warning'} />{' '}
                {config.verified ? '已通过' : '待验证'}
              </span>
            </li>
            <li className="data-row">
              <div>
                <strong>协议端点</strong>
                <span>主进程请求，不经过渲染端</span>
              </div>
              <span>{config.protocol}</span>
            </li>
          </ul>
          {config.lastError && (
            <div className="answer-panel">
              <WarningCircleIcon className="warning" />
              <p>{config.lastError}</p>
            </div>
          )}
          <Button
            appearance="subtle"
            icon={<ArrowRightIcon />}
            style={{ marginTop: 14 }}
            onClick={() => (window.location.hash = '#/ai')}
          >
            打开 AI 助教
          </Button>
        </Section>
      </div>
    </div>
  )
}
