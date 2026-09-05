/**
 * 折叠态主会话的委派子会话快速查看面板。
 * 鼠标悬浮主会话时展示所有子会话；键盘用 ArrowRight 打开。
 *
 * 整块入口只有一个点击语义：切到主会话。右下角的 delegation 角标是纯装饰，
 * 不拦指针也没有 hover 特效，hover 展开已经足够揭示子会话的存在。
 *
 * 开合与焦点策略统一由 useHoverPopover 提供：入口与弹层是同一个 hover 表面，
 * 离开后留出宽限期再关闭；子会话项先执行导航再收起弹层，保证点击一定生效。
 */

import * as React from 'react'
import { GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { AgentSessionMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import {
  getDelegatedChildSessionStatus,
  getDelegationStatusIconClass,
} from '@/lib/agent-session-list'
import {
  HOVER_POPOVER_CONTENT_CLASS,
  composeEventHandlers,
  useHoverPopover,
} from '@/hooks/useHoverPopover'

type TriggerElement = React.ReactElement<{
  onClick?: React.MouseEventHandler
  onKeyDown?: React.KeyboardEventHandler
  'aria-expanded'?: boolean
  'aria-controls'?: string
  'aria-keyshortcuts'?: string
}>

interface CollapsedDelegatedSessionsPopoverProps {
  parentTitle: string
  childSessions: AgentSessionMeta[]
  activeSessionId: string | null
  activeDelegationSessionId: string | null
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  /** Rail 同时只允许一个子会话面板展开，因此开合状态由 Rail 持有。 */
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (session: AgentSessionMeta) => void
  children: React.ReactNode
}

export function CollapsedDelegatedSessionsPopover({
  parentTitle,
  childSessions,
  activeSessionId,
  activeDelegationSessionId,
  agentIndicatorMap,
  open,
  onOpenChange,
  onSelect,
  children,
}: CollapsedDelegatedSessionsPopoverProps): React.ReactElement {
  const contentId = React.useId()
  const anchorRef = React.useRef<HTMLSpanElement | null>(null)
  const popover = useHoverPopover({ open, onOpenChange })

  const child = React.Children.only(children) as TriggerElement
  const parentButton = React.cloneElement(child, {
    // 整块只有一个点击语义：切到主会话，并收起子会话面板。
    onClick: composeEventHandlers(child.props.onClick, popover.close),
    // hover 对键盘与触摸不可用，保留一个不与导航冲突的展开快捷键。
    onKeyDown: composeEventHandlers(child.props.onKeyDown, (event) => {
      if (event.key !== 'ArrowRight' || childSessions.length === 0) return
      event.preventDefault()
      popover.openByKeyboard()
    }),
    'aria-expanded': popover.open,
    'aria-controls': popover.open ? contentId : undefined,
    'aria-keyshortcuts': 'ArrowRight',
  })

  return (
    <Popover open={popover.open} onOpenChange={popover.onOpenChange}>
      <PopoverAnchor asChild>
        <span ref={anchorRef} className="relative inline-flex size-10" {...popover.hoverProps}>
          {parentButton}
          {/* 纯装饰角标：不拦指针、不可聚焦、无 hover 特效，点击直接穿透到主会话按钮。 */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-0.5 -right-0.5 z-10 flex size-5 items-center justify-center text-foreground/45"
          >
            <GitBranch size={11} />
          </span>
        </span>
      </PopoverAnchor>
      <PopoverContent
        id={contentId}
        side="right"
        align="start"
        sideOffset={8}
        aria-label={`「${parentTitle}」的子会话`}
        className={cn('w-64 p-1.5', HOVER_POPOVER_CONTENT_CLASS)}
        {...popover.hoverProps}
        {...popover.contentFocusProps}
        onCloseAutoFocus={(event) => {
          popover.contentFocusProps.onCloseAutoFocus(event)
          if (event.defaultPrevented) return
          // 没有独立 trigger 按钮，Radix 无处归还焦点：显式送回主会话按钮。
          event.preventDefault()
          anchorRef.current?.querySelector('button')?.focus()
        }}
      >
        {childSessions.length > 0 ? (
          <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto scrollbar-thin">
            {childSessions.map((session) => {
              const status = getDelegatedChildSessionStatus(session, agentIndicatorMap)
              const active = session.id === activeSessionId
                || (session.parentSessionId === activeSessionId && session.id === activeDelegationSessionId)
              return (
                <button
                  key={session.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    // 先导航再收起：关闭动作不能抢在导航之前卸载当前列表项。
                    onSelect(session)
                    popover.close()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-accent/70 text-accent-foreground'
                      : 'text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground',
                  )}
                >
                  <GitBranch className={cn('size-3.5 shrink-0', getDelegationStatusIconClass(status))} />
                  <span className="min-w-0 flex-1 truncate">{session.title || '未命名子会话'}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="px-2 py-2 text-[12px] text-foreground/40">暂无子会话</div>
        )}
      </PopoverContent>
    </Popover>
  )
}
