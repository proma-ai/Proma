import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'

export interface VirtualSidebarRow {
  id: string
  /** 预估高度只影响首帧；实际挂载后由 measureElement 自动校正。 */
  estimateSize: number
  content: React.ReactNode
}

interface VirtualSidebarListProps {
  rows: VirtualSidebarRow[]
  className?: string
  /** 选中行离开挂载范围时，自动定位后再挂载，保持原侧栏的选中项可见行为。 */
  activeRowId?: string | null
  /** 额外提前挂载的行数，保证触控板快速滚动时不会露白。 */
  overscan?: number
}

/**
 * 左侧栏统一虚拟列表容器。
 *
 * 保持原生 overflow 滚动、可变行高和 DOM 测量；仅让视口附近行挂载，避免会话
 * 数量增长后 ContextMenu、Tooltip、hover hook 等交互树长期占据 DOM。
 */
export function VirtualSidebarList({
  rows,
  className,
  activeRowId,
  overscan = 10,
}: VirtualSidebarListProps): React.ReactElement {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rows[index]?.estimateSize ?? 34,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan,
  })
  const items = virtualizer.getVirtualItems()

  React.useEffect(() => {
    if (!activeRowId) return
    const index = rows.findIndex((row) => row.id === activeRowId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto', behavior: 'smooth' })
  }, [activeRowId, rows, virtualizer])

  return (
    <div ref={parentRef} className={cn('min-h-0 overflow-y-auto scrollbar-thin titlebar-no-drag', className)}>
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const row = rows[item.index]
          if (!row) return null
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
