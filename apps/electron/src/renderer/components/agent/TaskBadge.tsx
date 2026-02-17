/**
 * TaskBadge — 单个后台任务徽章
 *
 * 显示任务类型、ID、耗时和 Spinner。
 * 点击后滚动到对应的 ToolActivityItem。
 */

import * as React from 'react'
import { Loader2, Terminal, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BackgroundTask } from '@/atoms/agent-atoms'

export interface TaskBadgeProps {
  task: BackgroundTask
  onClick: () => void
}

/**
 * 格式化耗时（紧凑格式）
 *
 * @example
 * formatElapsed(30) → "30s"
 * formatElapsed(90) → "1m 30s"
 * formatElapsed(3660) → "1h 1m"
 */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

/**
 * 缩短 ID（显示前 8 位）
 *
 * @example
 * shortenId("abc123def456") → "abc123de..."
 * shortenId("short") → "short"
 */
function shortenId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id
}

/**
 * TaskBadge 组件
 *
 * 显示运行中的后台任务，点击后滚动到对应的 ToolActivityItem。
 */
export function TaskBadge({ task, onClick }: TaskBadgeProps): React.ReactElement {
  // 本地计时器（Shell 任务），Agent 任务使用事件驱动的 elapsedSeconds
  const [localElapsed, setLocalElapsed] = React.useState(() =>
    Math.floor((Date.now() - task.startTime) / 1000)
  )

  React.useEffect(() => {
    // 仅 Shell 任务使用本地计时器
    if (task.type !== 'shell') return

    const interval = setInterval(() => {
      setLocalElapsed(Math.floor((Date.now() - task.startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [task.type, task.startTime])

  const displayElapsed = task.type === 'shell' ? localElapsed : task.elapsedSeconds
  const Icon = task.type === 'shell' ? Terminal : GitBranch

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-[30px] px-3 py-1.5 rounded-[8px]',
        'flex items-center gap-2 shrink-0',
        'bg-background/70 backdrop-blur-sm',
        'border-[0.5px] border-border',
        'hover:bg-accent hover:border-accent-foreground/20',
        'transition-all duration-200',
        'text-xs font-medium',
        'cursor-pointer select-none'
      )}
      title={task.intent || `${task.type} 任务`}
    >
      {/* Spinner */}
      <Loader2 className="size-3 animate-spin text-primary" />

      {/* 类型图标 */}
      <Icon className="size-3 text-muted-foreground" />

      {/* 类型标签 */}
      <span className="text-muted-foreground">
        {task.type === 'shell' ? 'Shell' : 'Task'}
      </span>

      {/* 任务 ID（缩短） */}
      <span className="font-mono opacity-80">{shortenId(task.id)}</span>

      {/* 耗时 */}
      <span className="tabular-nums text-muted-foreground">
        {formatElapsed(displayElapsed)}
      </span>
    </button>
  )
}
