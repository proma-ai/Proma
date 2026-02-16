/**
 * WorkspaceSelector — Agent 工作区切换器
 *
 * 下拉选择器，展示所有工作区，支持新建、重命名、删除和切换。
 * 切换工作区后持久化到 settings。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { FolderOpen, Plus, Check, ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import type { AgentWorkspace } from '@proma/shared'

export function WorkspaceSelector(): React.ReactElement {
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)
  const [open, setOpen] = React.useState(false)

  // 新建状态
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const createInputRef = React.useRef<HTMLInputElement>(null)

  // 重命名状态
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const editInputRef = React.useRef<HTMLInputElement>(null)

  // 删除确认状态
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)

  /** 切换工作区 */
  const handleSelect = (workspace: AgentWorkspace): void => {
    if (editingId) return // 编辑中不切换
    setCurrentWorkspaceId(workspace.id)
    setOpen(false)

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

    try {
      const workspace = await window.electronAPI.createAgentWorkspace(trimmed)
      setWorkspaces((prev) => [workspace, ...prev])
      setCurrentWorkspaceId(workspace.id)
      setCreating(false)
      setOpen(false)

      window.electronAPI.updateSettings({
        agentWorkspaceId: workspace.id,
      }).catch(console.error)
    } catch (error) {
      console.error('[WorkspaceSelector] 创建工作区失败:', error)
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
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
      console.error('[WorkspaceSelector] 重命名工作区失败:', error)
    } finally {
      setEditingId(null)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
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

      // 如果删除的是当前工作区，切换到第一个剩余的
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

  /** 是否可以删除该工作区 */
  const canDelete = (ws: AgentWorkspace): boolean => {
    return ws.slug !== 'default' && workspaces.length > 1
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] transition-colors duration-100 titlebar-no-drag',
              'text-foreground/70 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06]',
            )}
          >
            <FolderOpen size={14} className="flex-shrink-0 text-foreground/50" />
            <span className="flex-1 text-left truncate">
              {currentWorkspace?.name || '选择工作区'}
            </span>
            <ChevronDown size={12} className="flex-shrink-0 text-foreground/40" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side="bottom"
          className="w-[var(--radix-dropdown-menu-trigger-width)] p-1"
        >
          {/* 工作区列表 */}
          <div className="max-h-[200px] overflow-y-auto">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                onClick={() => handleSelect(ws)}
                className={cn(
                  'group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors duration-100 text-left cursor-pointer',
                  ws.id === currentWorkspaceId
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground/70 hover:bg-foreground/[0.04]',
                )}
              >
                <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />

                {editingId === ws.id ? (
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={handleRename}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5"
                    maxLength={50}
                  />
                ) : (
                  <>
                    <span className="flex-1 truncate">{ws.name}</span>

                    {/* 操作按钮 - hover 时显示 */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleStartRename(e, ws)}
                        className="p-0.5 rounded hover:bg-foreground/[0.08] text-foreground/40 hover:text-foreground/70"
                        title="重命名"
                      >
                        <Pencil size={12} />
                      </button>
                      {canDelete(ws) && (
                        <button
                          onClick={(e) => handleStartDelete(e, ws.id)}
                          className="p-0.5 rounded hover:bg-destructive/10 text-foreground/40 hover:text-destructive"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>

                    {/* 选中勾 - 没有操作按钮时显示 */}
                    {ws.id === currentWorkspaceId && (
                      <Check size={13} className="flex-shrink-0 text-primary group-hover:hidden" />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* 分隔线 */}
          <div className="my-1 border-t border-foreground/[0.06]" />

          {/* 新建工作区 */}
          {creating ? (
            <div className="px-2 py-1">
              <input
                ref={createInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                onBlur={() => {
                  if (!newName.trim()) setCreating(false)
                }}
                placeholder="工作区名称..."
                className="w-full bg-transparent text-[13px] text-foreground border-b border-primary/50 outline-none px-0.5 py-1"
                maxLength={50}
              />
            </div>
          ) : (
            <div
              onClick={handleStartCreate}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/70 transition-colors duration-100 cursor-pointer"
            >
              <Plus size={13} />
              <span>新建工作区</span>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
