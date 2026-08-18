import { useEffect, useMemo, useState } from 'react'
import { Button, Field, Input, Select, Spinner } from '@fluentui/react-components'
import { CheckIcon, ClipboardTextIcon, LightningIcon, TargetIcon } from '@phosphor-icons/react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts'
import type {
  AiAskResult,
  DiagnosisResult,
  LearningPlan,
  LearningPlanItem,
  ReportData
} from '@shared/contracts'
import { FEATURE_PROMPTS, taskDataEnvelope } from '@shared/prompts'
import { invoke } from '../api'
import { MarkdownContent } from '../components/MarkdownContent'
import { EmptyState, ErrorState, LoadingState, PageHeader, Section, Stat } from '../components/ui'
import { useAppStore } from '../store'

export function ReportsPage(): React.JSX.Element {
  const [range, setRange] = useState<ReportData['range']>('30d')
  const [report, setReport] = useState<ReportData>()
  const [error, setError] = useState('')
  useEffect(() => {
    setReport(undefined)
    setError('')
    void invoke<ReportData>({ method: 'reports.get', params: { range } })
      .then(setReport)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '报告生成失败'))
  }, [range])
  return (
    <div className="page">
      <PageHeader
        eyebrow="REPORTS"
        title="学习报告"
        description="只统计已经提交的有效作答，未作答和草稿不会污染正确率。"
        actions={
          <>
            <Select
              value={range}
              onChange={(_, data) => setRange(data.value as ReportData['range'])}
            >
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
              <option value="all">全部时间</option>
            </Select>
            <Button onClick={() => void invoke({ method: 'reports.export', params: { range } })}>
              导出报告
            </Button>
          </>
        }
      />
      {error && <ErrorState message={error} />}
      {!report ? (
        <LoadingState label="正在聚合训练记录" />
      ) : report.totalAttempts === 0 ? (
        <EmptyState
          title="还没有可分析的作答"
          description="完成一组练习后，这里会显示模块正确率、用时趋势与错因分布。"
        />
      ) : (
        <>
          <div className="stats-row">
            <Stat
              label="有效作答"
              value={`${report.totalAttempts} 题`}
              detail={`${report.correctAttempts} 题正确`}
            />
            <Stat label="正确率" value={`${report.accuracy}%`} detail="按全部有效作答计算" />
            <Stat
              label="累计投入"
              value={`${report.studyMinutes} 分钟`}
              detail="根据单题用时汇总"
            />
            <Stat
              label="已标注错因"
              value={`${report.wrongCauses.filter((item) => item.cause !== '未标注').reduce((sum, item) => sum + item.count, 0)} 次`}
              detail="用于诊断训练障碍"
            />
          </div>
          <Section title="训练趋势" description="作答量与正确率使用不同坐标轴。">
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={report.dailyStats}
                  margin={{ top: 12, right: 10, bottom: 0, left: -20 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--colorNeutralStroke2)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--colorNeutralForeground3)', fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="left"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--colorNeutralForeground3)', fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--colorNeutralForeground3)', fontSize: 10 }}
                  />
                  <ChartTooltip
                    contentStyle={{
                      background: 'var(--colorNeutralBackground2)',
                      border: '1px solid var(--colorNeutralStroke1)',
                      borderRadius: 8,
                      fontSize: 12
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="attempts"
                    name="题数"
                    fill="#D65F35"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="accuracy"
                    name="正确率"
                    stroke="#77BFA3"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Section>
          <div className="grid two">
            <Section title="模块表现">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>模块</th>
                    <th>作答</th>
                    <th>正确率</th>
                    <th>均时</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categoryStats.map((item) => (
                    <tr key={item.category}>
                      <td>{item.category}</td>
                      <td>{item.attempts}</td>
                      <td
                        className={
                          item.accuracy >= 75 ? 'positive' : item.accuracy < 60 ? 'negative' : ''
                        }
                      >
                        {item.accuracy}%
                      </td>
                      <td>{item.averageDurationSeconds} 秒</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="错误原因">
              <ul className="data-list">
                {report.wrongCauses.map((item) => (
                  <li className="data-row" key={item.cause}>
                    <div>
                      <strong>{item.cause}</strong>
                      <span>
                        {report.totalAttempts
                          ? Math.round((item.count / report.totalAttempts) * 100)
                          : 0}
                        % 的全部作答
                      </span>
                    </div>
                    <strong>{item.count}</strong>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}

export function DiagnosisPage(): React.JSX.Element {
  const refreshDashboard = useAppStore((state) => state.refreshDashboard)
  const ai = useAppStore((state) => state.data!.ai)
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult>()
  const [activePlan, setActivePlan] = useState<LearningPlan>()
  const [preview, setPreview] = useState<LearningPlan>()
  const [durationDays, setDurationDays] = useState(14)
  const [dailyMinutes, setDailyMinutes] = useState(60)
  const [focusText, setFocusText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aiInterpretation, setAiInterpretation] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  async function load(): Promise<void> {
    setError('')
    try {
      const [diagnosisValue, plan] = await Promise.all([
        invoke<DiagnosisResult>({ method: 'diagnosis.get' }),
        invoke<LearningPlan | undefined>({ method: 'plan.active' })
      ])
      setDiagnosis(diagnosisValue)
      setActivePlan(plan)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '诊断生成失败')
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const groupedItems = useMemo(() => {
    const plan = activePlan ?? preview
    if (!plan) return []
    return Array.from({ length: plan.durationDays }, (_, index) => ({
      day: index + 1,
      items: plan.items.filter((item) => item.day === index + 1)
    })).filter((group) => group.items.length)
  }, [activePlan, preview])

  async function generatePlan(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setPreview(
        await invoke<LearningPlan>({
          method: 'plan.preview',
          params: {
            durationDays,
            dailyMinutes,
            focus: focusText
              .split(/[,，]/)
              .map((item) => item.trim())
              .filter(Boolean)
          }
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计划生成失败')
    } finally {
      setBusy(false)
    }
  }
  async function interpretDiagnosis(): Promise<void> {
    if (!diagnosis) return
    setAiBusy(true)
    setError('')
    try {
      const response = await invoke<AiAskResult>({
        method: 'ai.ask',
        params: {
          purpose: 'plan',
          messages: [
            {
              role: 'system',
              content: FEATURE_PROMPTS.diagnosis
            },
            {
              role: 'user',
              content: taskDataEnvelope('本地学习诊断统计', diagnosis)
            }
          ]
        }
      })
      setAiInterpretation(response.content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 诊断解读失败')
    } finally {
      setAiBusy(false)
    }
  }
  async function applyPlan(): Promise<void> {
    if (!preview) return
    setBusy(true)
    try {
      const applied = await invoke<LearningPlan>({
        method: 'plan.apply',
        params: { plan: preview }
      })
      setActivePlan(applied)
      setPreview(undefined)
      await refreshDashboard()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计划应用失败')
    } finally {
      setBusy(false)
    }
  }
  async function completeItem(item: LearningPlanItem): Promise<void> {
    if (!activePlan) return
    try {
      setActivePlan(
        await invoke<LearningPlan>({
          method: 'plan.item.complete',
          params: { planId: activePlan.id, itemId: item.id, completed: item.target }
        })
      )
      await refreshDashboard()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '进度保存失败')
    }
  }
  async function cancelPlan(): Promise<void> {
    if (!activePlan) return
    try {
      await invoke({ method: 'plan.cancel', params: { planId: activePlan.id } })
      setActivePlan(undefined)
      await refreshDashboard()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计划取消失败')
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="DIAGNOSIS"
        title="能力诊断与计划"
        description="画像来自作答记录，不以自评替代证据；样本不足时会明确提示。"
        actions={<Button onClick={() => void load()}>重新诊断</Button>}
      />
      {error && <ErrorState message={error} />}
      {!diagnosis ? (
        <LoadingState label="正在生成能力画像" />
      ) : (
        <>
          <Section>
            <div className="diagnosis-band">
              <div className="score-ring">
                <div>
                  <strong>{diagnosis.accuracy}%</strong>
                  <span>综合正确率</span>
                </div>
              </div>
              <div>
                <h2 style={{ marginTop: 0 }}>
                  {diagnosis.totalAttempts
                    ? `基于 ${diagnosis.totalAttempts} 次有效作答`
                    : '需要一组摸底数据'}
                </h2>
                <p className="muted">
                  平均每题 {diagnosis.averageDurationSeconds} 秒。强弱项至少需要真实作答才能排序。
                </p>
                <div className="button-row">
                  {diagnosis.weaknesses.map((item) => (
                    <span className="pill" key={item.category}>
                      {item.category} {item.accuracy}%
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Section>
          <div className="grid two">
            <Section title="相对优势">
              {diagnosis.strengths.length ? (
                <ul className="data-list">
                  {diagnosis.strengths.map((item) => (
                    <li className="data-row" key={item.category}>
                      <div>
                        <strong>{item.category}</strong>
                        <span>{item.attempts} 次作答</span>
                      </div>
                      <strong className="positive">{item.accuracy}%</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="样本不足" description="每个模块至少完成几道题后再判断优势。" />
              )}
            </Section>
            <Section title="优先补强">
              {diagnosis.weaknesses.length ? (
                <ul className="data-list">
                  {diagnosis.weaknesses.map((item) => (
                    <li className="data-row" key={item.category}>
                      <div>
                        <strong>{item.category}</strong>
                        <span>{item.attempts} 次作答</span>
                      </div>
                      <strong className={item.accuracy < 60 ? 'negative' : 'warning'}>
                        {item.accuracy}%
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="样本不足" description="完成专项训练后再生成优先级。" />
              )}
            </Section>
          </div>
          <Section title="训练建议">
            <ul className="data-list">
              {diagnosis.recommendations.map((recommendation, index) => (
                <li className="data-row" key={recommendation}>
                  <div>
                    <strong>{recommendation}</strong>
                  </div>
                  <span>{index + 1}</span>
                </li>
              ))}
            </ul>
          </Section>
          {(ai.hasApiKey || ai.provider === 'ollama' || ai.provider === 'lmstudio') &&
            diagnosis.totalAttempts > 0 && (
              <Section
                title="AI 证据解读"
                description="只发送汇总统计，不发送题库正文、笔记或逐题答案。"
                actions={
                  <Button disabled={aiBusy} onClick={() => void interpretDiagnosis()}>
                    {aiBusy ? '解读中' : aiInterpretation ? '重新解读' : '生成解读'}
                  </Button>
                }
              >
                {aiInterpretation ? (
                  <MarkdownContent content={aiInterpretation} />
                ) : (
                  <p className="muted">
                    本地事实已经生成。点击后由模型补充解释，事实数值不会被模型覆盖。
                  </p>
                )}
              </Section>
            )}
        </>
      )}
      <Section
        title={activePlan ? activePlan.title : preview ? '计划预览' : '生成学习计划'}
        description={
          activePlan
            ? `${activePlan.durationDays} 天 · 每天 ${activePlan.dailyMinutes} 分钟 · ${activePlan.focus.join('、')}`
            : '先生成预览，确认后才会替换当前活动计划。'
        }
        actions={
          activePlan ? (
            <Button appearance="subtle" onClick={() => void cancelPlan()}>
              取消计划
            </Button>
          ) : preview ? (
            <>
              <Button onClick={() => setPreview(undefined)}>重新配置</Button>
              <Button appearance="primary" disabled={busy} onClick={() => void applyPlan()}>
                应用计划
              </Button>
            </>
          ) : undefined
        }
      >
        {!activePlan && !preview ? (
          <div className="form-grid">
            <Field label="计划天数">
              <Input
                type="number"
                min={1}
                max={30}
                value={String(durationDays)}
                onChange={(_, data) =>
                  setDurationDays(Math.max(1, Math.min(30, Number(data.value) || 1)))
                }
              />
            </Field>
            <Field label="每天分钟">
              <Input
                type="number"
                min={10}
                max={300}
                value={String(dailyMinutes)}
                onChange={(_, data) =>
                  setDailyMinutes(Math.max(10, Math.min(300, Number(data.value) || 10)))
                }
              />
            </Field>
            <Field className="full" label="重点模块，可留空自动选择">
              <Input
                value={focusText}
                onChange={(_, data) => setFocusText(data.value)}
                placeholder="例如：资料分析，判断推理"
              />
            </Field>
            <div className="button-row full">
              <Button
                appearance="primary"
                icon={<LightningIcon />}
                disabled={busy}
                onClick={() => void generatePlan()}
              >
                {busy ? '生成中' : '生成预览'}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {groupedItems.map((group) => (
              <div className="plan-day" key={group.day}>
                <strong>第 {group.day} 天</strong>
                <div className="plan-items">
                  {group.items.map((item) => (
                    <div className="plan-item" key={item.id}>
                      <div>
                        <span>{item.title}</span>
                        <small className="muted">
                          目标 {item.target} {item.type === 'read_knowledge' ? '分钟' : '项'}
                        </small>
                      </div>
                      {activePlan ? (
                        <Button
                          size="small"
                          appearance={item.done ? 'subtle' : 'secondary'}
                          icon={item.done ? <CheckIcon /> : <TargetIcon />}
                          disabled={item.done}
                          onClick={() => void completeItem(item)}
                        >
                          {item.done ? '已完成' : '标记完成'}
                        </Button>
                      ) : (
                        <span className="pill">
                          {item.type === 'read_knowledge' ? <ClipboardTextIcon /> : <TargetIcon />}{' '}
                          {item.target}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
