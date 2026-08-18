import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from '../src/main/services/database'
import { VaultService } from '../src/main/services/vault'

describe('DatabaseService learning loop', () => {
  let directory: string
  let database: DatabaseService

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lizhi-database-'))
    database = new DatabaseService(
      join(directory, 'workbench.sqlite'),
      directory,
      join(directory, 'backups')
    )
    new VaultService(database).ensureBuiltinVault()
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('seeds the self-authored starter vault', () => {
    const vault = database.getActiveVault()
    expect(vault?.isBuiltin).toBe(true)
    expect(vault?.questionCount).toBe(8)
    expect(database.listQuestions()).toHaveLength(8)
    expect(database.listDocuments({})).toHaveLength(4)
  })

  it('records wrong answers and masters an item after two consecutive correct reviews', () => {
    const wrong = database.submitAttempt({
      questionId: 'builtin-language-001',
      answer: ['A'],
      durationSeconds: 12,
      mode: 'practice',
      wrongCause: '审题偏差'
    })
    expect(wrong.correct).toBe(false)
    expect(wrong.nextReviewAt).toBeTruthy()

    const firstReview = database.submitAttempt({
      questionId: 'builtin-language-001',
      answer: ['C'],
      durationSeconds: 8,
      mode: 'review'
    })
    expect(firstReview.correct).toBe(true)
    expect(firstReview.mastered).toBe(false)

    const secondReview = database.submitAttempt({
      questionId: 'builtin-language-001',
      answer: ['C'],
      durationSeconds: 7,
      mode: 'review'
    })
    expect(secondReview.mastered).toBe(true)
    expect(database.getDashboard().masteredQuestions).toBe(1)
  })

  it('finishes an exam atomically and adds every question to attempts', () => {
    const questions = database.listQuestions({ subject: 'xingce', limit: 2 })
    const exam = database.createExam(
      { title: '测试模考', subject: 'xingce', durationMinutes: 30, questionCount: 2 },
      questions
    )
    for (const question of questions) {
      database.saveExamAnswer(exam.id, {
        questionId: question.id,
        answer: question.answer,
        durationSeconds: 10
      })
    }
    const finished = database.finishExam(exam.id)
    expect(finished.status).toBe('finished')
    expect(finished.correctCount).toBe(2)
    expect(finished.score).toBe(100)
    expect(database.getReport('all').totalAttempts).toBe(2)
  })

  it('creates a restorable database backup', () => {
    const backup = database.createBackup('manual')
    expect(backup.size).toBeGreaterThan(0)
    expect(database.listBackups()).toHaveLength(1)
  })

  it('rejects a tampered backup before closing the live database', () => {
    mkdirSync(database.backupDirectory, { recursive: true })
    const invalid = join(database.backupDirectory, 'workbench-manual-invalid.sqlite')
    writeFileSync(invalid, 'not a sqlite database', 'utf8')

    expect(() => database.restoreBackup(invalid)).toThrow(/备份验证失败/)
    expect(database.getActiveVault()?.questionCount).toBe(8)
  })

  it('persists practice progress, snapshots and uncertain flags for resume', () => {
    const questions = database.listQuestions({ subject: 'xingce', limit: 3 })
    const session = database.createPracticeSession(
      { mode: 'adaptive', count: 3, feedbackMode: 'summary' },
      questions
    )
    database.updatePracticeSession(session.id, {
      currentIndex: 1,
      uncertainIds: [questions[1]!.id, 'not-in-session']
    })

    const resumed = database.getActivePracticeSession('practice')
    expect(resumed?.feedbackMode).toBe('summary')
    expect(resumed?.currentIndex).toBe(1)
    expect(resumed?.uncertainIds).toEqual([questions[1]!.id])
    expect(resumed?.questionSnapshots[questions[0]!.id]?.stem).toBe(questions[0]!.stem)
  })

  it('grades an active exam from its immutable question snapshot', () => {
    const questions = database.listQuestions({ subject: 'xingce', limit: 2 })
    const original = questions[0]!
    const exam = database.createExam(
      { title: '快照模考', subject: 'xingce', durationMinutes: 30, questionCount: 2 },
      questions
    )
    database.saveExamAnswer(exam.id, {
      questionId: original.id,
      answer: original.answer,
      durationSeconds: 8
    })
    const vault = database.getActiveVault()!
    const updated = database
      .listQuestions()
      .map((question) =>
        question.id === original.id
          ? { ...question, answer: ['H'], contentHash: `${question.contentHash}-updated` }
          : question
      )
    database.replaceVaultContent(vault, updated, database.listDocuments({}))

    const finished = database.finishExam(exam.id)
    expect(finished.correctCount).toBe(1)
    expect(finished.questionSnapshots[original.id]?.answer).toEqual(original.answer)
  })

  it('creates and restores an index snapshot after content changes', () => {
    const vault = database.getActiveVault()!
    const original = database.listQuestions()[0]!
    const changedQuestions = database.listQuestions().map((question) =>
      question.id === original.id
        ? {
            ...question,
            stem: `${question.stem}（修订）`,
            contentHash: `${question.contentHash}-revision`
          }
        : question
    )
    database.replaceVaultContent(vault, changedQuestions, database.listDocuments({}))
    const snapshot = database.listVaultSnapshots(vault.id)[0]
    expect(snapshot).toBeTruthy()

    database.rollbackVaultSnapshot(snapshot!.id)
    expect(database.getQuestion(original.id)?.stem).toBe(original.stem)
  })

  it('clears learning evidence while preserving settings and vault content', () => {
    const question = database.listQuestions()[0]!
    database.saveAppSettings({ dailyTarget: 77 })
    database.submitAttempt({
      questionId: question.id,
      answer: [],
      durationSeconds: 9,
      mode: 'practice'
    })
    database.setFavorite(question.id, true)
    database.saveNote(question.id, '保留前的笔记')

    database.resetLearningData()

    expect(database.getReport('all').totalAttempts).toBe(0)
    expect(database.listQuestions()).toHaveLength(8)
    expect(database.getAppSettings().dailyTarget).toBe(77)
    expect(database.listQuestions({ onlyFavorite: true })).toHaveLength(0)
    expect(database.getNote(question.id)).toBe('')
  })

  it('preserves user state when the active vault is reindexed', () => {
    database.submitAttempt({
      questionId: 'builtin-logic-001',
      answer: ['B'],
      durationSeconds: 15,
      mode: 'practice'
    })
    database.setFavorite('builtin-logic-001', true)
    database.saveNote('builtin-logic-001', '检查逆否命题')

    new VaultService(database).reindex()

    expect(database.getDashboard().wrongQuestions).toBe(1)
    expect(database.listQuestions({ onlyFavorite: true }).map((question) => question.id)).toContain(
      'builtin-logic-001'
    )
    expect(database.getNote('builtin-logic-001')).toBe('检查逆否命题')
  })
})
