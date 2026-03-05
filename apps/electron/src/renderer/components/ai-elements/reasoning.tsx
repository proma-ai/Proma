/**
 * AI Elements - 推理/思考折叠组件
 *
 * 简化迁移自 proma-frontend 的 ai-elements/reasoning.tsx。
 *
 * 特性：
 * - Collapsible 包装，streaming 时自动展开
 * - 流式结束后 1s 自动折叠
 * - duration 计时（思考了 N 秒）
 * - Brain 图标 + 状态文案
 * - 使用 CSS animate-pulse 替代 Shimmer/framer-motion
 */

import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Brain, ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

// ===== 上下文 =====

interface ReasoningContextValue {
  /** 是否正在流式输出推理内容 */
  isStreaming: boolean
  /** 折叠面板是否打开 */
  isOpen: boolean
  /** 设置折叠状态 */
  setIsOpen: (open: boolean) => void
  /** 思考持续时间（秒） */
  duration: number | undefined
}

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null)

/** 获取推理组件上下文 */
function useReasoning(): ReasoningContextValue {
  const context = React.useContext(ReasoningContext)
  if (!context) {
    throw new Error('Reasoning 子组件必须在 <Reasoning> 内使用')
  }
  return context
}

// ===== 常量 =====

/** 流式结束后自动折叠延迟（毫秒） */
const AUTO_CLOSE_DELAY = 1000
/** 毫秒转秒 */
const MS_IN_S = 1000

// ===== Reasoning 根组件 =====

interface ReasoningProps extends ComponentProps<typeof Collapsible> {
  /** 是否正在流式输出 */
  isStreaming?: boolean
  /** 受控展开状态 */
  open?: boolean
  /** 默认展开状态 */
  defaultOpen?: boolean
  /** 展开状态变化回调 */
  onOpenChange?: (open: boolean) => void
  /** 外部传入的持续时间 */
  duration?: number
}

export const Reasoning = React.memo(function Reasoning({
  className,
  isStreaming = false,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  duration: durationProp,
  children,
  ...props
}: ReasoningProps): React.ReactElement {
  // 内部 isOpen 状态（支持受控/非受控模式）
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const isOpen = openProp !== undefined ? openProp : internalOpen

  const setIsOpen = React.useCallback(
    (newOpen: boolean) => {
      setInternalOpen(newOpen)
      onOpenChange?.(newOpen)
    },
    [onOpenChange]
  )

  // 持续时间追踪
  const [duration, setDuration] = React.useState<number | undefined>(durationProp)
  const [hasAutoClosed, setHasAutoClosed] = React.useState(false)
  const [startTime, setStartTime] = React.useState<number | null>(null)

  // 追踪流式开始/结束时间，计算 duration
  React.useEffect(() => {
    if (isStreaming) {
      if (startTime === null) {
        setStartTime(Date.now())
      }
    } else if (startTime !== null) {
      setDuration(Math.ceil((Date.now() - startTime) / MS_IN_S))
      setStartTime(null)
    }
  }, [isStreaming, startTime])

  // 流式结束后自动折叠（仅一次）
  React.useEffect(() => {
    if (defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
      const timer = setTimeout(() => {
        setIsOpen(false)
        setHasAutoClosed(true)
      }, AUTO_CLOSE_DELAY)

      return () => clearTimeout(timer)
    }
  }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed])

  // 同步外部 duration prop
  React.useEffect(() => {
    if (durationProp !== undefined) {
      setDuration(durationProp)
    }
  }, [durationProp])

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen, setIsOpen, duration }}>
      <Collapsible
        className={cn('not-prose mb-4', className)}
        onOpenChange={setIsOpen}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  )
})

// ===== ReasoningTrigger 触发按钮 =====

interface ReasoningTriggerProps extends ComponentProps<typeof CollapsibleTrigger> {
  /** 自定义思考状态文案 */
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

/** 默认思考状态文案生成 */
function defaultGetThinkingMessage(isStreaming: boolean, duration?: number): ReactNode {
  if (isStreaming || duration === 0) {
    return <span className="animate-pulse">思考中...</span>
  }
  if (duration === undefined) {
    return <p>思考了几秒</p>
  }
  return <p>思考了 {duration} 秒</p>
}

export const ReasoningTrigger = React.memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultGetThinkingMessage,
  ...props
}: ReasoningTriggerProps): React.ReactElement {
  const { isStreaming, isOpen, duration } = useReasoning()

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <Brain className="size-4" />
          {getThinkingMessage(isStreaming, duration)}
          <ChevronDown
            className={cn(
              'size-4 transition-transform',
              isOpen ? 'rotate-180' : 'rotate-0'
            )}
          />
        </>
      )}
    </CollapsibleTrigger>
  )
})

// ===== ReasoningContent 折叠内容区 =====

interface ReasoningContentProps extends ComponentProps<typeof CollapsibleContent> {
  /** 推理文本内容（Markdown） */
  children: string
}

export const ReasoningContent = React.memo(
  function ReasoningContent({ className, children, ...props }: ReasoningContentProps): React.ReactElement {
    return (
      <CollapsibleContent
        className={cn(
          'mt-4 text-sm',
          'text-muted-foreground outline-none',
          'data-[state=closed]:animate-out data-[state=open]:animate-in',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2',
          className
        )}
        {...props}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              a: ({ href, children: linkChildren, ...linkProps }) => (
                <a
                  {...linkProps}
                  href={href}
                  onClick={(e) => {
                    e.preventDefault()
                    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                      window.electronAPI.openExternal(href)
                    }
                  }}
                  title={href}
                >
                  {linkChildren}
                </a>
              ),
            }}
          >
            {children}
          </Markdown>
        </div>
      </CollapsibleContent>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)
