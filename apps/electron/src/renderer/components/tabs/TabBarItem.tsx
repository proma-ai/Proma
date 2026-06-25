/**
 * TabBarItem — 单个标签页 UI
 *
 * 显示：标题 + 工作区标签 + 流式指示器 + 关闭按钮
 * 支持：点击聚焦、中键关闭、拖拽重排
 * hover 预览面板由父级 TabBar 统一管理状态
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useAtomValue } from 'jotai'
import { FileText, StickyNote, X, Clock, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TabType, TabMinimapItem } from '@/atoms/tab-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { tabMinimapCacheAtom } from '@/atoms/tab-atoms'
import { interfaceVariantAtom } from '@/atoms/theme'
import { Spinner } from '@/components/ui/spinner'
import { TabPreviewPanel } from './TabPreviewPanel'

export interface TabBarItemProps {
  id: string
  type: TabType
  title: string
  workspaceName?: string
  isActive: boolean
  isStreaming: SessionIndicatorStatus
  /** 是否显示 hover 预览面板（由父级管理） */
  isHovered: boolean
  /** 预览面板是否正在退出动画 */
  isLeaving: boolean
  /** 该 Tab 正在被拖出 TabBar 转分屏（tear-off 触发瞬间） */
  isTearingOff?: boolean
  onActivate: () => void
  onClose: () => void
  onMiddleClick: () => void
  onDragStart: (e: React.PointerEvent) => void
  /** 该 Tab 对应的会话是否由定时任务创建 */
  isAutomation?: boolean
  /** 该 Tab 对应的会话是否由父 Agent 协作委派创建 */
  isDelegation?: boolean
  /** hover 进入 Tab */
  onHoverEnter: () => void
  /** hover 离开 Tab */
  onHoverLeave: () => void
  /** hover 进入面板（阻止关闭） */
  onPanelHoverEnter: () => void
  /** hover 离开面板 */
  onPanelHoverLeave: () => void
}

export function TabBarItem({
  id,
  type,
  title,
  workspaceName,
  isActive,
  isStreaming,
  isHovered,
  isLeaving,
  isTearingOff,
  onActivate,
  onClose,
  onMiddleClick,
  onDragStart,
  isAutomation,
  isDelegation,
  onHoverEnter,
  onHoverLeave,
  onPanelHoverEnter,
  onPanelHoverLeave,
}: TabBarItemProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const [isNarrow, setIsNarrow] = React.useState(false)
  const minimapCache = useAtomValue(tabMinimapCacheAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'

  React.useEffect(() => {
    const el = buttonRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setIsNarrow(entry.contentRect.width < 72)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleMouseDown = (e: React.MouseEvent): void => {
    // Scratch Pad 不可中键关闭
    if (type === 'scratch') return
    if (e.button === 1) {
      e.preventDefault()
      onMiddleClick()
    }
  }

  const handleCloseClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onClose()
  }

  const isScratch = type === 'scratch'
  const showAgentSpinner = type === 'agent' && isStreaming === 'running'
  const previewItems = minimapCache.get(id) ?? []
  // 当前 active Tab 不显示预览面板
  const showPreview = isHovered && !isActive

  // Scratch Pad 是固定草稿入口
  if (isScratch) {
    return (
      <div
        className="relative flex-shrink-0 titlebar-no-drag"
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
      >
        <button
          ref={buttonRef}
          type="button"
          className={cn(
            'group relative flex items-center justify-center gap-1.5 min-w-[82px] px-3 h-[34px]',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'text-xs transition-colors select-none cursor-pointer',
            'border-t border-l border-r border-transparent',
            isActive
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground hover:text-foreground',
          )}
          onClick={onActivate}
          onMouseDown={handleMouseDown}
          onPointerDown={onDragStart}
        >
          <StickyNote className="size-3.5" />
          <span className="truncate">草稿</span>
        </button>
      </div>
    )
  }

  return (
    <div
      className="relative min-w-[132px] max-w-[240px] flex-[1_0_132px] titlebar-no-drag"
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'group relative flex items-center gap-1.5 px-3 h-[34px] w-full',
          isClassic ? 'rounded-t-lg' : 'rounded-none',
          'text-xs transition-colors select-none cursor-pointer',
          'border-t border-l border-r border-transparent',
          isActive
            ? isClassic
              ? 'bg-content-area text-foreground border-border/50'
              : 'app-tab-active text-foreground border-border/80'
            : isClassic
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              : 'app-tab-inactive text-muted-foreground hover:text-foreground',
          isTearingOff && 'ring-2 ring-primary/70 ring-offset-0 bg-primary/10',
        )}
        onClick={onActivate}
        onMouseDown={handleMouseDown}
        onPointerDown={onDragStart}
      >
        {type === 'preview' && !isNarrow && (
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        {/* 标题（窄状态下隐藏，用 spacer 撑开让关闭按钮靠右） */}
        {isNarrow ? (
          <span className="flex-1" />
        ) : (
          <span className="flex-1 min-w-0 truncate text-left flex items-center gap-1">
            {showAgentSpinner && <Spinner size="sm" className="mr-2 shrink-0 text-primary/70" />}
            {isAutomation && <Clock className="size-3 shrink-0 text-foreground/40" />}
            {isDelegation && !isAutomation && <GitBranch className="size-3 shrink-0 text-foreground/40" />}
            <span className="min-w-0 truncate">{title}</span>
          </span>
        )}

        {workspaceName && !isNarrow && (
          <span className="shrink-0 px-1.5 py-0 rounded-full bg-primary/10 text-[10px] leading-4 workspace-badge font-medium truncate max-w-[86px]">
            {workspaceName}
          </span>
        )}

        {/* 关闭按钮（scratch 类型不显示） */}
        {!isScratch && (
        <span
          role="button"
          tabIndex={-1}
          className={cn(
            'size-4 rounded-sm flex items-center justify-center shrink-0',
            'opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-opacity',
            isActive && 'opacity-60',
          )}
          onClick={handleCloseClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleCloseClick(e as unknown as React.MouseEvent)
          }}
        >
          <X className="size-2.5" />
        </span>
        )}

      </button>

      {/* 悬浮预览面板（Portal 渲染到 body） */}
      {showPreview && (
        <TabPreviewDropdown
          buttonRef={buttonRef}
          title={title}
          items={previewItems}
          isLeaving={isLeaving}
          onMouseEnter={onPanelHoverEnter}
          onMouseLeave={onPanelHoverLeave}
        />
      )}
    </div>
  )
}

/** 使用 Portal 渲染到 body，避免被容器 overflow 裁剪或被内容区遮盖 */
function TabPreviewDropdown({
  buttonRef,
  title,
  items,
  isLeaving,
  onMouseEnter,
  onMouseLeave,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  title: string
  items: TabMinimapItem[]
  isLeaving: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}): React.ReactElement | null {
  const panelWidth = 280
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)

  React.useLayoutEffect(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const top = rect.bottom
    let left = rect.left
    if (left + panelWidth > viewportWidth - 8) {
      left = viewportWidth - panelWidth - 8
    }
    if (left < 8) {
      left = 8
    }
    setPos({ top, left })
  }, [buttonRef])

  if (!pos) return null

  return createPortal(
    <div
      className="fixed z-[9999] pt-1"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <TabPreviewPanel title={title} items={items} isLeaving={isLeaving} />
    </div>,
    document.body
  )
}
