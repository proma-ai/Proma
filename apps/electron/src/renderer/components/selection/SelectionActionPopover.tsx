import * as React from 'react'
import { createPortal } from 'react-dom'
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
  // 顶部选区若仍向上展开，浮窗会被窗口边缘裁掉；此时改为在选区下方展示。
  const openBelow = y < 72
  // 浮窗有两个不可换行的动作。靠近视口边缘时改为向内对齐，避免 flex item 收缩后中文逐字竖排。
  const viewportWidth = window.innerWidth
  const edgePadding = 12
  const estimatedPopoverWidth = 292
  const alignRight = x > viewportWidth - estimatedPopoverWidth - edgePadding
  const alignLeft = !alignRight && x < estimatedPopoverWidth / 2 + edgePadding
  const horizontalTransform = alignRight ? '-translate-x-full' : alignLeft ? 'translate-x-0' : '-translate-x-1/2'
  const left = alignRight ? x - edgePadding : alignLeft ? x + edgePadding : x
  const content = (
    <div
      data-selection-action-popover
      className={`fixed z-[90] ${horizontalTransform} rounded-xl bg-popover/95 px-2 py-1.5 text-popover-foreground shadow-xl ring-1 ring-border/40 backdrop-blur ${openBelow ? 'translate-y-0' : '-translate-y-full'}`}
      style={{ left, top: openBelow ? y + 20 : y }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-muted"
          onClick={onAddToAgent}
        >
          <Bot className="size-4" />
          为 Agent 引用
        </button>
        {openSideAssistant && (
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-muted"
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

  // 预览与 Vault 均位于 overflow/transform 容器内；挂到 body 才不会被裁切或压在右侧工作区下层。
  return createPortal(content, document.body)
}
