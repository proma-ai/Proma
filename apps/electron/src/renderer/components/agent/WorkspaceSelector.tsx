/**
 * WorkspaceSelector — Agent 工作区切换器
 *
 * 垂直列表展示所有工作区，支持新建、重命名、删除、切换和拖拽排序。
 * 切换工作区后持久化到 settings。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { FolderOpen, Plus, Pencil, Trash2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { workspaceListHeightAtom } from '@/atoms/sidebar-atoms'
import type { AgentWorkspace } from '@proma/shared'

export function WorkspaceSelector(): React.ReactElement {
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const [listHeight, setListHeight] = useAtom(workspaceListHeightAtom)

  // 高度拖拽调整
  const listRef = React.useRef<HTMLDivElement>(null)
  const resizing = React.useRef(false)
  const startY = React.useRef(0)
  const startH = React.useRef(0)
  const cleanupResizeRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    return () => { cleanupResizeRef.current?.() }
  }, [])

  const handleResizeStart = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizing.current = true
      startY.current = e.clientY
      // 用实际渲染高度作为起点，避免 maxHeight > 实际高度时不跟手
      startH.current = listRef.current?.getBoundingClientRect().height ?? 120

      const onMove = (ev: MouseEvent): void => {
        if (!resizing.current) return
        const delta = ev.clientY - startY.current
        const next = Math.min(400, Math.max(80, startH.current + delta))
        setListHeight(next)
      }
      const onUp = (): void => {
        resizing.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        cleanupResizeRef.current = null
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      cleanupResizeRef.current = onUp
    },
    [setListHeight],
  )

  // 新建状态
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const createInputRef = React.useRef<HTMLInputElement>(null)
  /** 防止连续 Enter 触发多次创建请求 */
  const createInFlightRef = React.useRef(false)

  // 重命名状态
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const editInputRef = React.useRef<HTMLInputElement>(null)

  // 删除确认状态
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null)

  // 拖拽状态
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = React.useState<{ id: string; position: 'before' | 'after' } | null>(null)

  /** 切换工作区 */
  const handleSelect = (workspace: AgentWorkspace): void => {
    if (editingId) return
    setCurrentWorkspaceId(workspace.id)

    window.electronAPI.updateSettings({
      agentWorkspaceId: workspace.id,
    }).catch(console.error)
  }

  // ===== 新建 =====

  const handleStartCreate = (): void => {
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
    if (createInFlightRef.current) return
    createInFlightRef.current = true

    try {
      const workspace = await window.electronAPI.createAgentWorkspace(trimmed)
      setWorkspaces((prev) => [workspace, ...prev])
      setCurrentWorkspaceId(workspace.id)
      setCreating(false)

      window.electronAPI.updateSettings({
        agentWorkspaceId: workspace.id,
      }).catch(console.error)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '创建失败'
      toast.error(msg)
      setCreating(false)
    } finally {
      createInFlightRef.current = false
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      handleCreate()
    } else if (e.key === 'Escape') {
      setCreating(false)
    }
  }

  // ===== 重命名 =====

  const handleStartRename = (e: React.MouseEvent, ws: AgentWorkspace): void => {
    e.stopPropagation()
    setEditingId(ws.id)
    setEditName(ws.name)
    requestAnimationFrame(() => {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    })
  }

  const handleRename = async (): Promise<void> => {
    if (!editingId) return
    const trimmed = editName.trim()

    if (!trimmed) {
      setEditingId(null)
      return
    }

    try {
      const updated = await window.electronAPI.updateAgentWorkspace(editingId, { name: trimmed })
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
    } catch (error) {
      const msg = error instanceof Error ? error.message : '重命名失败'
      toast.error(msg)
    } finally {
      setEditingId(null)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      handleRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  // ===== 删除 =====

  const handleStartDelete = (e: React.MouseEvent, wsId: string): void => {
    e.stopPropagation()
    setDeleteTargetId(wsId)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTargetId) return

    try {
      await window.electronAPI.deleteAgentWorkspace(deleteTargetId)
      const remaining = workspaces.filter((w) => w.id !== deleteTargetId)
      setWorkspaces(remaining)

      if (deleteTargetId === currentWorkspaceId && remaining.length > 0) {
        setCurrentWorkspaceId(remaining[0]!.id)
        window.electronAPI.updateSettings({
          agentWorkspaceId: remaining[0]!.id,
        }).catch(console.error)
      }
    } catch (error) {
      console.error('[WorkspaceSelector] 删除工作区失败:', error)
    } finally {
      setDeleteTargetId(null)
    }
  }

  const canDelete = (ws: AgentWorkspace): boolean => {
    return ws.slug !== 'default' && workspaces.length > 1
  }

  // ===== 拖拽排序 =====

  const handleDragStart = (e: React.DragEvent, wsId: string): void => {
    setDragId(wsId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', wsId)
  }

  const handleDragOver = (e: React.DragEvent, wsId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragId || wsId === dragId) {
      setDropIndicator(null)
      return
    }
    // 根据鼠标在目标元素的上半/下半部分决定插入位置
    // 中线附近 30% 区域为死区，避免鼠标抖动导致横线闪烁
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    let position: 'before' | 'after'
    if (ratio < 0.35) {
      position = 'before'
    } else if (ratio > 0.65) {
      position = 'after'
    } else {
      // 死区内保持当前方向不变
      if (dropIndicator?.id === wsId) return
      position = ratio < 0.5 ? 'before' : 'after'
    }
    // 仅在状态变化时更新，减少不必要的重渲染
    if (dropIndicator?.id === wsId && dropIndicator.position === position) return
    setDropIndicator({ id: wsId, position })
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropIndicator(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetId: string): void => {
    e.preventDefault()
    if (!dragId || dragId === targetId || !dropIndicator || dropIndicator.id !== targetId) {
      setDragId(null)
      setDropIndicator(null)
      return
    }

    const fromIdx = workspaces.findIndex((w) => w.id === dragId)
    const toIdx = workspaces.findIndex((w) => w.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...workspaces]
    const [moved] = reordered.splice(fromIdx, 1)
    // 从原数组中移除后，目标索引需要调整
    const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx
    const insertIdx = dropIndicator.position === 'after' ? adjustedToIdx + 1 : adjustedToIdx
    reordered.splice(insertIdx, 0, moved!)

    setWorkspaces(reordered)
    setDragId(null)
    setDropIndicator(null)

    window.electronAPI.reorderAgentWorkspaces(reordered.map((w) => w.id)).catch(console.error)
  }

  const handleDragEnd = (): void => {
    setDragId(null)
    setDropIndicator(null)
  }

  return (
    <>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/40">
          <span className="text-[11px] font-medium text-foreground/50 uppercase tracking-wide">工作区</span>
          <button
            onClick={handleStartCreate}
            className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/35 hover:text-foreground/60 transition-colors titlebar-no-drag"
            title="新建工作区"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* 工作区列表 */}
        <div
          ref={listRef}
          className="overflow-y-auto scrollbar-thin flex flex-col p-1"
          style={{ maxHeight: listHeight }}
        >
          {workspaces.map((ws) => (
            <div key={ws.id} className="relative">
              {/* 上方插入指示线 */}
              {dropIndicator?.id === ws.id && dropIndicator.position === 'before' && (
                <div className="absolute top-0 left-1 right-1 h-0.5 bg-primary rounded-full z-10" />
              )}

              <div
                draggable={editingId !== ws.id}
                onDragStart={(e) => handleDragStart(e, ws.id)}
                onDragOver={(e) => handleDragOver(e, ws.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, ws.id)}
                onDragEnd={handleDragEnd}
                onClick={() => handleSelect(ws)}
                className={cn(
                  'group w-full flex items-center gap-1 px-1 py-[5px] rounded-md text-[13px] transition-colors duration-100 cursor-pointer titlebar-no-drag',
                  ws.id === currentWorkspaceId
                    ? 'workspace-item-selected bg-foreground/[0.08] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                    : 'text-foreground/70 hover:bg-foreground/[0.04]',
                  dragId === ws.id && 'opacity-40',
                )}
              >
              {/* 拖拽手柄 */}
              <GripVertical size={12} className="flex-shrink-0 text-foreground/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />

              <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />

              {editingId === ws.id ? (
                <input
                  ref={editInputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={handleRename}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5"
                  maxLength={50}
                />
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate">{ws.name}</span>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => handleStartRename(e, ws)}
                      className="p-0.5 rounded hover:bg-foreground/[0.08] text-foreground/30 hover:text-foreground/60 transition-colors"
                      title="重命名"
                    >
                      <Pencil size={12} />
                    </button>
                    {canDelete(ws) && (
                      <button
                        onClick={(e) => handleStartDelete(e, ws.id)}
                        className="p-0.5 rounded hover:bg-destructive/10 text-foreground/30 hover:text-destructive transition-colors"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </>
              )}
              </div>

              {/* 下方插入指示线 */}
              {dropIndicator?.id === ws.id && dropIndicator.position === 'after' && (
                <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full z-10" />
              )}
            </div>
          ))}

          {/* 新建工作区输入框 */}
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

        {/* 拖拽调整高度的 handle */}
        <div
          onMouseDown={handleResizeStart}
          className="h-1 cursor-row-resize group/resize flex items-center justify-center hover:bg-foreground/[0.06] transition-colors titlebar-no-drag"
        >
          <div className="w-8 h-[2px] rounded-full bg-foreground/0 group-hover/resize:bg-foreground/20 transition-colors" />
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(v) => { if (!v) setDeleteTargetId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除工作区</AlertDialogTitle>
            <AlertDialogDescription>
              删除后工作区配置将被移除，但目录文件会保留。确定要删除吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
