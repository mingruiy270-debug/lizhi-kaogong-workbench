import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import matter from 'gray-matter'
import type {
  Difficulty,
  KnowledgeDocument,
  Question,
  QuestionOption,
  Subject,
  VaultIndexResult,
  VaultInfo
} from '../../shared/contracts'
import { DatabaseService } from './database'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.obsidian',
  'node_modules',
  '.trash',
  'attachments',
  '附件'
])
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 50_000

function timestamp(): string {
  return new Date().toISOString()
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : value === undefined || value === null
      ? ''
      : String(value).trim()
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean)
  if (typeof value === 'string')
    return value
      .split(/[,，;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  return []
}

function parseSubject(value: unknown, filePath: string): Subject | 'common' {
  const raw = normalizeText(value).toLowerCase()
  if (raw.includes('申论') || raw === 'shenlun' || filePath.includes('申论')) return 'shenlun'
  if (raw.includes('行测') || raw === 'xingce' || filePath.includes('行测')) return 'xingce'
  return 'common'
}

function parseQuestionType(value: unknown, options: QuestionOption[]): Question['type'] {
  const raw = normalizeText(value).toLowerCase()
  if (['multiple', '多选', 'multiple-choice'].includes(raw)) return 'multiple'
  if (['judge', '判断', 'true-false'].includes(raw)) return 'judge'
  if (['essay', '申论', 'constructed'].includes(raw)) return 'essay'
  return options.length ? 'single' : 'essay'
}

function parseOptions(value: unknown, body: string): QuestionOption[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (typeof item === 'string')
        return [{ key: String.fromCharCode(65 + index), text: item.trim() }]
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const key = normalizeText(record.key || record.label) || String.fromCharCode(65 + index)
        const text = normalizeText(record.text || record.value || record.content)
        return text ? [{ key: key.toUpperCase(), text }] : []
      }
      return []
    })
  }
  const lines = body.split(/\r?\n/)
  const options: QuestionOption[] = []
  for (const line of lines) {
    const matched = line.trim().match(/^(?:[-*]\s*)?([A-HＡ-Ｈ])\s*[.、:：)]\s*(.+)$/i)
    if (matched?.[1] && matched[2])
      options.push({ key: matched[1].toUpperCase(), text: matched[2].trim() })
  }
  return options
}

function section(body: string, names: string[]): string {
  const heading = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const matched = body.match(
    new RegExp(`(?:^|\\n)#{1,4}\\s*(?:${heading})\\s*\\n([\\s\\S]*?)(?=\\n#{1,4}\\s|$)`, 'i')
  )
  return matched?.[1]?.trim() ?? ''
}

