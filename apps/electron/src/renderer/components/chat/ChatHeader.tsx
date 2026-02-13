/**
 * ChatHeader - 对话头部
 *
 * 显示对话标题（可点击编辑）+ 置顶按钮 + 并排模式切换按钮。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Pencil, Check, X, Columns2, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { currentConversationAtom, conversationsAtom, parallelModeAtom } from '@/atoms/chat-atoms'

export function ChatHeader(): React.ReactElement | null {
  const conversation = useAtomValue(currentConversationAtom)
  const setConversations = useSetAtom(conversationsAtom)
  const [parallelMode, setParallelMode] = useAtom(parallelModeAtom)
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  if (!conversation) return null

  const isPinned = !!conversation.pinned

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(conversation.title)
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false)
      return
    }

    try {
      const updated = await window.electronAPI.updateConversationTitle(conversation.id, trimmed)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
    } catch (error) {
      console.error('[ChatHeader] 更新标题失败:', error)
    }
    setEditing(false)
  }

  /** 切换置顶状态 */
  const handleTogglePin = async (): Promise<void> => {
    try {
      const updated = await window.electronAPI.togglePinConversation(conversation.id)
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      )
    } catch (error) {
      console.error('[ChatHeader] 切换置顶失败:', error)
    }
  }

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <div className="relative z-[51] flex items-center gap-2 px-4 h-[48px] titlebar-drag-region">
      {editing ? (
        <div className="flex items-center gap-1.5 flex-1 min-w-0 titlebar-no-drag">
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveTitle}
            className="flex-1 bg-transparent text-sm font-medium border-b border-primary/50 outline-none px-0 py-0.5 min-w-0"
            maxLength={100}
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={saveTitle}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(false)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="truncate text-sm font-medium text-foreground">
            {conversation.title}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={startEdit}
            className="titlebar-no-drag p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="编辑标题"
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
      )}

      {/* 右上角按钮组 — 绝对定位，与 Agent 侧统一 */}
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 titlebar-no-drag">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7',
                isPinned && 'bg-accent text-accent-foreground'
              )}
              onClick={handleTogglePin}
            >
              <Pin className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{isPinned ? '取消置顶' : '置顶对话'}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7',
                parallelMode && 'bg-accent text-accent-foreground'
              )}
              onClick={() => setParallelMode(!parallelMode)}
            >
              <Columns2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{parallelMode ? '关闭并排模式' : '并排模式'}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
