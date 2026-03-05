/**
 * MoveSessionDialog - 迁移会话到另一个工作区的对话框
 */

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { AgentWorkspace, AgentSessionMeta } from '@proma/shared'

interface MoveSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentWorkspaceId: string | undefined
  workspaces: AgentWorkspace[]
  onMoved: (updatedSession: AgentSessionMeta) => void
}

export function MoveSessionDialog({
  open,
  onOpenChange,
  sessionId,
  currentWorkspaceId,
  workspaces,
  onMoved,
}: MoveSessionDialogProps): React.ReactElement {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string>('')
  const [moving, setMoving] = React.useState(false)

  // 过滤掉当前工作区
  const availableWorkspaces = React.useMemo(
    () => workspaces.filter((ws) => ws.id !== currentWorkspaceId),
    [workspaces, currentWorkspaceId]
  )

  // 打开时重置选择
  React.useEffect(() => {
    if (open) {
      setSelectedWorkspaceId('')
      setMoving(false)
    }
  }, [open])

  const handleConfirm = async (): Promise<void> => {
    if (!selectedWorkspaceId || moving) return

    setMoving(true)
    try {
      const updated = await window.electronAPI.moveAgentSessionToWorkspace({
        sessionId,
        targetWorkspaceId: selectedWorkspaceId,
      })
      onMoved(updated)
      onOpenChange(false)
    } catch (error) {
      console.error('[迁移会话] 迁移失败:', error)
      setMoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>迁移到其他工作区</DialogTitle>
          <DialogDescription>
            选择目标工作区，会话将完整迁移过去。
          </DialogDescription>
        </DialogHeader>

        {availableWorkspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            没有其他可用的工作区，请先创建新的工作区。
          </p>
        ) : (
          <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
            <SelectTrigger>
              <SelectValue placeholder="选择目标工作区" />
            </SelectTrigger>
            <SelectContent>
              {availableWorkspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedWorkspaceId || moving || availableWorkspaces.length === 0}
          >
            {moving ? '迁移中...' : '确认迁移'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
