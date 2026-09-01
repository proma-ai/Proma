/**
 * ScrollMinimap — 消息导航迷你地图 + 滚动进度条
 *
 * 在消息区域右侧显示：
 * 1. 短横杠代表每条消息的位置（迷你地图），悬浮时弹出消息预览列表
 * 2. 可拖拽的滚动进度条，提供丝滑的滚动体验
 * 必须放在 StickToBottom（Conversation）内部使用。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Search } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { getModelLogo, resolveModelProvider } from '@/lib/model-logo'
import { channelsAtom } from '@/atoms/chat-atoms'
import { useShortcut } from '@/hooks/useShortcut'
import { cn } from '@/lib/utils'
import { MAX_SEARCH_QUERY_SOURCE_LENGTH } from '@proma/shared'
import type { SessionMessageSearchResponse, SessionMessageSearchResult } from '@proma/shared'
import type { SessionMessageSearch } from '@/lib/session-message-search'

export interface MinimapItem {
  id: string
  role: 'user' | 'assistant' | 'status'
  preview: string
  avatar?: string
  model?: string
}

interface ScrollMinimapProps {
  /** 用于显示位置与未搜索状态预览的轻量条目 */
  items: MinimapItem[]
  /** 独立搜索数据源；Chat 可在主进程查完整 JSONL，Agent 可查结构化内存快照 */
  searchMessages?: SessionMessageSearch
  /** 搜索结果尚未渲染时，调用方可先补载历史 */
  onRevealSearchResult?: (messageId: string) => Promise<boolean | void> | boolean | void
}

interface SearchListItem extends MinimapItem {
  matchStart?: number
  matchLength?: number
}

/** 最少消息数才显示迷你地图 */
const MIN_ITEMS = 1
/** 迷你地图最多渲染的横杠数 */
const MAX_BARS = 20
/** 迷你地图横杠垂直间距（px） */
const MINIMAP_BAR_SPACING = 8
/** 右侧滚动位置条宽度（px） */
const SCROLL_PROGRESS_WIDTH = 8

// ── Markdown 预览配置（轻量级，禁用重量级渲染） ──

const PREVIEW_REMARK_PLUGINS = [remarkGfm]

/* eslint-disable @typescript-eslint/no-explicit-any -- react-markdown components 类型复杂，使用内联对象即可 */
const PREVIEW_MD_COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="text-[11px] opacity-70 truncate">{children}</pre>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="text-[11px] bg-muted/50 px-0.5 rounded">{children}</code>,
  img: () => null as unknown as React.ReactElement,
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
} as const
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── 辅助函数 ──

/** 计算 node 相对于 container 的实际顶部偏移（递归累积 offsetTop） */
function getOffsetTopRelativeTo(node: HTMLElement, container: HTMLElement): number {
  let top = 0
  let el: HTMLElement | null = node
  while (el && el !== container) {
    top += el.offsetTop
    el = el.offsetParent as HTMLElement | null
  }
  return top
}

