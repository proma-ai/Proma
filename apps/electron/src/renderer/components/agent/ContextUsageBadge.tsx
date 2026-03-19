/**
 * ContextUsageBadge — 上下文使用量徽章
 *
 * 常驻显示在输入框工具栏，展示当前 Agent 会话的 token 使用量和压缩状态：
 * - 有数据时显示 "Xk / Yk" token 计数（Y = contextWindow × 0.775 压缩阈值）
 * - 无数据时不显示（首次请求前无 usage 数据）
 * - 压缩中时显示 Loader2 旋转图标
 * - 使用量 ≥ 80% 阈值时显示琥珀色警告
 * - 压缩按钮始终可见（有 token 数据后），非警告状态时仅图标展示
 */

import * as React from 'react'
import { Loader2, Minimize2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** 压缩阈值比例（SDK 在 ~77.5% 窗口大小时自动压缩） */
const COMPACT_THRESHOLD_RATIO = 0.775
/** 显示警告的阈值（阈值的 80%） */
const WARNING_RATIO = 0.80

interface ContextUsageBadgeProps {
  inputTokens?: number
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

export function ContextUsageBadge({
  inputTokens,
  contextWindow,
  isCompacting,
  isProcessing,
  onCompact,
}: ContextUsageBadgeProps): React.ReactElement | null {
  // 压缩中 → 始终显示 spinner
  if (isCompacting) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>压缩中...</span>
      </div>
    )
  }

  // 无 usage 数据 → 不显示（首次请求前无 token 信息）
  if (!inputTokens || inputTokens <= 0) return null

  const compactThreshold = contextWindow
    ? Math.floor(contextWindow * COMPACT_THRESHOLD_RATIO)
    : undefined

  const usageRatio = compactThreshold
    ? inputTokens / compactThreshold
    : undefined

  const isWarning = usageRatio !== undefined && usageRatio >= WARNING_RATIO

  const displayText = compactThreshold
    ? `${formatTokens(inputTokens)} / ${formatTokens(compactThreshold)}`
    : formatTokens(inputTokens)

  const tooltipText = contextWindow
    ? `上下文: ${inputTokens.toLocaleString()} / ${compactThreshold!.toLocaleString()} tokens (窗口 ${contextWindow.toLocaleString()})${isWarning ? '\n点击手动压缩' : ''}`
    : `上下文: ${inputTokens.toLocaleString()} tokens`

  const percentText = usageRatio !== undefined
    ? `${Math.round(usageRatio * 100)}%`
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
            {isWarning && percentText && (
              <span className="font-medium">{percentText}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="whitespace-pre-line">{tooltipText}</p>
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
