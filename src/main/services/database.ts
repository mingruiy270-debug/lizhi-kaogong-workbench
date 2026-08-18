import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import type {
  AppSettings,
  AiTrainingRecord,
  AttemptInput,
  AttemptResult,
  BackupInfo,
  ConstructedDraft,
  DashboardData,
  ExamAnswer,
  ExamConfig,
  ExamSession,
  KnowledgeDocument,
  LearningPlan,
  PracticeSelection,
  PracticeSession,
  Question,
  QuestionFacets,
  ReportData,
  ReviewItem,
  VaultIndexResult,
  VaultSnapshotInfo,
  VaultInfo
} from '../../shared/contracts'
import {
  DEFAULT_SETTINGS,
  REVIEW_CORRECT_DELAY_DAYS,
  REVIEW_MASTERED_STREAK,
  REVIEW_WRONG_DELAY_DAYS
} from '../../shared/defaults'

type SqlValue = string | number | bigint | Uint8Array | null
export type Row = Record<string, SqlValue>

function now(): string {
  return new Date().toISOString()
}

function dateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
}

export class DatabaseService {
  private db: DatabaseSync

  constructor(
    readonly databasePath: string,
    readonly dataDirectory: string,
    readonly backupDirectory: string
  ) {
    mkdirSync(dataDirectory, { recursive: true })
    mkdirSync(backupDirectory, { recursive: true })
    this.db = this.open()
    this.migrate()
  }

