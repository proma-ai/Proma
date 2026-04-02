/**
 * AgentHeader — Agent 会话头部
 *
 * 显示会话标题（可点击编辑）。
 * 参照 ChatHeader 的编辑模式。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Pencil, Check, X, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { agentSessionsAtom, agentSidePanelOpenMapAtom, workspaceFilesVersionAtom } from '@/atoms/agent-atoms'

/** AgentHeader 属性接口 */
interface AgentHeaderProps {
  sessionId: string
}

export function AgentHeader({ sessionId }: AgentHeaderProps): React.ReactElement | null {
  const sessions = useAtomValue(agentSessionsAtom)
  const session = sessions.find((s) => s.id === sessionId) ?? null
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 文件面板切换状态
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const setSidePanelOpenMap = useSetAtom(agentSidePanelOpenMapAtom)
  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const isPanelOpen = sidePanelOpenMap.get(sessionId) ?? true
  const hasFileChanges = filesVersion > 0

  const togglePanel = React.useCallback(() => {
    setSidePanelOpenMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, !(map.get(sessionId) ?? true))
      return map
    })
  }, [sessionId, setSidePanelOpenMap])

  if (!session) return null

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(session.title)
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }

    try {
      await window.electronAPI.updateAgentSessionTitle(session.id, trimmed)
      // 刷新会话列表以同步侧边栏
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (error) {
      console.error('[AgentHeader] 更新标题失败:', error)
    }
    setEditing(false)
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
        <>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="truncate text-sm font-medium text-foreground">
              {session.title}
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
          {/* 文件面板打开按钮（仅面板关闭时显示） */}
          {!isPanelOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative titlebar-no-drag h-7 w-7 flex-shrink-0"
                  onClick={togglePanel}
                >
                  <PanelRight className="size-3.5" />
                  {hasFileChanges && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary animate-pulse" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>打开文件面板</p>
              </TooltipContent>
            </Tooltip>
          )}
        </>
      )}
    </div>
  )
}
