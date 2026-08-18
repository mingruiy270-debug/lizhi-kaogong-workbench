import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Field, Select, Spinner, Tab, TabList } from '@fluentui/react-components'
import { FloppyDiskIcon, SparkleIcon } from '@phosphor-icons/react'
import type { ConstructedDraft, ConstructedEvaluation, Question } from '@shared/contracts'
import { formatFullDate, invoke } from '../api'
import { EmptyState, ErrorState, LoadingState, PageHeader, Section } from '../components/ui'

export function ShenlunSolutionPage(): React.JSX.Element {
  const [prompts, setPrompts] = useState<Question[]>()
  const [promptId, setPromptId] = useState('')
  const [content, setContent] = useState('')
  const [evaluation, setEvaluation] = useState<ConstructedEvaluation>()
  const [view, setView] = useState<'write' | 'reference'>('write')
  const [saving, setSaving] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState('')
  const saveTimer = useRef<number | undefined>(undefined)
  const current = useMemo(
    () => prompts?.find((prompt) => prompt.id === promptId),
    [prompts, promptId]
  )

  useEffect(() => {
    void invoke<Question[]>({
      method: 'vault.search',
      params: { subject: 'shenlun', type: 'essay', limit: 200 }
    })
      .then((items) => {
        setPrompts(items)
        setPromptId(items[0]?.id ?? '')
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '申论题目读取失败'))
  }, [])
  useEffect(() => {
    if (!promptId) return
    setContent('')
    setEvaluation(undefined)
    void invoke<ConstructedDraft | undefined>({
      method: 'draft.get',
      params: { id: `draft-${promptId}` }
    }).then((draft) => setContent(draft?.content ?? ''))
  }, [promptId])
  useEffect(() => {
    if (!promptId) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveDraft(false)
    }, 1200)
    return () => window.clearTimeout(saveTimer.current)
  }, [content, promptId])

  async function saveDraft(showState = true): Promise<void> {
    if (!promptId || !current) return
    if (showState) setSaving(true)
    try {
      await invoke({
        method: 'draft.save',
        params: { id: `draft-${promptId}`, promptId, title: current.stem.slice(0, 40), content }
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '草稿保存失败')
    } finally {
      if (showState) setSaving(false)
    }
  }
  async function evaluate(): Promise<void> {
    if (!current) return
    setEvaluating(true)
    setError('')
    try {
      await saveDraft(false)
      setEvaluation(
        await invoke<ConstructedEvaluation>({
          method: 'constructed.evaluate',
          params: { promptId: current.id, title: current.stem.slice(0, 40), content }
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评估失败')
    } finally {
      setEvaluating(false)
    }
  }
  if (!prompts)
    return (
      <div className="page">
        <PageHeader title="申论作答" />
        <LoadingState />
      </div>
    )
  if (!prompts.length)
    return (
      <div className="page">
        <PageHeader title="申论作答" />
        <EmptyState
          title="知识库中没有申论主观题"
          description="导入 type: essay 且 subject: shenlun 的 Markdown 题目后即可开始。"
        />
      </div>
    )
  return (
    <div className="page">
      <PageHeader
        eyebrow="SHENLUN"
        title="申论作答"
        description="草稿在本机自动保存。未配置 AI 时使用透明的本地规则评分，配置后自动尝试语义评估。"
        actions={
          <>
            <Button icon={<FloppyDiskIcon />} disabled={saving} onClick={() => void saveDraft()}>
              {saving ? '保存中' : '保存草稿'}
            </Button>
            <Button
              appearance="primary"
              icon={<SparkleIcon />}
              disabled={evaluating}
              onClick={() => void evaluate()}
            >
              {evaluating ? '评估中' : '提交评估'}
            </Button>
          </>
        }
      />
      {error && <ErrorState message={error} />}
      <Section>
        <Field label="选择题目">
          <Select value={promptId} onChange={(_, data) => setPromptId(data.value)}>
            {prompts.map((prompt) => (
              <option value={prompt.id} key={prompt.id}>
                {prompt.category}：{prompt.stem.slice(0, 55)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="question-meta" style={{ marginTop: 14 }}>
          <span className="pill">{current?.category}</span>
          <span className="pill">难度 {current?.difficulty}</span>
          <span className="pill">{content.replace(/\s/g, '').length} 字</span>
        </div>
        <p className="question-stem">{current?.stem}</p>
        <TabList
          selectedValue={view}
          onTabSelect={(_, data) => setView(data.value as 'write' | 'reference')}
        >
          <Tab value="write">我的作答</Tab>
          <Tab value="reference">参考解析</Tab>
        </TabList>
        {view === 'write' ? (
          <textarea
            className="essay-editor"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="建议先列要点，再组织成完整答案。草稿会在停止输入后自动保存。"
          />
        ) : (
          <div className="answer-panel">
            <h3>参考要点</h3>
            <p>{current?.answer.join('；')}</p>
            <p>{current?.explanation}</p>
          </div>
        )}
      </Section>
      {evaluating && (
        <Section>
          <Spinner label="正在评估答案" />
        </Section>
      )}
      {evaluation && (
        <Section
          title={`评估结果：${evaluation.score} 分`}
          description={`${evaluation.provider} · ${formatFullDate(evaluation.createdAt)}`}
        >
          <div className="grid three">
            {evaluation.dimensions.map((dimension) => (
              <div className="stat" key={dimension.name}>
                <span>{dimension.name}</span>
                <strong>{dimension.score}</strong>
                <small>{dimension.comment}</small>
              </div>
            ))}
          </div>
          <div className="answer-panel">
            <h3>综合反馈</h3>
            <p>{evaluation.summary}</p>
            <ol>
              {evaluation.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ol>
          </div>
        </Section>
      )}
    </div>
  )
}
