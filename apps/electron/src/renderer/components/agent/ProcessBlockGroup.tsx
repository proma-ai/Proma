import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName, getToolIcon } from './tool-utils'
import type {
  SDKContentBlock,
  SDKMessage,
  SDKToolResultBlock,
  SDKToolUseBlock,
  SDKUserMessage,
} from '@proma/shared'

interface ProcessBlockGroupProps {
  blocks: SDKContentBlock[]
  isStreaming?: boolean
  /** 惰性生成过程项；流式与历史态均渲染完整内容。 */
  renderChildren: () => React.ReactNode
  // 该过程组是否为整条消息的末尾项：是则流式中保留最后一段为正常显示，
  // 否则（最终答案已作为后续兄弟块外置）整组统一弱化。
  isMessageTail?: boolean
}

const MAX_PROCESS_GROUP_ICONS = 4
const PROCESS_GROUP_VIEWPORT_HEIGHT = 320
const PROCESS_GROUP_COLLAPSE_DURATION_MS = 500
const PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS = 900
const PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS = 3

interface IndexedContentBlock {
  block: SDKContentBlock
  index: number
}

export type AssistantTurnRenderItem =
  | { type: 'block'; item: IndexedContentBlock }
  | {
      type: 'process-group'
      items: IndexedContentBlock[]
    }

interface BuildAssistantTurnRenderItemsOptions {
  isStreaming?: boolean
  completedToolResultIds?: Set<string>
}

export function buildCompletedToolResultIds(turnMessages: SDKMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const msg of turnMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const blocks = userMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue
      const rb = b as SDKToolResultBlock
      ids.add(rb.tool_use_id)
    }
  }
  return ids
}

function getTrailingTextStartIndex(blocks: SDKContentBlock[]): number | null {
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock?.type !== 'text') return null

  let finalStartIndex = blocks.length - 1
  while (finalStartIndex > 0 && blocks[finalStartIndex - 1]?.type === 'text') {
    finalStartIndex -= 1
  }
  return finalStartIndex
}

function areToolsBeforeIndexCompleted(
  blocks: SDKContentBlock[],
  endIndex: number,
  completedToolResultIds: Set<string> | undefined,
): boolean {
  if (!completedToolResultIds) return false

  let hasToolUse = false
  for (let index = 0; index < endIndex; index++) {
    const block = blocks[index]
    if (block?.type !== 'tool_use') continue
    hasToolUse = true
    const toolBlock = block as SDKToolUseBlock
    if (!completedToolResultIds.has(toolBlock.id)) return false
  }

  // 没有 tool_use 时不认为"工具已完成"——避免流式中只有 thinking + 尾部 text
  // 时把还可能变成中间过程的 text 提前外置。
  return hasToolUse
}

export function buildAssistantTurnRenderItems(
  blocks: SDKContentBlock[],
  options: BuildAssistantTurnRenderItemsOptions = {},
): AssistantTurnRenderItem[] {
  if (blocks.length === 0) return []

  // 流式阶段最后的 text 还不稳定，后续工具调用可能会把它变成中间过程。
  // 只有当前面所有工具都有结果时，才把尾部 text 视作交付输出提前外置，降低完成瞬间的跳动。
  const hasProcessBlock = blocks.some((block) => block.type === 'tool_use' || block.type === 'thinking')
  const trailingTextStartIndex = getTrailingTextStartIndex(blocks)
  const canSplitStreamingFinalOutput = options.isStreaming
    && hasProcessBlock
    && trailingTextStartIndex !== null
    && trailingTextStartIndex > 0
    && areToolsBeforeIndexCompleted(blocks, trailingTextStartIndex, options.completedToolResultIds)

  if (options.isStreaming && hasProcessBlock && !canSplitStreamingFinalOutput) {
    return buildProcessGroupItems(blocks)
  }

  if (trailingTextStartIndex === null) {
    return buildProcessGroupItems(blocks)
  }

  const items: AssistantTurnRenderItem[] = []
  if (trailingTextStartIndex > 0) {
    items.push(...buildProcessGroupItems(
      blocks.slice(0, trailingTextStartIndex),
    ))
  }

  for (let index = trailingTextStartIndex; index < blocks.length; index++) {
    const block = blocks[index]
    if (!block) continue
    items.push({ type: 'block', item: { block, index } })
  }

  return items
}

function buildProcessGroupItems(blocks: SDKContentBlock[]): AssistantTurnRenderItem[] {
  return [{
    type: 'process-group',
    items: blocks.map((block, index) => ({ block, index })),
  }]
}

function buildProcessGroupSummary(blocks: SDKContentBlock[]): string {
  let toolCount = 0
  let messageCount = 0

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      toolCount += 1
    } else if (block.type === 'thinking' || block.type === 'text') {
      messageCount += 1
    }
  }

  const parts: string[] = []
  if (toolCount > 0) parts.push(`${toolCount} 次工具调用`)
  if (messageCount > 0) parts.push(`${messageCount} 条消息`)
  const summary = parts.join('，') || '过程'
  return `执行过程：${summary}`
}

