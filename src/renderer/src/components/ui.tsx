import type { ReactNode } from 'react'
import {
  Button,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Spinner
} from '@fluentui/react-components'
import { ArrowClockwiseIcon, FolderOpenIcon } from '@phosphor-icons/react'

export function PageHeader(props: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </header>
  )
}

export function Section(props: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={`section ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <div className="section-heading">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.description && <p>{props.description}</p>}
          </div>
          {props.actions && <div className="section-actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  )
}

export function LoadingState({ label = '正在加载' }: { label?: string }): React.JSX.Element {
  return (
    <div className="center-state">
      <Spinner label={label} />
    </div>
  )
}

export function EmptyState(props: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderOpenIcon size={28} aria-hidden />
      </div>
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      {props.actionLabel && props.onAction && (
        <Button appearance="primary" onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      )}
    </div>
  )
}

export function ErrorState(props: { message: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <MessageBar intent="error">
      <MessageBarBody>
        {props.message}
        {props.onRetry && (
          <Button appearance="transparent" icon={<ArrowClockwiseIcon />} onClick={props.onRetry}>
            重试
          </Button>
        )}
      </MessageBarBody>
    </MessageBar>
  )
}

export function Stat(props: {
  label: string
  value: ReactNode
  detail?: string
  progress?: number
}): React.JSX.Element {
  return (
    <div className="stat">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail && <small>{props.detail}</small>}
      {props.progress !== undefined && (
        <ProgressBar value={Math.max(0, Math.min(1, props.progress))} />
      )}
    </div>
  )
}

export function StatusDot({
  status
}: {
  status: 'ok' | 'warning' | 'error' | 'neutral'
}): React.JSX.Element {
  return (
    <span
      className={`status-dot status-${status}`}
      aria-label={
        status === 'ok'
          ? '正常'
          : status === 'warning'
            ? '需注意'
            : status === 'error'
              ? '异常'
              : '未配置'
      }
    />
  )
}
