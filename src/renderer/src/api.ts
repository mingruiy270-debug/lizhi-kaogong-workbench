import type { WorkbenchRequest } from '@shared/contracts'

export async function invoke<T>(request: WorkbenchRequest): Promise<T> {
  try {
    return await window.workbench.invoke<T>(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace(/^Error invoking remote method '[^']+': Error:\s*/, ''))
  }
}

export function formatDate(value?: string): string {
  if (!value) return '暂无'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
}

export function formatFullDate(value?: string): string {
  if (!value) return '暂无'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
