import type { FileIndexEntry } from '@proma/shared'

export function hasMixedFileSources(entries: readonly FileIndexEntry[]): boolean {
  let hasSession = false
  let hasWorkspace = false
  for (const entry of entries) {
    if (entry.source === 'session') hasSession = true
    if (entry.source === 'workspace') hasWorkspace = true
    if (hasSession && hasWorkspace) return true
  }
  return false
}
