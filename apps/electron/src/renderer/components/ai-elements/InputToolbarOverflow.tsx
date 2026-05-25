/**
 * InputToolbarOverflow - 输入框底部工具栏的响应式折叠容器
 *
 * 当容器宽度不足以容纳所有工具按钮时，按尾部优先顺序把多余按钮
 * 折叠进右上角的「更多」Popover，避免按钮被挤压堆叠。
 *
 * 关键设计：
 * - 每个 item 在任意时刻只挂载一次（要么在主行，要么在 Popover 内），
 *   避免有 IPC 订阅 / useEffect 副作用的按钮被双重挂载。
 * - 首帧直接渲染全部 items 用于测量宽度，下一帧根据容器宽度计算可见数。
 *   宽度不足时，跨边界的按钮会从主行迁移到 Popover（unmount → remount，
 *   开销可接受，且仅在用户调整窗口尺寸的边界点发生）。
 * - ResizeObserver 同时监听容器宽度和主行内每个 item 的宽度变化
 *   （例如 ModelSelector 切换模型后宽度会变）。
 */

import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ToolbarItem {
  /** 唯一标识 */
  key: string
  /** 行内渲染的节点（建议是 36px 圆形按钮或带文本的紧凑按钮） */
  node: React.ReactNode
}

interface InputToolbarOverflowProps {
  /** 左侧按钮列表，按从左到右顺序，靠右的优先进溢出菜单 */
  items: ToolbarItem[]
  /** 右侧固定区（如发送 / 停止按钮），不参与折叠 */
  trailing?: React.ReactNode
  /** 按钮间距（px），与外部 gap-1.5 (0.375rem) 对应 */
  gapPx?: number
  /** 「更多」按钮宽度（px） */
  moreButtonPx?: number
  /** 容器额外 className */
  className?: string
}

const DEFAULT_GAP_PX = 6
const DEFAULT_MORE_BUTTON_PX = 36

export function InputToolbarOverflow({
  items,
  trailing,
  gapPx = DEFAULT_GAP_PX,
  moreButtonPx = DEFAULT_MORE_BUTTON_PX,
  className,
}: InputToolbarOverflowProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [itemWidths, setItemWidths] = React.useState<Record<string, number>>({})
  const [popoverOpen, setPopoverOpen] = React.useState(false)

  // 容器宽度监听
  React.useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.getBoundingClientRect().width)

    let raf = 0
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const entry = entries[0]
        if (entry) setContainerWidth(entry.contentRect.width)
      })
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  // 监听主行内每个 item 的实际宽度（覆盖 ModelSelector 等动态宽度场景）
  // 注意：依赖列表为空——每次 render 后由下方的 ref 注册 + 这里读取实现自动测量
  const readWidths = React.useCallback((): void => {
    setItemWidths((prev) => {
      const next: Record<string, number> = { ...prev }
      let changed = false
      for (const [key, el] of itemRefs.current.entries()) {
        const w = el.getBoundingClientRect().width
        if (w <= 0) continue
        if (next[key] === undefined || Math.abs(next[key]! - w) > 0.5) {
          next[key] = w
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  // 仅在 items 列表（key 集合）变化时重新注册 observer；
  // 宽度变化由 ResizeObserver 推送给 readWidths，不需要每次 render 都重订阅。
  // 之前缺依赖数组导致每次 render 都重跑 → setItemWidths → re-render → 死循环（React #185）。
  const itemKeysSignature = items.map((it) => it.key).join('|')
  React.useLayoutEffect(() => {
    readWidths()
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(readWidths)
    })
    for (const el of itemRefs.current.values()) {
      observer.observe(el)
    }
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [itemKeysSignature, readWidths])

  /**
   * 计算可见数量：依次累加 item 宽度直到超出容器，
   * 再为「更多」按钮预留空间倒推出最终能放下的 item 数。
   * 缺失测量数据时返回 items.length，让所有 item 先显示再测量。
   */
  const visibleCount = React.useMemo(() => {
    if (containerWidth === 0) return items.length
    if (!items.every((it) => itemWidths[it.key] !== undefined)) return items.length

    let total = 0
    for (let i = 0; i < items.length; i++) {
      const w = itemWidths[items[i]!.key]!
      const next = total + w + (i > 0 ? gapPx : 0)
      if (next > containerWidth) {
        const reserved = moreButtonPx + gapPx
        let fit = i
        let acc = total
        while (fit > 0 && acc + reserved > containerWidth) {
          fit -= 1
          const fitW = itemWidths[items[fit]!.key]!
          acc -= fitW + (fit > 0 ? gapPx : 0)
        }
        return Math.max(0, fit)
      }
      total = next
    }
    return items.length
  }, [containerWidth, itemWidths, items, gapPx, moreButtonPx])

  const visibleItems = items.slice(0, visibleCount)
  const overflowItems = items.slice(visibleCount)
  const hasOverflow = overflowItems.length > 0

  const setItemRef = (key: string) => (el: HTMLDivElement | null): void => {
    if (el) itemRefs.current.set(key, el)
    else itemRefs.current.delete(key)
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between px-2 py-1 h-[48px] gap-4',
        className
      )}
    >
      <div
        ref={containerRef}
        className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
      >
        {visibleItems.map((it) => (
          <div key={it.key} ref={setItemRef(it.key)} className="shrink-0 flex items-center">
            {it.node}
          </div>
        ))}
        {hasOverflow && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-[36px] shrink-0 rounded-full text-foreground/60 hover:text-foreground"
                    aria-label="更多工具"
                  >
                    <MoreHorizontal className="size-5" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>更多</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              side="top"
              align="end"
              className="w-auto p-1.5"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex items-center gap-1.5">
                {overflowItems.map((it) => (
                  <div key={it.key} className="shrink-0 flex items-center">
                    {it.node}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {trailing && <div className="flex items-center gap-1.5 shrink-0">{trailing}</div>}
    </div>
  )
}
