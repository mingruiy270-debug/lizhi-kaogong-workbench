import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { LearningPlan, WorkbenchRequest } from '../shared/contracts'
import { AiService } from './services/ai'
import { DatabaseService } from './services/database'
import { DiagnosticService } from './services/diagnostics'
import { IntegrationService } from './services/integrations'
import { KnowledgeBuilderService } from './services/knowledge-builder'
import { StudyService } from './services/study'
import { VaultService } from './services/vault'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let database: DatabaseService | undefined

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith('..\\') && !path.startsWith('../') && !isAbsolute(path))
  )
}

if (process.env.WORKBENCH_SMOKE_DATA_DIR) {
  app.setPath('userData', resolve(process.env.WORKBENCH_SMOKE_DATA_DIR))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    backgroundColor: '#111714',
    title: '砺知考公工作台',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (process.env.WORKBENCH_SMOKE_CAPTURE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const capturePath = resolve(process.env.WORKBENCH_SMOKE_CAPTURE!)
        mkdirSync(dirname(capturePath), { recursive: true })
        try {
          const smokeRoute = process.env.WORKBENCH_SMOKE_ROUTE
          if (smokeRoute) {
            await mainWindow!.webContents.executeJavaScript(
              `window.location.hash = ${JSON.stringify(smokeRoute)}`
            )
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 4_500))
          }
          if (process.env.WORKBENCH_SMOKE_ASSERT_SCROLL === '1') {
            mainWindow!.show()
            mainWindow!.focus()
            mainWindow!.webContents.focus()
            const metrics = (await mainWindow!.webContents.executeJavaScript(`(() => {
              const workspace = document.querySelector('.workspace')
              if (!(workspace instanceof HTMLElement)) return { error: 'workspace missing' }
              workspace.scrollTop = 0
              const bounds = workspace.getBoundingClientRect()
              return {
                before: workspace.scrollTop,
                centerX: Math.round(bounds.left + bounds.width / 2),
                centerY: Math.round(bounds.top + bounds.height / 2),
                clientHeight: workspace.clientHeight,
                scrollHeight: workspace.scrollHeight,
                overflowY: getComputedStyle(workspace).overflowY
              }
            })()`)) as Record<string, unknown>
            if (!metrics.error) {
              mainWindow!.webContents.sendInputEvent({
                type: 'mouseMove',
                x: Number(metrics.centerX),
                y: Number(metrics.centerY)
              })
              for (let count = 0; count < 4; count += 1)
                mainWindow!.webContents.sendInputEvent({
                  type: 'mouseWheel',
                  x: Number(metrics.centerX),
                  y: Number(metrics.centerY),
                  deltaX: 0,
                  deltaY: -120,
                  canScroll: true
                })
              await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
              let after = Number(
                await mainWindow!.webContents.executeJavaScript(
                  `document.querySelector('.workspace')?.scrollTop ?? 0`
                )
              )
              if (after <= Number(metrics.before)) {
                const devtools = mainWindow!.webContents.debugger
                try {
                  if (!devtools.isAttached()) devtools.attach('1.3')
                  await devtools.sendCommand('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: Number(metrics.centerX),
                    y: Number(metrics.centerY)
                  })
                  await devtools.sendCommand('Input.dispatchMouseEvent', {
                    type: 'mouseWheel',
                    x: Number(metrics.centerX),
                    y: Number(metrics.centerY),
                    deltaX: 0,
                    deltaY: 480
                  })
                  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400))
                  after = Number(
                    await mainWindow!.webContents.executeJavaScript(
                      `document.querySelector('.workspace')?.scrollTop ?? 0`
                    )
                  )
                } finally {
                  if (devtools.isAttached()) devtools.detach()
                }
              }
              metrics.after = after
            }
            writeFileSync(`${capturePath}.scroll.json`, JSON.stringify(metrics, null, 2), 'utf8')
            if (
              metrics.error ||
              metrics.overflowY !== 'auto' ||
              Number(metrics.scrollHeight) <= Number(metrics.clientHeight) ||
              Number(metrics.after) <= Number(metrics.before)
            )
              throw new Error(`滚动冒烟检查失败：${JSON.stringify(metrics)}`)
          }
          const image = await mainWindow!.webContents.capturePage()
          writeFileSync(capturePath, image.toPNG())
          app.quit()
        } catch (error) {
          writeFileSync(
            `${capturePath}.error.txt`,
            error instanceof Error ? (error.stack ?? error.message) : String(error),
            'utf8'
          )
          app.exit(1)
        }
      }, 1500)
    })
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    if ((developmentUrl && url.startsWith(developmentUrl)) || url.startsWith('file://')) return
    event.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'))
}