  private open(): DatabaseSync {
    const database = new DatabaseSync(this.databasePath)
    database.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'
    )
    return database
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vault_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        connected_at TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL,
        question_count INTEGER NOT NULL DEFAULT 0,
        document_count INTEGER NOT NULL DEFAULT 0,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS vault_snapshots (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        question_count INTEGER NOT NULL,
        document_count INTEGER NOT NULL,
        payload BLOB NOT NULL,
        FOREIGN KEY(vault_id) REFERENCES vault_registry(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_vault_snapshots_time ON vault_snapshots(vault_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        stem TEXT NOT NULL,
        options_json TEXT NOT NULL,
        answer_json TEXT NOT NULL,
        explanation TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        source TEXT NOT NULL,
        year INTEGER,
        region TEXT,
        paper TEXT,
        material TEXT,
        content_version TEXT,
        tags_json TEXT NOT NULL,
        file_path TEXT,
        content_hash TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        FOREIGN KEY(vault_id) REFERENCES vault_registry(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_questions_subject_category ON questions(subject, category);
      CREATE INDEX IF NOT EXISTS idx_questions_vault ON questions(vault_id);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        file_path TEXT,
        indexed_at TEXT NOT NULL,
        FOREIGN KEY(vault_id) REFERENCES vault_registry(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_documents_kind_subject ON documents(kind, subject);
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        answer_json TEXT NOT NULL,
        correct INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        mode TEXT NOT NULL,
        session_id TEXT,
        wrong_cause TEXT,
        question_snapshot_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_question_time ON attempts(question_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts(created_at DESC);
      CREATE TABLE IF NOT EXISTS wrong_questions (
        question_id TEXT PRIMARY KEY,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        correct_streak INTEGER NOT NULL DEFAULT 0,
        mastered INTEGER NOT NULL DEFAULT 0,
        last_wrong_cause TEXT,
        first_wrong_at TEXT NOT NULL,
        last_attempt_at TEXT NOT NULL,
        FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS review_tasks (
        question_id TEXT PRIMARY KEY,
        due_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_review_due ON review_tasks(due_at, completed_at);
      CREATE TABLE IF NOT EXISTS favorites (
        question_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_notes (
        question_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS learning_sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS exam_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        duration_minutes INTEGER NOT NULL,
        question_ids_json TEXT NOT NULL,
        question_snapshots_json TEXT NOT NULL DEFAULT '{}',
        answers_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        score REAL,
        correct_count INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_exams_status_time ON exam_sessions(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS constructed_drafts (
        id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS constructed_attempts (
        id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        evaluation_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learning_plans (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_completions (
        plan_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        completed INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY(plan_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS ai_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        payload_json TEXT NOT NULL,
        encrypted_key TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        last_checked_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_training_attempts (
        id TEXT PRIMARY KEY,
        source_question_id TEXT NOT NULL,
        variant_json TEXT NOT NULL,
        user_answer_json TEXT NOT NULL,
        correct INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    const examColumns = this.db.prepare('PRAGMA table_info(exam_sessions)').all() as Row[]
    if (!examColumns.some((column) => String(column.name) === 'question_snapshots_json')) {
      this.db.exec(
        "ALTER TABLE exam_sessions ADD COLUMN question_snapshots_json TEXT NOT NULL DEFAULT '{}'"
      )
    }
    const questionColumns = this.db.prepare('PRAGMA table_info(questions)').all() as Row[]
    for (const [name, type] of [
      ['region', 'TEXT'],
      ['paper', 'TEXT'],
      ['material', 'TEXT'],
      ['content_version', 'TEXT']
    ]) {
      if (!questionColumns.some((column) => String(column.name) === name))
        this.db.exec(`ALTER TABLE questions ADD COLUMN ${name} ${type}`)
    }
    this.db
      .prepare('INSERT OR IGNORE INTO app_meta(key, value) VALUES (?, ?)')
      .run('schema_version', '1')
  }

  close(): void {
    this.db.close()
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      Row | undefined
    return row ? parseJson(row.value, fallback) : fallback
  }

  setSetting<T>(key: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), now())
  }

  getAppSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.getSetting<Partial<AppSettings>>('app_settings', {}) }
  }

  saveAppSettings(patch: Partial<AppSettings>): AppSettings {
    const settings = { ...this.getAppSettings(), ...patch }
    settings.dailyTarget = Math.max(1, Math.min(500, Math.round(settings.dailyTarget)))
    settings.defaultPracticeCount = Math.max(
      1,
      Math.min(100, Math.round(settings.defaultPracticeCount))
    )
    settings.defaultExamMinutes = Math.max(
      10,
      Math.min(300, Math.round(settings.defaultExamMinutes))
    )
    settings.backupRetention = Math.max(1, Math.min(100, Math.round(settings.backupRetention)))
    this.setSetting('app_settings', settings)
    return settings
  }

  upsertVault(vault: VaultInfo, active = true): void {
    if (active) this.db.prepare('UPDATE vault_registry SET active = 0').run()
    this.db
      .prepare(
        `INSERT INTO vault_registry(
          id, name, path, connected_at, last_indexed_at, question_count, document_count,
          warnings_json, is_builtin, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, path = excluded.path, last_indexed_at = excluded.last_indexed_at,
          question_count = excluded.question_count, document_count = excluded.document_count,
          warnings_json = excluded.warnings_json, active = excluded.active`
      )
      .run(
        vault.id,
        vault.name,
        vault.path,
        vault.connectedAt,
        vault.lastIndexedAt,
        vault.questionCount,
        vault.documentCount,
        JSON.stringify(vault.warnings),
        vault.isBuiltin ? 1 : 0,
        active ? 1 : 0
      )
  }

  getActiveVault(): VaultInfo | undefined {
    const row = this.db.prepare('SELECT * FROM vault_registry WHERE active = 1 LIMIT 1').get() as
      Row | undefined
    return row ? this.mapVault(row) : undefined
  }

  listVaults(): VaultInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM vault_registry ORDER BY active DESC, last_indexed_at DESC')
      .all() as Row[]
    return rows.map((row) => this.mapVault(row))
  }

  switchVault(id: string): VaultInfo {
    const row = this.db.prepare('SELECT * FROM vault_registry WHERE id=?').get(id) as
      Row | undefined
    if (!row) throw new Error('知识库不存在')
    this.transaction(() => {
      this.db.prepare('UPDATE vault_registry SET active=0').run()
      this.db.prepare('UPDATE vault_registry SET active=1 WHERE id=?').run(id)
    })
    return this.mapVault(row)
  }

  private mapVault(row: Row): VaultInfo {
    return {
      id: String(row.id),
      name: String(row.name),
      path: String(row.path),
      connectedAt: String(row.connected_at),
      lastIndexedAt: String(row.last_indexed_at),
      questionCount: numberValue(row.question_count),
      documentCount: numberValue(row.document_count),
      warnings: parseJson<string[]>(row.warnings_json, []),
      isBuiltin: Boolean(row.is_builtin)
    }
  }

  replaceVaultContent(
    vault: VaultInfo,
    questions: Question[],
    documents: KnowledgeDocument[],
    captureSnapshot = true
  ): { added: number; updated: number; removed: number } {
    const previousRows = this.db
      .prepare('SELECT id, content_hash FROM questions WHERE vault_id = ?')
      .all(vault.id) as Row[]
    const previous = new Map(previousRows.map((row) => [String(row.id), String(row.content_hash)]))
    let added = 0
    let updated = 0
    for (const question of questions) {
      if (!previous.has(question.id)) added += 1
      else if (previous.get(question.id) !== question.contentHash) updated += 1
    }
    const incomingIds = new Set(questions.map((question) => question.id))
    const removed = previousRows.filter((row) => !incomingIds.has(String(row.id))).length

    const previousDocuments = this.db
      .prepare('SELECT * FROM documents WHERE vault_id=? ORDER BY id')
      .all(vault.id) as Row[]
    this.transaction(() => {
      this.upsertVault(vault)
      if (
        captureSnapshot &&
        previousRows.length + previousDocuments.length > 0 &&
        added + updated + removed > 0
      ) {
        const snapshotId = randomUUID()
        const payload = gzipSync(
          JSON.stringify({
            vault: this.getVaultById(vault.id) ?? vault,
            questions: previousRows.map((row) => this.getQuestion(String(row.id))).filter(Boolean),
            documents: previousDocuments.map((row) => this.mapDocument(row))
          })
        )
        this.db
          .prepare(
            'INSERT INTO vault_snapshots(id,vault_id,created_at,question_count,document_count,payload) VALUES(?,?,?,?,?,?)'
          )
          .run(snapshotId, vault.id, now(), previousRows.length, previousDocuments.length, payload)
        this.db
          .prepare(
            `DELETE FROM vault_snapshots WHERE id IN (
            SELECT id FROM vault_snapshots WHERE vault_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 5
          )`
          )
          .run(vault.id)
      }
      this.db.prepare('DELETE FROM documents WHERE vault_id = ?').run(vault.id)
      const upsertQuestion = this.db.prepare(`INSERT INTO questions(
        id, vault_id, subject, category, type, stem, options_json, answer_json, explanation,
        difficulty, source, year, region, paper, material, content_version, tags_json, file_path,
        content_hash, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vault_id=excluded.vault_id, subject=excluded.subject, category=excluded.category,
        type=excluded.type, stem=excluded.stem, options_json=excluded.options_json,
        answer_json=excluded.answer_json, explanation=excluded.explanation,
        difficulty=excluded.difficulty, source=excluded.source, year=excluded.year,
        region=excluded.region, paper=excluded.paper, material=excluded.material,
        content_version=excluded.content_version,
        tags_json=excluded.tags_json, file_path=excluded.file_path,
        content_hash=excluded.content_hash, indexed_at=excluded.indexed_at`)
      for (const question of questions) {
        upsertQuestion.run(
          question.id,
          vault.id,
          question.subject,
          question.category,
          question.type,
          question.stem,
          JSON.stringify(question.options),
          JSON.stringify(question.answer),
          question.explanation,
          question.difficulty,
          question.source,
          question.year ?? null,
          question.region ?? null,
          question.paper ?? null,
          question.material ?? null,
          question.contentVersion ?? null,
          JSON.stringify(question.tags),
          question.filePath ?? null,
          question.contentHash,
          now()
        )
      }
      const removeQuestion = this.db.prepare('DELETE FROM questions WHERE id = ? AND vault_id = ?')
      for (const row of previousRows) {
        const id = String(row.id)
        if (!incomingIds.has(id)) removeQuestion.run(id, vault.id)
      }
      const insertDocument = this.db.prepare(`INSERT INTO documents(
        id, vault_id, subject, kind, title, summary, content, tags_json, file_path, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const document of documents) {
        insertDocument.run(
          document.id,
          vault.id,
          document.subject,
          document.kind,
          document.title,
          document.summary,
          document.content,
          JSON.stringify(document.tags),
          document.filePath ?? null,
          now()
        )
      }
    })
    return { added, updated, removed }
  }

  listQuestions(
    filter: {
      subject?: string
      category?: string
      type?: string
      difficulty?: number
      year?: number
      region?: string
      paper?: string
      query?: string
      onlyWrong?: boolean
      onlyFavorite?: boolean
      limit?: number
    } = {}
  ): Question[] {
    const where = ['v.active = 1']
    const values: SqlValue[] = []
    if (filter.subject) {
      where.push('q.subject = ?')
      values.push(filter.subject)
    }
    if (filter.category) {
      where.push('q.category = ?')
      values.push(filter.category)
    }
    if (filter.type) {
      where.push('q.type = ?')
      values.push(filter.type)
    }
    if (filter.difficulty) {
      where.push('q.difficulty = ?')
      values.push(filter.difficulty)
    }
    if (filter.year) {
      where.push('q.year = ?')
      values.push(filter.year)
    }
    if (filter.region?.trim()) {
      where.push('q.region = ?')
      values.push(filter.region.trim())
    }
    if (filter.paper?.trim()) {
      where.push('q.paper = ?')
      values.push(filter.paper.trim())
    }
    if (filter.query?.trim()) {
      where.push('(q.stem LIKE ? OR q.explanation LIKE ? OR q.tags_json LIKE ?)')
      const keyword = `%${filter.query.trim()}%`
      values.push(keyword, keyword, keyword)
    }
    if (filter.onlyWrong)
      where.push(
        'EXISTS (SELECT 1 FROM wrong_questions w WHERE w.question_id = q.id AND w.mastered = 0)'
      )
    if (filter.onlyFavorite)
      where.push('EXISTS (SELECT 1 FROM favorites f WHERE f.question_id = q.id)')
    const limit = Math.max(1, Math.min(5000, filter.limit ?? 500))
    const rows = this.db
      .prepare(
        `SELECT q.* FROM questions q JOIN vault_registry v ON v.id = q.vault_id
        WHERE ${where.join(' AND ')} ORDER BY q.year DESC, q.category, q.id LIMIT ?`
      )
      .all(...values, limit) as Row[]
    return rows.map((row) => this.mapQuestion(row))
  }

  getQuestion(id: string): Question | undefined {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as Row | undefined
    return row ? this.mapQuestion(row) : undefined
  }

  private mapQuestion(row: Row): Question {
    return {
      id: String(row.id),
      subject: String(row.subject) as Question['subject'],
      category: String(row.category),
      type: String(row.type) as Question['type'],
      stem: String(row.stem),
      options: parseJson(row.options_json, []),
      answer: parseJson(row.answer_json, []),
      explanation: String(row.explanation),
      difficulty: Math.max(1, Math.min(5, numberValue(row.difficulty))) as Question['difficulty'],
      source: String(row.source),
      year: row.year === null ? undefined : numberValue(row.year),
      region: row.region == null ? undefined : String(row.region),
      paper: row.paper == null ? undefined : String(row.paper),
      material: row.material == null ? undefined : String(row.material),
      contentVersion: row.content_version == null ? undefined : String(row.content_version),
      tags: parseJson(row.tags_json, []),
      filePath: row.file_path === null ? undefined : String(row.file_path),
      contentHash: String(row.content_hash)
    }
  }

  listDocuments(filter: { subject?: string; kind?: string; query?: string }): KnowledgeDocument[] {
    const where = ['v.active = 1']
    const values: SqlValue[] = []
    if (filter.subject) {
      where.push('d.subject = ?')
      values.push(filter.subject)
    }
    if (filter.kind) {
      where.push('d.kind = ?')
      values.push(filter.kind)
    }
    if (filter.query?.trim()) {
      where.push('(d.title LIKE ? OR d.summary LIKE ? OR d.content LIKE ?)')
      const keyword = `%${filter.query.trim()}%`
      values.push(keyword, keyword, keyword)
    }
    const rows = this.db
      .prepare(
        `SELECT d.* FROM documents d JOIN vault_registry v ON v.id = d.vault_id
        WHERE ${where.join(' AND ')} ORDER BY d.kind, d.title`
      )
      .all(...values) as Row[]
    return rows.map((row) => this.mapDocument(row))
  }

  private mapDocument(row: Row): KnowledgeDocument {
    return {
      id: String(row.id),
      subject: String(row.subject) as KnowledgeDocument['subject'],
      kind: String(row.kind) as KnowledgeDocument['kind'],
      title: String(row.title),
      summary: String(row.summary),
      content: String(row.content),
      tags: parseJson(row.tags_json, []),
      filePath: row.file_path === null ? undefined : String(row.file_path)
    }
  }

  private getVaultById(id: string): VaultInfo | undefined {
    const row = this.db.prepare('SELECT * FROM vault_registry WHERE id=?').get(id) as
      Row | undefined
    return row ? this.mapVault(row) : undefined
  }

  listVaultSnapshots(vaultId: string): VaultSnapshotInfo[] {
    const rows = this.db
      .prepare(
        'SELECT id,vault_id,created_at,question_count,document_count,length(payload) AS size FROM vault_snapshots WHERE vault_id=? ORDER BY created_at DESC'
      )
      .all(vaultId) as Row[]
    return rows.map((row) => ({
      id: String(row.id),
      vaultId: String(row.vault_id),
      createdAt: String(row.created_at),
      questionCount: numberValue(row.question_count),
      documentCount: numberValue(row.document_count),
      size: numberValue(row.size)
    }))
  }

  rollbackVaultSnapshot(snapshotId: string): VaultIndexResult {
    const row = this.db.prepare('SELECT * FROM vault_snapshots WHERE id=?').get(snapshotId) as
      Row | undefined
    if (!row || !(row.payload instanceof Uint8Array)) throw new Error('索引快照不存在或已经清理')
    const decoded = JSON.parse(gunzipSync(row.payload).toString('utf8')) as {
      vault: VaultInfo
      questions: Question[]
      documents: KnowledgeDocument[]
    }
    const vault: VaultInfo = {
      ...decoded.vault,
      lastIndexedAt: now(),
      questionCount: decoded.questions.length,
      documentCount: decoded.documents.length,
      warnings: ['当前使用历史索引快照。重新索引会再次读取源目录。']
    }
    const changes = this.replaceVaultContent(vault, decoded.questions, decoded.documents, true)
    return { vault, ...changes, skipped: 0, warnings: vault.warnings }
  }

  listCategories(subject?: string): Array<{ name: string; count: number }> {
    const rows = subject
      ? (this.db
          .prepare(
            `SELECT q.category, COUNT(*) AS count FROM questions q JOIN vault_registry v ON v.id=q.vault_id
          WHERE v.active=1 AND q.subject=? GROUP BY q.category ORDER BY count DESC`
          )
          .all(subject) as Row[])
      : (this.db
          .prepare(
            `SELECT q.category, COUNT(*) AS count FROM questions q JOIN vault_registry v ON v.id=q.vault_id
          WHERE v.active=1 GROUP BY q.category ORDER BY count DESC`
          )
          .all() as Row[])
    return rows.map((row) => ({ name: String(row.category), count: numberValue(row.count) }))
  }

  getQuestionFacets(subject?: string): QuestionFacets {
    const subjectClause = subject ? 'AND q.subject=?' : ''
    const parameters = subject ? [subject] : []
    const read = (column: 'year' | 'region' | 'paper'): Array<string | number> =>
      (
        this.db
          .prepare(
            `SELECT DISTINCT q.${column} AS value FROM questions q
             JOIN vault_registry v ON v.id=q.vault_id
             WHERE v.active=1 AND q.${column} IS NOT NULL AND q.${column} != '' ${subjectClause}
             ORDER BY q.${column} DESC`
          )
          .all(...parameters) as Row[]
      ).map((row) => (column === 'year' ? numberValue(row.value) : String(row.value)))
    return {
      years: read('year') as number[],
      regions: read('region') as string[],
      papers: read('paper') as string[]
    }
  }

  findSimilarQuestions(questionId: string, limit = 5): Question[] {
    const source = this.getQuestion(questionId)
    if (!source) return []
    const candidates = this.listQuestions({ subject: source.subject, limit: 2000 }).filter(
      (question) => question.id !== source.id
    )
    const sourceTags = new Set(source.tags)
    return candidates
      .map((question) => ({
        question,
        score:
          (question.category === source.category ? 10 : 0) +
          question.tags.filter((tag) => sourceTags.has(tag)).length * 3 -
          Math.abs(question.difficulty - source.difficulty)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.question.id.localeCompare(b.question.id))
      .slice(0, Math.max(1, Math.min(20, limit)))
      .map((item) => item.question)
  }

  getRecentAttemptQuestionIds(limit = 100): string[] {
    const rows = this.db
      .prepare('SELECT question_id FROM attempts ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(1000, limit))) as Row[]
    return [...new Set(rows.map((row) => String(row.question_id)))]
  }

  getAttemptedQuestionIds(): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT question_id FROM attempts').all() as Row[]
    return new Set(rows.map((row) => String(row.question_id)))
  }

  createPracticeSession(selection: PracticeSelection, questions: Question[]): PracticeSession {
    if (!questions.length) throw new Error('当前筛选条件下没有可用题目')
    const sessionKind = selection.mode === 'review' ? 'review' : 'practice'
    const timestamp = now()
    const session: PracticeSession = {
      id: randomUUID(),
      mode: selection.mode,
      feedbackMode: selection.feedbackMode ?? 'immediate',
      createdAt: timestamp,
      updatedAt: timestamp,
      questionIds: questions.map((question) => question.id),
      questionSnapshots: Object.fromEntries(questions.map((question) => [question.id, question])),
      currentIndex: 0,
      uncertainIds: [],
      status: 'active'
    }
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE learning_sessions SET ended_at=?, metadata_json=json_set(metadata_json,'$.status','abandoned') WHERE kind=? AND ended_at IS NULL"
        )
        .run(timestamp, sessionKind)
      this.db
        .prepare(
          'INSERT INTO learning_sessions(id,kind,started_at,ended_at,duration_seconds,metadata_json) VALUES(?,?,?,NULL,0,?)'
        )
        .run(session.id, sessionKind, timestamp, JSON.stringify(session))
    })
    return session
  }

  getActivePracticeSession(mode: 'practice' | 'review'): PracticeSession | undefined {
    const row = this.db
      .prepare(
        'SELECT metadata_json FROM learning_sessions WHERE kind=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
      )
      .get(mode) as Row | undefined
    return row ? parseJson<PracticeSession | undefined>(row.metadata_json, undefined) : undefined
  }

  updatePracticeSession(
    id: string,
    patch: { currentIndex?: number; uncertainIds?: string[] }
  ): PracticeSession {
    const row = this.db
      .prepare('SELECT metadata_json FROM learning_sessions WHERE id=? AND ended_at IS NULL')
      .get(id) as Row | undefined
    if (!row) throw new Error('训练会话不存在或已经结束')
    const session = parseJson<PracticeSession | undefined>(row.metadata_json, undefined)
    if (!session) throw new Error('训练会话数据损坏')
    if (patch.currentIndex !== undefined) {
      session.currentIndex = Math.max(
        0,
        Math.min(session.questionIds.length - 1, Math.round(patch.currentIndex))
      )
    }
    if (patch.uncertainIds !== undefined) {
      session.uncertainIds = [
        ...new Set(patch.uncertainIds.filter((idValue) => session.questionIds.includes(idValue)))
      ]
    }
    session.updatedAt = now()
    this.db
      .prepare('UPDATE learning_sessions SET metadata_json=? WHERE id=?')
      .run(JSON.stringify(session), id)
    return session
  }

  completePracticeSession(id: string, abandoned = false): PracticeSession {
    const row = this.db
      .prepare('SELECT metadata_json,started_at FROM learning_sessions WHERE id=?')
      .get(id) as Row | undefined
    if (!row) throw new Error('训练会话不存在')
    const session = parseJson<PracticeSession | undefined>(row.metadata_json, undefined)
    if (!session) throw new Error('训练会话数据损坏')
    session.status = abandoned ? 'abandoned' : 'completed'
    session.updatedAt = now()
    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - new Date(String(row.started_at)).getTime()) / 1000)
    )
    this.db
      .prepare(
        'UPDATE learning_sessions SET ended_at=?,duration_seconds=?,metadata_json=? WHERE id=?'
      )
      .run(session.updatedAt, durationSeconds, JSON.stringify(session), id)
    return session
  }

  submitAttempt(input: AttemptInput): AttemptResult {
    return this.transaction(() => this.recordAttempt(input))
  }

  private recordAttempt(input: AttemptInput, questionSnapshot?: Question): AttemptResult {
    const question = questionSnapshot ?? this.getQuestion(input.questionId)
    if (!question) throw new Error('题目不存在或知识库已切换')
    const normalize = (values: string[]) =>
      [...new Set(values.map((value) => value.trim().toUpperCase()))].sort()
    const correct =
      JSON.stringify(normalize(input.answer)) === JSON.stringify(normalize(question.answer))
    const attemptId = randomUUID()
    let nextReviewAt: string | undefined
    let mastered = false
    this.db
      .prepare(
        `INSERT INTO attempts(
          id, question_id, answer_json, correct, duration_seconds, mode, session_id,
          wrong_cause, question_snapshot_json, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attemptId,
        question.id,
        JSON.stringify(input.answer),
        correct ? 1 : 0,
        Math.max(0, Math.round(input.durationSeconds)),
        input.mode,
        input.sessionId ?? null,
        input.wrongCause?.trim() || null,
        JSON.stringify(question),
        question.contentHash,
        now()
      )
    const wrong = this.db
      .prepare('SELECT * FROM wrong_questions WHERE question_id = ?')
      .get(question.id) as Row | undefined
    if (!correct) {
      const firstWrongAt = wrong ? String(wrong.first_wrong_at) : now()
      this.db
        .prepare(
          `INSERT INTO wrong_questions(
            question_id, wrong_count, correct_streak, mastered, last_wrong_cause, first_wrong_at, last_attempt_at
          ) VALUES (?, ?, 0, 0, ?, ?, ?)
          ON CONFLICT(question_id) DO UPDATE SET
            wrong_count = wrong_questions.wrong_count + 1,
            correct_streak = 0,
            mastered = 0,
            last_wrong_cause = excluded.last_wrong_cause,
            last_attempt_at = excluded.last_attempt_at`
        )
        .run(
          question.id,
          wrong ? numberValue(wrong.wrong_count) + 1 : 1,
          input.wrongCause?.trim() || null,
          firstWrongAt,
          now()
        )
      nextReviewAt = addDays(REVIEW_WRONG_DELAY_DAYS)
    } else if (wrong) {
      const feedback = input.reviewFeedback ?? 'normal'
      const previousStreak = numberValue(wrong.correct_streak)
      const streak =
        feedback === 'forgot' ? 0 : feedback === 'hard' ? previousStreak : previousStreak + 1
      mastered = streak >= REVIEW_MASTERED_STREAK && (feedback === 'normal' || feedback === 'easy')
      this.db
        .prepare(
          'UPDATE wrong_questions SET correct_streak = ?, mastered = ?, last_attempt_at = ? WHERE question_id = ?'
        )
        .run(streak, mastered ? 1 : 0, now(), question.id)
      const delayDays =
        feedback === 'easy' ? 5 : feedback === 'normal' ? REVIEW_CORRECT_DELAY_DAYS : 1
      nextReviewAt = mastered ? undefined : addDays(delayDays)
    }
    if (nextReviewAt) {
      this.db
        .prepare(
          `INSERT INTO review_tasks(question_id, due_at, completed_at) VALUES (?, ?, NULL)
            ON CONFLICT(question_id) DO UPDATE SET due_at = excluded.due_at, completed_at = NULL`
        )
        .run(question.id, nextReviewAt)
    } else if (mastered) {
      this.db
        .prepare('UPDATE review_tasks SET completed_at = ? WHERE question_id = ?')
        .run(now(), question.id)
    }
    return {
      attemptId,
      correct,
      expected: question.answer,
      explanation: question.explanation,
      nextReviewAt,
      mastered
    }
  }

  setFavorite(questionId: string, favorite: boolean): void {
    if (favorite)
      this.db
        .prepare('INSERT OR IGNORE INTO favorites(question_id, created_at) VALUES (?, ?)')
        .run(questionId, now())
    else this.db.prepare('DELETE FROM favorites WHERE question_id = ?').run(questionId)
  }

  saveNote(questionId: string, content: string): void {
    if (Buffer.byteLength(content, 'utf8') > 200 * 1024) throw new Error('单题笔记不能超过 200 KB')
    this.db
      .prepare(
        `INSERT INTO user_notes(question_id, content, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(question_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      )
      .run(questionId, content, now())
  }

  getNote(questionId: string): string {
    const row = this.db
      .prepare('SELECT content FROM user_notes WHERE question_id = ?')
      .get(questionId) as Row | undefined
    return row ? String(row.content) : ''
  }

  getDueReviews(limit = 100): ReviewItem[] {
    const rows = this.db
      .prepare(
        `SELECT q.*, r.due_at, w.wrong_count, w.correct_streak, w.last_wrong_cause
        FROM review_tasks r
        JOIN questions q ON q.id = r.question_id
        JOIN vault_registry v ON v.id = q.vault_id AND v.active = 1
        JOIN wrong_questions w ON w.question_id = q.id
        WHERE r.completed_at IS NULL AND r.due_at <= ? AND w.mastered = 0
        ORDER BY r.due_at LIMIT ?`
      )
      .all(now(), Math.max(1, Math.min(500, limit))) as Row[]
    return rows.map((row) => ({
      question: this.mapQuestion(row),
      dueAt: String(row.due_at),
      wrongCount: numberValue(row.wrong_count),
      correctStreak: numberValue(row.correct_streak),
      lastWrongCause: row.last_wrong_cause === null ? undefined : String(row.last_wrong_cause)
    }))
  }

  createExam(config: ExamConfig, questions: Question[]): ExamSession {
    if (questions.length === 0) throw new Error('当前筛选条件下没有可用题目')
    const timestamp = now()
    const exam: ExamSession = {
      id: randomUUID(),
      title: config.title.trim() || '自定义模考',
      subject: config.subject,
      startedAt: timestamp,
      updatedAt: timestamp,
      durationMinutes: Math.max(10, Math.min(300, Math.round(config.durationMinutes))),
      questionIds: questions.map((question) => question.id),
      questionSnapshots: Object.fromEntries(questions.map((question) => [question.id, question])),
      answers: {},
      status: 'active'
    }
    this.db
      .prepare(
        `INSERT INTO exam_sessions(
        id, title, subject, started_at, updated_at, duration_minutes,
        question_ids_json, question_snapshots_json, answers_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'active')`
      )
      .run(
        exam.id,
        exam.title,
        exam.subject,
        exam.startedAt,
        exam.updatedAt,
        exam.durationMinutes,
        JSON.stringify(exam.questionIds),
        JSON.stringify(exam.questionSnapshots)
      )
    return exam
  }

  getActiveExam(): ExamSession | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM exam_sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1"
      )
      .get() as Row | undefined
    return row ? this.mapExam(row) : undefined
  }

  saveExamAnswer(examId: string, answer: ExamAnswer): ExamSession {
    const exam = this.getExam(examId)
    if (!exam || exam.status !== 'active') throw new Error('模考已结束或不存在')
    if (!exam.questionIds.includes(answer.questionId)) throw new Error('该题不属于当前模考')
    exam.answers[answer.questionId] = answer
    exam.updatedAt = now()
    this.db
      .prepare('UPDATE exam_sessions SET answers_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(exam.answers), exam.updatedAt, examId)
    return exam
  }

  finishExam(examId: string): ExamSession {
    const exam = this.getExam(examId)
    if (!exam) throw new Error('模考不存在')
    if (exam.status === 'finished') return exam
    this.transaction(() => {
      let correctCount = 0
      for (const questionId of exam.questionIds) {
        const answer = exam.answers[questionId] ?? { questionId, answer: [], durationSeconds: 0 }
        const snapshot = exam.questionSnapshots[questionId]
        if (!snapshot) throw new Error(`模考快照缺少题目 ${questionId}`)
        const result = this.recordAttempt({ ...answer, mode: 'exam', sessionId: exam.id }, snapshot)
        if (result.correct) correctCount += 1
      }
      const finishedAt = now()
      const score = Math.round((correctCount / exam.questionIds.length) * 1000) / 10
      this.db
        .prepare(
          "UPDATE exam_sessions SET status = 'finished', finished_at = ?, updated_at = ?, score = ?, correct_count = ? WHERE id = ?"
        )
        .run(finishedAt, finishedAt, score, correctCount, examId)
    })
    return this.getExam(examId)!
  }

  private getExam(id: string): ExamSession | undefined {
    const row = this.db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(id) as
      Row | undefined
    return row ? this.mapExam(row) : undefined
  }

  listExams(): ExamSession[] {
    return (
      this.db
        .prepare('SELECT * FROM exam_sessions ORDER BY updated_at DESC LIMIT 100')
        .all() as Row[]
    ).map((row) => this.mapExam(row))
  }

  private mapExam(row: Row): ExamSession {
    return {
      id: String(row.id),
      title: String(row.title),
      subject: String(row.subject) as ExamSession['subject'],
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
      finishedAt: row.finished_at === null ? undefined : String(row.finished_at),
      durationMinutes: numberValue(row.duration_minutes),
      questionIds: parseJson(row.question_ids_json, []),
      questionSnapshots: parseJson(row.question_snapshots_json, {}),
      answers: parseJson(row.answers_json, {}),
      status: String(row.status) as ExamSession['status'],
      score: row.score === null ? undefined : numberValue(row.score),
      correctCount: row.correct_count === null ? undefined : numberValue(row.correct_count)
    }
  }

  saveDraft(draft: Omit<ConstructedDraft, 'updatedAt'>): ConstructedDraft {
    const saved: ConstructedDraft = { ...draft, updatedAt: now() }
    this.db
      .prepare(
        `INSERT INTO constructed_drafts(id, prompt_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, updated_at=excluded.updated_at`
      )
      .run(saved.id, saved.promptId, saved.title, saved.content, saved.updatedAt)
    return saved
  }

  getDraft(id: string): ConstructedDraft | undefined {
    const row = this.db.prepare('SELECT * FROM constructed_drafts WHERE id = ?').get(id) as
      Row | undefined
    return row
      ? {
          id: String(row.id),
          promptId: String(row.prompt_id),
          title: String(row.title),
          content: String(row.content),
          updatedAt: String(row.updated_at)
        }
      : undefined
  }

  saveConstructedAttempt(payload: {
    id: string
    promptId: string
    title: string
    content: string
    evaluation: unknown
    createdAt: string
  }): void {
    this.db
      .prepare(
        'INSERT INTO constructed_attempts(id, prompt_id, title, content, evaluation_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        payload.id,
        payload.promptId,
        payload.title,
        payload.content,
        JSON.stringify(payload.evaluation),
        payload.createdAt
      )
  }

  getDashboard(): DashboardData {
    const settings = this.getAppSettings()
    const today = dateKey()
    const todayRow = this.db
      .prepare(
        `SELECT COUNT(*) AS attempts, COALESCE(SUM(duration_seconds), 0) AS seconds,
        COALESCE(SUM(correct), 0) AS correct FROM attempts WHERE substr(created_at, 1, 10) = ?`
      )
      .get(today) as Row
    const overall = this.db
      .prepare('SELECT COUNT(*) AS attempts, COALESCE(SUM(correct), 0) AS correct FROM attempts')
      .get() as Row
    const due = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM review_tasks r JOIN wrong_questions w ON w.question_id=r.question_id
        WHERE r.completed_at IS NULL AND r.due_at <= ? AND w.mastered=0`
      )
      .get(now()) as Row
    const wrong = this.db
      .prepare('SELECT COUNT(*) AS count FROM wrong_questions WHERE mastered=0')
      .get() as Row
    const mastered = this.db
      .prepare('SELECT COUNT(*) AS count FROM wrong_questions WHERE mastered=1')
      .get() as Row
    const total = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM questions q JOIN vault_registry v ON v.id=q.vault_id WHERE v.active=1'
      )
      .get() as Row
    const recentRows = this.db
      .prepare(
        `SELECT a.id, a.question_id, a.correct, a.created_at, q.stem
        FROM attempts a LEFT JOIN questions q ON q.id=a.question_id ORDER BY a.created_at DESC LIMIT 8`
      )
      .all() as Row[]
    const activityRows = this.db
      .prepare(
        `SELECT substr(created_at,1,10) AS date, COUNT(*) AS attempts,
        ROUND(100.0 * SUM(correct) / COUNT(*), 1) AS accuracy
        FROM attempts WHERE created_at >= ? GROUP BY substr(created_at,1,10) ORDER BY date`
      )
      .all(addDays(-13)) as Row[]
    const subjectRows = this.db
      .prepare(
        `SELECT q.subject, COUNT(*) AS attempts,
        ROUND(100.0 * SUM(a.correct) / COUNT(*), 1) AS accuracy
        FROM attempts a JOIN questions q ON q.id=a.question_id
        JOIN vault_registry v ON v.id=q.vault_id AND v.active=1
        GROUP BY q.subject ORDER BY attempts DESC`
      )
      .all() as Row[]
    const learningDates = new Set(
      (
        this.db
          .prepare(
            'SELECT DISTINCT substr(created_at,1,10) AS date FROM attempts ORDER BY date DESC'
          )
          .all() as Row[]
      ).map((row) => String(row.date))
    )
    let streak = 0
    const cursor = new Date()
    if (!learningDates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1)
    while (learningDates.has(dateKey(cursor))) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    const attempts = numberValue(overall.attempts)
    return {
      todayAttempts: numberValue(todayRow.attempts),
      todayMinutes: Math.round(numberValue(todayRow.seconds) / 60),
      dailyTarget: settings.dailyTarget,
      accuracy: attempts ? Math.round((numberValue(overall.correct) / attempts) * 1000) / 10 : 0,
      dueReviews: numberValue(due.count),
      wrongQuestions: numberValue(wrong.count),
      masteredQuestions: numberValue(mastered.count),
      totalQuestions: numberValue(total.count),
      studyStreak: streak,
      subjectMastery: subjectRows.map((row) => ({
        subject: String(row.subject) as 'xingce' | 'shenlun',
        attempts: numberValue(row.attempts),
        accuracy: numberValue(row.accuracy)
      })),
      activeExam: this.getActiveExam(),
      activePlan: this.getActivePlan(),
      recentAttempts: recentRows.map((row) => ({
        id: String(row.id),
        questionId: String(row.question_id),
        questionTitle: String(row.stem ?? '知识库中已无此题'),
        correct: Boolean(row.correct),
        createdAt: String(row.created_at)
      })),
      activity: activityRows.map((row) => ({
        date: String(row.date),
        attempts: numberValue(row.attempts),
        accuracy: numberValue(row.accuracy)
      }))
    }
  }

  getReport(range: ReportData['range']): ReportData {
    const cutoff =
      range === '7d' ? addDays(-7) : range === '30d' ? addDays(-30) : '1970-01-01T00:00:00.000Z'
    const overall = this.db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(correct),0) AS correct,
        COALESCE(SUM(duration_seconds),0) AS seconds FROM attempts WHERE created_at >= ?`
      )
      .get(cutoff) as Row
    const categoryRows = this.db
      .prepare(
        `SELECT json_extract(a.question_snapshot_json, '$.category') AS category,
        COUNT(*) AS attempts, SUM(a.correct) AS correct, AVG(a.duration_seconds) AS duration
        FROM attempts a WHERE a.created_at >= ? GROUP BY category ORDER BY attempts DESC`
      )
      .all(cutoff) as Row[]
    const dailyRows = this.db
      .prepare(
        `SELECT substr(created_at,1,10) AS date, COUNT(*) AS attempts, SUM(correct) AS correct,
        SUM(duration_seconds) AS seconds FROM attempts WHERE created_at >= ? GROUP BY date ORDER BY date`
      )
      .all(cutoff) as Row[]
    const causeRows = this.db
      .prepare(
        `SELECT COALESCE(NULLIF(trim(wrong_cause), ''), '未标注') AS cause, COUNT(*) AS count
        FROM attempts WHERE correct=0 AND created_at >= ? GROUP BY cause ORDER BY count DESC`
      )
      .all(cutoff) as Row[]
    const totalAttempts = numberValue(overall.total)
    const correctAttempts = numberValue(overall.correct)
    return {
      range,
      totalAttempts,
      correctAttempts,
      accuracy: totalAttempts ? Math.round((correctAttempts / totalAttempts) * 1000) / 10 : 0,
      studyMinutes: Math.round(numberValue(overall.seconds) / 60),
      categoryStats: categoryRows.map((row) => {
        const attempts = numberValue(row.attempts)
        const correct = numberValue(row.correct)
        return {
          category: String(row.category ?? '未分类'),
          attempts,
          correct,
          accuracy: attempts ? Math.round((correct / attempts) * 1000) / 10 : 0,
          averageDurationSeconds: Math.round(numberValue(row.duration))
        }
      }),
      dailyStats: dailyRows.map((row) => {
        const attempts = numberValue(row.attempts)
        return {
          date: String(row.date),
          attempts,
          accuracy: attempts ? Math.round((numberValue(row.correct) / attempts) * 1000) / 10 : 0,
          minutes: Math.round(numberValue(row.seconds) / 60)
        }
      }),
      wrongCauses: causeRows.map((row) => ({
        cause: String(row.cause),
        count: numberValue(row.count)
      }))
    }
  }

  savePlan(plan: LearningPlan): LearningPlan {
    const timestamp = now()
    this.transaction(() => {
      if (plan.status === 'active')
        this.db
          .prepare(
            "UPDATE learning_plans SET status='cancelled', updated_at=? WHERE status='active'"
          )
          .run(timestamp)
      this.db
        .prepare(
          `INSERT INTO learning_plans(id, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, status=excluded.status, updated_at=excluded.updated_at`
        )
        .run(plan.id, JSON.stringify(plan), plan.status, plan.createdAt, timestamp)
    })
    return plan
  }

  getActivePlan(): LearningPlan | undefined {
    const row = this.db
      .prepare(
        "SELECT payload_json FROM learning_plans WHERE status='active' ORDER BY updated_at DESC LIMIT 1"
      )
      .get() as Row | undefined
    if (!row) return undefined
    const plan = parseJson<LearningPlan | undefined>(row.payload_json, undefined)
    if (!plan) return undefined
    const completionRows = this.db
      .prepare('SELECT item_id, completed FROM plan_completions WHERE plan_id=?')
      .all(plan.id) as Row[]
    const completions = new Map(
      completionRows.map((item) => [String(item.item_id), numberValue(item.completed)])
    )
    plan.items = plan.items.map((item) => {
      const completed = completions.get(item.id) ?? item.completed
      return { ...item, completed, done: completed >= item.target }
    })
    return plan
  }

  completePlanItem(planId: string, itemId: string, completed: number): LearningPlan {
    const plan = this.getActivePlan()
    if (!plan || plan.id !== planId) throw new Error('当前学习计划不存在')
    const item = plan.items.find((candidate) => candidate.id === itemId)
    if (!item) throw new Error('计划项不存在')
    const safeCompleted = Math.max(0, Math.min(item.target, Math.round(completed)))
    this.db
      .prepare(
        `INSERT INTO plan_completions(plan_id,item_id,completed,completed_at) VALUES(?,?,?,?)
        ON CONFLICT(plan_id,item_id) DO UPDATE SET completed=excluded.completed, completed_at=excluded.completed_at`
      )
      .run(planId, itemId, safeCompleted, now())
    const updated = this.getActivePlan()!
    if (updated.items.every((candidate) => candidate.done)) {
      updated.status = 'completed'
      this.db
        .prepare(
          "UPDATE learning_plans SET status='completed', payload_json=?, updated_at=? WHERE id=?"
        )
        .run(JSON.stringify(updated), now(), planId)
    }
    return updated
  }

  cancelPlan(planId: string): void {
    this.db
      .prepare("UPDATE learning_plans SET status='cancelled', updated_at=? WHERE id=?")
      .run(now(), planId)
  }

  getAiRecord(): Row | undefined {
    return this.db.prepare('SELECT * FROM ai_config WHERE id=1').get() as Row | undefined
  }

  saveAiRecord(
    payloadJson: string,
    encryptedKey: string | null,
    verified: boolean,
    lastCheckedAt?: string,
    lastError?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO ai_config(id,payload_json,encrypted_key,verified,last_checked_at,last_error,updated_at)
        VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        payload_json=excluded.payload_json,
        encrypted_key=COALESCE(excluded.encrypted_key,ai_config.encrypted_key),
        verified=excluded.verified,last_checked_at=excluded.last_checked_at,last_error=excluded.last_error,updated_at=excluded.updated_at`
      )
      .run(
        payloadJson,
        encryptedKey,
        verified ? 1 : 0,
        lastCheckedAt ?? null,
        lastError ?? null,
        now()
      )
  }

  clearAiCredential(): void {
    this.db
      .prepare(
        'UPDATE ai_config SET encrypted_key=NULL,verified=0,last_error=NULL,updated_at=? WHERE id=1'
      )
      .run(now())
  }

  saveAiTrainingRecord(
    input: Omit<AiTrainingRecord, 'id' | 'correct' | 'createdAt'>
  ): AiTrainingRecord {
    const normalize = (values: string[]) =>
      [...new Set(values.map((value) => value.trim().toUpperCase()))].sort()
    const record: AiTrainingRecord = {
      ...input,
      id: randomUUID(),
      correct:
        JSON.stringify(normalize(input.answer)) === JSON.stringify(normalize(input.userAnswer)),
      createdAt: now()
    }
    this.db
      .prepare(
        `INSERT INTO ai_training_attempts(id,source_question_id,variant_json,user_answer_json,correct,created_at)
      VALUES(?,?,?,?,?,?)`
      )
      .run(
        record.id,
        record.sourceQuestionId,
        JSON.stringify({
          stem: record.stem,
          options: record.options,
          answer: record.answer,
          explanation: record.explanation
        }),
        JSON.stringify(record.userAnswer),
        record.correct ? 1 : 0,
        record.createdAt
      )
    return record
  }

  listAiTrainingRecords(): AiTrainingRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM ai_training_attempts ORDER BY created_at DESC LIMIT 100')
      .all() as Row[]
    return rows.map((row) => {
      const variant = parseJson<{
        stem: string
        options: AiTrainingRecord['options']
        answer: string[]
        explanation: string
      }>(row.variant_json, { stem: '', options: [], answer: [], explanation: '' })
      const userAnswer = parseJson<string[]>(row.user_answer_json, [])
      return {
        id: String(row.id),
        sourceQuestionId: String(row.source_question_id),
        ...variant,
        userAnswer,
        correct: Boolean(row.correct),
        createdAt: String(row.created_at)
      }
    })
  }

  getIntegrationRecord(): Row | undefined {
    return this.db.prepare('SELECT * FROM integrations WHERE id=1').get() as Row | undefined
  }

  saveIntegrationRecord(payloadJson: string): void {
    this.db
      .prepare(
        `INSERT INTO integrations(id,payload_json,updated_at) VALUES(1,?,?)
        ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at`
      )
      .run(payloadJson, now())
  }

  createBackup(reason: BackupInfo['reason'] = 'manual'): BackupInfo {
    this.db.exec('PRAGMA wal_checkpoint(FULL)')
    const createdAt = now()
    const safeTime = createdAt.replace(/[:.]/g, '-')
    const path = join(this.backupDirectory, `workbench-${reason}-${safeTime}.sqlite`)
    copyFileSync(this.databasePath, path)
    return { id: basename(path), path, createdAt, size: statSync(path).size, reason }
  }

  listBackups(): BackupInfo[] {
    if (!existsSync(this.backupDirectory)) return []
    return readdirSync(this.backupDirectory)
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => {
        const path = join(this.backupDirectory, name)
        const stat = statSync(path)
        const reason: BackupInfo['reason'] = name.includes('-pre-restore-')
          ? 'pre-restore'
          : name.includes('-automatic-')
            ? 'automatic'
            : 'manual'
        return { id: name, path, createdAt: stat.birthtime.toISOString(), size: stat.size, reason }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  restoreBackup(path: string): void {
    const resolved = this.listBackups().find((backup) => backup.path === path)
    if (!resolved) throw new Error('只能恢复由本应用创建且仍位于备份目录中的备份')
    this.validateBackup(resolved.path)
    const recovery = this.createBackup('pre-restore')
    this.db.close()
    try {
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${this.databasePath}${suffix}`
        if (existsSync(sidecar)) unlinkSync(sidecar)
      }
      copyFileSync(resolved.path, this.databasePath)
      this.db = this.open()
      this.migrate()
      if (this.integrityCheck() !== 'ok') throw new Error('恢复后的数据库完整性检查未通过')
    } catch (error) {
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${this.databasePath}${suffix}`
        if (existsSync(sidecar)) unlinkSync(sidecar)
      }
      copyFileSync(recovery.path, this.databasePath)
      this.db = this.open()
      this.migrate()
      throw new Error(
        `恢复失败，已自动回到操作前快照：${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  private validateBackup(path: string): void {
    const size = statSync(path).size
    if (size <= 0 || size > 1024 * 1024 * 1024) throw new Error('备份文件为空或超过 1 GB 上限')
    let candidate: DatabaseSync | undefined
    try {
      candidate = new DatabaseSync(path, { readOnly: true })
      const integrity = candidate.prepare('PRAGMA integrity_check').get() as Row
      if (String(Object.values(integrity)[0] ?? '') !== 'ok')
        throw new Error('备份数据库完整性检查未通过')
      const tables = candidate
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_meta','settings','vault_registry')"
        )
        .all() as Row[]
      if (tables.length !== 3) throw new Error('备份缺少工作台核心数据表')
    } catch (error) {
      throw new Error(`备份验证失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      candidate?.close()
    }
  }

  pruneBackups(retention: number): void {
    const backups = this.listBackups()
    for (const backup of backups.slice(Math.max(1, retention))) unlinkSync(backup.path)
  }

  integrityCheck(): string {
    const row = this.db.prepare('PRAGMA integrity_check').get() as Row
    return String(Object.values(row)[0] ?? 'unknown')
  }

  databaseSize(): number {
    return existsSync(this.databasePath) ? statSync(this.databasePath).size : 0
  }

  resetLearningData(): void {
    this.transaction(() => {
      for (const table of [
        'attempts',
        'wrong_questions',
        'review_tasks',
        'favorites',
        'user_notes',
        'learning_sessions',
        'exam_sessions',
        'constructed_drafts',
        'constructed_attempts',
        'plan_completions',
        'learning_plans',
        'ai_training_attempts'
      ]) {
        this.db.exec(`DELETE FROM ${table}`)
      }
    })
  }
}
