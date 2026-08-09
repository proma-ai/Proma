import { atom } from 'jotai'
import type { WorkspaceMemoryChange } from '@proma/shared'

export interface MemoryUpdateNotice extends WorkspaceMemoryChange {
  unread: boolean
}

/** Renderer-lifetime only: memory remains Markdown on disk; notifications are not a second store. */
export const workspaceMemoryUpdatesAtom = atom<Map<string, MemoryUpdateNotice>>(new Map())

/** One-shot route consumed by WorkspaceMemoryTab to preview/edit a just-updated file. */
export const memoryNavigationRequestAtom = atom<{
  workspaceSlug: string
  relativePath: string
  mode: 'preview' | 'edit'
} | null>(null)
