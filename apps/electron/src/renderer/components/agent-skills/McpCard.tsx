/**
 * McpCard — Agent 技能视图中的 MCP 服务器卡片（商店风）
 *
 * 整卡可点击打开编辑抽屉；右上角开关独立响应（阻止冒泡）。
 */

import * as React from 'react'
import { Plug, ShieldCheck, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
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
        'group relative flex h-full flex-col gap-3 rounded-xl border border-border/60 bg-content-area p-4 text-left transition-all cursor-pointer',
        'hover:border-border hover:shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        !entry.enabled && 'opacity-55',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-500/12 p-2 text-blue-500 shadow-sm shrink-0">
          <Plug size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {TRANSPORT_LABELS[entry.type] ?? entry.type ?? '未知'}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{description || target || '未配置地址'}</div>
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

      <div className="mt-auto flex items-center gap-2">
        {isBuiltin && (
          <span className="flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
            <ShieldCheck size={12} /> 内置
          </span>
        )}
        {statusLabel && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              statusTone === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              statusTone === 'warning' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
              statusTone === 'muted' && 'bg-muted text-muted-foreground',
            )}
          >
            {statusTone === 'success' && <CheckCircle2 size={12} />}
            {statusTone !== 'success' && <XCircle size={12} />}
            {statusLabel}
          </span>
        )}
        {test && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
              test.success
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            {test.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {test.success ? '连接正常' : '连接失败'}
          </span>
        )}
        {readOnly && (
          <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            内置托管
          </span>
        )}
        {!isBuiltin && !readOnly && onRequestDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
                className="ml-auto rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">删除</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
