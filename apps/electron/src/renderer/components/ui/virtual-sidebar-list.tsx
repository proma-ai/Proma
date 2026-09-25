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

interface VirtualSidebarListItemProps {
  /** 列表行复用时使用的数据索引；随索引变化重新创建 ref callback，让虚拟器重新测量 DOM。 */
  index: number
  start: number
  content: React.ReactNode
  measureElement: (node: Element | null) => void
}

/**
 * Virtualizer 行包装器。
 *
 * 行 ID 是虚拟器的稳定身份；index 只用于更新测量节点的 data-index 和位置，不参与 React key。
 * 这样展开/收起时，React 会按行身份移动/替换 DOM，而不会因为整体 index 偏移而重建整段可见列表。
 */
function VirtualSidebarListItem({
  index,
  start,
  content,
  measureElement,
}: VirtualSidebarListItemProps): React.ReactElement {
  const measureRef = React.useCallback((node: HTMLDivElement | null): void => {
    measureElement(node)
  }, [index, measureElement])

  return (
    <div
      ref={measureRef}
      data-index={index}
      className="absolute left-0 top-0 w-full"
      style={{ transform: `translateY(${start}px)` }}
    >
      {content}
    </div>
  )
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
  const rowsSignature = React.useMemo(
    () => rows.map((row) => `${row.id}:${row.estimateSize}`).join('|'),
    [rows],
  )
  const previousRowsSignatureRef = React.useRef(rowsSignature)

  React.useLayoutEffect(() => {
    if (previousRowsSignatureRef.current === rowsSignature) return
    previousRowsSignatureRef.current = rowsSignature
    // 行集合或顺序变化时，清除 TanStack Virtual 的旧尺寸缓存。
    // 否则恢复项目/折叠项目后，旧 index 可能复用相邻行的高度，造成选中串行和残影。
    virtualizer.measure()
  }, [rowsSignature, virtualizer])
  const items = virtualizer.getVirtualItems()
  const lastAutoScrolledRowIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!activeRowId) {
      lastAutoScrolledRowIdRef.current = null
      return
    }
    // 列表行会因状态更新或归档加载重建；这些变化不应打断用户手动滚动。
    if (lastAutoScrolledRowIdRef.current === activeRowId) return

    const index = rows.findIndex((row) => row.id === activeRowId)
    if (index < 0) return

    lastAutoScrolledRowIdRef.current = activeRowId
    virtualizer.scrollToIndex(index, { align: 'auto', behavior: 'auto' })
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
            <VirtualSidebarListItem
              key={item.key}
              index={item.index}
              start={item.start}
              content={row.content}
              measureElement={virtualizer.measureElement}
            />
          )
        })}
      </div>
    </div>
  )
}
