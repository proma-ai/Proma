import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { SkillFileNode, WorkspaceMemoryFileChange } from '@proma/shared'
import { workspaceMemoryChangesAtom } from '@/atoms/memory-change-atoms'
import { WorkspaceMemoryChangeShelf } from './WorkspaceMemoryChangeShelf'

interface WorkspaceMemoryChangeDockProps {
  workspaceSlug: string
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

/** Embedded at the bottom of the right file panel; observation is handled by App Shell. */
export function WorkspaceMemoryChangeDock({ workspaceSlug }: WorkspaceMemoryChangeDockProps): React.ReactElement | null {
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

  const open = React.useCallback((change?: WorkspaceMemoryFileChange) => {
    void window.electronAPI.openWorkspaceMemoryWindow(workspaceSlug, change?.relativePath)
  }, [workspaceSlug])

  const openFile = React.useCallback((relativePath: string) => {
    void window.electronAPI.openWorkspaceMemoryWindow(workspaceSlug, relativePath)
  }, [workspaceSlug])

  return (
    <WorkspaceMemoryChangeShelf
      changes={changes}
      memoryFiles={memoryFiles}
      onOpen={open}
      onOpenFile={openFile}
      className="-mx-2 -mb-2 mt-1 shrink-0 border-t border-border/70 bg-content-area"
    />
  )
}
