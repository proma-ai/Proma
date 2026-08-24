import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { WorkspaceMemoryFileChange } from '@proma/shared'

/** Renderer-lifetime presentation state for the global, current-workspace Memory change dock. */
export const workspaceMemoryChangesAtom = atom<Map<string, WorkspaceMemoryFileChange[]>>(new Map())

/** 当前会话内联记忆编辑器的未保存与外部更新状态，供 Tab 切换/关闭保护使用。 */
export interface WorkspaceMemoryEditingState {
  editingPath: string | null
  dirty: boolean
  remoteChanged: boolean
}
export const workspaceMemoryEditingStateAtomFamily = atomFamily((_sessionId: string) => atom<WorkspaceMemoryEditingState>({
  editingPath: null,
  dirty: false,
  remoteChanged: false,
}))

/** One-shot route from the global dock into WorkspaceMemoryTab. */
export const memoryFileNavigationAtom = atom<{
  workspaceSlug: string
  relativePath: string
  mode: 'preview' | 'edit'
} | null>(null)