/** 转义正则特殊字符 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── 主组件 ──

export function ScrollMinimap({ items, searchMessages, onRevealSearchResult }: ScrollMinimapProps): React.ReactElement | null {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const [hovered, setHovered] = React.useState(false)
  const [isLeaving, setIsLeaving] = React.useState(false)
  const [visibleIds, setVisibleIds] = React.useState<Set<string>>(new Set())
  /** 主区视口几何中心当前对应的消息 id —— 面板打开时作为列表居中锚点 */
  const [centerVisibleId, setCenterVisibleId] = React.useState<string | undefined>(undefined)
  const [canScroll, setCanScroll] = React.useState(false)
  const [thumbHeightPct, setThumbHeightPct] = React.useState(100)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<SessionMessageSearchResult[]>([])
  const [searchTruncated, setSearchTruncated] = React.useState(false)
  const [searchQueryTooLong, setSearchQueryTooLong] = React.useState(false)
  const [isSearching, setIsSearching] = React.useState(false)
  const [isDragging, setIsDragging] = React.useState(false)
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const visibleIdsRef = React.useRef<Set<string>>(new Set())
  const visibleElementsRef = React.useRef<Map<string, HTMLElement>>(new Map())
  const hoveredRef = React.useRef(hovered)
  hoveredRef.current = hovered
  const updateCenterVisibleRef = React.useRef<(() => void) | null>(null)
  const canScrollRef = React.useRef(false)
  const thumbHeightPctRef = React.useRef(100)
  const thumbRef = React.useRef<HTMLDivElement>(null)
  const searchRequestRef = React.useRef(0)

  // ── 组件卸载时清理计时器 ──

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
    }
  }, [])

  // 仅列表结构变化时重新绑定消息。滚动时由 IntersectionObserver 追踪可见项，
  // 避免每帧查询整个历史 DOM 并读取所有消息的几何信息。
  const itemIds = React.useMemo(() => items.map((item) => item.id).join('\u0000'), [items])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const updateVisibleIds = (next: Set<string>): void => {
      const previous = visibleIdsRef.current
      if (previous.size === next.size && [...previous].every((id) => next.has(id))) return
      visibleIdsRef.current = next
      setVisibleIds(next)
    }

    const updateCenterVisible = (): void => {
      const viewportCenter = el.getBoundingClientRect().top + el.clientHeight / 2
      let closestId: string | undefined
      let closestDistance = Number.POSITIVE_INFINITY
      for (const [id, element] of visibleElementsRef.current) {
        const rect = element.getBoundingClientRect()
        const distance = viewportCenter < rect.top
          ? rect.top - viewportCenter
          : viewportCenter > rect.bottom
            ? viewportCenter - rect.bottom
            : 0
        if (distance < closestDistance) {
          closestDistance = distance
          closestId = id
        }
      }
      setCenterVisibleId((previous) => previous === closestId ? previous : closestId)
    }

    const updateThumb = (): void => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const scrollRange = scrollHeight - clientHeight
      const nextCanScroll = scrollRange > 10
      const nextThumbHeightPct = scrollHeight > 0
        ? Math.max(10, Math.min((clientHeight / scrollHeight) * 100, 100))
        : 100
      const thumbTopPct = scrollRange > 0
        ? (scrollTop / scrollRange) * (100 - nextThumbHeightPct)
        : 0

      if (nextCanScroll !== canScrollRef.current) {
        canScrollRef.current = nextCanScroll
        setCanScroll(nextCanScroll)
      }
      if (Math.abs(thumbHeightPctRef.current - nextThumbHeightPct) >= 0.01) {
        thumbHeightPctRef.current = nextThumbHeightPct
        setThumbHeightPct(nextThumbHeightPct)
      }
      if (thumbRef.current) thumbRef.current.style.top = `${thumbTopPct}%`
    }

    const visible = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        const id = entry.target.getAttribute('data-message-id')
        if (!id) continue
        if (entry.isIntersecting) {
          visibleElementsRef.current.set(id, entry.target as HTMLElement)
          if (!visible.has(id)) {
            visible.add(id)
            changed = true
          }
        } else {
          visibleElementsRef.current.delete(id)
          if (visible.delete(id)) changed = true
        }
      }
      if (changed) updateVisibleIds(new Set(visible))
      if (hoveredRef.current) updateCenterVisible()
    }, { root: el, threshold: 0 })

    updateCenterVisibleRef.current = updateCenterVisible
    const observeMessageNode = (node: Node): void => {
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const element = node as HTMLElement
      if (element.matches('[data-message-id]')) observer.observe(element)
      for (const message of element.querySelectorAll<HTMLElement>('[data-message-id]')) {
        observer.observe(message)
      }
    }
    for (const message of el.querySelectorAll<HTMLElement>('[data-message-id]')) observer.observe(message)

    const mutationObserver = new MutationObserver((mutations) => {
      let changed = false
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) observeMessageNode(node)
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const element = node as HTMLElement
          const removedMessages = element.matches('[data-message-id]')
            ? [element]
            : [...element.querySelectorAll<HTMLElement>('[data-message-id]')]
          for (const message of removedMessages) {
            observer.unobserve(message)
            const id = message.getAttribute('data-message-id')
            if (id) visibleElementsRef.current.delete(id)
            if (id && visible.delete(id)) changed = true
          }
        }
      }
      if (changed) updateVisibleIds(new Set(visible))
    })
    mutationObserver.observe(el, { childList: true, subtree: true })
    updateThumb()

    const onScroll = (): void => {
      updateThumb()
      if (hoveredRef.current) updateCenterVisible()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(updateThumb)
    resizeObserver.observe(el)
    const content = el.firstElementChild
    if (content) resizeObserver.observe(content)

    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      updateCenterVisibleRef.current = null
      visibleIdsRef.current = new Set()
      visibleElementsRef.current.clear()
    }
  }, [itemIds, scrollRef])

  React.useEffect(() => {
    if (hovered) updateCenterVisibleRef.current?.()
  }, [hovered])

  // 进度条首次从不可滚动状态挂载时，上一段 effect 中尚无 thumb DOM；
  // 此处在绘制前补齐当前位置，保证恢复历史滚动位置后滑块也正确定位。
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    const thumb = thumbRef.current
    if (!el || !thumb || !canScroll) return
    const scrollRange = el.scrollHeight - el.clientHeight
    const thumbTopPct = scrollRange > 0
      ? (el.scrollTop / scrollRange) * (100 - thumbHeightPct)
      : 0
    thumb.style.top = `${thumbTopPct}%`
  }, [canScroll, scrollRef, thumbHeightPct])

  // ── 面板打开时自动聚焦搜索框 ──

  React.useEffect(() => {
    if (hovered && searchInputRef.current) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 80)
      return () => clearTimeout(timer)
    }
  }, [hovered])

  // ── 面板打开时把当前可见消息滚到列表中间，避免每次都从顶部开始 ──

  React.useEffect(() => {
    if (!hovered) return
    const timer = setTimeout(() => {
      const list = listRef.current
      if (!list) return
      const target = list.querySelector<HTMLElement>('[data-minimap-visible="true"]')
      if (!target) return
      // listRef 没有 position 设置，offsetTop / getOffsetTopRelativeTo 都不可靠，
      // 直接用 getBoundingClientRect 计算 target 相对 list 视口的偏移
      const listRect = list.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const offsetInList = (targetRect.top - listRect.top) + list.scrollTop
      const offset = offsetInList - (list.clientHeight - target.offsetHeight) / 2
      list.scrollTo({ top: Math.max(0, offset), behavior: 'auto' })
    }, 0)
    return () => clearTimeout(timer)
  }, [centerVisibleId, hovered, visibleIds])

  // ── 面板关闭时清空搜索 ──

  React.useEffect(() => {
    if (!hovered) setSearchQuery('')
  }, [hovered])

  // ── Cmd+F / Ctrl+F 快捷键：打开面板并聚焦搜索 ──

  const handleShortcutOpen = React.useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = undefined }
    setIsLeaving(false)
    setHovered(true)
  }, [])

  useShortcut('file-find', handleShortcutOpen, items.length >= MIN_ITEMS)

  // ── 鼠标进出控制（仅迷你地图区域） ──

  /** 鼠标进入后需停留此时间（ms）才展开面板，防止掠过时闪烁 */
  const OPEN_DELAY = 180

  const handleMouseEnter = (): void => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    setIsLeaving(false)

    // 面板已打开则无需重复触发
    if (hovered) return

    // 延迟打开：鼠标需在触发条上停留足够时间
    if (!openTimerRef.current) {
      openTimerRef.current = setTimeout(() => {
        setHovered(true)
        openTimerRef.current = undefined
      }, OPEN_DELAY)
    }
  }

  const handleMouseLeave = (): void => {
    // 尚未打开就离开了 → 取消打开定时器
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = undefined
    }

    if (!hovered) return

    closeTimerRef.current = setTimeout(() => {
      setIsLeaving(true)
      fadeTimerRef.current = setTimeout(() => {
        setHovered(false)
        setIsLeaving(false)
      }, 80)
    }, 40)
  }

  // ── 跳转到指定消息（直接操作 scrollTop，绕过 scrollIntoView） ──

  const scrollToMessage = React.useCallback((id: string) => {
    const el = scrollRef.current
    if (!el) return

    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.getAttribute('data-message-id') === id,
    )
    if (!target) return

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const offsetTop = getOffsetTopRelativeTo(target, el)
    const targetHeight = target.offsetHeight
    const viewportHeight = el.clientHeight
    const scrollTarget = targetHeight < viewportHeight
      ? offsetTop - (viewportHeight - targetHeight) / 2
      : offsetTop - 32
    el.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' })

    setHovered(false)
  }, [scrollRef, stopScroll, stickyState])

  const scrollToMessageWhenRendered = React.useCallback((id: string): void => {
    const container = scrollRef.current
    if (!container) return
    if (container.querySelector(`[data-message-id="${CSS.escape(id)}"]`)) {
      scrollToMessage(id)
      return
    }

    const observer = new MutationObserver(() => {
      if (!container.querySelector(`[data-message-id="${CSS.escape(id)}"]`)) return
      observer.disconnect()
      window.clearTimeout(timeout)
      scrollToMessage(id)
    })
    const timeout = window.setTimeout(() => observer.disconnect(), 1_000)
    observer.observe(container, { childList: true, subtree: true })
  }, [scrollRef, scrollToMessage])

  // ── 搜索：延迟请求，按请求序号丢弃陈旧结果 ──

  React.useEffect(() => {
    const query = searchQuery.trim()
    const requestId = ++searchRequestRef.current
    if (!query || !searchMessages) {
      setIsSearching(false)
      setSearchResults([])
      setSearchTruncated(false)
      setSearchQueryTooLong(false)
      return
    }

    setIsSearching(true)
    const timer = window.setTimeout(() => {
      void searchMessages(query)
        .then((response: SessionMessageSearchResponse) => {
          if (searchRequestRef.current === requestId) {
            setSearchResults(response.results)
            setSearchTruncated(response.truncated)
            setSearchQueryTooLong(response.queryTooLong)
          }
        })
        .catch((error: unknown) => {
          if (searchRequestRef.current === requestId) {
            console.warn('[消息导航] 搜索失败:', error)
            setSearchResults([])
            setSearchTruncated(false)
            setSearchQueryTooLong(false)
          }
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setIsSearching(false)
        })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [searchMessages, searchQuery])

  const filteredItems = React.useMemo<SearchListItem[]>(() => {
    const query = searchQuery.trim()
    if (!query) return items
    if (!searchMessages) {
      const normalizedQuery = query.toLowerCase()
      return items.filter((item) => item.preview.toLowerCase().includes(normalizedQuery))
    }
    const itemById = new Map(items.map((item) => [item.id, item]))
    return searchResults.map((result) => {
      const item = itemById.get(result.messageId)
      return {
        id: result.messageId,
        role: result.role === 'system' ? 'status' : result.role,
        preview: result.snippet,
        avatar: item?.avatar,
        model: item?.model,
        matchStart: result.matchStart,
        matchLength: result.matchLength,
      }
    })
  }, [items, searchMessages, searchQuery, searchResults])

  /** 列表居中锚点：优先用主区视口中心对应的消息；该消息被搜索过滤掉时退回第一条可见消息 */
  const anchorId = React.useMemo(() => {
    if (centerVisibleId && filteredItems.some((item) => item.id === centerVisibleId)) {
      return centerVisibleId
    }
    return filteredItems.find((item) => visibleIds.has(item.id))?.id
  }, [centerVisibleId, filteredItems, visibleIds])

  // ── 滚动条滑块拖拽 ──

  const handleThumbMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const el = scrollRef.current
    const track = trackRef.current
    if (!el || !track) return

    // 停止 StickToBottom 自动滚动
    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    setIsDragging(true)
    const startY = e.clientY
    const startScrollTop = el.scrollTop
    const trackHeight = track.clientHeight
    const { scrollHeight, clientHeight } = el
    const scrollRange = scrollHeight - clientHeight
    const thumbHeight = Math.max(trackHeight * 0.1, (clientHeight / scrollHeight) * trackHeight)
    const scrollableTrack = trackHeight - thumbHeight

    const onMouseMove = (ev: MouseEvent): void => {
      ev.preventDefault()
      const delta = ev.clientY - startY
      const scrollDelta = scrollableTrack > 0 ? (delta / scrollableTrack) * scrollRange : 0
      el.scrollTop = Math.max(0, Math.min(scrollRange, startScrollTop + scrollDelta))
    }

    const onMouseUp = (): void => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [scrollRef, stopScroll, stickyState])

  // ── 轨道点击跳转 ──

  const handleTrackMouseDown = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 只响应直接点击轨道背景，忽略点击滑块
    if (e.target !== e.currentTarget) return

    const track = trackRef.current
    const el = scrollRef.current
    if (!track || !el) return

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const rect = track.getBoundingClientRect()
    const clickRatio = (e.clientY - rect.top) / rect.height
    const { scrollHeight, clientHeight } = el
    const targetTop = clickRatio * (scrollHeight - clientHeight)
    el.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }, [scrollRef, stopScroll, stickyState])

  if (items.length < MIN_ITEMS) return null

  // ── 迷你地图条纹 ──

  const barCount = Math.min(items.length, MAX_BARS)

  return (
    <div className="absolute right-1 top-0 bottom-0 z-30 flex pointer-events-none">
      {/* ── 迷你地图悬停区域（面板 + 横杠） ── */}
      <div className="flex items-start h-full">
        {/* 展开面板 */}
        {hovered && (
          <div
            className={cn(
              'mr-1 w-[280px] rounded-lg border bg-popover shadow-xl origin-top-right flex flex-col overflow-hidden pointer-events-auto',
              isLeaving
                ? 'animate-out fade-out-0 zoom-out-95 duration-75'
                : 'animate-in fade-in-0 zoom-in-95 duration-150'
            )}
            style={{ maxHeight: 'min(420px, 60vh)', marginTop: 12 }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
              <span className="text-xs font-medium text-popover-foreground/70">消息导航</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {visibleIds.size}/{items.length}
              </span>
            </div>

            {/* 搜索框 */}
            <div className="px-2 py-1.5 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                <Input
                  ref={searchInputRef}
                  placeholder="搜索消息..."
                  value={searchQuery}
                  maxLength={MAX_SEARCH_QUERY_SOURCE_LENGTH}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => {
                    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
                    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
                    setIsLeaving(false)
                  }}
                  className="h-7 text-xs pl-7 focus-visible:!border-border/60 focus-visible:!ring-0 focus-visible:!shadow-xs"
                />
              </div>
            </div>

            {/* 消息列表 */}
            <div ref={listRef} className="overflow-y-auto flex-1 p-1.5 space-y-0.5 scrollbar-thin">
              {searchQueryTooLong && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground">
                  查询过长，请缩短后重试。
                </div>
              )}
              {searchTruncated && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground">
                  历史过长，仅显示可索引范围内的结果；请缩小范围。
                </div>
              )}
              {isSearching ? (
                <div className="py-6 text-center text-xs text-muted-foreground">搜索中...</div>
              ) : filteredItems.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  未找到匹配消息
                </div>
              ) : (
                filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-minimap-visible={item.id === anchorId ? 'true' : undefined}
                    className={cn(
                      'flex items-start gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                      visibleIds.has(item.id) && 'bg-accent/50'
                    )}
                    onClick={() => {
                      void Promise.resolve(onRevealSearchResult?.(item.id)).then((revealed) => {
                        if (revealed !== false) scrollToMessageWhenRendered(item.id)
                      })
                    }}
                  >
                    <ItemIcon item={item} />
                    <div className="flex-1 min-w-0">
                      <HighlightedPreview
                        text={item.preview}
                        query={searchQuery}
                        matchStart={item.matchStart}
                        matchLength={item.matchLength}
                      />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── 迷你地图横杠 —— 只有这里触发面板展开 ── */}
        {canScroll && <div
          className="relative mt-3 flex-shrink-0 pointer-events-auto"
          style={{ width: 24, height: barCount * MINIMAP_BAR_SPACING }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {Array.from({ length: barCount }, (_, i) => {
            const start = Math.floor((i * items.length) / barCount)
            const end = Math.floor(((i + 1) * items.length) / barCount)
            const group = items.slice(start, end)
            const isVisible = group.some((it) => visibleIds.has(it.id))
            const hasUser = group.some((it) => it.role === 'user')
            const top = ((i + 0.5) / barCount) * 100
            return (
              <div
                key={i}
                className={cn(
                  'absolute left-1 h-[2px] w-[20px] rounded-full transition-colors',
                  isVisible
                    ? 'bg-primary dark:bg-primary/70 minimap-visible-indicator'
                    : hasUser
                      ? 'bg-primary/25 dark:bg-primary/15'
                      : 'bg-primary/40 dark:bg-primary/25'
                )}
                style={{ top: `${top}%` }}
              />
            )
          })}
        </div>}
      </div>

      {/* ── 滚动进度条 ── */}
      {canScroll && <div className="relative ml-[4px] py-4 flex-shrink-0 pointer-events-auto" style={{ width: SCROLL_PROGRESS_WIDTH }}>
        <div
          ref={trackRef}
          className="relative h-full rounded-full cursor-pointer scroll-progress-track"
          onMouseDown={handleTrackMouseDown}
        >
          <div
            ref={thumbRef}
            className={cn(
              'absolute left-0 right-0 rounded-full transition-colors duration-100 scroll-progress-thumb',
              isDragging
                ? 'scroll-progress-thumb-active cursor-grabbing'
                : 'cursor-grab'
            )}
            style={{
              height: `${thumbHeightPct}%`,
              top: '0%',
            }}
            onMouseDown={handleThumbMouseDown}
          />
        </div>
      </div>}
    </div>
  )
}