export function buildProcessGroupToolNames(blocks: SDKContentBlock[]): string[] {
  const toolNames: string[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    const toolBlock = block as SDKToolUseBlock
    if (seen.has(toolBlock.name)) continue
    seen.add(toolBlock.name)
    toolNames.push(toolBlock.name)
  }

  return toolNames
}

type ProcessGroupDisplayMode = 'collapsed' | 'expanded'

function getProcessChildKey(child: React.ReactNode, index: number): string {
  if (React.isValidElement(child) && child.key != null) return String(child.key)
  return `process-child-${index}`
}

export function ProcessBlockGroup({ blocks, isStreaming, renderChildren, isMessageTail = false }: ProcessBlockGroupProps): React.ReactElement {
  const initialDisplayMode: ProcessGroupDisplayMode = !isStreaming
    ? 'collapsed'
    : 'expanded'
  const [displayMode, setDisplayMode] = React.useState<ProcessGroupDisplayMode>(initialDisplayMode)
  const [shouldRenderContent, setShouldRenderContent] = React.useState(initialDisplayMode !== 'collapsed')
  const [keepProgressViewport, setKeepProgressViewport] = React.useState(!!isStreaming)
  const [collapseCountdown, setCollapseCountdown] = React.useState<number | null>(null)
  const userToggledRef = React.useRef(false)
  const followLatestRef = React.useRef(true)
  const smoothScrollTargetRef = React.useRef<number | null>(null)
  const scrollFrameRef = React.useRef<number | null>(null)
  const wasStreamingRef = React.useRef(!!isStreaming)
  const autoCollapseTimersRef = React.useRef<number[]>([])
  const contentRef = React.useRef<HTMLDivElement>(null)
  const contentInnerRef = React.useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = React.useState<number | undefined>(undefined)

  const isContentExpanded = displayMode === 'expanded'
  const shouldShowContent = isContentExpanded || shouldRenderContent
  const visibleChildren = shouldShowContent ? renderChildren() : null

  const clearAutoCollapseTimers = React.useCallback(() => {
    for (const timer of autoCollapseTimersRef.current) window.clearTimeout(timer)
    autoCollapseTimersRef.current = []
  }, [])

  React.useEffect(() => {
    clearAutoCollapseTimers()

    if (isStreaming) {
      setCollapseCountdown(null)
      setKeepProgressViewport(true)
      if (!wasStreamingRef.current) {
        userToggledRef.current = false
        followLatestRef.current = true
        smoothScrollTargetRef.current = null
        if (scrollFrameRef.current !== null) {
          cancelAnimationFrame(scrollFrameRef.current)
          scrollFrameRef.current = null
        }
      }
      if (!userToggledRef.current) setDisplayMode('expanded')
      wasStreamingRef.current = true
      return
    }

    const shouldAutoCollapseAfterCompletion = wasStreamingRef.current && !userToggledRef.current
    wasStreamingRef.current = false

    if (!shouldAutoCollapseAfterCompletion) {
      setKeepProgressViewport(false)
      if (!userToggledRef.current) setDisplayMode('collapsed')
      return
    }

    const soundDelayTimer = window.setTimeout(() => {
      setCollapseCountdown(PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS)

      for (let second = PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS - 1; second >= 1; second--) {
        const elapsed = (PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS - second) * 1000
        autoCollapseTimersRef.current.push(window.setTimeout(() => setCollapseCountdown(second), elapsed))
      }

      autoCollapseTimersRef.current.push(window.setTimeout(() => {
        setCollapseCountdown(null)
        setDisplayMode('collapsed')
        autoCollapseTimersRef.current.push(window.setTimeout(
          () => setKeepProgressViewport(false),
          PROCESS_GROUP_COLLAPSE_DURATION_MS,
        ))
      }, PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS * 1000))
    }, PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS)
    autoCollapseTimersRef.current.push(soundDelayTimer)

    return clearAutoCollapseTimers
  }, [clearAutoCollapseTimers, isStreaming])

  const scrollToLatest = React.useCallback(() => {
    if (!followLatestRef.current) return
    const viewport = contentRef.current
    if (!viewport) return

    smoothScrollTargetRef.current = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    if (scrollFrameRef.current !== null) return

    const advanceScroll = (): void => {
      const target = smoothScrollTargetRef.current
      const activeViewport = contentRef.current
      if (!followLatestRef.current || target == null || !activeViewport) {
        scrollFrameRef.current = null
        return
      }

      const distance = target - activeViewport.scrollTop
      if (Math.abs(distance) <= 1) {
        activeViewport.scrollTop = target
        smoothScrollTargetRef.current = null
        scrollFrameRef.current = null
        return
      }

      // 内容突增时快速追近，正常增量则保持低成本的连续插值。
      const nextTop = distance > 72
        ? target - 48
        : activeViewport.scrollTop + distance * 0.32
      activeViewport.scrollTop = nextTop
      scrollFrameRef.current = requestAnimationFrame(advanceScroll)
    }

    scrollFrameRef.current = requestAnimationFrame(advanceScroll)
  }, [])

  React.useLayoutEffect(() => {
    if (!isStreaming || !keepProgressViewport) return
    const content = contentInnerRef.current
    if (!content) return

    const frame = requestAnimationFrame(scrollToLatest)
    const observer = new ResizeObserver(scrollToLatest)
    observer.observe(content)
    return () => {
      cancelAnimationFrame(frame)
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
      observer.disconnect()
    }
  }, [isStreaming, keepProgressViewport, scrollToLatest])

  React.useLayoutEffect(() => {
    if (isStreaming && keepProgressViewport) scrollToLatest()
  }, [blocks, isStreaming, keepProgressViewport, scrollToLatest])

  const handleProgressScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    if (scrollFrameRef.current !== null) return
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget
    if (scrollHeight - scrollTop - clientHeight <= 24) {
      followLatestRef.current = true
    }
  }, [])

  const handleProgressScrollIntent = React.useCallback((): void => {
    smoothScrollTargetRef.current = null
    followLatestRef.current = false
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  // 折叠前测量实际高度，用于丝滑的 height 过渡（子元素不 reflow，只裁剪边界）
  React.useEffect(() => {
    if (isContentExpanded) {
      setShouldRenderContent(true)
      setMeasuredHeight(undefined)
      return
    }

    // 折叠时：先测量当前高度，触发 height 过渡动画，动画结束后卸载 DOM
    const el = contentRef.current
    if (el) {
      const h = el.clientHeight
      setMeasuredHeight(h)
      // 强制浏览器在下一帧开始从 h → 0 的过渡
      requestAnimationFrame(() => setMeasuredHeight(0))
    }

    const timer = window.setTimeout(() => setShouldRenderContent(false), PROCESS_GROUP_COLLAPSE_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [isContentExpanded])

  const summary = React.useMemo(
    () => buildProcessGroupSummary(blocks),
    [blocks],
  )
  const toolNames = React.useMemo(() => buildProcessGroupToolNames(blocks), [blocks])
  const visibleToolNames = toolNames.slice(0, MAX_PROCESS_GROUP_ICONS)
  const hiddenToolCount = Math.max(0, toolNames.length - visibleToolNames.length)

  // 内容区子项渲染策略：
  // - 流式中：每个新块有入场动画，最新一段（消息末尾过程组的最后一个 child）保持正常显示，
  //   其余步骤轻微弱化以引导视觉重心到最下方。
  // - 流式结束后用户展开：所有内容以正常颜色显示，无动画。
  const renderContentChildren = (): React.ReactNode => {
    const childArray = React.Children.toArray(visibleChildren)
    return childArray.map((child, i) => {
      const isLast = i === childArray.length - 1
      const dimmed = isStreaming && !(isMessageTail && isLast)
      return (
        <div
          key={getProcessChildKey(child, i)}
          className={cn(dimmed && 'opacity-80')}
        >
          {child}
        </div>
      )
    })
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className={cn(
          'flex max-w-full items-center gap-2 py-0.5 text-left transition-opacity group',
          'hover:opacity-70',
        )}
        onClick={() => {
          userToggledRef.current = true
          clearAutoCollapseTimers()
          setCollapseCountdown(null)
          if (!isStreaming) setKeepProgressViewport(false)
          setDisplayMode((previous) => previous === 'collapsed' ? 'expanded' : 'collapsed')
        }}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150',
            isContentExpanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 truncate text-[14px] text-muted-foreground">{summary}</span>
        {collapseCountdown !== null && (
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground/50">
            （{collapseCountdown}）
          </span>
        )}
        {visibleToolNames.length > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground/60">
            {visibleToolNames.map((toolName) => {
              const ToolIcon = getToolIcon(toolName)
              return (
                <ToolIcon
                  key={toolName}
                  className="size-3.5"
                  aria-label={getToolDisplayName(toolName)}
                />
              )
            })}
            {hiddenToolCount > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground/60">
                +{hiddenToolCount}
              </span>
            )}
          </span>
        )}
      </button>

      {shouldRenderContent && (
        <div
          ref={contentRef}
          data-agent-history-selection-excluded={isContentExpanded ? undefined : 'true'}
          className={cn(
            'overflow-hidden',
            keepProgressViewport && 'overflow-y-auto overscroll-contain scrollbar-none',
          )}
          onScroll={keepProgressViewport ? handleProgressScroll : undefined}
          onWheel={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onTouchStart={keepProgressViewport ? handleProgressScrollIntent : undefined}
          style={{
            maxHeight: keepProgressViewport ? `${PROCESS_GROUP_VIEWPORT_HEIGHT}px` : undefined,
            height: measuredHeight !== undefined ? `${measuredHeight}px` : 'auto',
            opacity: isContentExpanded ? 1 : 0,
            transition: measuredHeight !== undefined
              ? `height ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out, opacity ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out`
              : `opacity ${PROCESS_GROUP_COLLAPSE_DURATION_MS}ms ease-in-out`,
          }}
        >
          <div ref={contentInnerRef} className="space-y-2">
            {renderContentChildren()}
          </div>
        </div>
      )}
    </div>
  )
}
