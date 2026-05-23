/**
 * CollapsedWorkspacePopover — 折叠态侧栏的工作区快速切换弹层
 *
 * 鼠标悬停在折叠侧栏的 Agent 模式按钮上时弹出，提供：
 * - 当前所有工作区列表，点击即切换
 * - 顶部 `+` 按钮支持 inline 新建
 *
 * 不包含重命名/删除/拖拽/高度调整等低频操作——这些留给展开态的 WorkspaceSelector。
 * 切换/创建逻辑通过 useWorkspaceActions 与展开态共享，确保行为一致。
 * 悬停控制复用 ContextUsageBadge 中的 cancelClose / scheduleClose 模式。
 */

import * as React from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions'

/** Popover hover 关闭延迟（ms），与项目其他 hover popover 一致 */
const HOVER_CLOSE_DELAY = 150

interface CollapsedWorkspacePopoverProps {
  children: React.ReactNode
}

export function CollapsedWorkspacePopover({
  children,
}: CollapsedWorkspacePopoverProps): React.ReactElement {
  const { workspaces, currentWorkspaceId, selectWorkspace, createWorkspace } = useWorkspaceActions()

  const [open, setOpen] = React.useState(false)
  const closeTimerRef = React.useRef<number | null>(null)

  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = React.useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY)
  }, [cancelClose])

  React.useEffect(() => () => cancelClose(), [cancelClose])

  // 新建状态
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const createInputRef = React.useRef<HTMLInputElement>(null)

  const handleSelect = (workspaceId: string): void => {
    selectWorkspace(workspaceId)
    setOpen(false)
  }

  const handleStartCreate = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setCreating(true)
    setNewName('')
    requestAnimationFrame(() => {
      createInputRef.current?.focus()
    })
  }

  const handleCreate = async (): Promise<void> => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }
    const workspace = await createWorkspace(trimmed)
    setCreating(false)
    if (workspace) setOpen(false)
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      handleCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setCreating(false)
    }
  }

  // 新建态下不允许 hover 离开就关闭，避免输入过程中弹层消失
  const handleContentMouseLeave = (): void => {
    if (creating) return
    scheduleClose()
  }

  return (
    <Popover open={open} onOpenChange={(v) => {
      setOpen(v)
      if (!v) setCreating(false)
    }}>
      <PopoverTrigger asChild>
        <span
          onMouseEnter={() => {
            cancelClose()
            setOpen(true)
          }}
          onMouseLeave={scheduleClose}
          onClickCapture={() => {
            // 点击触发元素（如 Agent 模式按钮）时关闭弹层，
            // 避免切换模式后弹层因 hover 状态滞留 150ms
            cancelClose()
            setOpen(false)
          }}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-56 p-0 overflow-hidden"
        onMouseEnter={cancelClose}
        onMouseLeave={handleContentMouseLeave}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/40">
          <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">
            Agent 模式 · 工作区
          </span>
          <button
            type="button"
            onClick={handleStartCreate}
            className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/35 hover:text-foreground/60 transition-colors"
            title="新建工作区"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* 工作区列表 */}
        <div className="flex flex-col p-1 max-h-[320px] overflow-y-auto scrollbar-thin">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => handleSelect(ws.id)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-[5px] rounded-md text-[13px] transition-colors duration-100 text-left',
                ws.id === currentWorkspaceId
                  ? 'bg-foreground/[0.08] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                  : 'text-foreground/70 hover:bg-foreground/[0.04]',
              )}
            >
              <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
              <span className="flex-1 min-w-0 truncate">{ws.name}</span>
            </button>
          ))}

          {creating && (
            <div className="flex items-center gap-2 px-2 py-[5px]">
              <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
              <input
                ref={createInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                onBlur={() => setCreating(false)}
                placeholder="工作区名称..."
                className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5"
                maxLength={50}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