// ── 子组件 ──

function ItemIcon({ item }: { item: MinimapItem }): React.ReactElement {
  const channels = useAtomValue(channelsAtom)
  if (item.role === 'user' && item.avatar) {
    return <UserAvatar avatar={item.avatar} size={16} className="mt-0.5" />
  }
  if ((item.role === 'assistant') && item.model) {
    return (
      <img
        src={getModelLogo(item.model, resolveModelProvider(item.model, channels))}
        alt=""
        className="size-4 shrink-0 mt-0.5 rounded-[20%] object-cover"
      />
    )
  }
  if (item.role === 'status') {
    return <AlertTriangle className="size-4 shrink-0 mt-0.5 text-destructive" />
  }
  return <div className="size-4 shrink-0 mt-0.5 rounded-[20%] bg-muted" />
}

/** Markdown 预览（无搜索时）或 纯文本+高亮（搜索时） */
function HighlightedPreview({
  text,
  query,
  matchStart,
  matchLength,
}: {
  text: string
  query: string
  matchStart?: number
  matchLength?: number
}): React.ReactElement {
  if (!text) {
    return <span className="text-xs opacity-40">(空消息)</span>
  }

  if (query.trim() && matchStart !== undefined && matchLength !== undefined) {
    const before = text.slice(0, matchStart)
    const match = text.slice(matchStart, matchStart + matchLength)
    const after = text.slice(matchStart + matchLength)
    return (
      <span className="text-xs text-popover-foreground/80 line-clamp-3">
        {before}<mark className="bg-primary/20 text-primary rounded-sm px-0.5">{match}</mark>{after}
      </span>
    )
  }

  if (query.trim()) {
    const escaped = escapeRegExp(query)
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return (
      <span className="text-xs text-popover-foreground/80 line-clamp-3">
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase()
            ? <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">{part}</mark>
            : part
        )}
      </span>
    )
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs text-popover-foreground/80 prose-p:my-0 prose-headings:my-0.5 prose-headings:text-xs prose-li:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 line-clamp-3 overflow-hidden">
      <Markdown remarkPlugins={PREVIEW_REMARK_PLUGINS} components={PREVIEW_MD_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
}
