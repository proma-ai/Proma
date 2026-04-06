/**
 * FileMentionList — @ 引用文件下拉列表
 *
 * 显示文件搜索结果，支持键盘导航（上/下/Enter/Escape）。
 * 通过 React.useImperativeHandle 暴露 onKeyDown 给 TipTap Suggestion。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { FileIndexEntry } from '@proma/shared'
import { FileTypeIcon } from './FileTypeIcon'

export interface FileMentionListProps {
  items: FileIndexEntry[]
  selectedIndex: number
  onSelect: (item: FileIndexEntry) => void
}

export interface FileMentionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const FileMentionList = React.forwardRef<FileMentionRef, FileMentionListProps>(
  function FileMentionList({ items, selectedIndex, onSelect }, ref) {
    const [localIndex, setLocalIndex] = React.useState(selectedIndex)
    const containerRef = React.useRef<HTMLDivElement>(null)

    // items 变化时重置选中索引
    React.useEffect(() => {
      setLocalIndex(0)
    }, [items])

    // 滚动选中项到可见区域
    React.useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const item = container.children[localIndex] as HTMLElement | undefined
      item?.scrollIntoView({ block: 'nearest' })
    }, [localIndex])

    // 暴露键盘处理给 TipTap
    React.useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setLocalIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1))
          return true
        }
        if (event.key === 'ArrowDown') {
          setLocalIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1))
          return true
        }
        if (event.key === 'Enter') {
          if (items.length === 0) return false
          const item = items[localIndex]
          if (item) onSelect(item)
          return true
        }
        if (event.key === 'Escape') {
          return true
        }
        return false
      },
    }))

    // 无匹配结果
    if (items.length === 0) {
      return (
        <div className="rounded-lg border bg-popover p-2 shadow-lg text-[11px] text-muted-foreground">
          无匹配文件
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className="rounded-lg border bg-popover shadow-lg overflow-y-auto max-h-[280px] min-w-[200px]"
      >
        {items.map((item, index) => (
          <button
            key={item.path}
            type="button"
            className={cn(
              'w-full flex items-center gap-1.5 px-2.5 py-1 text-left text-xs hover:bg-accent transition-colors',
              index === localIndex && 'bg-accent text-accent-foreground',
            )}
            onClick={() => onSelect(item)}
          >
            <FileTypeIcon name={item.name} isDirectory={item.type === 'dir'} size={12} />
            <span className="truncate flex-1">{item.name}</span>
            {/* 显示相对路径（当路径不等于文件名时） */}
            {item.path !== item.name && (
              <span className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                {item.path}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  },
)
