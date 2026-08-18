export type Subject = 'xingce' | 'shenlun'
export type QuestionType = 'single' | 'multiple' | 'judge' | 'essay'
export type Difficulty = 1 | 2 | 3 | 4 | 5

export interface QuestionOption {
  key: string
  text: string
}

export interface Question {
  id: string
  subject: Subject
  category: string
  type: QuestionType
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  difficulty: Difficulty
  source: string
  year?: number
  region?: string
  paper?: string
  material?: string
  contentVersion?: string
  tags: string[]
  filePath?: string
  contentHash: string
}

export interface KnowledgeDocument {
  id: string
  subject: Subject | 'common'
  kind: 'knowledge' | 'pattern' | 'method'
  title: string
  summary: string
  content: string
  tags: string[]
  filePath?: string
}

export interface VaultInfo {
  id: string
  name: string
  path: string
  connectedAt: string
  lastIndexedAt: string
  questionCount: number
  documentCount: number
  warnings: string[]
  isBuiltin: boolean
}

export interface VaultIndexResult {
  vault: VaultInfo
  added: number
  updated: number
  removed: number
  skipped: number
  warnings: string[]
}

export interface VaultSnapshotInfo {
  id: string
  vaultId: string
  createdAt: string
  questionCount: number
  documentCount: number
  size: number
}

export type KnowledgeBuildMode = 'auto' | 'questions' | 'documents' | 'convert-only'
export type KnowledgeBuildQuality = 'standard' | 'high'

export interface KnowledgeSourceFile {
  id: string
  relativePath: string
  extension: string
  size: number
  modifiedAt: string
  eligible: boolean
  reason?: string
}

export interface KnowledgeSourceScan {
  sourcePath: string
  scannedAt: string
  files: KnowledgeSourceFile[]
  eligibleCount: number
  eligibleSize: number
  skippedCount: number
  warnings: string[]
}

export interface KnowledgeEngineStatus {
  available: boolean
  installing: boolean
  version?: string
  pythonPath?: string
  message: string
  supportedExtensions: string[]
}

export interface KnowledgeBuildOptions {
  mode: KnowledgeBuildMode
  quality: KnowledgeBuildQuality
  subject: Subject | 'common' | 'auto'
  tags: string[]
  instruction: string
  rightsConfirmed: boolean
}

export type KnowledgeBuildFileState =
  | 'queued'
  | 'converting'
  | 'converted'
  | 'organizing'
  | 'ready'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export interface KnowledgeBuildFile {
  sourceId: string
  relativePath: string
  size: number
  state: KnowledgeBuildFileState
  message?: string
  artifactCount: number
  chunkCount: number
}

export type KnowledgeArtifactStatus = 'pending' | 'approved' | 'rejected' | 'published'

export interface KnowledgeArtifactSummary {
  id: string
  sourceId: string
  sourcePath: string
  kind: 'question' | 'document'
  subject: Subject | 'common'
  title: string
  category: string
  confidence: number
  status: KnowledgeArtifactStatus
  warnings: string[]
  preview: string
}

export interface KnowledgeArtifactDetail extends KnowledgeArtifactSummary {
  markdown: string
  evidenceExcerpt: string
}

export interface KnowledgeBuildJob {
  id: string
  sourcePath: string
  createdAt: string
  updatedAt: string
  status: 'queued' | 'running' | 'review' | 'completed' | 'cancelling' | 'cancelled' | 'failed'
  options: KnowledgeBuildOptions
  files: KnowledgeBuildFile[]
  artifacts: KnowledgeArtifactSummary[]
  processedFiles: number
  totalFiles: number
  approvedArtifacts: number
  pendingArtifacts: number
  failedFiles: number
  currentFile?: string
  message?: string
  outputPath: string
}

export interface QuestionFilter {
  subject?: Subject
  category?: string
  type?: QuestionType
  difficulty?: Difficulty
  year?: number
  region?: string
  paper?: string
  query?: string
  onlyWrong?: boolean
  onlyFavorite?: boolean
  limit?: number
}

export interface QuestionFacets {
  years: number[]
  regions: string[]
  papers: string[]
}

