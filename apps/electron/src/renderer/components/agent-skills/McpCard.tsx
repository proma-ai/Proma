/**
 * McpCard — Agent 技能视图中的 MCP 服务器卡片（商店风）
 *
 * 整卡可点击打开编辑抽屉；右上角开关独立响应（阻止冒泡）。
 */

import * as React from 'react'
import { Plug, CheckCircle2, XCircle, Trash2, ArrowUpRight, CircleDashed } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { McpServerEntry } from '@proma/shared'

const TRANSPORT_LABELS: Record<string, string> = { stdio: 'stdio', http: 'HTTP', sse: 'SSE' }

interface McpCardProps {
  name: string
  entry: McpServerEntry
  onOpen: () => void
  onToggle?: (enabled: boolean) => void
  onRequestDelete?: () => void
  description?: string
  targetLabel?: string
  statusLabel?: string
  statusTone?: 'success' | 'warning' | 'muted'
  readOnly?: boolean
}

export function McpCard({
  name,
  entry,
  onOpen,
  onToggle,
  onRequestDelete,
  description,
  targetLabel,
  statusLabel,
  statusTone = 'muted',
  readOnly = false,
}: McpCardProps): React.ReactElement {
  const isBuiltin = entry.isBuiltin === true
  const target = targetLabel ?? (entry.type === 'stdio' ? entry.command : entry.url)
  const test = entry.lastTestResult

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group relative flex min-h-[172px] flex-col gap-3 rounded-lg bg-card p-4 text-left shadow-md cursor-pointer',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        !entry.enabled && 'bg-muted/35',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-foreground [text-wrap:balance]">{name}</span>
            <span className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              isBuiltin ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {isBuiltin ? '内置' : (TRANSPORT_LABELS[entry.type] ?? entry.type ?? '未知')}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 min-h-[32px] text-[12px] leading-4 text-muted-foreground">{description || target || '未配置地址'}</div>
        </div>
        {onToggle && (
          <Switch
            checked={entry.enabled}
            onCheckedChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          />
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3">
        {statusLabel && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              statusTone === 'success' && 'bg-primary/12 text-primary',
              statusTone === 'warning' && 'bg-muted text-muted-foreground',
              statusTone === 'muted' && 'bg-muted text-muted-foreground',
            )}
          >
            {statusTone === 'success' ? <CheckCircle2 size={12} /> : <CircleDashed size={12} />}
            {statusLabel}
          </span>
        )}
        {test && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              test.success
                ? 'bg-primary/12 text-primary'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {test.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {test.success ? '连接正常' : '连接失败'}
          </span>
        )}
        {readOnly && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            内置托管
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!isBuiltin && !readOnly && onRequestDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground/50 opacity-0 transition-[color,opacity,background-color] hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">删除</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen() }}
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/65 transition-[transform,background-color,color] hover:bg-accent hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ArrowUpRight size={17} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{readOnly ? '查看详情' : '查看配置'}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
