/**
 * DiffPanelTabBar — 右侧工作区的统一顶栏。
 *
 * 文件、改动、预览、问答和每个浏览器网页位于同一层级；网页不再拥有嵌套 Tab 栏。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Blocks, Brain, CalendarDays, Clock, FolderOpen, Globe, ListTodo, MessageCircle, PanelRight, Plus, Repeat2, ServerCog, SquareTerminal, X } from 'lucide-react'
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
import { agentDiffUnseenChangesAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import type { AgentSidePanelTab, WorkspaceComponentTab } from '@/atoms/agent-atoms'

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
  onOpenChat?: () => void
  /** 仅当前右侧 Tab 需要的紧凑动作，渲染于标签列表之后，不影响内容区布局。 */
  activeTabAction?: React.ReactNode
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
  onOpenChat,
  activeTabAction,
  onClose,
}: DiffPanelTabBarProps): React.ReactElement {
  const unseenMap = useAtomValue(agentDiffUnseenChangesAtom)
  const setUnseenMap = useSetAtom(agentDiffUnseenChangesAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const unseenChanges = unseenMap.get(currentSessionId ?? '') ?? false
  const [isAddTabMenuOpen, setIsAddTabMenuOpen] = React.useState(false)
  // 仅鼠标在菜单外取消时抑制 Radix 的回焦；Esc 与键盘选择必须保留可见焦点。
  const suppressPointerDismissFocusRestoreRef = React.useRef(false)
  const tabListRef = React.useRef<HTMLDivElement>(null)
  const tabRefs = React.useRef(new Map<AgentSidePanelTab, HTMLDivElement>())

  React.useEffect(() => () => onAddTabMenuOpenChange?.(false), [onAddTabMenuOpenChange])

  const handleAddTabMenuOpenChange = React.useCallback((open: boolean) => {
    if (open) suppressPointerDismissFocusRestoreRef.current = false
    setIsAddTabMenuOpen(open)
    onAddTabMenuOpenChange?.(open)
  }, [onAddTabMenuOpenChange])

  React.useLayoutEffect(() => {
    const tabList = tabListRef.current
    const activeTabElement = tabRefs.current.get(activeTab)
    if (!tabList || !activeTabElement) return

    const nextScrollLeft = getScrollLeftToRevealTab(tabList, activeTabElement)
    if (nextScrollLeft !== tabList.scrollLeft) {
      tabList.scrollTo({ left: nextScrollLeft, behavior: 'smooth' })
    }
  }, [activeTab, tabs.length])

  const selectTab = React.useCallback((tab: AgentSidePanelTab) => {
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

  return (
    <div className="relative flex h-10 shrink-0 items-center border-b border-border/50 bg-content-area">
      <div className="pointer-events-none absolute inset-0 titlebar-drag-region" />
      <div className="relative flex min-w-0 flex-1 items-center titlebar-no-drag">
        <div ref={tabListRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain px-2 py-1 scrollbar-none" role="tablist" aria-label="右侧工作区">
          {tabs.map((tab) => {
            const selected = activeTab === tab.id
            const isChangesTab = tab.id === 'changes'
            return (
              <div
                key={tab.id}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.id, element)
                  else tabRefs.current.delete(tab.id)
                }}
                className={cn(
                  'group flex h-7 min-w-[84px] max-w-60 shrink-0 items-center rounded-lg transition-[background-color,color] duration-150',
                  selected
                    ? 'bg-foreground/[0.08] text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectTab(tab.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-left text-[13px] outline-none"
                >
                  {tab.activity || (isChangesTab && unseenChanges && !selected) ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="有未查看更新" />
                  ) : (
                    <span className={cn('shrink-0', selected ? 'text-foreground' : 'text-muted-foreground/80')}>{tab.icon}</span>
                  )}
                  <span className="truncate">{tab.label}</span>
                </button>
                {tab.closable && (
                  <button
                    type="button"
                    onClick={() => onCloseTab(tab.id)}
                    className={cn(
                      'inline-flex h-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground transition-[width,margin,background-color,color,opacity,transform] hover:bg-background/70 hover:text-foreground active:scale-[0.96]',
                      selected
                        ? 'mr-1 w-7 opacity-60 hover:opacity-100'
                        : 'mr-0 w-0 opacity-0 group-hover:mr-1 group-hover:w-7 group-hover:opacity-60 group-hover:hover:opacity-100',
                    )}
                    aria-label={`关闭 ${tab.label}`}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {activeTabAction && <div className="ml-1 flex shrink-0 items-center titlebar-no-drag">{activeTabAction}</div>}
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
