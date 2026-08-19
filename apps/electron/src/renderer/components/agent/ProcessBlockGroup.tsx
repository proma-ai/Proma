import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName, getToolIcon } from './tool-utils'
import type {
  SDKContentBlock,
  SDKToolUseBlock,
  SDKTextBlock,
  SDKThinkingBlock,
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
const PROCESS_GROUP_LIVE_CHILD_WINDOW = 4
const PROCESS_GROUP_COLLAPSE_DURATION_MS = 500
const PROCESS_GROUP_AUTO_COLLAPSE_SOUND_DELAY_MS = 900
const PROCESS_GROUP_AUTO_COLLAPSE_COUNTDOWN_SECONDS = 3
const PROCESS_GROUP_FOLLOW_BOTTOM_THRESHOLD = 24
const PROGRESS_SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

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

export function buildAssistantTurnRenderItems(
  blocks: SDKContentBlock[],
  options: BuildAssistantTurnRenderItemsOptions = {},
): AssistantTurnRenderItem[] {
  if (blocks.length === 0) return []

  // 只要流式末尾出现 text，就按常规消息布局直接展示。若 Agent 之后继续调用工具，
  // text 不再位于末尾，会自动回归过程组，避免把中间状态误认为最终答案。
  const hasProcessBlock = blocks.some((block) => block.type === 'tool_use' || block.type === 'thinking')
  const trailingTextStartIndex = getTrailingTextStartIndex(blocks)
  const canSplitStreamingFinalOutput = options.isStreaming
    && hasProcessBlock
    && trailingTextStartIndex !== null
    && trailingTextStartIndex > 0

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

/**
 * Reuse the previous array when streaming only changes a sibling block, such as
 * an already-externalized final text block. Delta updates replace changed block
 * objects immutably, so reference identity is enough to detect process changes.
 */
export function stabilizeProcessBlockReferences(
  previous: SDKContentBlock[],
  next: SDKContentBlock[],
): SDKContentBlock[] {
  if (previous.length !== next.length) return next
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return next
  }
  return previous
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

export function isProgressViewportAtBottom({
  clientHeight,
  scrollHeight,
  scrollTop,
}: Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>): boolean {
  return scrollHeight - scrollTop - clientHeight <= PROCESS_GROUP_FOLLOW_BOTTOM_THRESHOLD
}

function getProcessChildKey(child: React.ReactNode, index: number): string {
  if (React.isValidElement(child) && child.key != null) return String(child.key)
  return `process-child-${index}`
}

interface StableProcessChildCacheEntry {
  child: React.ReactNode
  snapshot: string
}

function getProcessChildSnapshot(child: React.ReactNode): string | null {
  if (!React.isValidElement(child) || child.type !== React.Fragment) return null
  const fragmentProps = child.props as { children?: React.ReactNode }
  const content = fragmentProps.children
  if (!React.isValidElement(content)) return null
  const contentProps = content.props as { block?: SDKContentBlock }
  const block = contentProps.block
  if (!block || (block.type !== 'text' && block.type !== 'thinking')) return null
  const text = block.type === 'text'
    ? (block as SDKTextBlock).text
    : (block as SDKThinkingBlock).thinking
  return `${block.type}:${text}`
}

const StableProcessChild = React.memo(
  function StableProcessChild({ child }: { child: React.ReactNode }): React.ReactElement {
    return <>{child}</>
  },
  (previous, next) => previous.child === next.child,
)

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
  const stableChildrenRef = React.useRef(new Map<string, StableProcessChildCacheEntry>())
  const stableProcessBlocksRef = React.useRef(blocks)
  stableProcessBlocksRef.current = stabilizeProcessBlockReferences(stableProcessBlocksRef.current, blocks)
  const stableProcessBlocks = stableProcessBlocksRef.current
  const collapseFrameRef = React.useRef<number | null>(null)
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
  }, [stableProcessBlocks, isStreaming, keepProgressViewport, scrollToLatest])

  const handleProgressScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    if (!isProgressViewportAtBottom(event.currentTarget)) return
    followLatestRef.current = true
    scrollToLatest()
  }, [scrollToLatest])

  const handleProgressScrollIntent = React.useCallback((): void => {
    smoothScrollTargetRef.current = null
    followLatestRef.current = false
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  const handleProgressKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (PROGRESS_SCROLL_KEYS.has(event.key)) handleProgressScrollIntent()
  }, [handleProgressScrollIntent])

  // 折叠前测量实际高度，用于丝滑的 height 过渡（子元素不 reflow，只裁剪边界）
  React.useEffect(() => {
    if (isContentExpanded) {
      if (collapseFrameRef.current !== null) {
        cancelAnimationFrame(collapseFrameRef.current)
        collapseFrameRef.current = null
      }
      setShouldRenderContent(true)
      setMeasuredHeight(undefined)
      return
    }

    // 折叠时：先测量当前高度，触发 height 过渡动画，动画结束后卸载 DOM
    const el = contentRef.current
    if (el) {
      const h = el.clientHeight
      setMeasuredHeight(h)
      collapseFrameRef.current = requestAnimationFrame(() => {
        collapseFrameRef.current = null
        setMeasuredHeight(0)
      })
    }

    const timer = window.setTimeout(() => setShouldRenderContent(false), PROCESS_GROUP_COLLAPSE_DURATION_MS)
    return () => {
      window.clearTimeout(timer)
      if (collapseFrameRef.current !== null) {
        cancelAnimationFrame(collapseFrameRef.current)
        collapseFrameRef.current = null
      }
    }
  }, [isContentExpanded])

  const summary = React.useMemo(
    () => buildProcessGroupSummary(blocks),
    [blocks],
  )
  const toolNames = React.useMemo(() => buildProcessGroupToolNames(blocks), [blocks])
  const visibleToolNames = toolNames.slice(0, MAX_PROCESS_GROUP_ICONS)
  const hiddenToolCount = Math.max(0, toolNames.length - visibleToolNames.length)

  // 只让最近几项参与高频更新；旧项保留在 DOM 中供用户滚动查看，但冻结其 React 子树。
  const renderContentChildren = (): React.ReactNode => {
    const childArray = React.Children.toArray(visibleChildren)
    const liveStart = Math.max(0, childArray.length - PROCESS_GROUP_LIVE_CHILD_WINDOW)
    const activeKeys = new Set<string>()

    const rendered = childArray.map((child, i) => {
      const key = getProcessChildKey(child, i)
      activeKeys.add(key)
      const cachedEntry = stableChildrenRef.current.get(key)
      const snapshot = getProcessChildSnapshot(child)
      const shouldFreeze = !!isStreaming && i < liveStart && snapshot !== null
      const stableChild = shouldFreeze && cachedEntry?.snapshot === snapshot
        ? cachedEntry.child
        : child
      if (!shouldFreeze || !cachedEntry || cachedEntry.snapshot !== snapshot) {
        stableChildrenRef.current.set(key, { child, snapshot: snapshot ?? '' })
      }

      const isLast = i === childArray.length - 1
      const dimmed = isStreaming && !(isMessageTail && isLast)
      return (
        <div key={key} className={cn(dimmed && 'opacity-80')}>
          <StableProcessChild child={stableChild} />
        </div>
      )
    })

    for (const key of stableChildrenRef.current.keys()) {
      if (!activeKeys.has(key)) stableChildrenRef.current.delete(key)
    }
    return rendered
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
            'overflow-hidden focus:outline-none',
            keepProgressViewport && 'overflow-y-auto overscroll-contain scrollbar-none',
          )}
          tabIndex={keepProgressViewport ? 0 : undefined}
          onScroll={keepProgressViewport ? handleProgressScroll : undefined}
          onPointerDown={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onWheel={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onTouchStart={keepProgressViewport ? handleProgressScrollIntent : undefined}
          onKeyDown={keepProgressViewport ? handleProgressKeyDown : undefined}
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