export interface PracticeSelection {
  mode: 'random' | 'sequence' | 'adaptive' | 'review'
  filter?: QuestionFilter
  count: number
  feedbackMode?: 'immediate' | 'summary'
}

export interface PracticeSession {
  id: string
  mode: PracticeSelection['mode']
  feedbackMode: 'immediate' | 'summary'
  createdAt: string
  updatedAt: string
  questionIds: string[]
  questionSnapshots: Record<string, Question>
  currentIndex: number
  uncertainIds: string[]
  status: 'active' | 'completed' | 'abandoned'
}

export interface AttemptInput {
  questionId: string
  answer: string[]
  durationSeconds: number
  mode: 'practice' | 'review' | 'exam' | 'ai'
  sessionId?: string
  wrongCause?: string
  reviewFeedback?: 'forgot' | 'hard' | 'normal' | 'easy'
}

export interface AttemptResult {
  attemptId: string
  correct: boolean
  expected: string[]
  explanation: string
  nextReviewAt?: string
  mastered: boolean
}

export interface ReviewItem {
  question: Question
  dueAt: string
  wrongCount: number
  correctStreak: number
  lastWrongCause?: string
}

export interface ExamConfig {
  title: string
  subject: Subject
  durationMinutes: number
  questionCount: number
  filter?: QuestionFilter
}

export interface ExamAnswer {
  questionId: string
  answer: string[]
  durationSeconds: number
}

export interface ExamSession {
  id: string
  title: string
  subject: Subject
  startedAt: string
  updatedAt: string
  finishedAt?: string
  durationMinutes: number
  questionIds: string[]
  questionSnapshots: Record<string, Question>
  answers: Record<string, ExamAnswer>
  status: 'active' | 'finished' | 'abandoned'
  score?: number
  correctCount?: number
}

export interface ConstructedDraft {
  id: string
  promptId: string
  title: string
  content: string
  updatedAt: string
}

export interface ConstructedEvaluation {
  id: string
  promptId: string
  score: number
  dimensions: Array<{ name: string; score: number; comment: string }>
  summary: string
  suggestions: string[]
  createdAt: string
  provider: string
}

export type PlanItemType = 'read_knowledge' | 'official_practice' | 'official_review' | 'ai_variant'

export interface LearningPlanItem {
  id: string
  day: number
  type: PlanItemType
  title: string
  target: number
  completed: number
  done: boolean
}

export interface LearningPlan {
  id: string
  title: string
  createdAt: string
  startDate: string
  durationDays: number
  dailyMinutes: number
  status: 'preview' | 'active' | 'completed' | 'cancelled'
  focus: string[]
  items: LearningPlanItem[]
}

export interface DiagnosisResult {
  generatedAt: string
  totalAttempts: number
  accuracy: number
  averageDurationSeconds: number
  strengths: Array<{ category: string; accuracy: number; attempts: number }>
  weaknesses: Array<{ category: string; accuracy: number; attempts: number }>
  recommendations: string[]
}

export interface DashboardData {
  todayAttempts: number
  todayMinutes: number
  dailyTarget: number
  accuracy: number
  dueReviews: number
  wrongQuestions: number
  masteredQuestions: number
  totalQuestions: number
  studyStreak: number
  subjectMastery: Array<{ subject: Subject; accuracy: number; attempts: number }>
  activeExam?: ExamSession
  activePlan?: LearningPlan
  recentAttempts: Array<{
    id: string
    questionId: string
    questionTitle: string
    correct: boolean
    createdAt: string
  }>
  activity: Array<{ date: string; attempts: number; accuracy: number }>
}

export interface ReportData {
  range: '7d' | '30d' | 'all'
  totalAttempts: number
  correctAttempts: number
  accuracy: number
  studyMinutes: number
  categoryStats: Array<{
    category: string
    attempts: number
    correct: number
    accuracy: number
    averageDurationSeconds: number
  }>
  dailyStats: Array<{ date: string; attempts: number; accuracy: number; minutes: number }>
  wrongCauses: Array<{ cause: string; count: number }>
}

export type AiProvider =
  | 'deepseek'
  | 'moonshot'
  | 'minimax'
  | 'qwen'
  | 'zhipu'
  | 'doubao'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'openai-compatible'

