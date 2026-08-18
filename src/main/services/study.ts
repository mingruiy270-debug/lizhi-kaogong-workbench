import { randomUUID } from 'node:crypto'
import type {
  ConstructedEvaluation,
  DiagnosisResult,
  LearningPlan,
  LearningPlanItem,
  PracticeSelection,
  Question
} from '../../shared/contracts'
import { FEATURE_PROMPTS, taskDataEnvelope } from '../../shared/prompts'
import { AiService } from './ai'
import { DatabaseService } from './database'

function now(): string {
  return new Date().toISOString()
}

function dateFromToday(days: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function shuffled<T>(items: T[]): T[] {
  const output = [...items]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(Math.random() * (index + 1))
    const value = output[index]
    output[index] = output[selected]!
    output[selected] = value!
  }
  return output
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  const codeBlock = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value
  try {
    const parsed = JSON.parse(codeBlock.trim())
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export class StudyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ai: AiService
  ) {}

  selectPractice(selection: PracticeSelection): Question[] {
    const count = clamp(Math.round(selection.count), 1, 100)
    if (selection.mode === 'review')
      return this.database.getDueReviews(count).map((item) => item.question)
    const pool = this.database.listQuestions({ ...selection.filter, limit: 5000 })
    if (selection.mode === 'sequence') return pool.slice(0, count)
    if (selection.mode === 'adaptive') {
      const diagnosis = this.getDiagnosis()
      const priority = new Map(
        diagnosis.weaknesses.map((item, index) => [
          item.category,
          diagnosis.weaknesses.length - index
        ])
      )
      const recent = new Set(this.database.getRecentAttemptQuestionIds(80))
      const attempted = this.database.getAttemptedQuestionIds()
      const wrong = this.database.listQuestions({ onlyWrong: true, limit: 500 })
      const wrongTags = new Set(wrong.flatMap((question) => question.tags))
      const wrongCategories = new Set(wrong.map((question) => question.category))
      return shuffled(pool)
        .map((question) => ({
          question,
          score:
            (priority.get(question.category) ?? 0) * 20 +
            (wrongCategories.has(question.category) ? 12 : 0) +
            question.tags.filter((tag) => wrongTags.has(tag)).length * 3 +
            (attempted.has(question.id) ? 0 : 8) -
            (recent.has(question.id) ? 40 : 0)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map((item) => item.question)
    }
    return shuffled(pool).slice(0, count)
  }

  getDiagnosis(): DiagnosisResult {
    const report = this.database.getReport('all')
    const categories = report.categoryStats.filter((item) => item.attempts > 0)
    const strengths = [...categories]
      .filter((item) => item.attempts >= 2)
      .sort((a, b) => b.accuracy - a.accuracy || b.attempts - a.attempts)
      .slice(0, 4)
      .map(({ category, accuracy, attempts }) => ({ category, accuracy, attempts }))
    const weaknesses = [...categories]
      .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
      .slice(0, 4)
      .map(({ category, accuracy, attempts }) => ({ category, accuracy, attempts }))
    const recommendations: string[] = []
    if (report.totalAttempts === 0)
      recommendations.push('先完成一组 10 题摸底训练，系统会据此生成能力画像。')
    if (report.totalAttempts > 0 && report.accuracy < 60)
      recommendations.push('当前优先补齐基础方法，每组训练后逐题填写错因。')
    if (report.totalAttempts > 0 && report.accuracy >= 60 && report.accuracy < 80)
      recommendations.push('基础已经建立，建议采用弱项专项与间隔复习交替训练。')
    if (report.accuracy >= 80) recommendations.push('正确率较稳定，可增加限时模考并关注平均用时。')
    if (weaknesses[0])
      recommendations.push(
        `优先训练“${weaknesses[0].category}”，当前正确率为 ${weaknesses[0].accuracy}%。`
      )
    if (report.wrongCauses[0]?.cause && report.wrongCauses[0].cause !== '未标注')
      recommendations.push(
        `最常见错因是“${report.wrongCauses[0].cause}”，复盘时应设置针对性检查步骤。`
      )
    return {
      generatedAt: now(),
      totalAttempts: report.totalAttempts,
      accuracy: report.accuracy,
      averageDurationSeconds: report.totalAttempts
        ? Math.round((report.studyMinutes * 60) / report.totalAttempts)
        : 0,
      strengths,
      weaknesses,
      recommendations
    }
  }

  previewPlan(input: {
    durationDays: number
    dailyMinutes: number
    focus: string[]
  }): LearningPlan {
    const durationDays = clamp(Math.round(input.durationDays), 1, 30)
    const dailyMinutes = clamp(Math.round(input.dailyMinutes), 10, 300)
    const diagnosis = this.getDiagnosis()
    const focus = input.focus.length
      ? input.focus.slice(0, 6)
      : diagnosis.weaknesses.map((item) => item.category).slice(0, 3)
    if (focus.length === 0) focus.push('综合能力')
    const items: LearningPlanItem[] = []
    const practiceTarget = clamp(Math.round(dailyMinutes / 3), 5, 50)
    for (let day = 1; day <= durationDays; day += 1) {
      const category = focus[(day - 1) % focus.length]!
      items.push({
        id: randomUUID(),
        day,
        type: 'read_knowledge',
        title: `阅读：${category}核心方法`,
        target: Math.max(10, Math.round(dailyMinutes * 0.25)),
        completed: 0,
        done: false
      })
      items.push({
        id: randomUUID(),
        day,
        type: 'official_practice',
        title: `专项训练：${category}`,
        target: practiceTarget,
        completed: 0,
        done: false
      })
      items.push({
        id: randomUUID(),
        day,
        type: day % 3 === 0 ? 'ai_variant' : 'official_review',
        title: day % 3 === 0 ? `变式训练：${category}` : '到期错题复习',
        target: day % 3 === 0 ? 3 : 5,
        completed: 0,
        done: false
      })
    }
    return {
      id: randomUUID(),
      title: `${durationDays} 天能力提升计划`,
      createdAt: now(),
      startDate: dateFromToday(0),
      durationDays,
      dailyMinutes,
      status: 'preview',
      focus,
      items
    }
  }

  async evaluateConstructed(input: {
    promptId: string
    title: string
    content: string
  }): Promise<ConstructedEvaluation> {
    const content = input.content.trim()
    if (content.length < 20) throw new Error('作答内容过短，至少输入 20 个字符后再评估')
    const prompt = this.database.getQuestion(input.promptId)
    const config = this.ai.getConfig()
    let evaluation: ConstructedEvaluation | undefined
    if (config.hasApiKey || config.provider === 'ollama' || config.provider === 'lmstudio') {
      try {
        const result = await this.ai.ask({
          purpose: 'evaluate',
          messages: [
            {
              role: 'system',
              content: FEATURE_PROMPTS.constructedEvaluation
            },
            {
              role: 'user',
              content: taskDataEnvelope('申论作答评估输入', {
                title: input.title,
                prompt: prompt?.stem ?? input.title,
                material: prompt?.material ?? '',
                referencePoints: prompt?.answer ?? [],
                referenceExplanation: prompt?.explanation ?? '',
                studentAnswer: content
              })
            }
          ]
        })
        const parsed = parseJsonObject(result.content)
        if (parsed) {
          const dimensionsRaw = Array.isArray(parsed.dimensions) ? parsed.dimensions : []
          evaluation = {
            id: randomUUID(),
            promptId: input.promptId,
            score: clamp(Number(parsed.score) || 0, 0, 100),
            dimensions: dimensionsRaw.flatMap((item) => {
              if (!item || typeof item !== 'object') return []
              const record = item as Record<string, unknown>
              return [
                {
                  name: String(record.name ?? '综合'),
                  score: clamp(Number(record.score) || 0, 0, 100),
                  comment: String(record.comment ?? '')
                }
              ]
            }),
            summary: String(parsed.summary ?? '评估完成'),
            suggestions: Array.isArray(parsed.suggestions)
              ? parsed.suggestions.map(String).slice(0, 8)
              : [],
            createdAt: now(),
            provider: `${result.provider}/${result.model}`
          }
        }
      } catch {
        evaluation = undefined
      }
    }
    evaluation ??= this.localEvaluation(input.promptId, content, prompt)
    this.database.saveConstructedAttempt({
      id: evaluation.id,
      promptId: input.promptId,
      title: input.title,
      content,
      evaluation,
      createdAt: evaluation.createdAt
    })
    return evaluation
  }

  private localEvaluation(
    promptId: string,
    content: string,
    prompt?: Question
  ): ConstructedEvaluation {
    const keywords = prompt?.answer ?? []
    const matched = keywords.filter((keyword) => content.includes(keyword)).length
    const coverage = keywords.length ? matched / keywords.length : 0.55
    const paragraphs = content.split(/\n+/).filter((item) => item.trim()).length
    const structure = clamp(
      (paragraphs >= 2 ? 72 : 55) + (/[一二三四]|首先|其次|最后|一是|二是/.test(content) ? 15 : 0),
      0,
      100
    )
    const lengthScore =
      content.length >= 100 && content.length <= 500 ? 88 : content.length >= 60 ? 72 : 55
    const accuracy = Math.round(45 + coverage * 50)
    const score = Math.round(accuracy * 0.5 + structure * 0.3 + lengthScore * 0.2)
    return {
      id: randomUUID(),
      promptId,
      score,
      dimensions: [
        {
          name: '要点覆盖',
          score: accuracy,
          comment: keywords.length
            ? `命中 ${matched}/${keywords.length} 个参考要点。`
            : '当前题目没有结构化参考要点，按表达完整度估算。'
        },
        {
          name: '结构组织',
          score: structure,
          comment: paragraphs >= 2 ? '答案具备分层表达。' : '建议按并列或因果关系分层组织。'
        },
        {
          name: '表达规范',
          score: lengthScore,
          comment: '请继续压缩重复表述，优先使用主体加措施加效果的句式。'
        }
      ],
      summary:
        '这是本地规则评分，用于快速自检，不替代人工阅卷。配置 AI 后可获得语义层面的进一步反馈。',
      suggestions: [
        matched < keywords.length
          ? '对照材料补齐尚未覆盖的核心做法。'
          : '要点覆盖较完整，可继续优化排序和概括层级。',
        structure < 75 ? '用序号或分号明确拆分要点。' : '保持当前分层结构，并减少空泛修饰。',
        '每个要点先写结论词，再补充材料依据。'
      ],
      createdAt: now(),
      provider: 'local-rubric'
    }
  }
}
