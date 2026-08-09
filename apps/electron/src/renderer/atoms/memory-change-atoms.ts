import { atom } from 'jotai'
import type { WorkspaceMemoryFileChange } from '@proma/shared'

/** Renderer-lifetime presentation state for the global, current-workspace Memory change dock. */
export const workspaceMemoryChangesAtom = atom<Map<string, WorkspaceMemoryFileChange[]>>(new Map())

/** One-shot route from the global dock into WorkspaceMemoryTab. */
export const memoryFileNavigationAtom = atom<{
  workspaceSlug: string
  relativePath: string
  mode: 'preview' | 'edit'
} | null>(null)
