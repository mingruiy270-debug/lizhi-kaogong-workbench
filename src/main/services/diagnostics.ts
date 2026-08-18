import { accessSync, constants, existsSync } from 'node:fs'
import type { AppDiagnostic, DiagnosticCheck, RuntimeStatus } from '../../shared/contracts'
import { AiService } from './ai'
import { DatabaseService } from './database'
import { IntegrationService } from './integrations'

export class DiagnosticService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ai: AiService,
    private readonly integrations: IntegrationService,
    private readonly appVersion: string
  ) {}

  runtimeStatus(): RuntimeStatus {
    const vault = this.database.getActiveVault()
    if (!vault) throw new Error('知识库尚未初始化')
    const integrationStatus = this.integrations.status()
    return {
      appVersion: this.appVersion,
      platform: `${process.platform} ${process.arch}`,
      databasePath: this.database.databasePath,
      dataDirectory: this.database.dataDirectory,
      vault,
      obsidian: integrationStatus.obsidian,
      ai: this.ai.getConfig()
    }
  }

  run(): AppDiagnostic {
    const checks: DiagnosticCheck[] = []
    const integrity = this.database.integrityCheck()
    checks.push({
      id: 'database-integrity',
      label: '用户数据库',
      status: integrity === 'ok' ? 'ok' : 'error',
      detail:
        integrity === 'ok'
          ? `完整性正常，当前大小 ${this.formatBytes(this.database.databaseSize())}`
          : `完整性检查返回：${integrity}`,
      action: integrity === 'ok' ? undefined : '从最近备份恢复'
    })
    try {
      accessSync(this.database.dataDirectory, constants.R_OK | constants.W_OK)
      checks.push({
        id: 'data-directory',
        label: '数据目录',
        status: 'ok',
        detail: '应用对数据目录具有读写权限。'
      })
    } catch {
      checks.push({
        id: 'data-directory',
        label: '数据目录',
        status: 'error',
        detail: '应用无法读写数据目录。',
        action: '检查目录权限'
      })
    }
    const vault = this.database.getActiveVault()
    checks.push({
      id: 'vault',
      label: '知识库索引',
      status:
        vault && vault.questionCount > 0 ? (vault.warnings.length ? 'warning' : 'ok') : 'error',
      detail: vault
        ? `${vault.name}：${vault.questionCount} 道题，${vault.documentCount} 篇文档，${vault.warnings.length} 条提示。`
        : '没有活动知识库。',
      action: vault?.warnings.length ? '查看知识库设置并重新索引' : undefined
    })
    const ai = this.ai.getConfig()
    const aiReady = ai.hasApiKey || ai.provider === 'ollama' || ai.provider === 'lmstudio'
    checks.push({
      id: 'ai',
      label: 'AI 模型',
      status: !aiReady ? 'warning' : ai.verified ? 'ok' : 'warning',
      detail: !aiReady
        ? '未配置模型凭据，本地核心训练功能仍可使用。'
        : ai.verified
          ? `${ai.provider}/${ai.model} 已验证。`
          : `配置已保存但尚未通过连接测试${ai.lastError ? `：${ai.lastError}` : '。'}`,
      action: !ai.verified ? '前往模型设置测试连接' : undefined
    })
    const obsidian = this.integrations.status().obsidian
    checks.push({
      id: 'obsidian',
      label: 'Obsidian',
      status: obsidian.detected && obsidian.vaultReady ? 'ok' : 'warning',
      detail: !obsidian.detected
        ? '未检测到 Obsidian，笔记跳转功能不可用。'
        : obsidian.vaultReady
          ? 'Obsidian 与 Vault 路径均可用。'
          : '已检测到 Obsidian，但尚未配置 Vault 路径。',
      action: obsidian.detected && obsidian.vaultReady ? undefined : '前往环境设置'
    })
    const activeExam = this.database.getActiveExam()
    if (activeExam) {
      checks.push({
        id: 'active-exam',
        label: '未完成模考',
        status: 'warning',
        detail: `“${activeExam.title}”仍可继续作答。`,
        action: '继续模考'
      })
    }
    checks.push({
      id: 'backup',
      label: '数据备份',
      status: this.database.listBackups().length ? 'ok' : 'warning',
      detail: this.database.listBackups().length
        ? `已有 ${this.database.listBackups().length} 份可恢复备份。`
        : '尚无备份，建议立即创建。',
      action: this.database.listBackups().length ? undefined : '创建备份'
    })
    return { generatedAt: new Date().toISOString(), checks }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
}
