import { useEffect, useState } from 'react'
import { Button, Field, Input, Select, Spinner, Switch } from '@fluentui/react-components'
import {
  ArrowClockwiseIcon,
  DatabaseIcon,
  FolderOpenIcon,
  HeartbeatIcon,
  WrenchIcon
} from '@phosphor-icons/react'
import type {
  AppDiagnostic,
  AppSettings,
  BackupInfo,
  IntegrationConfig,
  ObsidianBackupInfo,
  RuntimeStatus,
  VaultInfo,
  VaultIndexResult,
  VaultSnapshotInfo
} from '@shared/contracts'
import { formatBytes, formatFullDate, invoke } from '../api'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  StatusDot
} from '../components/ui'
import { useAppStore } from '../store'

export function EnvironmentPage(): React.JSX.Element {
  const [status, setStatus] = useState<RuntimeStatus>()
  const [diagnostic, setDiagnostic] = useState<AppDiagnostic>()
  const [config, setConfig] = useState<IntegrationConfig>()
  const [obsidianBackups, setObsidianBackups] = useState<ObsidianBackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function load(): Promise<void> {
    setError('')
    try {
      const [runtime, integrations, savedObsidianBackups] = await Promise.all([
        invoke<RuntimeStatus>({ method: 'runtime.status' }),
        invoke<IntegrationConfig>({ method: 'integration.get' }),
        invoke<ObsidianBackupInfo[]>({ method: 'obsidian.backups' })
      ])
      setStatus(runtime)
      setConfig(integrations)
      setObsidianBackups(savedObsidianBackups)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '环境状态读取失败')
    }
  }
  useEffect(() => {
    void load()
  }, [])
  async function runDiagnostic(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      setDiagnostic(await invoke<AppDiagnostic>({ method: 'diagnostics.run' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '诊断运行失败')
    } finally {
      setBusy(false)
    }
  }
  async function save(): Promise<void> {
    if (!config) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      setConfig(await invoke<IntegrationConfig>({ method: 'integration.save', params: config }))
      await load()
      setMessage('Obsidian 配置已保存。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置保存失败')
    } finally {
      setBusy(false)
    }
  }
  async function chooseVault(): Promise<void> {
    const path = await invoke<string | undefined>({ method: 'vault.choose' })
    if (path && config) setConfig({ ...config, obsidianVaultPath: path })
  }
  async function backupObsidian(): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await invoke<ObsidianBackupInfo>({ method: 'obsidian.backup' })
      await load()
      setMessage('Obsidian 配置已备份。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Obsidian 配置备份失败')
    } finally {
      setBusy(false)
    }
  }
  async function safeMode(): Promise<void> {
    if (!window.confirm('将先备份 .obsidian，再禁用社区插件。插件文件不会删除，是否继续？')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await invoke<ObsidianBackupInfo>({ method: 'obsidian.safeMode' })
      await load()
      setMessage('已进入 Obsidian 安全模式，社区插件列表已停用，可随时从备份恢复。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '安全模式启用失败')
    } finally {
      setBusy(false)
    }
  }
  async function restoreObsidian(id: string): Promise<void> {
    if (!window.confirm('恢复前会再次备份当前 .obsidian 配置。确认继续？')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await invoke<ObsidianBackupInfo>({ method: 'obsidian.restore', params: { id } })
      await load()
      setMessage('Obsidian 配置已恢复。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Obsidian 配置恢复失败')
    } finally {
      setBusy(false)
    }
  }
  if (!status || !config)
    return (
      <div className="page">
        <PageHeader title="学习环境" />
        <LoadingState />
      </div>
    )
  return (
    <div className="page">
      <PageHeader
        eyebrow="ENVIRONMENT"
        title="学习环境"
        description="核心训练完全本地可用。Obsidian 只是可选的笔记跳转，不影响题库、复习和报告。"
        actions={
          <>
            <Button icon={<HeartbeatIcon />} disabled={busy} onClick={() => void runDiagnostic()}>
              {busy ? '诊断中' : '运行完整诊断'}
            </Button>
            <Button onClick={() => void invoke({ method: 'diagnostics.export' })}>导出诊断</Button>
          </>
        }
      />
      {error && <ErrorState message={error} />}
      {message && (
        <div className="answer-panel">
          <p className="positive">{message}</p>
        </div>
      )}
      <div className="grid three">
        <Section title="应用数据">
          <ul className="data-list">
            <li className="data-row">
              <div>
                <strong>版本</strong>
                <span>{status.platform}</span>
              </div>
              <span>{status.appVersion}</span>
            </li>
            <li className="data-row">
              <div>
                <strong>本地数据库</strong>
                <span title={status.databasePath}>{status.databasePath}</span>
              </div>
              <StatusDot status="ok" />
            </li>
          </ul>
          <Button
            icon={<FolderOpenIcon />}
            onClick={() =>
              void invoke({ method: 'shell.openPath', params: { path: status.dataDirectory } })
            }
          >
            打开数据目录
          </Button>
        </Section>
        <Section title="知识库">
          <ul className="data-list">
            <li className="data-row">
              <div>
                <strong>{status.vault.name}</strong>
                <span>
                  {status.vault.questionCount} 题 · {status.vault.documentCount} 文档
                </span>
              </div>
              <StatusDot status={status.vault.warnings.length ? 'warning' : 'ok'} />
            </li>
            <li className="data-row">
              <div>
                <strong>最近索引</strong>
                <span>{formatFullDate(status.vault.lastIndexedAt)}</span>
              </div>
              <span>{status.vault.isBuiltin ? '内置示例' : '用户目录'}</span>
            </li>
          </ul>
        </Section>
        <Section title="AI 模型">
          <ul className="data-list">
            <li className="data-row">
              <div>
                <strong>{status.ai.model}</strong>
                <span>{status.ai.provider}</span>
              </div>
              <StatusDot
                status={
                  status.ai.verified
                    ? 'ok'
                    : status.ai.hasApiKey ||
                        status.ai.provider === 'ollama' ||
                        status.ai.provider === 'lmstudio'
                      ? 'warning'
                      : 'neutral'
                }
              />
            </li>
            <li className="data-row">
              <div>
                <strong>连接状态</strong>
                <span>
                  {status.ai.lastCheckedAt ? formatFullDate(status.ai.lastCheckedAt) : '未测试'}
                </span>
              </div>
              <span>{status.ai.verified ? '可用' : '待验证'}</span>
            </li>
          </ul>
        </Section>
      </div>
      <Section
        title="Obsidian 连接"
        description="使用已安装的 Obsidian 打开指定 Vault。路径只保存在本地数据库。"
      >
        <div className="form-grid">
          <Field label="Obsidian Vault 目录">
            <Input
              value={config.obsidianVaultPath}
              onChange={(_, data) => setConfig({ ...config, obsidianVaultPath: data.value })}
              contentAfter={
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<FolderOpenIcon />}
                  onClick={() => void chooseVault()}
                  aria-label="选择 Vault 目录"
                />
              }
            />
          </Field>
          <Field label="Obsidian 可执行文件">
            <Input
              value={config.obsidianExecutable}
              onChange={(_, data) => setConfig({ ...config, obsidianExecutable: data.value })}
              placeholder="通常可自动检测"
            />
          </Field>
        </div>
        <div className="button-row" style={{ marginTop: 16 }}>
          <Button appearance="primary" disabled={busy} onClick={() => void save()}>
            保存连接
          </Button>
          <Button
            disabled={!status.obsidian.vaultReady}
            onClick={() =>
              void invoke({ method: 'integration.openObsidian' }).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : '打开失败')
              )
            }
          >
            打开 Obsidian
          </Button>
          <Button
            disabled={busy || !status.obsidian.vaultReady}
            onClick={() => void backupObsidian()}
          >
            备份配置
          </Button>
          <Button disabled={busy || !status.obsidian.vaultReady} onClick={() => void safeMode()}>
            安全模式
          </Button>
          <span className="pill">
            <StatusDot
              status={status.obsidian.detected && status.obsidian.vaultReady ? 'ok' : 'warning'}
            />{' '}
            {status.obsidian.detected
              ? status.obsidian.vaultReady
                ? '已就绪'
                : '等待 Vault 路径'
              : '未检测到程序'}
          </span>
        </div>
        {obsidianBackups.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <strong style={{ fontSize: 12 }}>Obsidian 配置备份</strong>
            <ul className="data-list">
              {obsidianBackups.slice(0, 8).map((backup) => (
                <li className="data-row" key={backup.id}>
                  <div>
                    <strong>{formatFullDate(backup.createdAt)}</strong>
                    <span>
                      {backup.reason === 'manual'
                        ? '手动备份'
                        : backup.reason === 'safe-mode'
                          ? '安全模式前'
                          : '恢复前'}{' '}
                      · {formatBytes(backup.size)}
                    </span>
                  </div>
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => void restoreObsidian(backup.id)}
                  >
                    恢复
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
      {diagnostic && (
        <Section title="诊断结果" description={formatFullDate(diagnostic.generatedAt)}>
          {diagnostic.checks.map((check) => (
            <div className="check-row" key={check.id}>
              <StatusDot status={check.status} />
              <div>
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
              {check.action && <span className="pill">{check.action}</span>}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { data, updateSettings, initialize } = useAppStore()
  const [settings, setSettings] = useState<AppSettings>(data!.settings)
  const [backups, setBackups] = useState<BackupInfo[]>()
  const [vaults, setVaults] = useState<VaultInfo[]>([])
  const [snapshots, setSnapshots] = useState<VaultSnapshotInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    void invoke<BackupInfo[]>({ method: 'backup.list' }).then(setBackups)
    void invoke<VaultInfo[]>({ method: 'vault.list' }).then(setVaults)
    void invoke<VaultSnapshotInfo[]>({
      method: 'vault.snapshots',
      params: { vaultId: data!.vault.id }
    }).then(setSnapshots)
  }, [])

  async function refreshVaultState(vaultId: string): Promise<void> {
    const [installed, savedSnapshots] = await Promise.all([
      invoke<VaultInfo[]>({ method: 'vault.list' }),
      invoke<VaultSnapshotInfo[]>({ method: 'vault.snapshots', params: { vaultId } })
    ])
    setVaults(installed)
    setSnapshots(savedSnapshots)
  }
  async function saveSettings(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await updateSettings(settings)
      setMessage('应用设置已保存。')
    } finally {
      setBusy(false)
    }
  }
  async function connectVault(): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const path = await invoke<string | undefined>({ method: 'vault.choose' })
      if (!path) return
      const result = await invoke<VaultIndexResult>({ method: 'vault.connect', params: { path } })
      await initialize()
      await refreshVaultState(result.vault.id)
      setMessage(
        `已连接 ${result.vault.name}：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}，跳过 ${result.skipped}。`
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '知识库连接失败')
    } finally {
      setBusy(false)
    }
  }
  async function reindex(): Promise<void> {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await invoke<VaultIndexResult>({ method: 'vault.reindex' })
      await initialize()
      await refreshVaultState(result.vault.id)
      setMessage(`索引完成：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新索引失败')
    } finally {
      setBusy(false)
    }
  }
  async function createBackup(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await invoke({ method: 'backup.create' })
      setBackups(await invoke<BackupInfo[]>({ method: 'backup.list' }))
      setMessage('备份已创建。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '备份创建失败')
    } finally {
      setBusy(false)
    }
  }
  async function switchVault(id: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const selected = await invoke<VaultInfo>({ method: 'vault.switch', params: { id } })
      await initialize()
      await refreshVaultState(selected.id)
      setMessage(`已切换到 ${selected.name}。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '知识库切换失败')
    } finally {
      setBusy(false)
    }
  }
  async function rollbackSnapshot(snapshotId: string): Promise<void> {
    if (!window.confirm('将活动索引回滚到所选快照。源目录文件不会被修改，是否继续？')) return
    setBusy(true)
    setError('')
    try {
      const result = await invoke<VaultIndexResult>({
        method: 'vault.rollback',
        params: { snapshotId }
      })
      await initialize()
      await refreshVaultState(result.vault.id)
      setMessage('知识库索引已回滚。重新索引时会再次读取源目录。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '索引回滚失败')
    } finally {
      setBusy(false)
    }
  }
  async function restore(path: string): Promise<void> {
    if (!window.confirm('恢复会先创建当前数据快照，然后用所选备份替换数据库。是否继续？')) return
    setBusy(true)
    setError('')
    try {
      await invoke({ method: 'backup.restore', params: { path } })
      await initialize()
      setMessage('备份恢复完成。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '备份恢复失败')
    } finally {
      setBusy(false)
    }
  }
  async function resetLearningData(): Promise<void> {
    const confirmation = window.prompt(
      '此操作会先备份，然后清空作答、错题、笔记、计划和考试。请输入：清空学习数据'
    )
    if (confirmation !== '清空学习数据') return
    setBusy(true)
    setError('')
    try {
      await invoke({ method: 'user.resetLearningData', params: { confirmation } })
      await initialize()
      setMessage('学习数据已清空，知识库、模型凭据和应用设置保持不变。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '学习数据清理失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="SETTINGS"
        title="应用设置"
        description="管理界面、训练默认值、知识库和可恢复备份。第三方受许可保护的内容包不会被导入。"
      />
      {error && <ErrorState message={error} />}
      {message && (
        <div className="answer-panel">
          <p className="positive">{message}</p>
        </div>
      )}
      <div className="grid two">
        <Section title="界面与训练默认值">
          <div className="form-grid">
            <Field label="主题">
              <Select
                value={settings.theme}
                onChange={(_, value) =>
                  setSettings({ ...settings, theme: value.value as AppSettings['theme'] })
                }
              >
                <option value="dark">深色</option>
                <option value="light">浅色</option>
                <option value="system">跟随系统</option>
              </Select>
            </Field>
            <Field label="每日目标题数">
              <Input
                type="number"
                min={1}
                max={500}
                value={String(settings.dailyTarget)}
                onChange={(_, value) =>
                  setSettings({ ...settings, dailyTarget: Number(value.value) || 1 })
                }
              />
            </Field>
            <Field label="默认练习题数">
              <Input
                type="number"
                min={1}
                max={100}
                value={String(settings.defaultPracticeCount)}
                onChange={(_, value) =>
                  setSettings({ ...settings, defaultPracticeCount: Number(value.value) || 1 })
                }
              />
            </Field>
            <Field label="默认模考分钟">
              <Input
                type="number"
                min={10}
                max={300}
                value={String(settings.defaultExamMinutes)}
                onChange={(_, value) =>
                  setSettings({ ...settings, defaultExamMinutes: Number(value.value) || 10 })
                }
              />
            </Field>
          </div>
          <div className="data-row">
            <div>
              <strong>减少动效</strong>
              <span>关闭 hover 位移和过渡</span>
            </div>
            <Switch
              checked={settings.reduceMotion}
              onChange={(_, value) => setSettings({ ...settings, reduceMotion: value.checked })}
            />
          </div>
          <div className="data-row">
            <div>
              <strong>每日自动备份</strong>
              <span>每天首次启动时创建一份</span>
            </div>
            <Switch
              checked={settings.autoBackup}
              onChange={(_, value) => setSettings({ ...settings, autoBackup: value.checked })}
            />
          </div>
          <Field label="保留备份数量">
            <Input
              type="number"
              min={1}
              max={100}
              value={String(settings.backupRetention)}
              onChange={(_, value) =>
                setSettings({ ...settings, backupRetention: Number(value.value) || 1 })
              }
            />
          </Field>
          <Button
            appearance="primary"
            style={{ marginTop: 16 }}
            disabled={busy}
            onClick={() => void saveSettings()}
          >
            保存应用设置
          </Button>
        </Section>
        <Section
          title="Markdown 知识库"
          description="当前活动知识库会作为训练、阅读和申论题目的唯一内容来源。"
        >
          <ul className="data-list">
            <li className="data-row">
              <div>
                <strong>{data!.vault.name}</strong>
                <span title={data!.vault.path}>{data!.vault.path}</span>
              </div>
              <StatusDot status={data!.vault.warnings.length ? 'warning' : 'ok'} />
            </li>
            <li className="data-row">
              <div>
                <strong>索引内容</strong>
                <span>
                  {data!.vault.questionCount} 题 · {data!.vault.documentCount} 文档
                </span>
              </div>
              <span>{formatFullDate(data!.vault.lastIndexedAt)}</span>
            </li>
          </ul>
          {data!.vault.warnings.map((warning) => (
            <div className="answer-panel" key={warning}>
              <p className="warning">{warning}</p>
            </div>
          ))}
          <div className="button-row" style={{ marginTop: 16 }}>
            <Button
              appearance="primary"
              icon={<FolderOpenIcon />}
              disabled={busy}
              onClick={() => void connectVault()}
            >
              连接目录
            </Button>
            <Button icon={<ArrowClockwiseIcon />} disabled={busy} onClick={() => void reindex()}>
              重新索引
            </Button>
          </div>
          {vaults.length > 1 && (
            <div style={{ marginTop: 18 }}>
              <strong style={{ fontSize: 12 }}>已连接知识库</strong>
              <ul className="data-list">
                {vaults.map((vault) => (
                  <li className="data-row" key={vault.id}>
                    <div>
                      <strong>{vault.name}</strong>
                      <span>
                        {vault.questionCount} 题 · {vault.documentCount} 文档
                      </span>
                    </div>
                    {vault.id === data!.vault.id ? (
                      <span className="pill">当前</span>
                    ) : (
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => void switchVault(vault.id)}
                      >
                        切换
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {snapshots.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <strong style={{ fontSize: 12 }}>历史索引快照</strong>
              <ul className="data-list">
                {snapshots.map((snapshot) => (
                  <li className="data-row" key={snapshot.id}>
                    <div>
                      <strong>{formatFullDate(snapshot.createdAt)}</strong>
                      <span>
                        {snapshot.questionCount} 题 · {snapshot.documentCount} 文档 ·{' '}
                        {formatBytes(snapshot.size)}
                      </span>
                    </div>
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => void rollbackSnapshot(snapshot.id)}
                    >
                      回滚索引
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>
      <Section
        title="数据备份"
        description="恢复前会自动创建 pre-restore 快照，避免误操作造成不可逆丢失。"
        actions={
          <Button icon={<DatabaseIcon />} disabled={busy} onClick={() => void createBackup()}>
            立即备份
          </Button>
        }
      >
        {!backups ? (
          <Spinner label="正在读取备份" />
        ) : backups.length ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>类型</th>
                <th>大小</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td>{formatFullDate(backup.createdAt)}</td>
                  <td>
                    {backup.reason === 'manual'
                      ? '手动'
                      : backup.reason === 'automatic'
                        ? '自动'
                        : '恢复前快照'}
                  </td>
                  <td>{formatBytes(backup.size)}</td>
                  <td>
                    <Button
                      size="small"
                      appearance="subtle"
                      disabled={busy}
                      onClick={() => void restore(backup.path)}
                    >
                      恢复
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="尚无备份"
            description="创建第一份本地数据库快照，后续可从这里恢复。"
            actionLabel="立即备份"
            onAction={() => void createBackup()}
          />
        )}
      </Section>
      <Section
        title="Markdown 格式提示"
        description="frontmatter 字段允许中英文值，路径变化不会改变基于内容生成的稳定题号。"
      >
        <pre
          className="markdown"
          style={{ whiteSpace: 'pre-wrap' }}
        >{`---\nid: my-question-001\nkind: question\nsubject: xingce\ncategory: 判断推理\ntype: single\nanswer: A\ndifficulty: 2\ntags: [逻辑, 充分条件]\n---\n# 题目标题\n\n题干内容\n\nA. 选项一\nB. 选项二\n\n## 解析\n\n解析内容`}</pre>
      </Section>
      <Section
        title="危险操作"
        description="只清空学习证据，不删除知识库目录、模型凭据和应用设置。操作前自动创建本地快照。"
      >
        <Button appearance="secondary" disabled={busy} onClick={() => void resetLearningData()}>
          清空学习数据
        </Button>
      </Section>
    </div>
  )
}
