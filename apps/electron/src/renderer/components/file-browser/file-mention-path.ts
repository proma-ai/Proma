import type { FileIndexEntry } from '@proma/shared'

type MentionSelection = Pick<FileIndexEntry, 'path' | 'source'>

function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}|[\\/])/.test(path)
}

function joinRendererPath(root: string, relativePath: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const normalizedRelativePath = relativePath.replace(/[\\/]+/g, separator)
  return `${normalizedRoot}${separator}${normalizedRelativePath}`
}

/**
 * Project entries can be passed through unchanged. Relative session entries must become absolute:
 * Agent cwd is the project root for new sessions, so a bare session-relative mention is ambiguous.
 */
export function resolveFileMentionPath(entry: MentionSelection, sessionRoot: string | null): string {
  if (entry.source !== 'session' || isAbsolutePath(entry.path) || !sessionRoot) {
    return entry.path
  }
  return joinRendererPath(sessionRoot, entry.path)
}