function firstTitle(body: string, fallback: string): string {
  const matched = body.match(/^#\s+(.+)$/m)
  return matched?.[1]?.trim() || fallback
}

function bodyBeforeSections(body: string): string {
  return (
    body
      .replace(/^#\s+.+$/m, '')
      .split(/\n#{1,4}\s*(?:选项|答案|解析|参考答案|材料)\s*\n/i)[0]
      ?.replace(/^(?:[-*]\s*)?[A-HＡ-Ｈ]\s*[.、:：)]\s*.+$/gim, '')
      .trim() ?? ''
  )
}

const BUILTIN_QUESTION_DATA: Array<Omit<Question, 'contentHash'>> = [
  {
    id: 'builtin-quantity-001',
    subject: 'xingce',
    category: '数量关系',
    type: 'single',
    stem: '某项目由甲单独完成需 12 天，乙单独完成需 18 天。两人合作 4 天后，剩余工作由甲单独完成，还需多少天？',
    options: [
      { key: 'A', text: '4' },
      { key: 'B', text: '16/3' },
      { key: 'C', text: '6' },
      { key: 'D', text: '20/3' }
    ],
    answer: ['B'],
    explanation:
      '合作 4 天完成 4×(1/12+1/18)=5/9，剩余 4/9。甲每天完成 1/12，因此还需 (4/9)÷(1/12)=16/3 天。',
    difficulty: 2,
    source: '砺知自编示例',
    tags: ['工程问题', '效率']
  },
  {
    id: 'builtin-language-001',
    subject: 'xingce',
    category: '言语理解',
    type: 'single',
    stem: '真正有效的公共服务创新，不在于概念有多新，而在于能否准确回应群众的具体需要。填入画线处最恰当的一项是：公共服务创新应当____。',
    options: [
      { key: 'A', text: '追逐技术热点' },
      { key: 'B', text: '强调形式变化' },
      { key: 'C', text: '坚持需求导向' },
      { key: 'D', text: '扩大宣传声量' }
    ],
    answer: ['C'],
    explanation: '文段通过“不在于……而在于……”突出群众具体需要，因此主旨是坚持需求导向。',
    difficulty: 1,
    source: '砺知自编示例',
    tags: ['主旨概括']
  },
  {
    id: 'builtin-logic-001',
    subject: 'xingce',
    category: '判断推理',
    type: 'single',
    stem: '所有参加培训的人员都完成了测评，小周没有完成测评。由此一定可以推出：',
    options: [
      { key: 'A', text: '小周没有参加培训' },
      { key: 'B', text: '小周参加了其他活动' },
      { key: 'C', text: '完成测评的都参加了培训' },
      { key: 'D', text: '小周拒绝参加培训' }
    ],
    answer: ['A'],
    explanation:
      '“参加培训”是“完成测评”的充分条件。小周没有完成测评，根据逆否命题可得小周没有参加培训。',
    difficulty: 2,
    source: '砺知自编示例',
    tags: ['翻译推理', '逆否命题']
  },
  {
    id: 'builtin-data-001',
    subject: 'xingce',
    category: '资料分析',
    type: 'single',
    stem: '某市上年接待游客 800 万人次，本年增长 12.5%。本年接待游客约为多少万人次？',
    options: [
      { key: 'A', text: '850' },
      { key: 'B', text: '880' },
      { key: 'C', text: '900' },
      { key: 'D', text: '920' }
    ],
    answer: ['C'],
    explanation: '本年人数为 800×(1+12.5%)=800+100=900 万人次。',
    difficulty: 1,
    source: '砺知自编示例',
    tags: ['增长率']
  },
  {
    id: 'builtin-common-001',
    subject: 'xingce',
    category: '常识判断',
    type: 'single',
    stem: '行政机关作出重大行政决策时，强调公众参与、专家论证和风险评估，主要体现了决策的哪项要求？',
    options: [
      { key: 'A', text: '科学民主依法决策' },
      { key: 'B', text: '完全市场化决策' },
      { key: 'C', text: '内部封闭决策' },
      { key: 'D', text: '临时应急决策' }
    ],
    answer: ['A'],
    explanation: '公众参与体现民主，专家论证和风险评估体现科学，规范程序体现依法决策。',
    difficulty: 1,
    source: '砺知自编示例',
    tags: ['行政决策']
  },
  {
    id: 'builtin-multiple-001',
    subject: 'xingce',
    category: '判断推理',
    type: 'multiple',
    stem: '为提高调查问卷的数据质量，以下做法合理的有：',
    options: [
      { key: 'A', text: '问题表述清晰中性' },
      { key: 'B', text: '设置逻辑校验' },
      { key: 'C', text: '只保留支持结论的样本' },
      { key: 'D', text: '在正式调查前进行预测试' }
    ],
    answer: ['A', 'B', 'D'],
    explanation: '清晰中性的表述、逻辑校验和预测试都有助于质量控制。选择性保留样本会引入偏差。',
    difficulty: 3,
    source: '砺知自编示例',
    tags: ['数据质量', '多选']
  },
  {
    id: 'builtin-judge-001',
    subject: 'xingce',
    category: '常识判断',
    type: 'judge',
    stem: '在同一总体中，随机样本量通常越大，抽样误差就越容易减小。',
    options: [
      { key: 'A', text: '正确' },
      { key: 'B', text: '错误' }
    ],
    answer: ['A'],
    explanation: '在抽样设计合理、其他条件相近时，增大样本量通常可以降低随机抽样误差。',
    difficulty: 1,
    source: '砺知自编示例',
    tags: ['统计常识']
  },
  {
    id: 'builtin-essay-001',
    subject: 'shenlun',
    category: '归纳概括',
    type: 'essay',
    stem: '某社区通过议事会收集居民诉求，将停车、养老、托育等问题分类建账，并由责任单位限时反馈。请概括该社区治理做法的主要特点。',
    options: [],
    answer: ['多元参与', '需求分类', '台账管理', '限时反馈', '闭环治理'],
    explanation:
      '参考要点：搭建议事平台，吸纳居民参与；围绕实际诉求分类建账；明确责任主体与办理时限；反馈结果，形成治理闭环。',
    difficulty: 2,
    source: '砺知自编示例',
    tags: ['基层治理', '概括题']
  }
]

const BUILTIN_QUESTIONS: Question[] = BUILTIN_QUESTION_DATA.map((question) => ({
  ...question,
  contentHash: hash(JSON.stringify(question))
}))

const BUILTIN_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'builtin-doc-structure',
    subject: 'xingce',
    kind: 'method',
    title: '结构化拆题法',
    summary: '先识别题型，再提取条件，最后选择最短验证路径。',
    content:
      '# 结构化拆题法\n\n1. 标记题目所属模块和考点。\n2. 把自然语言条件改写成关系式或逻辑式。\n3. 先排除违反硬条件的选项。\n4. 记录错误原因，而不只记录答案。',
    tags: ['方法', '复盘']
  },
  {
    id: 'builtin-doc-language',
    subject: 'xingce',
    kind: 'knowledge',
    title: '转折结构的阅读重点',
    summary: '关联词后的内容通常承担作者核心判断。',
    content:
      '# 转折结构\n\n遇到“虽然……但是……”“不是……而是……”等结构，先判断前后语义权重，再用后半部分校验选项。注意：重点不等于只看一个句子，还需核对指代范围。',
    tags: ['言语理解', '关联词']
  },
  {
    id: 'builtin-doc-pattern',
    subject: 'common',
    kind: 'pattern',
    title: '错因记录模板',
    summary: '把错误分成知识、审题、计算、策略与时间五类。',
    content:
      '# 错因记录模板\n\n- 知识缺口：概念或公式不知道。\n- 审题偏差：遗漏限定词或对象。\n- 计算失误：方法正确但运算出错。\n- 策略不当：选了过长路径。\n- 时间失控：应跳过却持续投入。',
    tags: ['错题', '规律']
  },
  {
    id: 'builtin-doc-shenlun',
    subject: 'shenlun',
    kind: 'method',
    title: '申论要点组织四步法',
    summary: '定位任务、提取关键词、合并同义项、按逻辑排序。',
    content:
      '# 申论要点组织四步法\n\n先圈定作答对象与任务，再从材料中提取主体、行为和结果。将同义表述合并，最后根据并列、因果或时间关系排序。每个要点尽量做到观点在前、说明在后。',
    tags: ['申论', '作答方法']
  }
]

