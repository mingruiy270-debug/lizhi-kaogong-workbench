import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Button,
  FluentProvider,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  Tooltip
} from '@fluentui/react-components'
import {
  BrainIcon,
  BookOpenTextIcon,
  BooksIcon,
  ChartLineUpIcon,
  CheckSquareOffsetIcon,
  ClipboardTextIcon,
  CompassIcon,
  ExamIcon,
  GearIcon,
  HouseIcon,
  LightbulbFilamentIcon,
  ListChecksIcon,
  NotePencilIcon,
  RobotIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  SquaresFourIcon,
  StethoscopeIcon,
  TargetIcon
} from '@phosphor-icons/react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { darkTheme, lightTheme } from './theme'
import { useAppStore } from './store'
import { LoadingState } from './components/ui'

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage }))
)
const PracticePage = lazy(() =>
  import('./pages/PracticePages').then((module) => ({ default: module.PracticePage }))
)
const ReviewPage = lazy(() =>
  import('./pages/PracticePages').then((module) => ({ default: module.ReviewPage }))
)
const ExamHomePage = lazy(() =>
  import('./pages/ExamPages').then((module) => ({ default: module.ExamHomePage }))
)
const ExamRunPage = lazy(() =>
  import('./pages/ExamPages').then((module) => ({ default: module.ExamRunPage }))
)
const KnowledgePage = lazy(() =>
  import('./pages/KnowledgePages').then((module) => ({ default: module.KnowledgePage }))
)
const KnowledgeBuilderPage = lazy(() =>
  import('./pages/KnowledgeBuilderPage').then((module) => ({
    default: module.KnowledgeBuilderPage
  }))
)
const PatternsPage = lazy(() =>
  import('./pages/KnowledgePages').then((module) => ({ default: module.PatternsPage }))
)
const ShenlunSolutionPage = lazy(() =>
  import('./pages/ShenlunSolutionPage').then((module) => ({ default: module.ShenlunSolutionPage }))
)
const ReportsPage = lazy(() =>
  import('./pages/InsightPages').then((module) => ({ default: module.ReportsPage }))
)
const DiagnosisPage = lazy(() =>
  import('./pages/InsightPages').then((module) => ({ default: module.DiagnosisPage }))
)
const AiPage = lazy(() => import('./pages/AiPages').then((module) => ({ default: module.AiPage })))
const AiTrainingPage = lazy(() =>
  import('./pages/AiPages').then((module) => ({ default: module.AiTrainingPage }))
)
const ModelSettingsPage = lazy(() =>
  import('./pages/AiPages').then((module) => ({ default: module.ModelSettingsPage }))
)
const EnvironmentPage = lazy(() =>
  import('./pages/SettingsPages').then((module) => ({ default: module.EnvironmentPage }))
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPages').then((module) => ({ default: module.SettingsPage }))
)

type IconComponent = ComponentType<{
  size?: number
  weight?: 'regular' | 'fill' | 'bold'
  'aria-hidden'?: boolean
}>

interface NavItem {
  label: string
  path: string
  icon: IconComponent
}

const groups: Array<{ label: string; items: NavItem[] }> = [
  { label: '总览', items: [{ label: '今日工作台', path: '/', icon: HouseIcon }] },
  {
    label: '训练',
    items: [
      { label: '专项练习', path: '/practice', icon: TargetIcon },
      { label: '错题复习', path: '/review', icon: CheckSquareOffsetIcon },
      { label: '模拟考试', path: '/exam', icon: ExamIcon }
    ]
  },
  {
    label: '知识',
    items: [
      { label: '知识库工坊', path: '/knowledge-builder', icon: BookOpenTextIcon },
      { label: '行测知识', path: '/knowledge/xingce', icon: BooksIcon },
      { label: '行测方法', path: '/thinking/xingce', icon: LightbulbFilamentIcon },
      { label: '申论知识', path: '/knowledge/shenlun', icon: ClipboardTextIcon },
      { label: '申论方法', path: '/thinking/shenlun', icon: BrainIcon },
      { label: '规律中心', path: '/patterns', icon: SquaresFourIcon }
    ]
  },
  {
    label: '提升',
    items: [
      { label: '申论作答', path: '/shenlun-solution', icon: NotePencilIcon },
      { label: '学习报告', path: '/reports', icon: ChartLineUpIcon },
      { label: 'AI 助教', path: '/ai', icon: RobotIcon },
      { label: 'AI 变式训练', path: '/ai-training', icon: SparkleIcon },
      { label: '能力诊断', path: '/diagnosis', icon: StethoscopeIcon }
    ]
  },
  {
    label: '系统',
    items: [
      { label: '学习环境', path: '/environment', icon: CompassIcon },
      { label: '模型设置', path: '/model-settings', icon: SlidersHorizontalIcon },
      { label: '应用设置', path: '/settings', icon: GearIcon }
    ]
  }
]

