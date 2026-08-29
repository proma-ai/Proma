/**
 * DiffPanelTabBar — 右侧工作区的统一顶栏。
 *
 * 文件、改动、预览、问答和每个浏览器网页位于同一层级；网页不再拥有嵌套 Tab 栏。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Blocks, Brain, CalendarDays, Clock, Columns2, FolderOpen, Globe, ListTodo, MessageCircle, PanelRight, Plus, Repeat2, ServerCog, SquareTerminal, X } from 'lucide-react'
import { OBSIDIAN_NAME, ObsidianIcon } from '@/components/obsidian/obsidian-brand'
import { cn } from '@/lib/utils'
import { getScrollLeftToRevealTab } from '@/lib/tab-visibility'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { agentDiffUnseenChangesAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import type { AgentSidePanelTab, WorkspaceComponentTab } from '@/atoms/agent-atoms'
import { groupRightWorkspaceTabs, type RightWorkspacePane } from '@/lib/right-workspace-split'

export interface RightWorkspaceTabDragState {
  tabId: AgentSidePanelTab
  clientX: number
  clientY: number
}

export interface WorkspacePanelTab {
  id: AgentSidePanelTab
  label: string
  icon: React.ReactNode
  closable?: boolean
  activity?: boolean
}

interface DiffPanelTabBarProps {
  tabs: WorkspacePanelTab[]
  activeTab: AgentSidePanelTab
  onTabChange: (tab: AgentSidePanelTab) => void
  onCloseTab: (tab: AgentSidePanelTab) => void
  onOpenBrowser: () => void
  /** 加号菜单是否展开；供原生浏览器视图临时避让。 */
  onAddTabMenuOpenChange?: (open: boolean) => void
  onOpenFile: () => void
  onOpenTerminal?: () => void
  onOpenWorkspaceComponent?: (component: WorkspaceComponentTab) => void
  onOpenVault?: () => void
  onOpenChat?: () => void
  /** 仅当前右侧 Tab 需要的紧凑动作，渲染于标签列表之后，不影响内容区布局。 */
  activeTabAction?: React.ReactNode
  visibleTabs?: Partial<Record<RightWorkspacePane, AgentSidePanelTab>>
  focusedPane?: RightWorkspacePane
  onTabDragChange?: (state: RightWorkspaceTabDragState | null) => void
  onTabDrop?: (state: RightWorkspaceTabDragState) => void
  onSplitTab?: (tab: AgentSidePanelTab, pane: RightWorkspacePane) => void
  onCollapseSplit?: () => void
  onClose?: () => void
}