export class VaultService {
  constructor(private readonly database: DatabaseService) {}

  ensureBuiltinVault(): VaultInfo {
    const active = this.database.getActiveVault()
    if (active) return active
    const vault: VaultInfo = {
      id: 'builtin-vault',
      name: '砺知入门题库',
      path: 'builtin://starter',
      connectedAt: timestamp(),
      lastIndexedAt: timestamp(),
      questionCount: BUILTIN_QUESTIONS.length,
      documentCount: BUILTIN_DOCUMENTS.length,
      warnings: ['当前使用内置自编示例。可在设置中连接自己的 Markdown 知识库。'],
      isBuiltin: true
    }
    this.database.replaceVaultContent(vault, BUILTIN_QUESTIONS, BUILTIN_DOCUMENTS)
    return vault
  }

  connect(directory: string): VaultIndexResult {
    const root = resolve(directory)
    if (!existsSync(root) || !statSync(root).isDirectory())
      throw new Error('所选路径不是可读取的目录')
    if (extname(root).toLowerCase() === '.akvault') {
      throw new Error(
        '本应用不读取第三方受许可保护的 .akvault 包。请选择你拥有权利的 Markdown 目录。'
      )
    }
    const realRoot = realpathSync(root)
    const vaultId = `vault-${hash(realRoot.toLowerCase()).slice(0, 20)}`
    const warnings: string[] = []
    const paths = this.walkMarkdown(realRoot, warnings)
    if (paths.length === 0) throw new Error('目录中没有找到 Markdown 文件')
    const questions: Question[] = []
    const documents: KnowledgeDocument[] = []
    const seenIds = new Set<string>()
    let skipped = 0
    for (const path of paths) {
      try {
        const parsed = this.parseFile(realRoot, path)
        if (!parsed) {
          skipped += 1
          continue
        }
        parsed.id = `${vaultId}:${parsed.id}`
        if (seenIds.has(parsed.id)) {
          warnings.push(`${relative(realRoot, path)}：ID ${parsed.id} 重复，已跳过`)
          skipped += 1
          continue
        }
        seenIds.add(parsed.id)
        if ('stem' in parsed) questions.push(parsed)
        else documents.push(parsed)
      } catch (error) {
        warnings.push(
          `${relative(realRoot, path)}：${error instanceof Error ? error.message : '解析失败'}`
        )
        skipped += 1
      }
    }
    if (questions.length === 0 && documents.length === 0)
      throw new Error('没有解析出题目或知识文档，请检查 Markdown frontmatter')
    const existingVault = this.database
      .listVaults()
      .find((candidate) => candidate.path === realRoot)
    const connectedAt = existingVault?.connectedAt ?? timestamp()
    const vault: VaultInfo = {
      id: vaultId,
      name: basename(realRoot),
      path: realRoot,
      connectedAt,
      lastIndexedAt: timestamp(),
      questionCount: questions.length,
      documentCount: documents.length,
      warnings: warnings.slice(0, 100),
      isBuiltin: false
    }
    const changes = this.database.replaceVaultContent(vault, questions, documents)
    return { vault, ...changes, skipped, warnings: vault.warnings }
  }

