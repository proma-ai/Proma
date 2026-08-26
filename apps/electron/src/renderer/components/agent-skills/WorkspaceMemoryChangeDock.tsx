import * as React from 'react'
import { useAtomValue } from 'jotai'
import { workspaceMemoryChangesAtom } from '@/atoms/memory-change-atoms'
import { WorkspaceMemoryChangeShelf } from './WorkspaceMemoryChangeShelf'

interface WorkspaceMemoryChangeDockProps {
  workspaceSlug: string
  className?: string
}

/** 仅在本次运行捕捉到记忆更新时显示；完整项目记忆由用户主动从工作区 Tab 打开。 */
export function WorkspaceMemoryChangeDock({ workspaceSlug, className }: WorkspaceMemoryChangeDockProps): React.ReactElement | null {
  const updatesByWorkspace = useAtomValue(workspaceMemoryChangesAtom)
  const changes = updatesByWorkspace.get(workspaceSlug) ?? []

  if (changes.length === 0) return null

  return (
    <WorkspaceMemoryChangeShelf
      changes={changes}
      className={className ?? '-mx-2 -mb-2 mt-1 shrink-0 border-t border-border/70 bg-content-area'}
    />
  )
}
