import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { shell } from 'electron'
import type { IntegrationConfig, ObsidianBackupInfo } from '../../shared/contracts'
import { DEFAULT_INTEGRATIONS } from '../../shared/defaults'
import { DatabaseService } from './database'

interface StoredIntegrations {
  obsidianVaultPath: string
  obsidianExecutable: string
}

function parseStored(value: unknown): StoredIntegrations {
  if (typeof value !== 'string') return { ...DEFAULT_INTEGRATIONS }
  try {
    const parsed = JSON.parse(value) as Partial<StoredIntegrations>
    return {
      obsidianVaultPath: parsed.obsidianVaultPath ?? '',
      obsidianExecutable: parsed.obsidianExecutable ?? ''
    }
  } catch {
    return { ...DEFAULT_INTEGRATIONS }
  }
}

function detectedObsidian(): string {
  const candidates = [
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Programs', 'Obsidian', 'Obsidian.exe')
      : '',
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Obsidian', 'Obsidian.exe') : ''
  ]
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? ''
}

function directorySize(path: string): number {
  if (!existsSync(path)) return 0
  return readdirSync(path, { withFileTypes: true }).reduce((size, entry) => {
    const item = join(path, entry.name)
    if (entry.isSymbolicLink()) return size
    return size + (entry.isDirectory() ? directorySize(item) : statSync(item).size)
  }, 0)
}

function copyDirectory(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (item) => !lstatSync(item).isSymbolicLink()
  })
}

export class IntegrationService {
  constructor(private readonly database: DatabaseService) {}

  getConfig(): IntegrationConfig {
    const stored = this.getStored()
    return {
      obsidianVaultPath: stored.obsidianVaultPath,
      obsidianExecutable: stored.obsidianExecutable || detectedObsidian()
    }
  }

  saveConfig(patch: Partial<IntegrationConfig>): IntegrationConfig {
    const stored = this.getStored()
    if (patch.obsidianVaultPath !== undefined)
      stored.obsidianVaultPath = patch.obsidianVaultPath.trim()
    if (patch.obsidianExecutable !== undefined)
      stored.obsidianExecutable = patch.obsidianExecutable.trim()
    this.database.saveIntegrationRecord(JSON.stringify(stored))
    return this.getConfig()
  }

  status(): {
    obsidian: { detected: boolean; executable?: string; vaultReady: boolean }
  } {
    const config = this.getConfig()
    const obsidianPath = config.obsidianExecutable || detectedObsidian()
    return {
      obsidian: {
        detected: Boolean(obsidianPath && existsSync(obsidianPath)),
        executable: obsidianPath || undefined,
        vaultReady: Boolean(config.obsidianVaultPath && existsSync(config.obsidianVaultPath))
      }
    }
  }

  async openObsidian(): Promise<void> {
    const config = this.getConfig()
    if (!config.obsidianVaultPath || !existsSync(config.obsidianVaultPath))
      throw new Error('请先配置有效的 Obsidian Vault 路径')
    const vaultName = basename(resolve(config.obsidianVaultPath))
    if (config.obsidianExecutable && existsSync(config.obsidianExecutable)) {
      spawn(config.obsidianExecutable, [config.obsidianVaultPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref()
      return
    }
    await shell.openExternal(`obsidian://open?vault=${encodeURIComponent(vaultName)}`)
  }

  listObsidianBackups(): ObsidianBackupInfo[] {
    const root = this.obsidianBackupRoot()
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .flatMap((entry) => {
        if (!entry.isDirectory()) return []
        try {
          const manifest = JSON.parse(
            readFileSync(join(root, entry.name, 'manifest.json'), 'utf8')
          ) as Partial<ObsidianBackupInfo>
          if (
            manifest.id !== entry.name ||
            typeof manifest.createdAt !== 'string' ||
            typeof manifest.vaultPath !== 'string' ||
            !['manual', 'pre-restore', 'safe-mode'].includes(String(manifest.reason))
          )
            return []
          return [
            {
              id: manifest.id,
              createdAt: manifest.createdAt,
              vaultPath: manifest.vaultPath,
              size: directorySize(join(root, entry.name, 'config')),
              reason: manifest.reason as ObsidianBackupInfo['reason']
            }
          ]
        } catch {
          return []
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  createObsidianBackup(reason: ObsidianBackupInfo['reason'] = 'manual'): ObsidianBackupInfo {
    const { vaultPath, configPath } = this.obsidianPaths()
    if (!existsSync(configPath) || !statSync(configPath).isDirectory())
      throw new Error('当前 Vault 尚未生成 .obsidian 配置目录')
    const id = randomUUID()
    const backupPath = join(this.obsidianBackupRoot(), id)
    mkdirSync(backupPath, { recursive: true })
    try {
      copyDirectory(configPath, join(backupPath, 'config'))
      const backup: ObsidianBackupInfo = {
        id,
        createdAt: new Date().toISOString(),
        vaultPath,
        size: directorySize(join(backupPath, 'config')),
        reason
      }
      writeFileSync(join(backupPath, 'manifest.json'), JSON.stringify(backup, null, 2), 'utf8')
      return backup
    } catch (error) {
      rmSync(backupPath, { recursive: true, force: true })
      throw error
    }
  }

  restoreObsidianBackup(id: string): ObsidianBackupInfo {
    const backup = this.listObsidianBackups().find((item) => item.id === id)
    if (!backup) throw new Error('找不到可恢复的 Obsidian 配置备份')
    const { vaultPath, configPath } = this.obsidianPaths()
    if (resolve(backup.vaultPath) !== vaultPath)
      throw new Error('该备份属于另一个 Vault，已拒绝跨目录恢复')
    this.createObsidianBackup('pre-restore')
    const source = join(this.obsidianBackupRoot(), backup.id, 'config')
    const pending = join(vaultPath, `.obsidian-restore-${randomUUID()}`)
    const displaced = join(vaultPath, `.obsidian-previous-${randomUUID()}`)
    copyDirectory(source, pending)
    try {
      renameSync(configPath, displaced)
      try {
        renameSync(pending, configPath)
      } catch (error) {
        renameSync(displaced, configPath)
        throw error
      }
      rmSync(displaced, { recursive: true, force: true })
      return backup
    } finally {
      if (existsSync(pending)) rmSync(pending, { recursive: true, force: true })
    }
  }

  enableObsidianSafeMode(): ObsidianBackupInfo {
    const { configPath } = this.obsidianPaths()
    const backup = this.createObsidianBackup('safe-mode')
    writeFileSync(join(configPath, 'community-plugins.json'), '[]\n', 'utf8')
    return backup
  }

  private getStored(): StoredIntegrations {
    const record = this.database.getIntegrationRecord()
    return record ? parseStored(record.payload_json) : { ...DEFAULT_INTEGRATIONS }
  }

  private obsidianBackupRoot(): string {
    const root = join(this.database.dataDirectory, 'obsidian-backups')
    mkdirSync(root, { recursive: true })
    return root
  }

  private obsidianPaths(): { vaultPath: string; configPath: string } {
    const config = this.getConfig()
    if (!config.obsidianVaultPath) throw new Error('请先配置 Obsidian Vault 路径')
    const vaultPath = resolve(config.obsidianVaultPath)
    if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory())
      throw new Error('Obsidian Vault 路径不存在或不是目录')
    return { vaultPath, configPath: join(vaultPath, '.obsidian') }
  }
}
