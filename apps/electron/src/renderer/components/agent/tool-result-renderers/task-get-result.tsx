/**
 * TaskGet 工具结果渲染器 — 任务详情摘要
 *
 * TaskGet 是只读查询，结果应更像“任务详情”而不是原始日志。
 */

import * as React from 'react'
import { CheckCircle2, Circle, Clock3, FileText, Layers3, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DefaultResultRenderer } from './default-result'

interface TaskGetResultRendererProps {
  result: string
  isError: boolean
}

export interface ParsedTaskGetResult {
  id?: string
  subject?: string
  status?: string
  description?: string
  blocks: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function normalizeBlockId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

function parseBlocks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeBlockId(String(item)))
      .filter(Boolean)
  }
  if (typeof value === 'number') return [`#${value}`]
  if (typeof value !== 'string') return []

  if (/^(?:none|null|undefined|n\/a|无|暂无)$/i.test(value.trim())) return []

  const matches = value.match(/#[A-Za-z0-9._-]+|[A-Za-z0-9._-]+/g)
  return matches
    ? matches.map(normalizeBlockId).filter(Boolean)
    : []
}

function parseJsonTask(text: string): ParsedTaskGetResult | null {
  try {
    const parsed = JSON.parse(text)
    if (!isRecord(parsed)) return null

    const task = isRecord(parsed.task) ? parsed.task : parsed
    return {
      id: stringValue(task.id ?? task.taskId),
      subject: stringValue(task.subject ?? task.title ?? task.name),
      status: stringValue(task.status),
      description: stringValue(task.description),
      blocks: parseBlocks(task.blocks ?? task.blockIds ?? task.block_ids),
    }
  } catch {
    return null
  }
}

function parseTextTask(text: string): ParsedTaskGetResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  const result: ParsedTaskGetResult = { blocks: [] }
  for (const line of lines) {
    const taskMatch = /^Task\s*#?([^:\s]+)\s*:?\s*(.*)$/i.exec(line)
    if (taskMatch) {
      result.id = taskMatch[1]
      if (taskMatch[2]) result.subject = taskMatch[2]
      continue
    }

    const fieldMatch = /^([A-Za-z][A-Za-z\s_-]*):\s*(.*)$/.exec(line)
    if (!fieldMatch) continue

    const key = fieldMatch[1]?.trim().toLowerCase()
    const value = fieldMatch[2]?.trim() ?? ''
    if (key === 'status') {
      result.status = value
    } else if (key === 'description') {
      result.description = value
    } else if (key === 'blocks') {
      result.blocks = parseBlocks(value)
    }
  }

  return result.id || result.subject || result.status || result.description || result.blocks.length > 0
    ? result
    : null
}

export function parseTaskGetResult(text: string): ParsedTaskGetResult | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseJsonTask(trimmed) ?? parseTextTask(trimmed)
}

export function getTaskGetStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'in_progress':
      return '进行中'
    case 'completed':
      return '已完成'
    case 'blocked':
      return '已阻塞'
    case 'deleted':
      return '已删除'
    case 'cancelled':
      return '已取消'
    case 'error':
      return '出错'
    case 'pending':
      return '待处理'
    default:
      return status || '未知状态'
  }
}

function statusMeta(status: string | undefined): {
  label: string
  className: string
  icon: React.ComponentType<{ className?: string }>
} {
  switch (status) {
    case 'in_progress':
      return {
        label: getTaskGetStatusLabel(status),
        className: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400',
        icon: Clock3,
      }
    case 'completed':
      return {
        label: getTaskGetStatusLabel(status),
        className: 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400',
        icon: CheckCircle2,
      }
    case 'blocked':
      return {
        label: getTaskGetStatusLabel(status),
        className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        icon: Circle,
      }
    case 'cancelled':
    case 'error':
    case 'deleted':
      return {
        label: getTaskGetStatusLabel(status),
        className: 'border-destructive/20 bg-destructive/10 text-destructive',
        icon: XCircle,
      }
    case 'pending':
      return {
        label: getTaskGetStatusLabel(status),
        className: 'border-border/50 bg-muted/50 text-muted-foreground',
        icon: Circle,
      }
    default:
      return {
        label: getTaskGetStatusLabel(status),
        className: 'border-border/50 bg-muted/50 text-muted-foreground',
        icon: Circle,
      }
  }
}

export function TaskGetResultRenderer({ result, isError }: TaskGetResultRendererProps): React.ReactElement {
  const task = React.useMemo(() => parseTaskGetResult(result), [result])

  if (isError) return <DefaultResultRenderer result={result} isError />
  if (!task) return <DefaultResultRenderer result={result} isError={false} />

  const meta = statusMeta(task.status)
  const StatusIcon = meta.icon

  return (
    <section className="rounded-md border border-border/40 bg-muted/20 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 min-w-0">
            {task.id && (
              <span className="shrink-0 rounded-sm border border-border/50 bg-background/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                #{task.id}
              </span>
            )}
            <h4 className="truncate text-[13px] font-medium text-foreground/90">
              {task.subject || '任务详情'}
            </h4>
          </div>
          {task.description && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          )}
        </div>

        <span className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
          meta.className,
        )}>
          <StatusIcon className="size-3" />
          {meta.label}
        </span>
      </div>

      {task.blocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/30 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <Layers3 className="size-3" />
            关联块
          </span>
          {task.blocks.map((blockId) => (
            <span
              key={blockId}
              className="rounded-sm bg-background/50 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground"
            >
              {blockId}
            </span>
          ))}
        </div>
      )}

      {!task.description && task.blocks.length === 0 && (
        <div className="flex items-center gap-1.5 border-t border-border/30 px-3 py-2 text-[11px] text-muted-foreground/60">
          <FileText className="size-3" />
          没有更多任务详情
        </div>
      )}
    </section>
  )
}
