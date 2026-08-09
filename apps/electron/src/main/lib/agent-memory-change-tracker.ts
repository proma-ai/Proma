import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { WorkspaceMemoryChange } from '@proma/shared'
import { getProjectFilesPath, getWorkspaceAgentsMdPath, getWorkspaceMemorySummary } from './agent-workspace-manager'

const MAX_FILES = 32
const MAX_FILE_BYTES = 48 * 1024
const MAX_PREVIEW_LENGTH = 180
const WORKSPACE_AGENTS_KEY = '$workspace/AGENTS.md'
const PROJECT_AGENTS_KEY = '$project/AGENTS.md'

interface MemoryFileSnapshot {
  hash: string
  lines: string[]
}

export type MemorySnapshot = Map<string, MemoryFileSnapshot>

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function listMarkdownFiles(root: string, current = root, result: string[] = []): string[] {
  if (result.length >= MAX_FILES || !existsSync(current)) return result
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = readdirSync(current, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (result.length >= MAX_FILES) break
    const abs = join(current, entry.name)
    // Long-term memory must stay within the managed root; never traverse symlinks here.
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      listMarkdownFiles(root, abs, result)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      result.push(relative(root, abs).split(/\\/g).join('/'))
    }
  }
  return result
}

function captureBoundedMarkdownFile(snapshot: MemorySnapshot, key: string, absPath: string): void {
  try {
    const stat = lstatSync(absPath)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return
    const content = readFileSync(absPath, 'utf8')
    snapshot.set(key, { hash: hash(content), lines: content.split(/\r?\n/) })
  } catch {
    // A concurrent rename/delete is not a user-visible error and will be reconciled next run.
  }
}

/**
 * Captures bounded, ordinary Markdown under memory/ plus the two explicitly
 * managed AGENTS.md files. It deliberately does not watch arbitrary project files.
 */
export function captureWorkspaceMemorySnapshot(workspaceSlug?: string): MemorySnapshot {
  const snapshot: MemorySnapshot = new Map()
  if (!workspaceSlug) return snapshot
  const root = getWorkspaceMemorySummary(workspaceSlug).autoMemory.directory
  for (const relativePath of listMarkdownFiles(root)) {
    captureBoundedMarkdownFile(snapshot, relativePath, join(root, relativePath))
  }
  captureBoundedMarkdownFile(snapshot, WORKSPACE_AGENTS_KEY, getWorkspaceAgentsMdPath(workspaceSlug))
  captureBoundedMarkdownFile(snapshot, PROJECT_AGENTS_KEY, join(getProjectFilesPath(workspaceSlug), 'AGENTS.md'))
  return snapshot
}

function lineDelta(before: string[], after: string[]): { addedLines: number; removedLines: number; preview?: string } {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const added = after.filter((line) => line.trim() && !beforeSet.has(line))
  const removed = before.filter((line) => line.trim() && !afterSet.has(line))
  const preview = added[0]?.trim() || removed[0]?.trim()
  return {
    addedLines: added.length,
    removedLines: removed.length,
    ...(preview ? { preview: preview.slice(0, MAX_PREVIEW_LENGTH) } : {}),
  }
}

export function diffWorkspaceMemorySnapshot(
  workspaceSlug: string | undefined,
  sessionId: string,
  runStartedAt: number,
  before: MemorySnapshot,
): WorkspaceMemoryChange | undefined {
  if (!workspaceSlug) return undefined
  const after = captureWorkspaceMemorySnapshot(workspaceSlug)
  const paths = new Set([...before.keys(), ...after.keys()])
  const files: WorkspaceMemoryChange['files'] = []
  for (const relativePath of paths) {
    const previous = before.get(relativePath)
    const current = after.get(relativePath)
    if (previous?.hash === current?.hash) continue
    const delta = lineDelta(previous?.lines ?? [], current?.lines ?? [])
    const area = relativePath === WORKSPACE_AGENTS_KEY
      ? 'workspace_instruction'
      : relativePath === PROJECT_AGENTS_KEY ? 'project_instruction' : 'memory'
    files.push({
      id: `${area}:${area === 'memory' ? relativePath : 'AGENTS.md'}`,
      relativePath: area === 'memory' ? relativePath : 'AGENTS.md',
      area,
      kind: !previous ? 'created' : !current ? 'deleted' : 'modified',
      ...delta,
    })
  }
  if (files.length === 0) return undefined

  return {
    workspaceSlug,
    sessionId,
    runStartedAt,
    category: files.some((file) => file.area === 'project_instruction')
      ? 'project_instruction'
      : files.some((file) => file.area === 'workspace_instruction')
        ? 'workspace_instruction'
        : files.some((file) => file.relativePath === 'user-profile.md')
          ? 'profile'
          : files.some((file) => file.relativePath === 'MEMORY.md') ? 'index' : 'topic',
    files: files.slice(0, MAX_FILES),
  }
}
