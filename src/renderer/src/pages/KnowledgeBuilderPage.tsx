import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  ProgressBar,
  Select,
  Spinner,
  Textarea
} from '@fluentui/react-components'
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  FileMdIcon,
  FolderOpenIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  WrenchIcon
} from '@phosphor-icons/react'
import type {
  KnowledgeArtifactDetail,
  KnowledgeArtifactStatus,
  KnowledgeBuildJob,
  KnowledgeBuildMode,
  KnowledgeBuildQuality,
  KnowledgeEngineStatus,
  KnowledgeSourceScan,
  Subject,
  VaultIndexResult
} from '@shared/contracts'
import { formatBytes, invoke } from '../api'
import { MarkdownContent } from '../components/MarkdownContent'
import { EmptyState, ErrorState, LoadingState, PageHeader, Section } from '../components/ui'
import { useAppStore } from '../store'

const RUNNING_STATES = new Set(['queued', 'running', 'cancelling'])

function jobStatusLabel(status: KnowledgeBuildJob['status']): string {
  return {
    queued: '等待启动',
    running: '处理中',
    review: '等待审核',
    completed: '已完成',
    cancelling: '正在停止',
    cancelled: '已取消',
    failed: '任务异常'
  }[status]
}

function artifactStatusLabel(status: KnowledgeArtifactStatus): string {
  return {
    pending: '待审核',
    approved: '已批准',
    rejected: '已拒绝',
    published: '已发布'
  }[status]
}

function statusAppearance(
  status: KnowledgeArtifactStatus
): 'filled' | 'outline' | 'tint' | 'ghost' {
  return status === 'approved' || status === 'published'
    ? 'filled'
    : status === 'rejected'
      ? 'outline'
      : 'tint'
}

