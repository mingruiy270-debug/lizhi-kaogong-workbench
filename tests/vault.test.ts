import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from '../src/main/services/database'
import { VaultService } from '../src/main/services/vault'

const QUESTION = `---
kind: question
subject: xingce
category: 判断推理
type: single
answer: A
difficulty: 2
tags: [逻辑]
---
# 条件推理

所有甲都是乙，小王不是乙。一定可以推出什么？

A. 小王不是甲
B. 小王是甲

## 解析

根据逆否命题，小王不是甲。
`

describe('VaultService', () => {
  let directory: string
  let vaultDirectory: string
  let database: DatabaseService
  let vaults: VaultService

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lizhi-vault-'))
    vaultDirectory = join(directory, 'vault')
    mkdirSync(vaultDirectory)
    database = new DatabaseService(
      join(directory, 'workbench.sqlite'),
      directory,
      join(directory, 'backups')
    )
    vaults = new VaultService(database)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('indexes generic Markdown questions and knowledge documents', () => {
    writeFileSync(join(vaultDirectory, 'question.md'), QUESTION, 'utf8')
    writeFileSync(
      join(vaultDirectory, 'method.md'),
      '---\nkind: method\nsubject: xingce\ntags: [复盘]\n---\n# 检查步骤\n\n先检查题干限定词。',
      'utf8'
    )
    const result = vaults.connect(vaultDirectory)
    expect(result.vault.questionCount).toBe(1)
    expect(result.vault.documentCount).toBe(1)
    expect(database.listQuestions()[0]?.answer).toEqual(['A'])
    expect(database.listDocuments({ kind: 'method' })[0]?.title).toBe('检查步骤')
  })

  it('keeps generated question IDs stable after a file rename', () => {
    const firstPath = join(vaultDirectory, 'first.md')
    const secondPath = join(vaultDirectory, 'renamed.md')
    writeFileSync(firstPath, QUESTION, 'utf8')
    vaults.connect(vaultDirectory)
    const firstId = database.listQuestions()[0]?.id
    renameSync(firstPath, secondPath)
    const result = vaults.connect(vaultDirectory)
    expect(database.listQuestions()[0]?.id).toBe(firstId)
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
  })

  it('reports malformed files without blocking valid content', () => {
    writeFileSync(join(vaultDirectory, 'valid.md'), QUESTION, 'utf8')
    writeFileSync(
      join(vaultDirectory, 'invalid.md'),
      '---\nkind: question\n---\n# 没有答案的题',
      'utf8'
    )
    const result = vaults.connect(vaultDirectory)
    expect(result.vault.questionCount).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.warnings[0]).toMatch(/缺少(?:题干|答案)/)
  })

  it('indexes paper facets and only reads whitelisted assets inside the active vault', () => {
    const enriched = QUESTION.replace(
      'difficulty: 2',
      'difficulty: 2\nyear: 2025\nregion: 上海\npaper: 2025 上海测试卷\ncontentVersion: v2'
    )
    writeFileSync(join(vaultDirectory, 'question.md'), enriched, 'utf8')
    writeFileSync(
      join(vaultDirectory, 'image.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    writeFileSync(join(directory, 'outside.png'), Buffer.from('outside'))
    vaults.connect(vaultDirectory)
    const question = database.listQuestions()[0]!

    expect(question.region).toBe('上海')
    expect(question.paper).toBe('2025 上海测试卷')
    expect(question.contentVersion).toBe('v2')
    expect(database.getQuestionFacets('xingce')).toEqual({
      years: [2025],
      regions: ['上海'],
      papers: ['2025 上海测试卷']
    })
    expect(vaults.readAssetDataUrl(question.filePath!, 'image.png')).toMatch(
      /^data:image\/png;base64,/
    )
    expect(() => vaults.readAssetDataUrl(question.filePath!, '../outside.png')).toThrow(
      /超出当前知识库/
    )
  })

  it('isolates identical declared IDs across different vaults', () => {
    const firstVault = join(directory, 'first-vault')
    const secondVault = join(directory, 'second-vault')
    mkdirSync(firstVault)
    mkdirSync(secondVault)
    const declared = QUESTION.replace('kind: question', 'id: shared-id\nkind: question')
    writeFileSync(join(firstVault, 'question.md'), declared, 'utf8')
    writeFileSync(join(secondVault, 'question.md'), declared, 'utf8')

    const first = vaults.connect(firstVault)
    const firstQuestion = database.listQuestions()[0]!
    database.setFavorite(firstQuestion.id, true)
    const second = vaults.connect(secondVault)
    const secondQuestion = database.listQuestions()[0]!

    expect(secondQuestion.id).not.toBe(firstQuestion.id)
    expect(secondQuestion.id).toContain(second.vault.id)
    database.switchVault(first.vault.id)
    expect(database.listQuestions({ onlyFavorite: true })[0]?.id).toBe(firstQuestion.id)
  })
})
