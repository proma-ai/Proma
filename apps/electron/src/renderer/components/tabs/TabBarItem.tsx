/**
 * TabBarItem — 单个标签页 UI
 *
 * 显示：类型图标 + 标题 + 流式指示器 + 关闭按钮
 * 支持：点击聚焦、中键关闭、拖拽重排
 */

import * as React from 'react'
import { MessageSquare, Bot, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TabType } from '@/atoms/tab-atoms'

export interface TabBarItemProps {
  id: string
  type: TabType
  title: string
  isActive: boolean
  isStreaming: boolean
  onActivate: () => void
  onClose: () => void
  onMiddleClick: () => void
  /** 拖拽相关 */
  onDragStart: (e: React.PointerEvent) => void
}

export function TabBarItem({
  type,
  title,
  isActive,
  isStreaming,
  onActivate,
  onClose,
  onMiddleClick,
  onDragStart,
}: TabBarItemProps): React.ReactElement {
  const handleMouseDown = (e: React.MouseEvent): void => {
    // 中键点击关闭
    if (e.button === 1) {
      e.preventDefault()
      onMiddleClick()
    }
  }

  const handleCloseClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onClose()
  }

  const Icon = type === 'chat' ? MessageSquare : Bot

  return (
    <button
      type="button"
      className={cn(
        'group relative flex items-center gap-1.5 px-3 h-[34px] min-w-[100px] max-w-[200px] shrink-0',
        'rounded-t-lg text-xs transition-colors select-none cursor-pointer',
        'border-t border-l border-r border-transparent',
        isActive
          ? 'bg-content-area text-foreground border-border/50 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.04)]'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
      )}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      onPointerDown={onDragStart}
    >
      {/* 类型图标 */}
      <Icon className="size-3 shrink-0" />

      {/* 标题 */}
      <span className="flex-1 min-w-0 truncate text-left">{title}</span>

      {/* 流式指示器 */}
      {isStreaming && (
        <span
          className={cn(
            'size-1.5 rounded-full shrink-0 animate-pulse',
            type === 'chat' ? 'bg-emerald-500' : 'bg-blue-500'
          )}
        />
      )}

      {/* 关闭按钮 */}
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
    </button>
  )
}
