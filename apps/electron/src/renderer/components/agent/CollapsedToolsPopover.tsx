/**
 * 折叠态侧栏的工作区工具入口，支持 hover、点击、触摸和键盘。
 *
 * 与子会话面板共用 useHoverPopover：入口与弹层视作同一 hover 表面，离开后留
 * 宽限期再关闭；工具项先执行动作再收起弹层。
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  HOVER_POPOVER_CONTENT_CLASS,
  composeEventHandlers,
  useHoverPopover,
} from '@/hooks/useHoverPopover'

type TriggerElement = React.ReactElement<{
  onMouseEnter?: React.MouseEventHandler
  onMouseLeave?: React.MouseEventHandler
  onPointerDown?: React.PointerEventHandler
  onKeyDown?: React.KeyboardEventHandler
}>

export interface CollapsedToolItem {
  label: string
  icon: React.ReactNode
  active?: boolean
  badge?: string
  showUpdate?: boolean
  onClick: () => void
}

export function CollapsedToolsPopover({
  children,
  items,
}: {
  children: React.ReactNode
  items: CollapsedToolItem[]
}): React.ReactElement {
  const popover = useHoverPopover()

  const child = React.Children.only(children) as TriggerElement
  const trigger = React.cloneElement(child, {
    onMouseEnter: composeEventHandlers(child.props.onMouseEnter, popover.hoverProps.onMouseEnter),
    onMouseLeave: composeEventHandlers(child.props.onMouseLeave, popover.hoverProps.onMouseLeave),
    onPointerDown: composeEventHandlers(child.props.onPointerDown, popover.manualTriggerProps.onPointerDown),
    onKeyDown: composeEventHandlers(child.props.onKeyDown, popover.manualTriggerProps.onKeyDown),
  })

  return (
    <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className={cn('w-48 p-1.5', HOVER_POPOVER_CONTENT_CLASS)}
        {...popover.hoverProps}
        {...popover.contentFocusProps}
      >
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-current={item.active ? 'page' : undefined}
              onClick={() => {
                // 先执行工具动作再收起，避免关闭时提前卸载当前按钮。
                item.onClick()
                popover.close()
              }}
              className={cn(
                'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                item.active
                  ? 'bg-accent/70 text-accent-foreground'
                  : 'text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.badge && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium leading-4 text-primary-foreground tabular-nums">
                  {item.badge}
                </span>
              )}
              {item.showUpdate && <span className="size-2 shrink-0 rounded-full bg-blue-500" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
