import { Button, ProgressBar } from '@fluentui/react-components'
import { ArrowRightIcon, BrainIcon, ExamIcon, PlayIcon, TargetIcon } from '@phosphor-icons/react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import { formatDate } from '../api'
import { PageHeader, Section, Stat } from '../components/ui'
import { useAppStore } from '../store'

export function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const data = useAppStore((state) => state.data)!
  const refresh = useAppStore((state) => state.refreshDashboard)
  const dashboard = data.dashboard
  const targetProgress = dashboard.dailyTarget ? dashboard.todayAttempts / dashboard.dailyTarget : 0
  return (
    <div className="page">
      <PageHeader
        eyebrow="TODAY"
        title="今天，从最值得补的一处开始"
        description={`知识库已准备 ${dashboard.totalQuestions} 道题。系统会把作答、错因和复习节奏留在本机。`}
        actions={
          <Button
            appearance="primary"
            icon={<PlayIcon weight="fill" />}
            onClick={() => navigate('/practice')}
          >
            开始训练
          </Button>
        }
      />
      <div className="stats-row">
        <Stat
          label="今日完成"
          value={`${dashboard.todayAttempts} 题`}
          detail={`目标 ${dashboard.dailyTarget} 题`}
          progress={targetProgress}
        />
        <Stat
          label="累计正确率"
          value={`${dashboard.accuracy}%`}
          detail={dashboard.accuracy ? '基于全部有效作答' : '完成首组训练后生成'}
        />
        <Stat
          label="到期复习"
          value={`${dashboard.dueReviews} 题`}
          detail={`${dashboard.wrongQuestions} 道未掌握错题`}
        />
        <Stat
          label="今日投入"
          value={`${dashboard.todayMinutes} 分钟`}
          detail={`连续学习 ${dashboard.studyStreak} 天 · ${dashboard.masteredQuestions} 道错题已掌握`}
        />
      </div>

      <div className="dashboard-grid" style={{ marginTop: 16 }}>
        <Section title="近两周训练节奏" description="柱高表示每日作答量，空白日不会伪造数据。">
          {dashboard.activity.length ? (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={dashboard.activity}
                  margin={{ top: 12, right: 4, bottom: 0, left: -24 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--colorNeutralStroke2)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fill: 'var(--colorNeutralForeground3)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'var(--colorNeutralForeground3)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    cursor={{ fill: 'var(--colorNeutralBackground3)' }}
                    contentStyle={{
                      background: 'var(--colorNeutralBackground2)',
                      border: '1px solid var(--colorNeutralStroke1)',
                      borderRadius: 8,
                      fontSize: 12
                    }}
                  />
                  <Bar dataKey="attempts" name="作答题数" fill="#D65F35" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state">
              <TargetIcon size={30} className="muted" />
              <h3>训练记录从今天开始</h3>
              <p>完成一组练习后，这里会显示你的真实学习节奏。</p>
            </div>
          )}
        </Section>
        <Section title="科目掌握与今日行动" description="掌握度只来自有效作答，不使用自评。">
          {dashboard.subjectMastery.map((item) => (
            <div className="data-row" key={item.subject}>
              <div>
                <strong>{item.subject === 'xingce' ? '行测' : '申论'}</strong>
                <span>{item.attempts} 次有效作答</span>
              </div>
              <strong>{item.accuracy}%</strong>
            </div>
          ))}
          <ul className="data-list">
            <li className="data-row">
              <div>
                <strong>自适应专项训练</strong>
                <span>从薄弱模块优先选题</span>
              </div>
              <Button
                appearance="subtle"
                icon={<ArrowRightIcon />}
                onClick={() => navigate('/practice')}
                aria-label="进入专项训练"
              />
            </li>
            <li className="data-row">
              <div>
                <strong>到期错题复习</strong>
                <span>
                  {dashboard.dueReviews ? `${dashboard.dueReviews} 道等待复习` : '今天没有到期任务'}
                </span>
              </div>
              <Button
                appearance="subtle"
                icon={<ArrowRightIcon />}
                onClick={() => navigate('/review')}
                aria-label="进入错题复习"
              />
            </li>
            <li className="data-row">
              <div>
                <strong>能力诊断与计划</strong>
                <span>根据真实作答生成建议</span>
              </div>
              <Button
                appearance="subtle"
                icon={<ArrowRightIcon />}
                onClick={() => navigate('/diagnosis')}
                aria-label="进入能力诊断"
              />
            </li>
          </ul>
        </Section>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <Section title="继续进行">
          {dashboard.activeExam ? (
            <div>
              <div className="data-row">
                <div>
                  <strong>{dashboard.activeExam.title}</strong>
                  <span>
                    已答 {Object.keys(dashboard.activeExam.answers).length}/
                    {dashboard.activeExam.questionIds.length} 题 ·{' '}
                    {formatDate(dashboard.activeExam.updatedAt)}
                  </span>
                </div>
                <ExamIcon size={22} className="accent" />
              </div>
              <Button
                appearance="primary"
                style={{ marginTop: 14 }}
                onClick={() => navigate('/exam/run')}
              >
                继续模考
              </Button>
            </div>
          ) : dashboard.activePlan ? (
            <div>
              <div className="data-row">
                <div>
                  <strong>{dashboard.activePlan.title}</strong>
                  <span>{dashboard.activePlan.focus.join(' · ')}</span>
                </div>
                <BrainIcon size={22} className="accent" />
              </div>
              <ProgressBar
                value={
                  dashboard.activePlan.items.filter((item) => item.done).length /
                  dashboard.activePlan.items.length
                }
                style={{ marginTop: 14 }}
              />
              <Button style={{ marginTop: 14 }} onClick={() => navigate('/diagnosis')}>
                查看计划
              </Button>
            </div>
          ) : (
            <div className="empty-state" style={{ minHeight: 150 }}>
              <h3>没有未完成任务</h3>
              <p>开始一场模考或在能力诊断中应用学习计划。</p>
            </div>
          )}
        </Section>
        <Section
          title="最近作答"
          actions={
            <Button appearance="subtle" onClick={() => void refresh()}>
              刷新
            </Button>
          }
        >
          {dashboard.recentAttempts.length ? (
            <ul className="data-list">
              {dashboard.recentAttempts.slice(0, 5).map((attempt) => (
                <li className="data-row" key={attempt.id}>
                  <div>
                    <strong>{attempt.questionTitle}</strong>
                    <span>{formatDate(attempt.createdAt)}</span>
                  </div>
                  <span className={attempt.correct ? 'positive' : 'negative'}>
                    {attempt.correct ? '正确' : '错误'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state" style={{ minHeight: 150 }}>
              <h3>暂无作答记录</h3>
              <p>每一次有效作答都会保留题目快照。</p>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