export function DiffPanelTabBar({
  tabs,
  activeTab,
  onTabChange,
  onCloseTab,
  onOpenBrowser,
  onAddTabMenuOpenChange,
  onOpenFile,
  onOpenTerminal,
  onOpenWorkspaceComponent,
  onOpenVault,
  onOpenChat,
  activeTabAction,
  visibleTabs,
  focusedPane,
  onTabDragChange,
  onTabDrop,
  onSplitTab,
  onCollapseSplit,
  onClose,
}: DiffPanelTabBarProps): React.ReactElement {
  const unseenMap = useAtomValue(agentDiffUnseenChangesAtom)
  const setUnseenMap = useSetAtom(agentDiffUnseenChangesAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const unseenChanges = unseenMap.get(currentSessionId ?? '') ?? false
  const [isAddTabMenuOpen, setIsAddTabMenuOpen] = React.useState(false)
  const [isSplitTabGroupHovered, setIsSplitTabGroupHovered] = React.useState(false)
  // 仅鼠标在菜单外取消时抑制 Radix 的回焦；Esc 与键盘选择必须保留可见焦点。
  const suppressPointerDismissFocusRestoreRef = React.useRef(false)
  const tabListRef = React.useRef<HTMLDivElement>(null)
  const scrollbarTrackRef = React.useRef<HTMLDivElement>(null)
  const scrollbarThumbRef = React.useRef<HTMLDivElement>(null)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = React.useState(false)
  const tabRefs = React.useRef(new Map<AgentSidePanelTab, HTMLDivElement>())
  const barRef = React.useRef<HTMLDivElement>(null)
  const suppressClickTabRef = React.useRef<AgentSidePanelTab | null>(null)
  const activeTabDragCancelRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => () => onAddTabMenuOpenChange?.(false), [onAddTabMenuOpenChange])
  React.useEffect(() => () => activeTabDragCancelRef.current?.(), [])
  React.useEffect(() => {
    if (!visibleTabs?.left || !visibleTabs.right) setIsSplitTabGroupHovered(false)
  }, [visibleTabs?.left, visibleTabs?.right])

  const handleAddTabMenuOpenChange = React.useCallback((open: boolean) => {
    if (open) suppressPointerDismissFocusRestoreRef.current = false
    setIsAddTabMenuOpen(open)
    onAddTabMenuOpenChange?.(open)
  }, [onAddTabMenuOpenChange])

  const syncScrollbarThumb = React.useCallback(() => {
    const tabList = tabListRef.current
    const track = scrollbarTrackRef.current
    const thumb = scrollbarThumbRef.current
    if (!tabList) return

    const maxScrollLeft = tabList.scrollWidth - tabList.clientWidth
    const overflow = maxScrollLeft > 1
    setHasHorizontalOverflow((previous) => previous === overflow ? previous : overflow)
    if (!overflow || !track || !thumb) return

    const trackWidth = track.clientWidth
    const thumbWidth = Math.min(trackWidth, Math.max(24, trackWidth * tabList.clientWidth / tabList.scrollWidth))
    const maxThumbOffset = trackWidth - thumbWidth
    const thumbOffset = maxScrollLeft > 0 ? maxThumbOffset * tabList.scrollLeft / maxScrollLeft : 0
    thumb.style.width = `${thumbWidth}px`
    thumb.style.transform = `translateX(${thumbOffset}px)`
  }, [])

  React.useLayoutEffect(() => {
    const tabList = tabListRef.current
    const activeTabElement = tabRefs.current.get(activeTab)
    if (!tabList || !activeTabElement) return

    const nextScrollLeft = getScrollLeftToRevealTab(tabList, activeTabElement)
    if (nextScrollLeft !== tabList.scrollLeft) {
      tabList.scrollTo({ left: nextScrollLeft, behavior: 'smooth' })
    }
    syncScrollbarThumb()
  }, [activeTab, syncScrollbarThumb, tabs.length])

  React.useLayoutEffect(() => {
    const tabList = tabListRef.current
    const track = scrollbarTrackRef.current
    if (!tabList) return

    const observer = new ResizeObserver(syncScrollbarThumb)
    observer.observe(tabList)
    if (track) observer.observe(track)
    syncScrollbarThumb()
    return () => observer.disconnect()
  }, [hasHorizontalOverflow, syncScrollbarThumb, tabs.length])

  React.useEffect(() => {
    const tabList = tabListRef.current
    if (!tabList) return
    tabList.addEventListener('scroll', syncScrollbarThumb, { passive: true })
    return () => tabList.removeEventListener('scroll', syncScrollbarThumb)
  }, [syncScrollbarThumb])

  const handleScrollbarThumbPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const tabList = tabListRef.current
    const track = scrollbarTrackRef.current
    if (!tabList || !track || event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startScrollLeft = tabList.scrollLeft
    const maxScrollLeft = tabList.scrollWidth - tabList.clientWidth
    const thumbWidth = Math.min(track.clientWidth, Math.max(24, track.clientWidth * tabList.clientWidth / tabList.scrollWidth))
    const maxThumbOffset = track.clientWidth - thumbWidth

    const handleMove = (moveEvent: PointerEvent) => {
      if (maxThumbOffset <= 0) return
      const nextScrollLeft = startScrollLeft + (moveEvent.clientX - startX) * maxScrollLeft / maxThumbOffset
      tabList.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft))
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      document.removeEventListener('pointercancel', handleUp)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    document.addEventListener('pointercancel', handleUp)
  }, [])

  const selectTab = React.useCallback((tab: AgentSidePanelTab) => {
    if (suppressClickTabRef.current === tab) {
      suppressClickTabRef.current = null
      return
    }
    if (tab === 'changes' && currentSessionId) {
      setUnseenMap((previous) => {
        if (previous.get(currentSessionId) === false) return previous
        const next = new Map(previous)
        next.set(currentSessionId, false)
        return next
      })
    }
    onTabChange(tab)
  }, [currentSessionId, onTabChange, setUnseenMap])

  const beginTabDrag = React.useCallback((tabId: AgentSidePanelTab, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !onTabDragChange || !onTabDrop) return
    activeTabDragCancelRef.current?.()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false
    let frame = 0
    let latestState: RightWorkspaceTabDragState = { tabId, clientX: startX, clientY: startY }
    const target = event.currentTarget

    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      document.removeEventListener('pointercancel', handleCancel)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', cancel)
      try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId) } catch { /* 节点已卸载 */ }
      if (activeTabDragCancelRef.current === cancel) activeTabDragCancelRef.current = null
    }
    const cancel = () => {
      cleanup()
      suppressClickTabRef.current = null
      if (dragging) onTabDragChange(null)
    }
    const publishDrag = () => {
      frame = 0
      onTabDragChange(latestState)
    }
    const handleMove = (moveEvent: PointerEvent) => {
      latestState = { tabId, clientX: moveEvent.clientX, clientY: moveEvent.clientY }
      const rect = barRef.current?.getBoundingClientRect()
      if (!dragging) {
        const crossedBelowBar = rect ? moveEvent.clientY > rect.bottom + 12 : moveEvent.clientY - startY > 24
        if (!crossedBelowBar || Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 18) return
        dragging = true
        suppressClickTabRef.current = tabId
        publishDrag()
        return
      }
      if (!frame) frame = requestAnimationFrame(publishDrag)
    }
    const handleUp = () => {
      cleanup()
      if (!dragging) return
      onTabDrop(latestState)
      onTabDragChange(null)
      window.setTimeout(() => {
        if (suppressClickTabRef.current === tabId) suppressClickTabRef.current = null
      }, 0)
    }
    const handleCancel = () => cancel()
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      cancel()
    }

    activeTabDragCancelRef.current = cancel
    target.setPointerCapture(pointerId)
    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
    document.addEventListener('pointercancel', handleCancel)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', cancel)
  }, [onTabDragChange, onTabDrop])

  const orderedTabs = React.useMemo(() => {
    if (!visibleTabs?.left || !visibleTabs.right) return tabs
    return groupRightWorkspaceTabs(tabs, visibleTabs.left, visibleTabs.right)
  }, [tabs, visibleTabs?.left, visibleTabs?.right])

  return (
    <div ref={barRef} className="relative flex h-10 shrink-0 items-center border-b border-border/50 bg-content-area">
      <div className="pointer-events-none absolute inset-0 titlebar-drag-region" />
      <div className="relative flex h-full min-w-0 flex-1 items-center titlebar-no-drag">
        <div className="relative flex min-w-0 flex-1 self-stretch">
          <div ref={tabListRef} className="flex h-9 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain px-2 pt-1.5 pb-0.5 scrollbar-none" role="tablist" aria-label="右侧工作区">
          {orderedTabs.map((tab) => {
            const selected = activeTab === tab.id
            const isSplitView = visibleTabs?.left !== undefined && visibleTabs.right !== undefined
            const visiblePane = visibleTabs?.left === tab.id ? 'left' : visibleTabs?.right === tab.id ? 'right' : null
            const isSplitTab = isSplitView && visiblePane !== null
            const isFirstSplitTab = isSplitTab && visiblePane === 'left'
            const isLastSplitTab = isSplitTab && visiblePane === 'right'
            const isChangesTab = tab.id === 'changes'
            const isSharedSplitClose = isLastSplitTab && onCollapseSplit !== undefined
            const showsIndividualClose = Boolean(tab.closable && !isSplitTab)
            const tabNode = (
              <div
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.id, element)
                  else tabRefs.current.delete(tab.id)
                }}
                  className={cn(
                    'group flex h-7 min-w-[84px] max-w-60 shrink-0 items-center transition-[background-color,color,box-shadow] duration-150',
                    isSplitTab
                      ? cn(
                          'bg-foreground/[0.055] text-foreground/90',
                          isFirstSplitTab && 'rounded-l-lg',
                          isLastSplitTab && 'rounded-r-lg',
                          !isFirstSplitTab && '-ml-1.5',
                        )
                      : cn(
                          'rounded-lg',
                          selected && !isSplitView
                            ? 'bg-foreground/[0.08] text-foreground'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        ),
                  )}
                data-visible-pane={visiblePane ?? undefined}
                onPointerEnter={() => { if (isSplitTab) setIsSplitTabGroupHovered(true) }}
                onPointerLeave={() => { if (isSplitTab) setIsSplitTabGroupHovered(false) }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-description={visiblePane ? `显示在${visiblePane === 'left' ? '左侧' : '右侧'} Pane` : undefined}
                  onClick={() => selectTab(tab.id)}
                  onPointerDown={(event) => beginTabDrag(tab.id, event)}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-left text-[13px] outline-none"
                >
                  {tab.activity || (isChangesTab && unseenChanges && !selected) ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="有未查看更新" />
                  ) : (
                    <span className={cn('shrink-0', selected ? 'text-foreground' : 'text-muted-foreground/80')}>{tab.icon}</span>
                  )}
                  <span className="truncate">{tab.label}</span>
                </button>
                {(showsIndividualClose || isSharedSplitClose) && (
                  <button
                    type="button"
                    onClick={isSharedSplitClose ? onCollapseSplit : () => onCloseTab(tab.id)}
                    className={cn(
                      'inline-flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground transition-[width,margin,background-color,color,opacity,transform] hover:bg-background/70 hover:text-foreground active:scale-[0.96]',
                      isSharedSplitClose
                        ? (isSplitTabGroupHovered
                            ? 'mr-1 w-7 opacity-60 hover:opacity-100'
                            : 'mr-0 w-0 opacity-0')
                        : (selected
                            ? 'mr-1 w-7 opacity-60 hover:opacity-100'
                            : 'mr-0 w-0 opacity-0 group-hover:mr-1 group-hover:w-7 group-hover:opacity-60 group-hover:hover:opacity-100'),
                    )}
                    aria-label={isSharedSplitClose ? '退出并排，保留两个标签' : `关闭 ${tab.label}`}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )
            return onSplitTab ? (
              <ContextMenu key={tab.id}>
                <Tooltip delayDuration={700}>
                  <TooltipTrigger asChild>
                    <ContextMenuTrigger asChild>{tabNode}</ContextMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">向下拖拽以并排查看</TooltipContent>
                </Tooltip>
                <ContextMenuContent className="min-w-40">
                  <ContextMenuItem disabled={tab.id === activeTab && !visibleTabs} onSelect={() => onSplitTab(tab.id, 'left')}>
                    在左侧并排
                  </ContextMenuItem>
                  <ContextMenuItem disabled={tab.id === activeTab && !visibleTabs} onSelect={() => onSplitTab(tab.id, 'right')}>
                    在右侧并排
                  </ContextMenuItem>
                  {visibleTabs?.left && visibleTabs.right && onCollapseSplit && (
                    <ContextMenuItem onSelect={onCollapseSplit}>
                      退出并排，保留当前标签
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            ) : <React.Fragment key={tab.id}>{tabNode}</React.Fragment>
          })}
          </div>
          {hasHorizontalOverflow && (
            <div ref={scrollbarTrackRef} className="pointer-events-none absolute bottom-0.5 left-2 right-2 h-[2px] rounded-full">
              <div
                ref={scrollbarThumbRef}
                className="pointer-events-auto h-full cursor-grab rounded-full bg-muted-foreground/30 transition-[background-color] hover:bg-muted-foreground/50 active:cursor-grabbing"
                onPointerDown={handleScrollbarThumbPointerDown}
              />
            </div>
          )}
        </div>
        {activeTabAction && <div className="ml-1 flex shrink-0 items-center titlebar-no-drag">{activeTabAction}</div>}
        {visibleTabs?.left && visibleTabs.right && onCollapseSplit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mr-1 inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2 text-foreground transition-[background-color,color,transform] hover:bg-muted active:scale-[0.96]"
                onClick={onCollapseSplit}
                aria-label="退出并排，保留当前标签"
              >
                <Columns2 className="size-3.5" />
                <span className="text-[11px]">退出并排</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">退出并排，保留当前标签</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu open={isAddTabMenuOpen} onOpenChange={handleAddTabMenuOpenChange}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] hover:bg-muted hover:text-foreground active:scale-[0.96]"
                  aria-label="添加右侧工作区标签"
                >
                  <Plus className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">添加标签</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="z-[100] min-w-40 titlebar-no-drag"
            onPointerDownOutside={() => { suppressPointerDismissFocusRestoreRef.current = true }}
            onCloseAutoFocus={(event) => {
              if (!suppressPointerDismissFocusRestoreRef.current) return
              suppressPointerDismissFocusRestoreRef.current = false
              event.preventDefault()
            }}
          >
            <DropdownMenuItem onSelect={onOpenBrowser}>
              <Globe className="size-3.5" />
              新建浏览器标签
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenFile}>
              <FolderOpen className="size-3.5" />
              打开文件
            </DropdownMenuItem>
            {onOpenTerminal && (
              <DropdownMenuItem onSelect={onOpenTerminal}>
                <SquareTerminal className="size-3.5" />
                新建终端
              </DropdownMenuItem>
            )}
            {onOpenWorkspaceComponent && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('todos')}>
                  <ListTodo className="size-3.5" />
                  打开 Todo
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('calendar')}>
                  <CalendarDays className="size-3.5" />
                  打开日程
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('skills')}>
                  <Blocks className="size-3.5" />
                  打开 Skills
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('mcp')}>
                  <ServerCog className="size-3.5" />
                  打开 MCP
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('memory')}>
                  <Brain className="size-3.5" />
                  打开项目记忆
                </DropdownMenuItem>
              </>
            )}
            {onOpenChat && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onOpenChat}>
                  <MessageCircle className="size-3.5" />
                  打开问答
                </DropdownMenuItem>
              </>
            )}
            {onOpenWorkspaceComponent && (
              <DropdownMenuItem onSelect={() => onOpenWorkspaceComponent('automations')}>
                <Clock className="size-3.5" />
                打开定时任务
              </DropdownMenuItem>
            )}
            {onOpenVault && (
              <DropdownMenuItem onSelect={onOpenVault}>
                <ObsidianIcon className="size-3.5" />
                打开 {OBSIDIAN_NAME}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                className="mr-2 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] hover:bg-muted hover:text-foreground active:scale-[0.96]"
                aria-label="折叠右侧工作区"
              >
                <PanelRight className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">折叠右侧工作区 ({navigator.platform.includes('Mac') ? '⌘⇧B' : 'Ctrl+Shift+B'})</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
