import { spawn, execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  KnowledgeArtifactDetail,
  KnowledgeArtifactStatus,
  KnowledgeArtifactSummary,
  KnowledgeBuildFile,
  KnowledgeBuildJob,
  KnowledgeBuildOptions,
  KnowledgeEngineStatus,
  KnowledgeSourceFile,
  KnowledgeSourceScan,
  Subject,
  VaultIndexResult
} from '../../shared/contracts'
import { FEATURE_PROMPTS, sourceEnvelope, taskDataEnvelope } from '../../shared/prompts'
import { AiService } from './ai'
import { VaultService } from './vault'

const execFileAsync = promisify(execFile)

const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.xls',
  '.html',
  '.htm',
  '.csv',
  '.json',
  '.xml',
  '.txt',
  '.md',
  '.epub',
  '.msg',
  '.eml'
]
const INCOMPLETE_EXTENSIONS = new Set(['.downloading', '.part', '.tmp', '.crdownload'])
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm'])
const IGNORED_DIRECTORIES = new Set(['.git', '.obsidian', 'node_modules', '$recycle.bin'])
const MAX_SOURCE_FILES = 10_000
const MAX_SELECTED_FILES = 500
const MAX_SOURCE_FILE_BYTES = 256 * 1024 * 1024
const MAX_RAW_MARKDOWN_BYTES = 20 * 1024 * 1024
const MAX_CHUNK_CHARACTERS = 12_000
const MAX_CHUNKS_PER_FILE = 60
const MARKITDOWN_VERSION = '0.1.6'

interface CandidateItem {
  kind: 'question' | 'document'
  documentKind: 'knowledge' | 'method' | 'pattern'
  subject: Subject | 'common'
  category: string
  questionType: 'single' | 'multiple' | 'judge' | 'essay'
  stem: string
  options: Array<{ key: string; text: string }>
  answer: string[]
  explanation: string
  title: string
  summary: string
  content: string
  tags: string[]
  year?: number
  region?: string
  paper?: string
  difficulty: number
  confidence: number
  evidenceExcerpt: string
  warnings: string[]
}

interface StoredArtifact extends KnowledgeArtifactDetail {
  jobId: string
  relativeSourcePath: string
}

interface StoredJob {
  id: string
  sourcePath: string
  createdAt: string
  updatedAt: string
  status: KnowledgeBuildJob['status']
  options: KnowledgeBuildOptions
  files: KnowledgeBuildFile[]
  artifactIds: string[]
  currentFile?: string
  message?: string
  cancelRequested: boolean
  outputPath: string
}

function now(): string {
  return new Date().toISOString()
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function compact(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))]
    : []
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith('..\\') && !path.startsWith('../') && !isAbsolute(path))
  )
}

function jsonObject(value: string): Record<string, unknown> {
  const withoutFence = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的 JSON 对象')
  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('JSON 顶层必须是对象')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`模型 JSON 格式无效：${error instanceof Error ? error.message : '解析失败'}`)
  }
}

function yaml(value: string): string {
  return JSON.stringify(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))
}

function safeTitle(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || fallback).slice(0, 80)
}

function chunkText(value: string): string[] {
  const paragraphs = value
    .replace(/\u0000/g, '')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARACTERS) {
      flush()
      for (let start = 0; start < paragraph.length; start += MAX_CHUNK_CHARACTERS - 300)
        chunks.push(paragraph.slice(start, start + MAX_CHUNK_CHARACTERS))
      continue
    }
    if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARACTERS) flush()
    current += `${current ? '\n\n' : ''}${paragraph}`
  }
  flush()
  return chunks.slice(0, MAX_CHUNKS_PER_FILE)
}

export class KnowledgeBuilderService {
  private readonly rootDirectory: string
  private readonly jobsDirectory: string
  private readonly engineDirectory: string
  private readonly managedVaultDirectory: string
  private runningJobId?: string
  private runningChild?: ReturnType<typeof spawn>
  private installing = false
  private engineCache?: KnowledgeEngineStatus

  constructor(
    dataDirectory: string,
    private readonly resourceDirectory: string,
    private readonly ai: AiService,
    private readonly vaults: VaultService
  ) {
    this.rootDirectory = join(dataDirectory, 'knowledge-builder')
    this.jobsDirectory = join(this.rootDirectory, 'jobs')
    this.engineDirectory = join(this.rootDirectory, 'engine')
    this.managedVaultDirectory = join(this.rootDirectory, 'managed-vault')
    mkdirSync(this.jobsDirectory, { recursive: true })
    mkdirSync(this.engineDirectory, { recursive: true })
    mkdirSync(this.managedVaultDirectory, { recursive: true })
    this.recoverInterruptedJobs()
  }