async function initialize(): Promise<void> {
  const dataDirectory = app.getPath('userData')
  const databasePath = join(dataDirectory, 'workbench.sqlite')
  const backupDirectory = join(dataDirectory, 'backups')
  database = new DatabaseService(databasePath, dataDirectory, backupDirectory)
  const vaults = new VaultService(database)
  const ai = new AiService(database)
  const integrations = new IntegrationService(database)
  const study = new StudyService(database, ai)
  const knowledgeBuilder = new KnowledgeBuilderService(
    dataDirectory,
    process.resourcesPath,
    ai,
    vaults
  )
  const diagnostics = new DiagnosticService(database, ai, integrations, app.getVersion())
  vaults.ensureBuiltinVault()

  const settings = database.getAppSettings()
  if (settings.autoBackup) {
    const today = new Date().toISOString().slice(0, 10)
    if (!database.listBackups().some((backup) => backup.createdAt.startsWith(today))) {
      database.createBackup('automatic')
      database.pruneBackups(settings.backupRetention)
    }
  }

  ipcMain.handle('workbench:invoke', async (event, request: WorkbenchRequest) => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
      throw new Error('拒绝来自子框架的请求')
    switch (request.method) {
      case 'bootstrap':
        return {
          dashboard: database!.getDashboard(),
          settings: database!.getAppSettings(),
          vault: database!.getActiveVault(),
          ai: ai.getConfig()
        }
      case 'dashboard.get':
        return database!.getDashboard()
      case 'vault.choose': {
        const selected = await dialog.showOpenDialog(mainWindow!, {
          title: '选择 Markdown 知识库目录',
          properties: ['openDirectory']
        })
        return selected.canceled ? undefined : selected.filePaths[0]
      }
      case 'vault.connect':
        return vaults.connect(request.params.path)
      case 'vault.reindex':
        return vaults.reindex()
      case 'vault.list':
        return database!.listVaults()
      case 'vault.switch':
        return database!.switchVault(request.params.id)
      case 'vault.snapshots':
        return database!.listVaultSnapshots(request.params.vaultId)
      case 'vault.rollback':
        return database!.rollbackVaultSnapshot(request.params.snapshotId)
      case 'vault.search':
        return database!.listQuestions(request.params)
      case 'vault.categories':
        return database!.listCategories(request.params?.subject)
      case 'vault.facets':
        return database!.getQuestionFacets(request.params?.subject)
      case 'vault.asset':
        return vaults.readAssetDataUrl(request.params.sourceFilePath, request.params.assetPath)
      case 'knowledgeBuilder.source.choose': {
        const selected = await dialog.showOpenDialog(mainWindow!, {
          title: '选择未整理的知识库原料目录',
          properties: ['openDirectory']
        })
        return selected.canceled ? undefined : selected.filePaths[0]
      }
      case 'knowledgeBuilder.source.scan':
        return knowledgeBuilder.scan(request.params.path)
      case 'knowledgeBuilder.engine.status':
        return knowledgeBuilder.engineStatus()
      case 'knowledgeBuilder.engine.install':
        return knowledgeBuilder.installEngine()
      case 'knowledgeBuilder.job.start':
        return knowledgeBuilder.startJob(request.params)
      case 'knowledgeBuilder.job.latest':
        return knowledgeBuilder.latestJob()
      case 'knowledgeBuilder.job.get':
        return knowledgeBuilder.getJob(request.params.id)
      case 'knowledgeBuilder.job.cancel':
        return knowledgeBuilder.cancelJob(request.params.id)
      case 'knowledgeBuilder.job.retry':
        return knowledgeBuilder.retryJob(request.params.id, request.params.sourceIds)
      case 'knowledgeBuilder.artifact.get':
        return knowledgeBuilder.getArtifact(request.params.jobId, request.params.artifactId)
      case 'knowledgeBuilder.artifact.review':
        return knowledgeBuilder.reviewArtifact(
          request.params.jobId,
          request.params.artifactId,
          request.params.status
        )
      case 'knowledgeBuilder.publish':
        return knowledgeBuilder.publish(request.params.jobId)
      case 'documents.list':
        return database!.listDocuments(request.params)
      case 'questions.get':
        return database!.getQuestion(request.params.id)
      case 'practice.select':
        return study.selectPractice(request.params)
      case 'practice.session.start': {
        const questions = study.selectPractice(request.params)
        return database!.createPracticeSession(request.params, questions)
      }
      case 'practice.session.active':
        return database!.getActivePracticeSession(request.params.mode)
      case 'practice.session.update':
        return database!.updatePracticeSession(request.params.id, request.params)
      case 'practice.session.complete':
        return database!.completePracticeSession(request.params.id, request.params.abandoned)
      case 'questions.similar':
        return database!.findSimilarQuestions(request.params.id, request.params.limit)
      case 'attempt.submit':
        return database!.submitAttempt(request.params)
      case 'favorite.set':
        return database!.setFavorite(request.params.questionId, request.params.favorite)
      case 'note.save':
        return database!.saveNote(request.params.questionId, request.params.content)
      case 'note.get':
        return database!.getNote(request.params.questionId)
      case 'review.due':
        return database!.getDueReviews(request.params?.limit)
      case 'exam.create': {
        const questions = study.selectPractice({
          mode: 'random',
          count: request.params.questionCount,
          filter: { ...request.params.filter, subject: request.params.subject }
        })
        return database!.createExam(request.params, questions)
      }
      case 'exam.active':
        return database!.getActiveExam()
      case 'exam.save':
        return database!.saveExamAnswer(request.params.examId, request.params.answer)
      case 'exam.finish':
        return database!.finishExam(request.params.examId)
      case 'exam.history':
        return database!.listExams()
      case 'draft.save':
        return database!.saveDraft(request.params)
      case 'draft.get':
        return database!.getDraft(request.params.id)
      case 'constructed.evaluate':
        return study.evaluateConstructed(request.params)
      case 'reports.get':
        return database!.getReport(request.params.range)
      case 'reports.export': {
        const report = database!.getReport(request.params.range)
        const selected = await dialog.showSaveDialog(mainWindow!, {
          title: '导出学习报告',
          defaultPath: `砺知学习报告-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (selected.canceled || !selected.filePath) return undefined
        writeFileSync(selected.filePath, JSON.stringify(report, null, 2), 'utf8')
        return selected.filePath
      }
      case 'diagnosis.get':
        return study.getDiagnosis()
      case 'plan.preview':
        return study.previewPlan(request.params)
      case 'plan.apply': {
        const plan: LearningPlan = {
          ...request.params.plan,
          status: 'active',
          startDate: new Date().toISOString()
        }
        return database!.savePlan(plan)
      }
      case 'plan.active':
        return database!.getActivePlan()
      case 'plan.item.complete':
        return database!.completePlanItem(
          request.params.planId,
          request.params.itemId,
          request.params.completed
        )
      case 'plan.cancel':
        return database!.cancelPlan(request.params.planId)
      case 'ai.config.get':
        return ai.getConfig()
      case 'ai.config.save':
        return ai.saveConfig(request.params)
      case 'ai.config.clearCredential':
        return ai.clearCredential()
      case 'ai.providers':
        return ai.providers()
      case 'ai.models.discover':
        return ai.discoverModels()
      case 'ai.test':
        return ai.test()
      case 'ai.ask':
        return ai.ask(request.params)
      case 'aiTraining.record':
        return database!.saveAiTrainingRecord(request.params)
      case 'aiTraining.history':
        return database!.listAiTrainingRecords()
      case 'settings.get':
        return database!.getAppSettings()
      case 'settings.save':
        return database!.saveAppSettings(request.params)
      case 'runtime.status':
        return diagnostics.runtimeStatus()
      case 'integration.get':
        return integrations.getConfig()
      case 'integration.save':
        return integrations.saveConfig(request.params)
      case 'integration.openObsidian':
        return integrations.openObsidian()
      case 'obsidian.backups':
        return integrations.listObsidianBackups()
      case 'obsidian.backup':
        return integrations.createObsidianBackup()
      case 'obsidian.restore':
        return integrations.restoreObsidianBackup(request.params.id)
      case 'obsidian.safeMode':
        return integrations.enableObsidianSafeMode()
      case 'backup.create': {
        const backup = database!.createBackup('manual')
        database!.pruneBackups(database!.getAppSettings().backupRetention)
        return backup
      }
      case 'backup.list':
        return database!.listBackups()
      case 'backup.restore': {
        database!.restoreBackup(request.params.path)
        return {
          dashboard: database!.getDashboard(),
          settings: database!.getAppSettings(),
          vault: database!.getActiveVault(),
          ai: ai.getConfig()
        }
      }
      case 'diagnostics.run':
        return diagnostics.run()
      case 'diagnostics.export': {
        const report = diagnostics.run()
        const selected = await dialog.showSaveDialog(mainWindow!, {
          title: '导出诊断报告',
          defaultPath: `砺知诊断-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
        if (selected.canceled || !selected.filePath) return undefined
        writeFileSync(selected.filePath, JSON.stringify(report, null, 2), 'utf8')
        return selected.filePath
      }
      case 'user.resetLearningData': {
        if (request.params.confirmation !== '清空学习数据') throw new Error('确认文字不匹配')
        database!.createBackup('pre-restore')
        database!.resetLearningData()
        return database!.getDashboard()
      }
      case 'shell.openPath': {
        const requested = resolve(request.params.path)
        const activeVault = database!.getActiveVault()
        const allowedRoots = [
          resolve(dataDirectory),
          ...(activeVault && !activeVault.isBuiltin ? [resolve(activeVault.path)] : [])
        ]
        if (!allowedRoots.some((root) => isWithin(root, requested)))
          throw new Error('该路径不在应用数据或活动知识库范围内')
        const error = await shell.openPath(requested)
        if (error) throw new Error(error)
        return true
      }
    }
  })
}

app.whenReady().then(async () => {
  await initialize()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => database?.close())
