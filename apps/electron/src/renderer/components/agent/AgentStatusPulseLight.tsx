import * as React from 'react'
import type { AgentStreamState, SessionIndicatorStatus, ToolActivity } from '@/atoms/agent-atoms'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { aggregateTaskItems, type TaskItem } from './task-progress'

export interface AgentDelegationProgressSummary {
  total: number
  completed: number
  running?: number
  failed?: number
  cancelled?: number
  interrupted?: number
}

export interface AgentDelegationProgressSource {
  createdAt: number
  delegationStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
}

export function buildAgentDelegationProgressSummary(
  sessions: AgentDelegationProgressSource[],
  currentRunStartedAt?: number,
): AgentDelegationProgressSummary | undefined {
  const cutoff = currentRunStartedAt == null ? null : currentRunStartedAt - 1000
  const scopedSessions = cutoff == null
    ? sessions
    : sessions.filter((session) => session.createdAt >= cutoff)

  if (scopedSessions.length === 0) return undefined

  return {
    total: scopedSessions.length,
    completed: scopedSessions.filter((session) => session.delegationStatus === 'completed').length,
    running: scopedSessions.filter((session) => session.delegationStatus === 'running').length,
    failed: scopedSessions.filter((session) => session.delegationStatus === 'failed').length,
    cancelled: scopedSessions.filter((session) => session.delegationStatus === 'cancelled').length,
    interrupted: scopedSessions.filter((session) => session.delegationStatus === 'interrupted').length,
  }
}

interface AgentStatusPulseLightProps {
  status: SessionIndicatorStatus | undefined
  streamState?: AgentStreamState
  errorMessage?: string | null
  delegationSummary?: AgentDelegationProgressSummary
  className?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

interface AgentStatusTooltipRow {
  label: string
  value: string
}

export interface AgentStatusTooltipModel {
  headline: string
  rows: AgentStatusTooltipRow[]
  ariaLabel: string
}

interface BuildAgentStatusTooltipModelInput {
  status: Exclude<SessionIndicatorStatus, 'idle'>
  streamState?: AgentStreamState
  errorMessage?: string | null
  delegationSummary?: AgentDelegationProgressSummary
  now: number
}

const STATUS_LABEL: Record<Exclude<SessionIndicatorStatus, 'idle'>, string> = {
  running: '执行中',
  blocked: '需要介入',
  completed: '已完成',
  error: '异常',
}

const STATUS_COLOR_CLASS: Record<Exclude<SessionIndicatorStatus, 'idle'>, string> = {
  running: 'text-blue-500',
  blocked: 'text-orange-500',
  completed: 'text-emerald-500',
  error: 'text-red-500',
}

function useTicker(enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!enabled) return undefined
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [enabled])

  return now
}

export function formatAgentStatusDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 1) return `${seconds}秒`
  if (minutes < 60) return `${minutes}分${seconds.toString().padStart(2, '0')}秒`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}小时${remainMinutes}分`
}

function truncateText(value: string, maxLength = 96): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1)}...`
}

function getToolAction(activity: ToolActivity): string {
  return activity.displayName || activity.intent || activity.toolName
}

function getLatestToolActivity(activities: ToolActivity[]): ToolActivity | undefined {
  for (let i = activities.length - 1; i >= 0; i -= 1) {
    const activity = activities[i]
    if (activity && !activity.done) return activity
  }
  return activities[activities.length - 1]
}

function getTaskProgress(items: TaskItem[]): {
  summary: string | null
  current: string | null
} {
  if (items.length === 0) return { summary: null, current: null }

  const completedCount = items.filter((item) => item.status === 'completed').length
  const currentIndex = items.findIndex((item) => item.status === 'in_progress')
  const pendingIndex = items.findIndex((item) => item.status === 'pending')
  const activeIndex = currentIndex >= 0 ? currentIndex : pendingIndex
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null
  const parts = [`已完成 ${completedCount}/${items.length}`]

  if (activeIndex >= 0) parts.push(`当前第 ${activeIndex + 1} 步`)

  return {
    summary: parts.join(' · '),
    current: activeItem ? truncateText(activeItem.activeForm || activeItem.subject, 64) : null,
  }
}

function getDelegationProgress(summary: AgentDelegationProgressSummary | undefined): string | null {
  if (!summary || summary.total <= 0) return null

  const running = summary.running ?? 0
  const failed = summary.failed ?? 0
  const cancelled = summary.cancelled ?? 0
  const interrupted = summary.interrupted ?? 0
  const parts = [`已完成 ${summary.completed}/${summary.total}`]

  if (running > 0) parts.push(`运行中 ${running}`)
  if (failed > 0) parts.push(`失败 ${failed}`)
  if (cancelled > 0) parts.push(`已取消 ${cancelled}`)
  if (interrupted > 0) parts.push(`已中断 ${interrupted}`)

  return parts.join(' · ')
}

function getDelegationCurrent(summary: AgentDelegationProgressSummary | undefined): string | null {
  if (!summary || summary.total <= 0) return null
  const running = summary.running ?? 0
  const failed = summary.failed ?? 0
  const cancelled = summary.cancelled ?? 0
  const interrupted = summary.interrupted ?? 0

  if (running > 0) return '等待子任务结果'
  if (failed > 0 || cancelled > 0 || interrupted > 0) return '检查子任务结果'
  if (summary.completed >= summary.total) return '正在汇总子任务结果'
  return '等待子任务结果'
}

