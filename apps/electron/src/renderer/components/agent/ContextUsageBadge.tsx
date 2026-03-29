/**
 * ContextUsageBadge — 上下文使用量徽章
 *
 * 常驻显示在输入框工具栏，展示当前 Agent 会话的上下文占用情况：
 * - 有数据时显示 "Xk / Yk"（已用 / 总窗口大小）
 * - 无数据时不显示（首次请求前无 usage 数据）
 * - 压缩中时显示 Loader2 旋转图标
 * - 使用量接近压缩阈值（窗口 × 0.775 × 80%）时显示琥珀色警告
 * - hover tooltip 显示 token 用量明细
 */

import * as React from 'react'
import { Loader2, Minimize2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** 压缩阈值比例（SDK 在 ~77.5% 窗口大小时自动压缩） */
const COMPACT_THRESHOLD_RATIO = 0.775
/** 显示警告的阈值（压缩阈值的 80%） */
const WARNING_RATIO = 0.80

interface ContextUsageBadgeProps {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
  isCompacting: boolean
  isProcessing: boolean
  onCompact: () => void
}

/** 格式化 token 数为可读字符串（如 1234 → "1.2k"） */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`
  }
  return `${tokens}`
}

/** 构建多行 tooltip 文本 */
function buildTooltipLines(props: {
  inputTokens: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  contextWindow?: number
  isWarning: boolean
}): string {
  const lines: string[] = []

  // 纯输入 = 总上下文 - 缓存读取 - 缓存写入
  const pureInput = props.inputTokens - (props.cacheReadTokens ?? 0) - (props.cacheCreationTokens ?? 0)

  if (pureInput > 0) lines.push(`输入: ${pureInput.toLocaleString()}`)
  if (props.outputTokens) lines.push(`输出: ${props.outputTokens.toLocaleString()}`)
  if (props.cacheCreationTokens) lines.push(`缓存写入: ${props.cacheCreationTokens.toLocaleString()}`)
  if (props.cacheReadTokens) lines.push(`缓存读取: ${props.cacheReadTokens.toLocaleString()}`)

  if (props.contextWindow) {
    lines.push(`上下文窗口: ${props.contextWindow.toLocaleString()}`)
  }

  if (props.isWarning) {
    lines.push('点击手动压缩')
  }

  return lines.join('\n')
}

export function ContextUsageBadge({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  contextWindow,
  isCompacting,
  isProcessing,
  onCompact,
}: ContextUsageBadgeProps): React.ReactElement | null {
  // 保留最近一次有效的 token 值，避免切换会话时闪烁消失
  const stableRef = React.useRef<{
    inputTokens: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    contextWindow?: number
  } | null>(null)
  if (inputTokens && inputTokens > 0) {
    stableRef.current = { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, contextWindow }
  }

  // 压缩中 → 始终显示 spinner
  if (isCompacting) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>压缩中...</span>
      </div>
    )
  }

  // 使用稳定值：优先当前数据，回退到上次有效数据
  const stable = stableRef.current
  const hasCurrent = inputTokens != null && inputTokens > 0
  const displayTokens = hasCurrent ? inputTokens : stable?.inputTokens
  const displayWindow = hasCurrent ? contextWindow : stable?.contextWindow
  const displayOutput = hasCurrent ? outputTokens : stable?.outputTokens
  const displayCacheRead = hasCurrent ? cacheReadTokens : stable?.cacheReadTokens
  const displayCacheCreation = hasCurrent ? cacheCreationTokens : stable?.cacheCreationTokens

  // 从未有过 usage 数据 → 不显示
  if (!displayTokens || displayTokens <= 0) return null

  // 警告阈值：基于压缩阈值（contextWindow × 0.775 × 80%）
  const compactThreshold = displayWindow
    ? Math.floor(displayWindow * COMPACT_THRESHOLD_RATIO)
    : undefined
  const isWarning = compactThreshold
    ? displayTokens / compactThreshold >= WARNING_RATIO
    : false

  // 显示文本：已用 / 总窗口
  const displayText = displayWindow
    ? `${formatTokens(displayTokens)} / ${formatTokens(displayWindow)}`
    : formatTokens(displayTokens)

  const tooltipText = buildTooltipLines({
    inputTokens: displayTokens,
    outputTokens: displayOutput,
    cacheReadTokens: displayCacheRead,
    cacheCreationTokens: displayCacheCreation,
    contextWindow: displayWindow,
    isWarning,
  })

  // 占用百分比（相对完整窗口）
  const percentText = displayWindow
    ? `${Math.round((displayTokens / displayWindow) * 100)}%`
    : undefined

  // 压缩按钮的 tooltip 文案
  const compactTooltip = isProcessing
    ? '对话进行中，无法压缩'
    : '手动压缩上下文'

  return (
    <div className="flex items-center gap-0.5">
      {/* 上下文用量显示 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-colors',
              isWarning
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
            )}
          >
            <span>{displayText}</span>
            {percentText && (
              <span className={cn('tabular-nums', isWarning && 'font-medium')}>{percentText}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="whitespace-pre-line text-left">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>

      {/* 压缩按钮 — 始终可见 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center justify-center size-[22px] rounded transition-colors',
              isProcessing
                ? 'text-muted-foreground/40 cursor-not-allowed'
                : isWarning
                  ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer'
                  : 'text-muted-foreground hover:bg-muted cursor-pointer',
            )}
            onClick={!isProcessing ? onCompact : undefined}
            disabled={isProcessing}
          >
            <Minimize2 className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{compactTooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