function AppShell(): React.JSX.Element {
  const { data, loading, error, initialize, clearError } = useAppStore()
  const location = useLocation()

  useEffect(() => {
    void initialize()
  }, [initialize])
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [location.pathname])

  if (loading && !data) {
    return (
      <div className="boot-screen">
        <div className="brand-mark">
          <ListChecksIcon size={30} weight="bold" />
        </div>
        <Spinner size="large" label="正在准备本地工作台" />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="boot-screen">
        <MessageBar intent="error">
          <MessageBarBody>{error ?? '应用初始化失败'}</MessageBarBody>
          <MessageBarActions>
            <Button onClick={() => void initialize()}>重试</Button>
          </MessageBarActions>
        </MessageBar>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ListChecksIcon size={22} weight="bold" aria-hidden />
          </div>
          <div>
            <strong>砺知考公</strong>
            <span>本地学习工作台</span>
          </div>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={18} aria-hidden />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="vault-summary">
          <StatusIndicator builtin={data.vault.isBuiltin} />
          <div>
            <span>{data.vault.name}</span>
            <small>
              {data.vault.questionCount} 题 · {data.vault.documentCount} 文档
            </small>
          </div>
          <Tooltip content="知识库设置" relationship="label">
            <Button
              as="a"
              href="#/settings"
              appearance="subtle"
              size="small"
              icon={<GearIcon />}
              aria-label="知识库设置"
            />
          </Tooltip>
        </div>
      </aside>
      <main className="workspace" id="main-content">
        {error && (
          <div className="global-message">
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
              <MessageBarActions>
                <Button onClick={clearError}>关闭</Button>
              </MessageBarActions>
            </MessageBar>
          </div>
        )}
        <Suspense fallback={<LoadingState label="正在打开页面" />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/exam" element={<ExamHomePage />} />
            <Route path="/exam/run" element={<ExamRunPage />} />
            <Route path="/knowledge-builder" element={<KnowledgeBuilderPage />} />
            <Route
              path="/knowledge/xingce"
              element={<KnowledgePage subject="xingce" kind="knowledge" />}
            />
            <Route
              path="/thinking/xingce"
              element={<KnowledgePage subject="xingce" kind="method" />}
            />
            <Route
              path="/knowledge/shenlun"
              element={<KnowledgePage subject="shenlun" kind="knowledge" />}
            />
            <Route
              path="/thinking/shenlun"
              element={<KnowledgePage subject="shenlun" kind="method" />}
            />
            <Route path="/patterns" element={<PatternsPage />} />
            <Route path="/shenlun-solution" element={<ShenlunSolutionPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/ai" element={<AiPage />} />
            <Route path="/ai-training" element={<AiTrainingPage />} />
            <Route path="/diagnosis" element={<DiagnosisPage />} />
            <Route path="/environment" element={<EnvironmentPage />} />
            <Route path="/model-settings" element={<ModelSettingsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function StatusIndicator({ builtin }: { builtin: boolean }): React.JSX.Element {
  return (
    <span
      className={`vault-indicator ${builtin ? 'builtin' : 'connected'}`}
      aria-label={builtin ? '内置题库' : '用户知识库已连接'}
    />
  )
}

export function App(): React.JSX.Element {
  const settings = useAppStore((state) => state.data?.settings)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const isDark =
    settings?.theme === 'light' ? false : settings?.theme === 'system' ? systemDark : true
  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark])
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    document.documentElement.dataset.reduceMotion = settings?.reduceMotion ? 'true' : 'false'
  }, [isDark, settings?.reduceMotion])
  return (
    <FluentProvider theme={theme} className="app-provider">
      <AppShell />
    </FluentProvider>
  )
}