  scan(sourcePath: string): KnowledgeSourceScan {
    const requested = resolve(sourcePath)
    if (!existsSync(requested) || !statSync(requested).isDirectory())
      throw new Error('所选原料路径不是可读取目录')
    const root = realpathSync(requested)
    const files: KnowledgeSourceFile[] = []
    const warnings: string[] = []
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (files.length >= MAX_SOURCE_FILES)
          throw new Error(`原料超过 ${MAX_SOURCE_FILES} 个文件，请拆分目录后分批处理`)
        const path = resolve(directory, entry.name)
        if (!isWithin(root, path)) continue
        if (entry.isSymbolicLink()) {
          warnings.push(`${relative(root, path)}：符号链接未读取`)
          continue
        }
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) visit(path)
          continue
        }
        if (!entry.isFile()) continue
        const info = lstatSync(path)
        const extension = extname(entry.name).toLowerCase()
        let eligible = SUPPORTED_EXTENSIONS.includes(extension)
        let reason: string | undefined
        if (INCOMPLETE_EXTENSIONS.has(extension)) {
          eligible = false
          reason = '下载尚未完成'
        } else if (IMAGE_EXTENSIONS.has(extension)) {
          eligible = false
          reason = '需要可靠 OCR，当前版本不会仅凭图片元数据入库'
        } else if (VIDEO_EXTENSIONS.has(extension)) {
          eligible = false
          reason = '视频暂不属于本地 MarkItDown 转换范围'
        } else if (!eligible) reason = extension ? '暂不支持此格式' : '文件没有扩展名'
        if (info.size > MAX_SOURCE_FILE_BYTES) {
          eligible = false
          reason = '单文件超过 256 MB，请先拆分或压缩'
        }
        const relativePath = relative(root, path).replace(/\\/g, '/')
        files.push({
          id: hash(`${relativePath}\u0000${info.size}\u0000${info.mtimeMs}`).slice(0, 24),
          relativePath,
          extension: extension || '[none]',
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          eligible,
          reason
        })
      }
    }
    visit(root)
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'))
    return {
      sourcePath: root,
      scannedAt: now(),
      files,
      eligibleCount: files.filter((file) => file.eligible).length,
      eligibleSize: files.filter((file) => file.eligible).reduce((sum, file) => sum + file.size, 0),
      skippedCount: files.filter((file) => !file.eligible).length,
      warnings: warnings.slice(0, 100)
    }
  }

  async engineStatus(): Promise<KnowledgeEngineStatus> {
    if (
      this.engineCache?.available &&
      this.engineCache.pythonPath &&
      existsSync(this.engineCache.pythonPath)
    )
      return { ...this.engineCache, installing: this.installing }
    const candidates = this.pythonCandidates()
    for (const pythonPath of candidates) {
      if (!existsSync(pythonPath)) continue
      const version = await this.markitdownVersion(pythonPath)
      if (version) {
        this.engineCache = {
          available: true,
          installing: this.installing,
          version,
          pythonPath,
          message: `MarkItDown ${version} 已就绪`,
          supportedExtensions: [...SUPPORTED_EXTENSIONS]
        }
        return { ...this.engineCache }
      }
    }
    return {
      available: false,
      installing: this.installing,
      message: '尚未安装独立 MarkItDown 转换环境',
      supportedExtensions: [...SUPPORTED_EXTENSIONS]
    }
  }

  async installEngine(): Promise<KnowledgeEngineStatus> {
    if (this.installing) throw new Error('转换引擎正在安装，请稍候')
    if (this.runningJobId) throw new Error('知识构建任务运行时不能更新转换引擎')
    this.installing = true
    try {
      const launcher = await this.findPythonLauncher()
      const environment = join(this.engineDirectory, '.venv')
      const pythonPath = this.managedPythonPath()
      if (!existsSync(pythonPath)) {
        mkdirSync(this.engineDirectory, { recursive: true })
        await execFileAsync(launcher.command, [...launcher.args, '-m', 'venv', environment], {
          timeout: 120_000,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024
        })
      }
      await execFileAsync(
        pythonPath,
        [
          '-m',
          'pip',
          'install',
          '--disable-pip-version-check',
          `markitdown[pdf,docx,pptx,xlsx,xls,outlook]==${MARKITDOWN_VERSION}`
        ],
        {
          timeout: 15 * 60_000,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, PIP_NO_INPUT: '1', PYTHONUTF8: '1' }
        }
      )
      const status = await this.engineStatus()
      if (!status.available) throw new Error('安装命令已结束，但 MarkItDown 无法导入')
      return status
    } catch (error) {
      throw new Error(`MarkItDown 安装失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      this.installing = false
    }
  }

  async startJob(input: {
    sourcePath: string
    fileIds: string[]
    options: KnowledgeBuildOptions
  }): Promise<KnowledgeBuildJob> {
    if (this.runningJobId) throw new Error('已有知识构建任务正在运行')
    if (!input.options.rightsConfirmed)
      throw new Error('请先确认你有权处理所选资料，并会在发布前人工复核')
    const ids = [...new Set(input.fileIds)]
    if (!ids.length) throw new Error('至少选择一个可转换文件')
    if (ids.length > MAX_SELECTED_FILES)
      throw new Error(`单个批次最多处理 ${MAX_SELECTED_FILES} 个文件`)
    const engine = await this.engineStatus()
    if (!engine.available) throw new Error('请先安装 MarkItDown 转换引擎')
    if (input.options.mode !== 'convert-only') {
      const config = this.ai.getConfig()
      if (!config.hasApiKey && !['ollama', 'lmstudio'].includes(config.provider))
        throw new Error('请先在模型设置中保存 API Key，或配置本地模型')
    }
    const scan = this.scan(input.sourcePath)
    const selected = scan.files.filter((file) => file.eligible && ids.includes(file.id))
    if (selected.length !== ids.length)
      throw new Error('部分文件已变化或不再可处理，请重新扫描后选择')
    const id = `kbjob-${randomUUID()}`
    const outputPath = join(this.jobsDirectory, id)
    mkdirSync(join(outputPath, 'raw'), { recursive: true })
    mkdirSync(join(outputPath, 'artifacts'), { recursive: true })
    const job: StoredJob = {
      id,
      sourcePath: scan.sourcePath,
      createdAt: now(),
      updatedAt: now(),
      status: 'queued',
      options: {
        ...input.options,
        tags: [...new Set(input.options.tags.map((tag) => tag.trim()).filter(Boolean))].slice(
          0,
          20
        ),
        instruction: input.options.instruction.trim().slice(0, 2000)
      },
      files: selected.map((file) => ({
        sourceId: file.id,
        relativePath: file.relativePath,
        size: file.size,
        state: 'queued',
        artifactCount: 0,
        chunkCount: 0
      })),
      artifactIds: [],
      cancelRequested: false,
      outputPath
    }
    this.saveJob(job)
    void this.runJob(id).catch((error) => {
      const failed = this.loadJob(id)
      failed.status = 'failed'
      failed.message = error instanceof Error ? error.message : '后台任务异常结束'
      failed.updatedAt = now()
      this.saveJob(failed)
      this.runningJobId = undefined
      this.runningChild = undefined
    })
    return this.jobView(job)
  }

  latestJob(): KnowledgeBuildJob | undefined {
    const manifests = readdirSync(this.jobsDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && existsSync(join(this.jobsDirectory, entry.name, 'job.json'))
      )
      .map((entry) => this.loadJob(entry.name))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return manifests[0] ? this.jobView(manifests[0]) : undefined
  }

  getJob(id: string): KnowledgeBuildJob {
    return this.jobView(this.loadJob(id))
  }

  cancelJob(id: string): KnowledgeBuildJob {
    const job = this.loadJob(id)
    if (!['queued', 'running', 'cancelling'].includes(job.status)) return this.jobView(job)
    job.cancelRequested = true
    job.status = 'cancelling'
    job.message = '正在停止，当前模型请求可能需要先结束'
    job.updatedAt = now()
    this.saveJob(job)
    if (this.runningJobId === id && this.runningChild) this.runningChild.kill()
    return this.jobView(job)
  }

  async retryJob(id: string, sourceIds?: string[]): Promise<KnowledgeBuildJob> {
    if (this.runningJobId) throw new Error('已有知识构建任务正在运行')
    const job = this.loadJob(id)
    if (['queued', 'running', 'cancelling'].includes(job.status))
      throw new Error('当前任务尚未结束')
    const requested = sourceIds?.length ? new Set(sourceIds) : undefined
    let count = 0
    for (const file of job.files) {
      if (
        (file.state === 'failed' || file.state === 'cancelled') &&
        (!requested || requested.has(file.sourceId))
      ) {
        file.state = 'queued'
        file.message = undefined
        file.artifactCount = 0
        file.chunkCount = 0
        count += 1
      }
    }
    if (!count) throw new Error('没有可重试的失败或已取消文件')
    job.cancelRequested = false
    job.status = 'queued'
    job.message = undefined
    job.updatedAt = now()
    this.saveJob(job)
    void this.runJob(id).catch((error) => {
      const failed = this.loadJob(id)
      failed.status = 'failed'
      failed.message = error instanceof Error ? error.message : '重试任务异常结束'
      failed.updatedAt = now()
      this.saveJob(failed)
      this.runningJobId = undefined
      this.runningChild = undefined
    })
    return this.jobView(job)
  }

  getArtifact(jobId: string, artifactId: string): KnowledgeArtifactDetail {
    const job = this.loadJob(jobId)
    if (!job.artifactIds.includes(artifactId)) throw new Error('产物不属于该任务')
    return this.loadArtifact(job, artifactId)
  }

  reviewArtifact(
    jobId: string,
    artifactId: string,
    status: Extract<KnowledgeArtifactStatus, 'approved' | 'rejected'>
  ): KnowledgeBuildJob {
    const job = this.loadJob(jobId)
    if (['queued', 'running', 'cancelling'].includes(job.status))
      throw new Error('请等待转换任务结束后再审核')
    if (!job.artifactIds.includes(artifactId)) throw new Error('产物不属于该任务')
    const artifact = this.loadArtifact(job, artifactId)
    if (artifact.status === 'published') throw new Error('已发布产物不能改回审核状态')
    artifact.status = status
    this.saveArtifact(job, artifact)
    job.updatedAt = now()
    this.saveJob(job)
    return this.jobView(job)
  }

  publish(jobId: string): VaultIndexResult {
    const job = this.loadJob(jobId)
    if (['queued', 'running', 'cancelling'].includes(job.status))
      throw new Error('请等待转换任务结束后再发布')
    const approved = job.artifactIds
      .map((id) => this.loadArtifact(job, id))
      .filter((artifact) => artifact.status === 'approved')
    if (!approved.length) throw new Error('没有已批准且尚未发布的产物')
    const staged: Array<{ artifact: StoredArtifact; target: string; content: string }> = []
    for (const artifact of approved) {
      const group = artifact.kind === 'question' ? '题库' : '知识'
      const directory = join(this.managedVaultDirectory, group, artifact.subject)
      mkdirSync(directory, { recursive: true })
      const target = join(directory, `${safeTitle(artifact.title, artifact.id)}-${artifact.id}.md`)
      const content = artifact.markdown.replace(
        'reviewStatus: "pending"',
        'reviewStatus: "approved"'
      )
      staged.push({ artifact, target, content })
    }
    for (const item of staged) this.atomicWrite(item.target, item.content)
    const result = this.vaults.connect(this.managedVaultDirectory)
    for (const item of staged) {
      item.artifact.status = 'published'
      this.saveArtifact(job, item.artifact)
    }
    job.status = 'completed'
    job.message = `已发布 ${staged.length} 个产物并切换到应用管理知识库`
    job.updatedAt = now()
    this.saveJob(job)
    return result
  }

  private async runJob(id: string): Promise<void> {
    if (this.runningJobId) throw new Error('已有知识构建任务正在运行')
    this.runningJobId = id
    try {
      let job = this.loadJob(id)
      job.status = 'running'
      job.message = undefined
      job.updatedAt = now()
      this.saveJob(job)
      const engine = await this.engineStatus()
      if (!engine.available || !engine.pythonPath) throw new Error('MarkItDown 转换引擎不可用')
      const workerPath = this.workerPath()
      for (const entry of job.files) {
        job = this.loadJob(id)
        if (job.cancelRequested) break
        const file = job.files.find((candidate) => candidate.sourceId === entry.sourceId)
        if (!file || file.state !== 'queued') continue
        job.currentFile = file.relativePath
        file.state = 'converting'
        file.message = '正在转换为 Markdown'
        job.updatedAt = now()
        this.saveJob(job)
        try {
          const source = this.resolveSourceFile(job, file)
          const rawPath = join(job.outputPath, 'raw', `${file.sourceId}.md`)
          await this.convert(engine.pythonPath, workerPath, source, rawPath)
          job.cancelRequested ||= this.loadJob(id).cancelRequested
          if (job.cancelRequested) throw new Error('任务已取消')
          const rawSize = statSync(rawPath).size
          if (rawSize > MAX_RAW_MARKDOWN_BYTES)
            throw new Error('转换结果超过 20 MB，请先拆分原文件')
          const raw = readFileSync(rawPath, 'utf8').trim()
          if (raw.length < 50)
            throw new Error('没有提取到足够文本，文件可能是扫描件，需要 OCR 后再处理')
          file.state = 'converted'
          file.message = 'Markdown 转换完成'
          this.saveJob(job)
          if (job.options.mode === 'convert-only') {
            file.state = 'ready'
            file.message = '原始 Markdown 已保存在任务目录'
          } else {
            file.state = 'organizing'
            file.message = '正在由模型提炼并校验'
            this.saveJob(job)
            const artifacts = await this.organize(job, file, raw)
            job.cancelRequested ||= this.loadJob(id).cancelRequested
            for (const artifact of artifacts) {
              this.saveArtifact(job, artifact)
              if (!job.artifactIds.includes(artifact.id)) job.artifactIds.push(artifact.id)
            }
            file.artifactCount = artifacts.length
            file.state = 'ready'
            file.message = artifacts.length
              ? `生成 ${artifacts.length} 个待审核产物`
              : '未发现足够完整、可入库的内容'
          }
        } catch (error) {
          job.cancelRequested ||= this.loadJob(id).cancelRequested
          file.state = job.cancelRequested ? 'cancelled' : 'failed'
          file.message = error instanceof Error ? error.message : '处理失败'
        }
        job.currentFile = undefined
        job.updatedAt = now()
        this.saveJob(job)
      }
      job = this.loadJob(id)
      if (job.cancelRequested) {
        for (const file of job.files) if (file.state === 'queued') file.state = 'cancelled'
        job.status = 'cancelled'
        job.message = '任务已取消，已完成的转换和审核产物仍被保留'
      } else {
        const artifacts = job.artifactIds.map((artifactId) => this.loadArtifact(job, artifactId))
        job.status = artifacts.some((artifact) => artifact.status === 'pending')
          ? 'review'
          : 'completed'
        job.message = artifacts.length
          ? '批次处理完成，请逐项审核后发布'
          : '批次处理完成，未生成待发布产物'
      }
      job.currentFile = undefined
      job.updatedAt = now()
      this.saveJob(job)
    } finally {
      this.runningJobId = undefined
      this.runningChild = undefined
    }
  }

  private async organize(
    job: StoredJob,
    file: KnowledgeBuildFile,
    raw: string
  ): Promise<StoredArtifact[]> {
    const chunks = chunkText(raw)
    if (!chunks.length) return []
    file.chunkCount = chunks.length
    const artifacts: StoredArtifact[] = []
    const seen = new Set<string>()
    for (let index = 0; index < chunks.length; index += 1) {
      const latest = this.loadJob(job.id)
      if (latest.cancelRequested) break
      const chunk = chunks[index]!
      file.message = `模型整理 ${index + 1}/${chunks.length}`
      this.saveJob(job)
      const context = taskDataEnvelope('知识整理任务参数', {
        sourceFile: file.relativePath,
        chunk: { current: index + 1, total: chunks.length },
        outputMode: job.options.mode,
        defaultSubject: job.options.subject,
        batchTags: job.options.tags,
        customInstruction: job.options.instruction || ''
      })
      const extracted = await this.ai.ask(
        {
          purpose: 'knowledge',
          messages: [
            { role: 'system', content: FEATURE_PROMPTS.knowledgeExtract },
            { role: 'user', content: `${context}\n${sourceEnvelope(file.relativePath, chunk)}` }
          ]
        },
        120_000
      )
      let payload = jsonObject(extracted.content)
      if (job.options.quality === 'high') {
        const reviewed = await this.ai.ask(
          {
            purpose: 'knowledge',
            messages: [
              { role: 'system', content: FEATURE_PROMPTS.knowledgeReview },
              {
                role: 'user',
                content: `${context}\n${sourceEnvelope(file.relativePath, chunk)}\n${taskDataEnvelope('待终审候选 JSON', payload)}`
              }
            ]
          },
          120_000
        )
        payload = jsonObject(reviewed.content)
      }
      const items = Array.isArray(payload.items) ? payload.items : []
      for (const value of items.slice(0, 6)) {
        const candidate = this.validateCandidate(value, job.options, chunk)
        if (!candidate) continue
        const signature = hash(
          candidate.kind === 'question'
            ? `${candidate.subject}\n${candidate.stem}\n${JSON.stringify(candidate.options)}`
            : `${candidate.subject}\n${candidate.title}\n${candidate.content}`
        )
        if (seen.has(signature)) continue
        seen.add(signature)
        const artifactId = `kb-${hash(`${file.sourceId}\n${signature}`).slice(0, 24)}`
        const title =
          candidate.kind === 'question'
            ? safeTitle(candidate.stem.slice(0, 60), '未命名题目')
            : safeTitle(candidate.title, '未命名知识')
        const markdown = this.candidateMarkdown(
          artifactId,
          candidate,
          file.relativePath,
          job.options.tags
        )
        artifacts.push({
          id: artifactId,
          jobId: job.id,
          sourceId: file.sourceId,
          sourcePath: file.relativePath,
          relativeSourcePath: file.relativePath,
          kind: candidate.kind,
          subject: candidate.subject,
          title,
          category: candidate.category,
          confidence: candidate.confidence,
          status: 'pending',
          warnings: candidate.warnings,
          preview:
            candidate.kind === 'question'
              ? candidate.stem.slice(0, 180)
              : (candidate.summary || candidate.content).slice(0, 180),
          markdown,
          evidenceExcerpt: candidate.evidenceExcerpt
        })
      }
    }
    return artifacts
  }

  private validateCandidate(
    value: unknown,
    options: KnowledgeBuildOptions,
    source: string
  ): CandidateItem | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    let kind: CandidateItem['kind'] = record.kind === 'question' ? 'question' : 'document'
    if (options.mode === 'questions' && kind !== 'question') return undefined
    if (options.mode === 'documents' && kind !== 'document') return undefined
    const rawSubject = normalizeString(record.subject)
    const subject: CandidateItem['subject'] =
      options.subject !== 'auto'
        ? options.subject
        : rawSubject === 'xingce' || rawSubject === 'shenlun' || rawSubject === 'common'
          ? rawSubject
          : 'common'
    const evidenceExcerpt = normalizeString(record.evidenceExcerpt).slice(0, 80)
    const warnings = stringArray(record.warnings).slice(0, 8)
    if (evidenceExcerpt && !compact(source).includes(compact(evidenceExcerpt).slice(0, 20)))
      warnings.push('定位依据未能在当前片段中直接匹配，请重点人工复核')
    const confidence = clamp(Number(record.confidence) || 0.5, 0, 1)
    if (confidence < 0.75 && warnings.length === 0) warnings.push('模型置信度较低')
    const tags = stringArray(record.tags).slice(0, 12)
    const category =
      normalizeString(record.category) || (subject === 'shenlun' ? '申论综合' : '未分类')
    const yearValue = Number(record.year)
    const year =
      Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 2200 ? yearValue : undefined
    if (kind === 'question') {
      const stem = normalizeString(record.stem)
      const answer = stringArray(record.answer).map((item) => item.toUpperCase())
      const rawOptions = Array.isArray(record.options) ? record.options : []
      const questionOptions = rawOptions.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const option = item as Record<string, unknown>
        const key = normalizeString(option.key).toUpperCase()
        const text = normalizeString(option.text)
        return key && text ? [{ key, text }] : []
      })
      const questionTypeRaw = normalizeString(record.questionType)
      const questionType: CandidateItem['questionType'] = [
        'single',
        'multiple',
        'judge',
        'essay'
      ].includes(questionTypeRaw)
        ? (questionTypeRaw as CandidateItem['questionType'])
        : questionOptions.length
          ? answer.length > 1
            ? 'multiple'
            : 'single'
          : 'essay'
      if (stem.length < 6 || answer.length === 0) return undefined
      if (questionType !== 'essay') {
        if (questionOptions.length < 2) return undefined
        const keys = new Set(questionOptions.map((item) => item.key))
        if (answer.some((item) => !keys.has(item))) return undefined
      }
      const explanation = normalizeString(record.explanation)
      if (explanation.length < 8) warnings.push('解析较短，请在发布前补充核验过程')
      return {
        kind,
        documentKind: 'knowledge',
        subject,
        category,
        questionType,
        stem,
        options: questionOptions,
        answer,
        explanation: explanation || '当前来源未提供足够解析，请人工补充。',
        title: '',
        summary: '',
        content: '',
        tags,
        year,
        region: normalizeString(record.region) || undefined,
        paper: normalizeString(record.paper) || undefined,
        difficulty: clamp(Math.round(Number(record.difficulty) || 2), 1, 5),
        confidence,
        evidenceExcerpt,
        warnings: [...new Set(warnings)]
      }
    }
    const title = normalizeString(record.title)
    const content = normalizeString(record.content)
    if (title.length < 2 || content.length < 50) return undefined
    if (/添加.{0,6}(微信|群)|扫码|领取更多|下载地址/i.test(`${title}\n${content}`)) return undefined
    return {
      kind,
      documentKind: ['knowledge', 'method', 'pattern'].includes(
        normalizeString(record.documentKind)
      )
        ? (normalizeString(record.documentKind) as CandidateItem['documentKind'])
        : 'knowledge',
      subject,
      category,
      questionType: 'essay',
      stem: '',
      options: [],
      answer: [],
      explanation: '',
      title,
      summary: normalizeString(record.summary) || content.replace(/[#>*_`]/g, '').slice(0, 140),
      content,
      tags,
      year,
      region: normalizeString(record.region) || undefined,
      paper: normalizeString(record.paper) || undefined,
      difficulty: clamp(Math.round(Number(record.difficulty) || 2), 1, 5),
      confidence,
      evidenceExcerpt,
      warnings: [...new Set(warnings)]
    }
  }

  private candidateMarkdown(
    id: string,
    item: CandidateItem,
    sourcePath: string,
    batchTags: string[]
  ): string {
    const tags = [...new Set([...item.tags, ...batchTags])]
    const common = [
      '---',
      `id: ${yaml(id)}`,
      `subject: ${yaml(item.subject)}`,
      `category: ${yaml(item.category)}`,
      `tags: ${JSON.stringify(tags)}`,
      `source: ${yaml(`本地资料/${sourcePath}`)}`,
      `sourceFile: ${yaml(sourcePath)}`,
      `confidence: ${item.confidence.toFixed(2)}`,
      `reviewStatus: "pending"`,
      `generatedBy: "MarkItDown + configured LLM"`
    ]
    if (item.year) common.push(`year: ${item.year}`)
    if (item.region) common.push(`region: ${yaml(item.region)}`)
    if (item.paper) common.push(`paper: ${yaml(item.paper)}`)
    if (item.kind === 'question') {
      return [
        ...common,
        'kind: "question"',
        `questionType: ${yaml(item.questionType)}`,
        `difficulty: ${item.difficulty}`,
        `stem: ${yaml(item.stem)}`,
        `options: ${JSON.stringify(item.options)}`,
        `answer: ${JSON.stringify(item.answer)}`,
        `explanation: ${yaml(item.explanation)}`,
        '---',
        '',
        '# 题目',
        '',
        item.stem,
        ...(item.options.length
          ? ['', '## 选项', '', ...item.options.map((option) => `${option.key}. ${option.text}`)]
          : []),
        '',
        '## 答案',
        '',
        item.answer.join('、'),
        '',
        '## 解析',
        '',
        item.explanation,
        ''
      ].join('\n')
    }
    return [
      ...common,
      `kind: ${yaml(item.documentKind)}`,
      `title: ${yaml(item.title)}`,
      `summary: ${yaml(item.summary)}`,
      '---',
      '',
      `# ${item.title}`,
      '',
      item.content.replace(/^#\s+.+\n+/, ''),
      ''
    ].join('\n')
  }

  private async convert(
    pythonPath: string,
    workerPath: string,
    sourcePath: string,
    outputPath: string
  ): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(pythonPath, [workerPath, sourcePath, outputPath], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      })
      this.runningChild = child
      let stderr = ''
      const timer = setTimeout(() => child.kill(), 10 * 60_000)
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-20_000)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        this.runningChild = undefined
        if (code === 0 && existsSync(outputPath)) resolvePromise()
        else reject(new Error(stderr.trim() || `MarkItDown 进程退出码 ${code ?? '未知'}`))
      })
    })
  }

  private resolveSourceFile(job: StoredJob, file: KnowledgeBuildFile): string {
    const root = realpathSync(job.sourcePath)
    const candidate = resolve(root, file.relativePath)
    if (!isWithin(root, candidate) || !existsSync(candidate))
      throw new Error('原料文件不存在或超出目录')
    const info = lstatSync(candidate)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('原料不是普通文件')
    const actual = realpathSync(candidate)
    if (!isWithin(root, actual)) throw new Error('原料路径超出所选目录')
    if (info.size !== file.size) throw new Error('原料文件在扫描后发生变化，请重新扫描')
    return actual
  }

  private jobView(job: StoredJob): KnowledgeBuildJob {
    const artifacts = job.artifactIds.flatMap((id) => {
      try {
        return [this.artifactSummary(this.loadArtifact(job, id))]
      } catch {
        return []
      }
    })
    return {
      id: job.id,
      sourcePath: job.sourcePath,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      status: job.status,
      options: job.options,
      files: job.files,
      artifacts,
      processedFiles: job.files.filter((file) =>
        ['ready', 'failed', 'skipped', 'cancelled'].includes(file.state)
      ).length,
      totalFiles: job.files.length,
      approvedArtifacts: artifacts.filter((artifact) => artifact.status === 'approved').length,
      pendingArtifacts: artifacts.filter((artifact) => artifact.status === 'pending').length,
      failedFiles: job.files.filter((file) => file.state === 'failed').length,
      currentFile: job.currentFile,
      message: job.message,
      outputPath: job.outputPath
    }
  }

  private artifactSummary(artifact: StoredArtifact): KnowledgeArtifactSummary {
    const {
      markdown: _markdown,
      evidenceExcerpt: _evidence,
      jobId: _jobId,
      relativeSourcePath: _path,
      ...summary
    } = artifact
    return summary
  }

  private jobDirectory(id: string): string {
    if (!/^kbjob-[0-9a-f-]+$/i.test(id)) throw new Error('任务 ID 无效')
    const directory = resolve(this.jobsDirectory, id)
    if (!isWithin(this.jobsDirectory, directory)) throw new Error('任务路径无效')
    return directory
  }

  private loadJob(id: string): StoredJob {
    const path = join(this.jobDirectory(id), 'job.json')
    if (!existsSync(path)) throw new Error('知识构建任务不存在')
    return JSON.parse(readFileSync(path, 'utf8')) as StoredJob
  }

  private saveJob(job: StoredJob): void {
    job.updatedAt = now()
    mkdirSync(this.jobDirectory(job.id), { recursive: true })
    this.atomicWrite(join(this.jobDirectory(job.id), 'job.json'), JSON.stringify(job, null, 2))
  }

  private artifactPath(job: StoredJob, artifactId: string): string {
    if (!/^kb-[0-9a-f]+$/i.test(artifactId)) throw new Error('产物 ID 无效')
    return join(this.jobDirectory(job.id), 'artifacts', `${artifactId}.json`)
  }

  private loadArtifact(job: StoredJob, artifactId: string): StoredArtifact {
    const path = this.artifactPath(job, artifactId)
    if (!existsSync(path)) throw new Error('知识产物不存在')
    return JSON.parse(readFileSync(path, 'utf8')) as StoredArtifact
  }

  private saveArtifact(job: StoredJob, artifact: StoredArtifact): void {
    mkdirSync(join(this.jobDirectory(job.id), 'artifacts'), { recursive: true })
    this.atomicWrite(this.artifactPath(job, artifact.id), JSON.stringify(artifact, null, 2))
  }

  private atomicWrite(path: string, content: string): void {
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, content, 'utf8')
    renameSync(temporary, path)
  }

  private managedPythonPath(): string {
    return process.platform === 'win32'
      ? join(this.engineDirectory, '.venv', 'Scripts', 'python.exe')
      : join(this.engineDirectory, '.venv', 'bin', 'python')
  }

  private pythonCandidates(): string[] {
    const override = process.env.WORKBENCH_MARKITDOWN_PYTHON
    const development =
      process.platform === 'win32'
        ? resolve(process.cwd(), '.venv-markitdown', 'Scripts', 'python.exe')
        : resolve(process.cwd(), '.venv-markitdown', 'bin', 'python')
    return [
      ...new Set([override, this.managedPythonPath(), development].filter(Boolean) as string[])
    ]
  }

  private async markitdownVersion(pythonPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        pythonPath,
        ['-c', "import importlib.metadata as m; import markitdown; print(m.version('markitdown'))"],
        {
          timeout: 10_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, PYTHONUTF8: '1' }
        }
      )
      return stdout.trim() || undefined
    } catch {
      return undefined
    }
  }

  private async findPythonLauncher(): Promise<{ command: string; args: string[] }> {
    const candidates =
      process.platform === 'win32'
        ? [
            { command: 'py', args: ['-3.12'] },
            { command: 'py', args: ['-3'] },
            { command: 'python', args: [] }
          ]
        : [
            { command: 'python3.12', args: [] },
            { command: 'python3', args: [] },
            { command: 'python', args: [] }
          ]
    for (const candidate of candidates) {
      try {
        const { stdout, stderr } = await execFileAsync(
          candidate.command,
          [...candidate.args, '--version'],
          { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }
        )
        const match = `${stdout}\n${stderr}`.match(/Python\s+(\d+)\.(\d+)/i)
        if (match && Number(match[1]) >= 3 && Number(match[2]) >= 10) return candidate
      } catch {
        // Try the next narrow launcher candidate.
      }
    }
    throw new Error('未找到 Python 3.10 或更高版本')
  }

  private workerPath(): string {
    const candidates = [
      join(this.resourceDirectory, 'tools', 'markitdown-worker.py'),
      resolve(process.cwd(), 'tools', 'markitdown-worker.py')
    ]
    const path = candidates.find((candidate) => existsSync(candidate))
    if (!path) throw new Error('MarkItDown 本地转换脚本缺失')
    return path
  }

  private recoverInterruptedJobs(): void {
    for (const entry of readdirSync(this.jobsDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(this.jobsDirectory, entry.name, 'job.json')
      if (!existsSync(path)) continue
      try {
        const job = this.loadJob(entry.name)
        if (!['queued', 'running', 'cancelling'].includes(job.status)) continue
        for (const file of job.files)
          if (['converting', 'converted', 'organizing'].includes(file.state)) {
            file.state = 'failed'
            file.message = '应用在处理期间退出，可使用重试继续'
          }
        job.status = 'failed'
        job.currentFile = undefined
        job.cancelRequested = false
        job.message = '上次任务被应用退出中断，已完成内容仍被保留'
        this.saveJob(job)
      } catch {
        // A damaged manifest is isolated from other jobs and can be inspected in its folder.
      }
    }
  }
}
