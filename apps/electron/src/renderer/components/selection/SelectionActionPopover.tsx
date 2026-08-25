import * as React from 'react'
import { Bot, MessageSquarePlus } from 'lucide-react'

interface SelectionActionPopoverProps {
  x: number
  y: number
  onAddToAgent: () => void
  /** Pi `/tree`：从当前 Agent 历史节点创建右侧探索分支。 */
  onOpenExplorationBranch?: () => void | Promise<void>
  /** 兼容尚未迁移的临时 Agent 入口。 */
  onOpenTemporaryAgent?: () => void | Promise<void>
  /** 兼容尚未迁移的文件 / Scratch 选区入口。 */
  onOpenChat?: () => void | Promise<void>
}

export function SelectionActionPopover({
  x,
  y,
  onAddToAgent,
  onOpenExplorationBranch,
  onOpenTemporaryAgent,
  onOpenChat,
}: SelectionActionPopoverProps): React.ReactElement {
  const openSideAssistant = onOpenExplorationBranch ?? onOpenTemporaryAgent ?? onOpenChat
  return (
    <div
      data-selection-action-popover
      className="fixed z-[90] -translate-x-1/2 -translate-y-full rounded-xl bg-popover/95 px-2 py-1.5 text-popover-foreground shadow-xl ring-1 ring-border/40 backdrop-blur"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-muted"
          onClick={onAddToAgent}
        >
          <Bot className="size-4" />
          为 Agent 引用
        </button>
        {openSideAssistant && (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-muted"
            onClick={() => {
              void openSideAssistant()
            }}
          >
            <MessageSquarePlus className="size-4" />
            {onOpenExplorationBranch ? '探索此分支' : onOpenTemporaryAgent ? '打开临时 Agent' : '打开右侧问答'}
          </button>
        )}
      </div>
    </div>
  )
}