  reindex(): VaultIndexResult {
    const vault = this.database.getActiveVault() ?? this.ensureBuiltinVault()
    if (vault.isBuiltin) {
      const changes = this.database.replaceVaultContent(
        { ...vault, lastIndexedAt: timestamp() },
        BUILTIN_QUESTIONS,
        BUILTIN_DOCUMENTS
      )
      return {
        vault: { ...vault, lastIndexedAt: timestamp() },
        ...changes,
        skipped: 0,
        warnings: vault.warnings
      }
    }
    return this.connect(vault.path)
  }

  readAssetDataUrl(sourceFilePath: string, assetPath: string): string {
    const vault = this.database.getActiveVault()
    if (!vault || vault.isBuiltin) throw new Error('当前知识库没有可读取的本地附件')
    const root = realpathSync(vault.path)
    const source = realpathSync(resolve(sourceFilePath))
    if (!this.isWithin(root, source)) throw new Error('附件来源文档不属于当前知识库')
    let decoded: string
    try {
      decoded = decodeURIComponent(assetPath.split(/[?#]/, 1)[0] ?? '')
    } catch {
      throw new Error('附件路径编码无效')
    }
    if (!decoded || /^[a-z][a-z0-9+.-]*:/i.test(decoded))
      throw new Error('只允许读取知识库内的相对附件')
    const candidate = resolve(dirname(source), decoded)
    if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error('附件文件不存在')
    const file = realpathSync(candidate)
    if (!this.isWithin(root, file)) throw new Error('附件路径超出当前知识库')
    const mime =
      {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      }[extname(file).toLowerCase()] ?? ''
    if (!mime) throw new Error('附件类型不在图片白名单中')
    const size = statSync(file).size
    if (size > 15 * 1024 * 1024) throw new Error('单个图片附件不能超过 15 MB')
    return `data:${mime};base64,${readFileSync(file).toString('base64')}`
  }

  private walkMarkdown(root: string, warnings: string[]): string[] {
    const results: string[] = []
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (results.length >= MAX_FILES)
          throw new Error(`Markdown 文件超过 ${MAX_FILES} 个，已停止索引`)
        if (entry.isSymbolicLink()) continue
        const fullPath = resolve(directory, entry.name)
        if (!fullPath.toLowerCase().startsWith(root.toLowerCase())) continue
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) visit(fullPath)
          continue
        }
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue
        const size = lstatSync(fullPath).size
        if (size > MAX_FILE_BYTES) {
          warnings.push(`${relative(root, fullPath)}：文件超过 5 MB，已跳过`)
          continue
        }
        results.push(fullPath)
      }
    }
    visit(root)
    return results
  }

  private isWithin(root: string, candidate: string): boolean {
    const path = relative(root, candidate)
    return (
      path === '' ||
      (path !== '..' && !path.startsWith(`..\\`) && !path.startsWith('../') && !isAbsolute(path))
    )
  }

  private parseFile(root: string, filePath: string): Question | KnowledgeDocument | undefined {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data as Record<string, unknown>
    const relativePath = relative(root, filePath).replace(/\\/g, '/')
    const declaredKind = normalizeText(data.kind || data.type || data.contentType).toLowerCase()
    const options = parseOptions(data.options, parsed.content)
    const hasQuestionSignals = Boolean(
      data.answer ||
      data.answers ||
      data.correct ||
      data.stem ||
      options.length ||
      declaredKind.includes('question') ||
      declaredKind === '题目'
    )
    const title = normalizeText(data.title) || firstTitle(parsed.content, basename(filePath, '.md'))
    if (!hasQuestionSignals) {
      const kind: KnowledgeDocument['kind'] =
        declaredKind.includes('pattern') || declaredKind.includes('规律')
          ? 'pattern'
          : declaredKind.includes('method') || declaredKind.includes('方法')
            ? 'method'
            : 'knowledge'
      const subject = parseSubject(data.subject, relativePath)
      const documentId =
        normalizeText(data.id || data.uid) ||
        `doc-${hash(`${title}\n${parsed.content.slice(0, 800)}`).slice(0, 24)}`
      return {
        id: documentId,
        subject,
        kind,
        title,
        summary:
          normalizeText(data.summary) ||
          parsed.content
            .replace(/[#>*_`\[\]]/g, '')
            .trim()
            .slice(0, 140),
        content: parsed.content.trim(),
        tags: asStringArray(data.tags),
        filePath
      }
    }
    const stem =
      normalizeText(data.stem || data.question) ||
      section(parsed.content, ['题目', '问题']) ||
      bodyBeforeSections(parsed.content)
    if (!stem) throw new Error('缺少题干')
    const answer = asStringArray(
      data.answer || data.answers || data.correct || section(parsed.content, ['答案', '参考答案'])
    ).map((value) =>
      value
        .replace(/^答案[:：]?\s*/i, '')
        .trim()
        .toUpperCase()
    )
    if (answer.length === 0) throw new Error('缺少答案')
    const explanation =
      normalizeText(data.explanation || data.analysis) ||
      section(parsed.content, ['解析', '答案解析', '参考解析']) ||
      '该题暂未提供解析。'
    const subjectRaw = parseSubject(data.subject, relativePath)
    const subject: Subject =
      subjectRaw === 'common'
        ? parseQuestionType(data.questionType || data.type, options) === 'essay'
          ? 'shenlun'
          : 'xingce'
        : subjectRaw
    const category =
      normalizeText(data.category || data.topic || data.module) ||
      (subject === 'shenlun' ? '申论综合' : '未分类')
    const difficultyNumber = Number(data.difficulty ?? 2)
    const difficulty = Math.max(
      1,
      Math.min(5, Number.isFinite(difficultyNumber) ? Math.round(difficultyNumber) : 2)
    ) as Difficulty
    const region = normalizeText(data.region || data.area || data.province)
    const paper = normalizeText(data.paper || data.paperName || data.exam)
    const year = data.year && Number.isFinite(Number(data.year)) ? Number(data.year) : undefined
    const stableSignature = `${subject}\n${category}\n${stem}\n${JSON.stringify(options)}\n${normalizeText(data.source)}\n${year ?? ''}\n${region}\n${paper}`
    const aliases = asStringArray(data.aliases || data.alias)
    const explicitId = normalizeText(data.id || data.uid || aliases[0])
    return {
      id: explicitId || `q-${hash(stableSignature).slice(0, 24)}`,
      subject,
      category,
      type: parseQuestionType(data.questionType || data.type, options),
      stem,
      options,
      answer,
      explanation,
      difficulty,
      source: normalizeText(data.source) || '用户知识库',
      year,
      region: region || undefined,
      paper: paper || undefined,
      material:
        normalizeText(data.material || data.passage) ||
        section(parsed.content, ['材料', '给定资料']) ||
        undefined,
      contentVersion: normalizeText(data.contentVersion || data.version) || hash(raw).slice(0, 16),
      tags: [
        ...new Set([...asStringArray(data.tags), ...aliases.map((alias) => `alias:${alias}`)])
      ],
      filePath,
      contentHash: hash(raw)
    }
  }
}