export function KnowledgeBuilderPage(): React.JSX.Element {
  const initialize = useAppStore((state) => state.initialize)
  const [engine, setEngine] = useState<KnowledgeEngineStatus>()
  const [scan, setScan] = useState<KnowledgeSourceScan>()
  const [sourcePath, setSourcePath] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<KnowledgeBuildMode>('auto')
  const [quality, setQuality] = useState<KnowledgeBuildQuality>('high')
  const [subject, setSubject] = useState<Subject | 'common' | 'auto'>('auto')
  const [tags, setTags] = useState('')
  const [instruction, setInstruction] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [job, setJob] = useState<KnowledgeBuildJob>()
  const [artifact, setArtifact] = useState<KnowledgeArtifactDetail>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const visibleFiles = useMemo(() => {
    if (!scan) return []
    const keyword = query.trim().toLowerCase()
    return scan.files.filter(
      (file) => !keyword || file.relativePath.toLowerCase().includes(keyword)
    )
  }, [query, scan])

  const visibleEligible = visibleFiles.filter((file) => file.eligible)
  const selectedSize = scan?.files
    .filter((file) => selected.has(file.id))
    .reduce((total, file) => total + file.size, 0)

  useEffect(() => {
    void Promise.all([
      invoke<KnowledgeEngineStatus>({ method: 'knowledgeBuilder.engine.status' }),
      invoke<KnowledgeBuildJob | undefined>({ method: 'knowledgeBuilder.job.latest' })
    ])
      .then(([engineStatus, latest]) => {
        setEngine(engineStatus)
        setJob(latest)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '知识库工坊初始化失败'))
  }, [])

  useEffect(() => {
    if (!job || !RUNNING_STATES.has(job.status)) return
    const timer = window.setInterval(() => {
      void invoke<KnowledgeBuildJob>({
        method: 'knowledgeBuilder.job.get',
        params: { id: job.id }
      })
        .then(setJob)
        .catch((cause) => setError(cause instanceof Error ? cause.message : '任务状态读取失败'))
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job?.id, job?.status])

  async function installEngine(): Promise<void> {
    setBusy('engine')
    setError('')
    try {
      setEngine(await invoke({ method: 'knowledgeBuilder.engine.install' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '转换引擎安装失败')
    } finally {
      setBusy('')
    }
  }

  async function chooseSource(): Promise<void> {
    setError('')
    const path = await invoke<string | undefined>({ method: 'knowledgeBuilder.source.choose' })
    if (!path) return
    setSourcePath(path)
    await scanSource(path)
  }

  async function scanSource(path = sourcePath): Promise<void> {
    if (!path.trim()) return
    setBusy('scan')
    setError('')
    try {
      const result = await invoke<KnowledgeSourceScan>({
        method: 'knowledgeBuilder.source.scan',
        params: { path: path.trim() }
      })
      setSourcePath(result.sourcePath)
      setScan(result)
      setSelected(new Set())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '原料扫描失败')
    } finally {
      setBusy('')
    }
  }

  function toggleFile(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function startJob(): Promise<void> {
    if (!scan) return
    setBusy('start')
    setError('')
    setArtifact(undefined)
    try {
      const created = await invoke<KnowledgeBuildJob>({
        method: 'knowledgeBuilder.job.start',
        params: {
          sourcePath: scan.sourcePath,
          fileIds: [...selected],
          options: {
            mode,
            quality,
            subject,
            tags: tags
              .split(/[,，;；\n]/)
              .map((tag) => tag.trim())
              .filter(Boolean),
            instruction,
            rightsConfirmed
          }
        }
      })
      setJob(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务启动失败')
    } finally {
      setBusy('')
    }
  }

  async function cancelJob(): Promise<void> {
    if (!job) return
    setError('')
    try {
      setJob(await invoke({ method: 'knowledgeBuilder.job.cancel', params: { id: job.id } }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务停止失败')
    }
  }

  async function retryJob(): Promise<void> {
    if (!job) return
    setBusy('retry')
    setError('')
    try {
      setJob(await invoke({ method: 'knowledgeBuilder.job.retry', params: { id: job.id } }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '失败文件重试失败')
    } finally {
      setBusy('')
    }
  }

  async function openArtifact(id: string): Promise<void> {
    if (!job) return
    setBusy('artifact')
    setError('')
    try {
      setArtifact(
        await invoke({
          method: 'knowledgeBuilder.artifact.get',
          params: { jobId: job.id, artifactId: id }
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '产物读取失败')
    } finally {
      setBusy('')
    }
  }

  async function reviewArtifact(status: 'approved' | 'rejected'): Promise<void> {
    if (!job || !artifact) return
    setBusy('review')
    setError('')
    try {
      const updated = await invoke<KnowledgeBuildJob>({
        method: 'knowledgeBuilder.artifact.review',
        params: { jobId: job.id, artifactId: artifact.id, status }
      })
      setJob(updated)
      setArtifact(
        await invoke({
          method: 'knowledgeBuilder.artifact.get',
          params: { jobId: job.id, artifactId: artifact.id }
        })
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '审核状态保存失败')
    } finally {
      setBusy('')
    }
  }

  async function publish(): Promise<void> {
    if (!job) return
    setBusy('publish')
    setError('')
    try {
      const result = await invoke<VaultIndexResult>({
        method: 'knowledgeBuilder.publish',
        params: { jobId: job.id }
      })
      await initialize()
      setJob(await invoke({ method: 'knowledgeBuilder.job.get', params: { id: job.id } }))
      setArtifact(undefined)
      if (result.warnings.length) setError(`发布完成，但有 ${result.warnings.length} 条索引提示`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '知识库发布失败')
    } finally {
      setBusy('')
    }
  }

  async function openOutput(): Promise<void> {
    if (!job) return
    try {
      await invoke({ method: 'shell.openPath', params: { path: job.outputPath } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务目录无法打开')
    }
  }

  if (!engine) return <LoadingState label="正在检查知识转换环境" />

  return (
    <div className="page knowledge-builder-page">
      <PageHeader
        eyebrow="知识库工坊"
        title="把本地资料变成可审核的题库"
        description="原料只读，MarkItDown 负责转换，已配置模型负责提炼和复核。只有人工批准的产物才会进入应用管理知识库。"
        actions={
          <Button icon={<FolderOpenIcon />} onClick={() => void chooseSource()}>
            选择原料目录
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => setError('')} />}

      <Section
        title="转换环境"
        description="使用独立 Python 环境，不改动系统 Python，也不会把 API Key 交给转换进程。"
        actions={
          !engine.available && (
            <Button
              appearance="primary"
              icon={<WrenchIcon />}
              disabled={busy === 'engine'}
              onClick={() => void installEngine()}
            >
              {busy === 'engine' ? '正在安装' : '安装转换引擎'}
            </Button>
          )
        }
      >
        <div className="builder-engine-row">
          <div className={`engine-state ${engine.available ? 'ready' : 'missing'}`}>
            {engine.available ? <CheckCircleIcon size={22} /> : <WrenchIcon size={22} />}
            <div>
              <strong>{engine.message}</strong>
              <small>
                {engine.pythonPath ??
                  '需要本机已有 Python 3.10 或更高版本，安装内容位于应用数据目录'}
              </small>
            </div>
          </div>
          {busy === 'engine' && <ProgressBar />}
        </div>
      </Section>

      <Section
        title="原料批次"
        description="建议先选 1-3 个代表性文件验证质量和费用，再逐步扩大批次。"
      >
        <div className="builder-source-row">
          <Field label="原料目录">
            <Input
              value={sourcePath}
              onChange={(_, data) => setSourcePath(data.value)}
              placeholder="选择或输入本地资料目录"
            />
          </Field>
          <Button
            icon={busy === 'scan' ? <Spinner size="tiny" /> : <ArrowClockwiseIcon />}
            disabled={!sourcePath.trim() || busy === 'scan'}
            onClick={() => void scanSource()}
          >
            扫描
          </Button>
        </div>

        {scan ? (
          <>
            <div className="builder-scan-summary" aria-label="扫描摘要">
              <div>
                <strong>{scan.eligibleCount}</strong>
                <span>可转换文件</span>
              </div>
              <div>
                <strong>{formatBytes(scan.eligibleSize)}</strong>
                <span>可转换体积</span>
              </div>
              <div>
                <strong>{scan.skippedCount}</strong>
                <span>跳过或待处理</span>
              </div>
              <div>
                <strong>{selected.size}</strong>
                <span>本批已选，{formatBytes(selectedSize ?? 0)}</span>
              </div>
            </div>

            <div className="builder-file-toolbar">
              <Input
                value={query}
                onChange={(_, data) => setQuery(data.value)}
                placeholder="按路径筛选文件"
              />
              <Button
                onClick={() =>
                  setSelected(new Set(visibleEligible.slice(0, 500).map((file) => file.id)))
                }
              >
                选择当前可转换项
              </Button>
              <Button icon={<TrashIcon />} onClick={() => setSelected(new Set())}>
                清空选择
              </Button>
            </div>

            <div className="builder-file-list" role="list" aria-label="原料文件">
              {visibleFiles.map((file) => (
                <label className={`builder-file ${file.eligible ? '' : 'disabled'}`} key={file.id}>
                  <Checkbox
                    checked={selected.has(file.id)}
                    disabled={!file.eligible}
                    onChange={(_, data) => toggleFile(file.id, data.checked === true)}
                    aria-label={`选择 ${file.relativePath}`}
                  />
                  <FileMdIcon size={18} aria-hidden />
                  <span className="builder-file-name" title={file.relativePath}>
                    {file.relativePath}
                  </span>
                  <span>{formatBytes(file.size)}</span>
                  <Badge appearance="outline">{file.extension}</Badge>
                  {!file.eligible && <small>{file.reason}</small>}
                </label>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title="尚未扫描原料"
            description="选择“本地知识库”或你的其他资料目录。扫描只读取文件元数据，不会修改内容。"
            actionLabel="选择目录"
            onAction={() => void chooseSource()}
          />
        )}
      </Section>

      {scan && (
        <Section
          title="整理策略"
          description="高质量模式会进行提取和二次审校，模型调用量约为标准模式的两倍。"
        >
          <div className="builder-options">
            <Field label="产物类型">
              <Select
                value={mode}
                onChange={(_, data) => setMode(data.value as KnowledgeBuildMode)}
              >
                <option value="auto">自动识别题目与知识</option>
                <option value="questions">只生成题目</option>
                <option value="documents">只生成知识文档</option>
                <option value="convert-only">仅转换 Markdown，不调用模型</option>
              </Select>
            </Field>
            <Field label="质量流程">
              <Select
                value={quality}
                disabled={mode === 'convert-only'}
                onChange={(_, data) => setQuality(data.value as KnowledgeBuildQuality)}
              >
                <option value="high">高质量，两阶段审校</option>
                <option value="standard">标准，单阶段提取</option>
              </Select>
            </Field>
            <Field label="默认科目">
              <Select
                value={subject}
                onChange={(_, data) => setSubject(data.value as Subject | 'common' | 'auto')}
              >
                <option value="auto">由内容判断</option>
                <option value="xingce">行测</option>
                <option value="shenlun">申论</option>
                <option value="common">公共知识</option>
              </Select>
            </Field>
            <Field label="批次标签" hint="用逗号分隔，将附加到所有产物">
              <Input
                value={tags}
                onChange={(_, data) => setTags(data.value)}
                placeholder="例如：国考，2025"
              />
            </Field>
          </div>
          <Field
            label="自定义整理要求"
            hint="例如：优先提取数量关系公式与典型陷阱。要求只影响内容侧重点，不能绕过证据和审核规则。"
          >
            <Textarea
              value={instruction}
              resize="vertical"
              onChange={(_, data) => setInstruction(data.value)}
              placeholder="可留空，使用默认公考知识编辑规则"
            />
          </Field>
          <Checkbox
            checked={rightsConfirmed}
            onChange={(_, data) => setRightsConfirmed(data.checked === true)}
            label="我确认有权处理所选资料，并会在发布前逐项核对答案、事实与来源"
          />
          <div className="button-row builder-start-row">
            <Button
              appearance="primary"
              icon={<PlayIcon />}
              disabled={
                !engine.available ||
                !selected.size ||
                !rightsConfirmed ||
                busy === 'start' ||
                Boolean(job && RUNNING_STATES.has(job.status))
              }
              onClick={() => void startJob()}
            >
              {busy === 'start' ? '正在创建批次' : `开始处理 ${selected.size} 个文件`}
            </Button>
            <span className="muted-copy">
              原文件保持不变，任务可取消，单个失败不会中断整个批次。
            </span>
          </div>
        </Section>
      )}

      {job && (
        <Section
          title="任务与审核"
          description={job.message}
          actions={
            <div className="button-row">
              <Button icon={<FolderOpenIcon />} onClick={() => void openOutput()}>
                打开任务目录
              </Button>
              {RUNNING_STATES.has(job.status) && (
                <Button icon={<StopIcon />} onClick={() => void cancelJob()}>
                  停止任务
                </Button>
              )}
              {job.failedFiles > 0 && !RUNNING_STATES.has(job.status) && (
                <Button
                  icon={<ArrowClockwiseIcon />}
                  disabled={busy === 'retry'}
                  onClick={() => void retryJob()}
                >
                  重试失败文件
                </Button>
              )}
              {job.approvedArtifacts > 0 && !RUNNING_STATES.has(job.status) && (
                <Button
                  appearance="primary"
                  icon={<CheckCircleIcon />}
                  disabled={busy === 'publish'}
                  onClick={() => void publish()}
                >
                  发布 {job.approvedArtifacts} 项
                </Button>
              )}
            </div>
          }
        >
          <div className="builder-job-head">
            <div>
              <Badge appearance="filled">{jobStatusLabel(job.status)}</Badge>
              <strong>
                {job.processedFiles}/{job.totalFiles} 文件
              </strong>
              <span>{job.currentFile ?? '当前没有正在处理的文件'}</span>
            </div>
            <div>
              <span>{job.pendingArtifacts} 待审核</span>
              <span>{job.approvedArtifacts} 已批准</span>
              <span>{job.failedFiles} 失败</span>
            </div>
          </div>
          <ProgressBar value={job.totalFiles ? job.processedFiles / job.totalFiles : 0} />

          <div className="builder-job-files">
            {job.files.map((file) => (
              <div key={file.sourceId}>
                <span title={file.relativePath}>{file.relativePath}</span>
                <Badge appearance="outline">{file.state}</Badge>
                <small>{file.message ?? '等待处理'}</small>
              </div>
            ))}
          </div>

          {job.artifacts.length > 0 && (
            <div className="builder-review-layout">
              <div className="builder-artifact-list" aria-label="待审核知识产物">
                {job.artifacts.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`builder-artifact ${artifact?.id === item.id ? 'active' : ''}`}
                    onClick={() => void openArtifact(item.id)}
                  >
                    <span>
                      <Badge appearance={statusAppearance(item.status)}>
                        {artifactStatusLabel(item.status)}
                      </Badge>
                      <small>{item.kind === 'question' ? '题目' : '知识文档'}</small>
                      <small>{Math.round(item.confidence * 100)}% 置信度</small>
                    </span>
                    <strong>{item.title}</strong>
                    <p>{item.preview}</p>
                  </button>
                ))}
              </div>
              <div className="builder-artifact-preview">
                {busy === 'artifact' ? (
                  <LoadingState label="正在读取产物" />
                ) : artifact ? (
                  <>
                    <div className="builder-preview-head">
                      <div>
                        <strong>{artifact.title}</strong>
                        <span>来源定位：{artifact.evidenceExcerpt || '模型未提供定位摘录'}</span>
                      </div>
                      {artifact.status !== 'published' && (
                        <div className="button-row">
                          <Button
                            appearance={artifact.status === 'rejected' ? 'primary' : 'secondary'}
                            disabled={busy === 'review'}
                            onClick={() => void reviewArtifact('rejected')}
                          >
                            拒绝
                          </Button>
                          <Button
                            appearance={artifact.status === 'approved' ? 'primary' : 'secondary'}
                            disabled={busy === 'review'}
                            onClick={() => void reviewArtifact('approved')}
                          >
                            批准
                          </Button>
                        </div>
                      )}
                    </div>
                    {artifact.warnings.length > 0 && (
                      <div className="builder-warning-list">
                        {artifact.warnings.map((warning) => (
                          <span key={warning}>{warning}</span>
                        ))}
                      </div>
                    )}
                    <MarkdownContent
                      content={artifact.markdown.replace(/^---\s*[\s\S]*?\s*---\s*/m, '')}
                    />
                  </>
                ) : (
                  <EmptyState
                    title="选择一项开始审核"
                    description="核对题干、答案、解析、来源定位和模型警告。批准不会立即发布。"
                  />
                )}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
