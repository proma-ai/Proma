/**
 * TaskList 工具结果渲染器 — 任务状态列表
 */

import * as React from 'react'
import { CheckCircle2, Circle, Clock3, ListTodo, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DefaultResultRenderer } from './default-result'

interface TaskListResultRendererProps {
  result: string
  isError: boolean
}

export interface ParsedTaskListItem {
  id: string
  subject: string
  status: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function parseJsonTaskList(text: string): ParsedTaskListItem[] | null {
  try {
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.tasks)
        ? parsed.tasks
        : null
    if (!list) return null

    const items = list
      .filter(isRecord)
      .map((item) => {
        const id = stringValue(item.id ?? item.taskId ?? item.task_id)
        const subject = stringValue(item.subject ?? item.title ?? item.name ?? item.description)
        const status = stringValue(item.status) ?? 'pending'
        return id && subject ? { id, subject, status } : null
      })
      .filter((item): item is ParsedTaskListItem => item !== null)

    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

function parseTextTaskList(text: string): ParsedTaskListItem[] | null {
  const items: ParsedTaskListItem[] = []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  for (const line of lines) {
    const match = /^#?([A-Za-z0-9._-]+)\s+\[([A-Za-z0-9_-]+)\]\s+(.+)$/.exec(line)
    if (!match) continue

    items.push({
      id: match[1]!,
      status: match[2]!,
      subject: match[3]!,
    })
  }

  return items.length > 0 ? items : null
}

export function parseTaskListResult(text: string): ParsedTaskListItem[] | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseJsonTaskList(trimmed) ?? parseTextTaskList(trimmed)
}

function statusMeta(status: string): {
  label: string
  className: string
  icon: React.ComponentType<{ className?: string }>
} {
  switch (status) {
    case 'in_progress':
      return {
        label: '进行中',
        className: 'text-blue-600 dark:text-blue-400',
        icon: Clock3,
      }
    case 'completed':
      return {
        label: '已完成',
        className: 'text-green-600 dark:text-green-400',
        icon: CheckCircle2,
      }
    case 'blocked':
      return {
        label: '已阻塞',
        className: 'text-amber-700 dark:text-amber-400',
        icon: Circle,
      }
    case 'cancelled':
    case 'error':
    case 'deleted':
      return {
        label: status === 'deleted' ? '已删除' : status === 'cancelled' ? '已取消' : '出错',
        className: 'text-destructive',
        icon: XCircle,
      }
    case 'pending':
      return {
        label: '待处理',
        className: 'text-muted-foreground',
        icon: Circle,
      }
    default:
      return {
        label: status,
        className: 'text-muted-foreground',
        icon: Circle,
      }
  }
}

export function TaskListResultRenderer({ result, isError }: TaskListResultRendererProps): React.ReactElement {
  const tasks = React.useMemo(() => parseTaskListResult(result), [result])

  if (isError) return <DefaultResultRenderer result={result} isError />
  if (!tasks) return <DefaultResultRenderer result={result} isError={false} />

  const completedCount = tasks.filter((task) => task.status === 'completed').length

  return (
    <section className="rounded-md border border-border/40 bg-muted/20 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
        <ListTodo className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/75">任务状态</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">
          {completedCount}/{tasks.length}
        </span>
      </div>

      <div className="divide-y divide-border/20">
        {tasks.map((task) => {
          const meta = statusMeta(task.status)
          const StatusIcon = meta.icon

          return (
            <div key={task.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2">
              <span className="rounded-sm border border-border/50 bg-background/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                #{task.id}
              </span>
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full bg-background/45 px-2 py-0.5 text-[11px] font-medium',
                meta.className,
              )}>
                <StatusIcon className={cn('size-3', task.status === 'in_progress' && 'animate-pulse')} />
                {meta.label}
              </span>
              <span className={cn(
                'truncate text-[13px]',
                task.status === 'completed'
                  ? 'text-muted-foreground/65 line-through'
                  : 'text-foreground/85',
              )}>
                {task.subject}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
