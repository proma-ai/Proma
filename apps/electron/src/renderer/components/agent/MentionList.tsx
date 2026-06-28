/**
 * MentionList — 泛型 Mention 下拉列表
 *
 * 统一键盘导航（上/下/Enter/Escape）、选中高亮、滚动定位。
 * 通过 renderItem / keyExtractor 适配不同 Mention 类型（Skill、MCP 等）。
 * 通过 React.useImperativeHandle 暴露 onKeyDown 给 TipTap Suggestion。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface MentionListProps<T> {
  items: T[]
  onSelect: (item: T) => void
  /** 空列表占位文字 */
  emptyText: string
  /** 从 item 提取唯一 key */
  keyExtractor: (item: T) => string
  /** 自定义每项渲染 */
  renderItem: (item: T) => React.ReactNode
  /** 标题栏左侧标签（如 Skill / MCP 服务 / 会话），不传则只显示快捷键提示 */
  headerLabel?: string
}

/** 标题栏：左侧面板类型标签，右侧快捷键提示 */
function MentionHeader({ label }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] font-medium bg-primary/10 text-primary border-b border-border/50">
      <span>{label}</span>
      <span className="font-normal text-muted-foreground">Esc 关闭 · Enter 选中</span>
    </div>
  )
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

function MentionListInner<T>(
  { items, onSelect, emptyText, keyExtractor, renderItem, headerLabel }: MentionListProps<T>,
  ref: React.ForwardedRef<MentionListRef>,
): React.ReactElement {
  const [localIndex, setLocalIndex] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setLocalIndex(0)
  }, [items])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const item = container.children[localIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [localIndex])

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
      // Escape 不在此处理：返回 false 交还给 TipTap suggestion 插件内置的
      // Escape 分支，由它调用 onExit（触发我们的 cleanup 移除弹窗）并 dispatchExit
      // 重置插件 active 状态。若在此 return true，插件会认为已处理而跳过退出，
      // 导致弹窗无法关闭，必须靠输入空格让 suggestion 匹配失效才会消失。
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-popover shadow-lg overflow-hidden w-[280px]">
        <MentionHeader label={headerLabel} />
        <div className="p-2 text-[11px] text-muted-foreground">{emptyText}</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-popover shadow-lg overflow-hidden w-[280px]">
      <MentionHeader label={headerLabel} />
      {/* containerRef 只包裹列表项，键盘导航靠 children[index] 定位，head 须置于其外 */}
      <div ref={containerRef} className="overflow-y-auto max-h-[240px]">
        {items.map((item, index) => (
          <button
            key={keyExtractor(item)}
            type="button"
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent transition-colors',
              index === localIndex && 'bg-accent text-accent-foreground',
            )}
            // 用 mousedown 而非 click：异步 items 重渲染会替换 button 节点，
            // 导致 mousedown/mouseup 不在同一节点、click 不派发而漏选；
            // preventDefault 阻止按钮抢焦点，避免编辑器 blur 触发弹窗关闭竞态。
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(item)
            }}
          >
            {renderItem(item)}
          </button>
        ))}
      </div>
    </div>
  )
}

// 泛型 forwardRef 包装
export const MentionList = React.forwardRef(MentionListInner) as <T>(
  props: MentionListProps<T> & { ref?: React.Ref<MentionListRef> },
) => React.ReactElement
