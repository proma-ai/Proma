/**
 * ChatToolBlock — Chat 模式工具调用块
 *
 * 视觉效果与 Agent 模式 ContentBlock 中的 ToolUseBlock 保持一致：
 * - 语义化短语行（如 "读取 foo.ts 第 10-60 行"）
 * - 工具专属图标
 * - 点击展开看结构化结果（ToolResultRenderer）
 * - 流式进行中显示 spinner + "正在xxx..."
 *
 * 不依赖 SDKContentBlock 类型，直接接受扁平化 props。
 */

import * as React from 'react'
import { ChevronRight, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolIcon } from '@/components/agent/tool-utils'
import { getToolPhrase } from '@/components/agent/tool-phrase'
import { ToolResultRenderer } from '@/components/agent/tool-result-renderers'

export interface ChatToolBlockProps {
  toolName: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  isCompleted: boolean
  animate?: boolean
  index?: number
}

export function ChatToolBlock({
  toolName,
  input,
  result,
  isError = false,
  isCompleted,
  animate = false,
  index = 0,
}: ChatToolBlockProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)

  const phrase = getToolPhrase(toolName, input)
  const ToolIcon = getToolIcon(toolName)
  const displayLabel = isCompleted ? phrase.label : phrase.loadingLabel

  const delay = animate && index < 10 ? `${index * 30}ms` : '0ms'

  return (
    <div
      className={cn(
        animate && 'animate-in fade-in slide-in-from-left-1 duration-150 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <button
        type="button"
        className="flex items-center gap-2 py-0.5 text-left hover:opacity-70 transition-opacity group"
        onClick={() => setExpanded(!expanded)}
      >
        {!isCompleted ? (
          <Loader2 className="size-3.5 animate-spin text-primary/50 shrink-0" />
        ) : isError ? (
          <XCircle className="size-3.5 text-destructive/70 shrink-0" />
        ) : null}

        <ToolIcon className={cn('size-3.5 shrink-0 text-muted-foreground')} />

        <span className={cn('truncate text-[14px] text-muted-foreground')}>
          {displayLabel}
        </span>

        <ChevronRight
          className={cn(
            'shrink-0 size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-all duration-150',
            expanded && 'rotate-90 opacity-100',
          )}
        />
      </button>

      {expanded && result && (
        <div className="ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30 animate-in fade-in slide-in-from-top-1 duration-150">
          <ToolResultRenderer
            toolName={toolName}
            input={input}
            result={result}
            isError={isError}
          />
        </div>
      )}
    </div>
  )
}