function getToolProgressSummary(activities: ToolActivity[]): string | null {
  if (activities.length === 0) return null

  const completedCount = activities.filter((activity) => activity.done && !activity.isError).length
  const runningCount = activities.filter((activity) => !activity.done).length
  const errorCount = activities.filter((activity) => activity.isError).length
  const parts = [`已完成 ${completedCount}/${activities.length}`]

  if (runningCount > 0) parts.push(`运行中 ${runningCount}`)
  if (errorCount > 0) parts.push(`出错 ${errorCount}`)

  return parts.join(' · ')
}

function getToolProgressRow(activities: ToolActivity[]): string | null {
  const summary = getToolProgressSummary(activities)
  if (!summary) return null

  const latestTool = getLatestToolActivity(activities)
  if (!latestTool) return summary

  return `${truncateText(getToolAction(latestTool), 48)} · ${summary}`
}

function hasActiveDelegationDispatch(activities: ToolActivity[]): boolean {
  return activities.some((activity) => {
    if (activity.done) return false
    const action = `${activity.toolName} ${activity.displayName ?? ''} ${activity.intent ?? ''}`.toLowerCase()
    return action.includes('delegate_agent') || action.includes('delegate_agents')
  })
}

export function buildAgentStatusTooltipModel({
  status,
  streamState,
  errorMessage,
  delegationSummary,
  now,
}: BuildAgentStatusTooltipModelInput): AgentStatusTooltipModel {
  const duration = streamState?.startedAt ? formatAgentStatusDuration(now - streamState.startedAt) : null
  const headline = duration ? `${STATUS_LABEL[status]} · ${duration}` : STATUS_LABEL[status]
  const activities = streamState?.toolActivities ?? []
  const taskItems = aggregateTaskItems(activities, status !== 'running')
  const taskProgress = getTaskProgress(taskItems)
  const delegationCurrent = getDelegationCurrent(delegationSummary)
  const delegationProgress = getDelegationProgress(delegationSummary)
  const toolProgress = getToolProgressRow(activities)
  const delegationDispatching = hasActiveDelegationDispatch(activities)

  let currentAction: string
  if (status === 'error') {
    currentAction = errorMessage ? truncateText(errorMessage) : '需要检查当前会话'
  } else if (status === 'blocked') {
    currentAction = '等待你的操作或确认'
  } else if (status === 'completed') {
    currentAction = '任务已完成'
  } else if (streamState?.isCompacting) {
    currentAction = '正在压缩上下文'
  } else if (streamState?.retrying) {
    currentAction = '网络波动，自动恢复中'
  } else if (delegationDispatching && !delegationCurrent) {
    currentAction = '正在派发子任务'
  } else if (delegationCurrent) {
    currentAction = delegationCurrent
  } else if (taskProgress.current) {
    currentAction = taskProgress.current
  } else if (streamState?.content.trim()) {
    currentAction = '正在生成回复'
  } else if (toolProgress) {
    currentAction = `执行 ${toolProgress}`
  } else {
    currentAction = '正在思考'
  }

  const rows: AgentStatusTooltipRow[] = [
    {
      label: status === 'error' ? '错误' : '当前',
      value: currentAction,
    },
  ]

  if (taskProgress.summary) {
    rows.push({ label: '进度', value: taskProgress.summary })
  }

  if (delegationProgress) {
    rows.push({ label: '子会话', value: delegationProgress })
  }

  if (streamState?.retrying) {
    rows.push({
      label: '重试',
      value: `第 ${streamState.retrying.currentAttempt}/${streamState.retrying.maxAttempts} 次${streamState.retrying.failed ? ' · 已失败' : ''}`,
    })
  }

  return {
    headline,
    rows: rows.slice(0, 4),
    ariaLabel: [headline, ...rows.map((row) => `${row.label}：${row.value}`)].join('，'),
  }
}

export function AgentStatusPulseLight({
  status,
  streamState,
  errorMessage,
  delegationSummary,
  className,
  tooltipSide = 'top',
}: AgentStatusPulseLightProps): React.ReactElement | null {
  const activeStatus = status && status !== 'idle' ? status : null
  const now = useTicker(activeStatus === 'running' && !!streamState?.startedAt)

  if (!activeStatus) return null

  const tooltip = buildAgentStatusTooltipModel({
    status: activeStatus,
    streamState,
    errorMessage,
    delegationSummary,
    now,
  })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'agent-status-pulse-light titlebar-no-drag inline-flex size-3 shrink-0 items-center justify-center rounded-full align-middle',
            STATUS_COLOR_CLASS[activeStatus],
            activeStatus === 'running' && 'agent-status-pulse-light-running',
            className,
          )}
          aria-label={tooltip.ariaLabel}
        >
          <span className="size-2 rounded-full bg-current" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="w-[320px] max-w-[calc(100vw-24px)] space-y-2">
        <div className={cn('flex items-center gap-2 font-medium', STATUS_COLOR_CLASS[activeStatus])}>
          <span className="size-2 rounded-full bg-current shadow-[0_0_6px_currentColor]" aria-hidden="true" />
          <span className="text-tooltip-foreground">{tooltip.headline}</span>
        </div>
        <div className="grid gap-1.5 text-[12px] leading-relaxed">
          {tooltip.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2">
              <span className="text-tooltip-muted">{row.label}</span>
              <span className="min-w-0 break-words text-tooltip-foreground/90">{row.value}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
