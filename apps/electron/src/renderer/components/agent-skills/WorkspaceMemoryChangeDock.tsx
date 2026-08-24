import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { SkillFileNode } from '@proma/shared'
import { workspaceMemoryChangesAtom } from '@/atoms/memory-change-atoms'
import { WorkspaceMemoryChangeShelf } from './WorkspaceMemoryChangeShelf'

interface WorkspaceMemoryChangeDockProps {
  workspaceSlug: string
  sessionId: string
  className?: string
}

interface MemoryFileListItem {
  relativePath: string
  modifiedAt?: number
}

function flattenMemoryFiles(nodes: SkillFileNode[]): MemoryFileListItem[] {
  return nodes.flatMap((node) => node.type === 'directory'
    ? flattenMemoryFiles(node.children ?? [])
    : [{ relativePath: node.relativePath, modifiedAt: node.modifiedAt }])
}

/** 紧凑项目记忆 Diff 预览；变更观察由 App Shell 常驻处理。 */
export function WorkspaceMemoryChangeDock({ workspaceSlug, sessionId, className }: WorkspaceMemoryChangeDockProps): React.ReactElement | null {
  const updatesByWorkspace = useAtomValue(workspaceMemoryChangesAtom)
  const changes = updatesByWorkspace.get(workspaceSlug) ?? []
  const [memoryFiles, setMemoryFiles] = React.useState<MemoryFileListItem[]>([])

  const refreshMemoryFiles = React.useCallback(async (): Promise<void> => {
    const tree = await window.electronAPI.listWorkspaceAutoMemoryFiles(workspaceSlug)
    setMemoryFiles(flattenMemoryFiles(tree))
  }, [workspaceSlug])

  React.useEffect(() => {
    void refreshMemoryFiles().catch(() => {})
  }, [refreshMemoryFiles, changes[0]?.changedAt])

  return (
    <WorkspaceMemoryChangeShelf
      workspaceSlug={workspaceSlug}
      sessionId={sessionId}
      changes={changes}
      memoryFiles={memoryFiles}
      className={className ?? '-mx-2 -mb-2 mt-1 shrink-0 border-t border-border/70 bg-content-area'}
    />
  )
}