export type AiProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generate-content'
  | 'ollama-openai'

export interface AiProviderInfo {
  id: AiProvider
  name: string
  protocol: AiProtocol
  defaultBaseUrl: string
  defaultModel: string
  local: boolean
  apiKeyRequired: boolean
}

export interface AiConfigInput {
  provider: AiProvider
  protocol: AiProtocol
  baseUrl: string
  model: string
  apiKey?: string
  temperature: number
  maxTokens: number
}

export interface AiConfigView extends Omit<AiConfigInput, 'apiKey'> {
  hasApiKey: boolean
  verified: boolean
  lastCheckedAt?: string
  lastError?: string
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiAskInput {
  messages: AiMessage[]
  purpose: 'chat' | 'explain' | 'evaluate' | 'variant' | 'plan' | 'knowledge'
}

export interface AiAskResult {
  content: string
  provider: string
  model: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export interface AiTrainingRecord {
  id: string
  sourceQuestionId: string
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  userAnswer: string[]
  correct: boolean
  createdAt: string
}

export interface IntegrationConfig {
  obsidianVaultPath: string
  obsidianExecutable: string
}

export interface ObsidianBackupInfo {
  id: string
  createdAt: string
  vaultPath: string
  size: number
  reason: 'manual' | 'pre-restore' | 'safe-mode'
}

export interface RuntimeStatus {
  appVersion: string
  platform: string
  databasePath: string
  dataDirectory: string
  vault: VaultInfo
  obsidian: { detected: boolean; executable?: string; vaultReady: boolean }
  ai: AiConfigView
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  dailyTarget: number
  defaultPracticeCount: number
  defaultExamMinutes: number
  reduceMotion: boolean
  autoBackup: boolean
  backupRetention: number
}

export interface BootstrapData {
  dashboard: DashboardData
  settings: AppSettings
  vault: VaultInfo
  ai: AiConfigView
}

export interface BackupInfo {
  id: string
  path: string
  createdAt: string
  size: number
  reason: 'manual' | 'automatic' | 'pre-restore'
}

export interface DiagnosticCheck {
  id: string
  label: string
  status: 'ok' | 'warning' | 'error'
  detail: string
  action?: string
}

export interface AppDiagnostic {
  generatedAt: string
  checks: DiagnosticCheck[]
}

export type WorkbenchRequest =
  | { method: 'bootstrap'; params?: undefined }
  | { method: 'dashboard.get'; params?: undefined }
  | { method: 'vault.choose'; params?: undefined }
  | { method: 'vault.connect'; params: { path: string } }
  | { method: 'vault.reindex'; params?: undefined }
  | { method: 'vault.list'; params?: undefined }
  | { method: 'vault.switch'; params: { id: string } }
  | { method: 'vault.snapshots'; params: { vaultId: string } }
  | { method: 'vault.rollback'; params: { snapshotId: string } }
  | { method: 'vault.search'; params: QuestionFilter }
  | { method: 'vault.categories'; params?: { subject?: Subject } }
  | { method: 'vault.facets'; params?: { subject?: Subject } }
  | { method: 'vault.asset'; params: { sourceFilePath: string; assetPath: string } }
  | { method: 'knowledgeBuilder.source.choose'; params?: undefined }
  | { method: 'knowledgeBuilder.source.scan'; params: { path: string } }
  | { method: 'knowledgeBuilder.engine.status'; params?: undefined }
  | { method: 'knowledgeBuilder.engine.install'; params?: undefined }
  | {
      method: 'knowledgeBuilder.job.start'
      params: { sourcePath: string; fileIds: string[]; options: KnowledgeBuildOptions }
    }
  | { method: 'knowledgeBuilder.job.latest'; params?: undefined }
  | { method: 'knowledgeBuilder.job.get'; params: { id: string } }
  | { method: 'knowledgeBuilder.job.cancel'; params: { id: string } }
  | { method: 'knowledgeBuilder.job.retry'; params: { id: string; sourceIds?: string[] } }
  | { method: 'knowledgeBuilder.artifact.get'; params: { jobId: string; artifactId: string } }
  | {
      method: 'knowledgeBuilder.artifact.review'
      params: { jobId: string; artifactId: string; status: 'approved' | 'rejected' }
    }
  | { method: 'knowledgeBuilder.publish'; params: { jobId: string } }
  | {
      method: 'documents.list'
      params: { subject?: Subject | 'common'; kind?: KnowledgeDocument['kind']; query?: string }
    }
  | { method: 'questions.get'; params: { id: string } }
  | { method: 'practice.select'; params: PracticeSelection }
  | { method: 'practice.session.start'; params: PracticeSelection }
  | { method: 'practice.session.active'; params: { mode: 'practice' | 'review' } }
  | {
      method: 'practice.session.update'
      params: { id: string; currentIndex?: number; uncertainIds?: string[] }
    }
  | { method: 'practice.session.complete'; params: { id: string; abandoned?: boolean } }
  | { method: 'questions.similar'; params: { id: string; limit?: number } }
  | { method: 'attempt.submit'; params: AttemptInput }
  | { method: 'favorite.set'; params: { questionId: string; favorite: boolean } }
  | { method: 'note.save'; params: { questionId: string; content: string } }
  | { method: 'note.get'; params: { questionId: string } }
  | { method: 'review.due'; params?: { limit?: number } }
  | { method: 'exam.create'; params: ExamConfig }
  | { method: 'exam.active'; params?: undefined }
  | { method: 'exam.save'; params: { examId: string; answer: ExamAnswer } }
  | { method: 'exam.finish'; params: { examId: string } }
  | { method: 'exam.history'; params?: undefined }
  | { method: 'draft.save'; params: Omit<ConstructedDraft, 'updatedAt'> }
  | { method: 'draft.get'; params: { id: string } }
  | { method: 'constructed.evaluate'; params: { promptId: string; title: string; content: string } }
  | { method: 'reports.get'; params: { range: ReportData['range'] } }
  | { method: 'reports.export'; params: { range: ReportData['range'] } }
  | { method: 'diagnosis.get'; params?: undefined }
  | {
      method: 'plan.preview'
      params: { durationDays: number; dailyMinutes: number; focus: string[] }
    }
  | { method: 'plan.apply'; params: { plan: LearningPlan } }
  | { method: 'plan.active'; params?: undefined }
  | { method: 'plan.item.complete'; params: { planId: string; itemId: string; completed: number } }
  | { method: 'plan.cancel'; params: { planId: string } }
  | { method: 'ai.config.get'; params?: undefined }
  | { method: 'ai.config.save'; params: AiConfigInput }
  | { method: 'ai.config.clearCredential'; params?: undefined }
  | { method: 'ai.providers'; params?: undefined }
  | { method: 'ai.models.discover'; params?: undefined }
  | { method: 'ai.test'; params?: undefined }
  | { method: 'ai.ask'; params: AiAskInput }
  | { method: 'aiTraining.record'; params: Omit<AiTrainingRecord, 'id' | 'correct' | 'createdAt'> }
  | { method: 'aiTraining.history'; params?: undefined }
  | { method: 'settings.get'; params?: undefined }
  | { method: 'settings.save'; params: Partial<AppSettings> }
  | { method: 'runtime.status'; params?: undefined }
  | { method: 'integration.get'; params?: undefined }
  | { method: 'integration.save'; params: Partial<IntegrationConfig> }
  | { method: 'integration.openObsidian'; params?: undefined }
  | { method: 'obsidian.backups'; params?: undefined }
  | { method: 'obsidian.backup'; params?: undefined }
  | { method: 'obsidian.restore'; params: { id: string } }
  | { method: 'obsidian.safeMode'; params?: undefined }
  | { method: 'backup.create'; params?: undefined }
  | { method: 'backup.list'; params?: undefined }
  | { method: 'backup.restore'; params: { path: string } }
  | { method: 'diagnostics.run'; params?: undefined }
  | { method: 'diagnostics.export'; params?: undefined }
  | { method: 'user.resetLearningData'; params: { confirmation: string } }
  | { method: 'shell.openPath'; params: { path: string } }

export interface WorkbenchAPI {
  invoke<T = unknown>(request: WorkbenchRequest): Promise<T>
  platform: string
}
