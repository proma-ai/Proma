import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { WorkspaceMemoryFileChange } from '@proma/shared'
import { getWorkspaceMemorySummary } from './agent-workspace-manager'

const MAX_DIFF_FILE_BYTES = 96 * 1024
const MAX_DIFF_LINES = 8
const CHANGE_DEBOUNCE_MS = 180

interface FileSnapshot {
  signature: string
  text?: string
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isSafeRelativePath(path: string): boolean {
  return path !== '' && path !== '.' && !path.startsWith('..') && !isAbsolute(path)
}

function readSnapshot(path: string): FileSnapshot | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile()) return undefined
    if (stat.size > MAX_DIFF_FILE_BYTES) return { signature: `large:${stat.size}:${stat.mtimeMs}` }
    const raw = readFileSync(path)
    if (raw.includes(0)) return { signature: `binary:${sha256(raw)}` }
    return { signature: sha256(raw), text: raw.toString('utf8') }
  } catch {
    return undefined
  }
}

function firstMeaningfulLine(lines: string[]): string | undefined {
  return lines.find((line) => line.trim())?.trim().slice(0, 180)
}

function createChange(relativePath: string, before: FileSnapshot | undefined, after: FileSnapshot | undefined): WorkspaceMemoryFileChange | undefined {
  if (before?.signature === after?.signature) return undefined
  const kind = !before ? 'created' : !after ? 'deleted' : 'modified'
  if ((before && before.text === undefined) || (after && after.text === undefined)) {
    return { relativePath, kind, changedAt: Date.now(), diffAvailable: false }
  }

  const previous = (before?.text ?? '').split(/\r?\n/)
  const next = (after?.text ?? '').split(/\r?\n/)
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < previous.length - prefix && suffix < next.length - prefix
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix += 1

  const removed = previous.slice(prefix, previous.length - suffix)
  const added = next.slice(prefix, next.length - suffix)
  const context = previous.slice(Math.max(0, prefix - 1), prefix)
  return {
    relativePath,
    kind,
    changedAt: Date.now(),
    diffAvailable: true,
    preview: firstMeaningfulLine(added) ?? firstMeaningfulLine(removed),
    diff: {
      context,
      removed: removed.slice(0, MAX_DIFF_LINES),
      added: added.slice(0, MAX_DIFF_LINES),
      truncated: removed.length > MAX_DIFF_LINES || added.length > MAX_DIFF_LINES,
    },
  }
}

/**
 * Watches one workspace's managed memory root only while at least one Memory tab
 * subscribes. It is intentionally independent from Agent runs, so external-editor
 * writes and writes from another session are represented as well.
 */
class WorkspaceMemoryWatcher {
  private readonly snapshots = new Map<string, FileSnapshot>()
  private readonly callbacks = new Set<(change: WorkspaceMemoryFileChange) => void>()
  private readonly directoryWatchers = new Map<string, FSWatcher>()
  private readonly pendingPaths = new Map<string, ReturnType<typeof setTimeout>>()
  private rescanTimer?: ReturnType<typeof setTimeout>
  private closed = false

  constructor(private readonly root: string) {
    this.captureInitialSnapshots(root)
    this.watchDirectoryTree(root)
  }

  subscribe(callback: (change: WorkspaceMemoryFileChange) => void): () => void {
    this.callbacks.add(callback)
    return () => {
      this.callbacks.delete(callback)
      if (this.callbacks.size === 0) this.close()
    }
  }

  private captureInitialSnapshots(directory: string): void {
    let entries: import('node:fs').Dirent<string>[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        this.captureInitialSnapshots(absolutePath)
      } else if (entry.isFile()) {
        const path = relative(this.root, absolutePath).split(/\\/g).join('/')
        const snapshot = readSnapshot(absolutePath)
        if (snapshot) this.snapshots.set(path, snapshot)
      }
    }
  }

  private watchDirectoryTree(directory: string): void {
    if (this.closed || this.directoryWatchers.has(directory)) return
    try {
      const watcher = watch(directory, (_eventType, filename) => {
        this.scheduleRescan()
        if (!filename) return
        const changedPath = resolve(directory, filename.toString())
        const relativePath = relative(this.root, changedPath).split(/\\/g).join('/')
        if (isSafeRelativePath(relativePath)) this.schedulePath(relativePath)
      })
      watcher.on('error', () => { /* Next subscription reconstructs the bounded watcher tree. */ })
      this.directoryWatchers.set(directory, watcher)
    } catch {
      return
    }

    let entries: import('node:fs').Dirent<string>[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) this.watchDirectoryTree(join(directory, entry.name))
    }
  }

  private scheduleRescan(): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = undefined
      this.watchDirectoryTree(this.root)
      this.reconcileTree()
    }, CHANGE_DEBOUNCE_MS)
  }

  private schedulePath(relativePath: string): void {
    const existing = this.pendingPaths.get(relativePath)
    if (existing) clearTimeout(existing)
    this.pendingPaths.set(relativePath, setTimeout(() => {
      this.pendingPaths.delete(relativePath)
      this.reconcilePath(relativePath)
    }, CHANGE_DEBOUNCE_MS))
  }

  private reconcilePath(relativePath: string): void {
    if (this.closed) return
    const absolutePath = resolve(this.root, relativePath)
    if (!isSafeRelativePath(relative(this.root, absolutePath))) return
    const after = readSnapshot(absolutePath)
    const before = this.snapshots.get(relativePath)
    if (!after && !before) return
    const change = createChange(relativePath, before, after)
    if (!change) return
    if (after) this.snapshots.set(relativePath, after)
    else this.snapshots.delete(relativePath)
    for (const callback of this.callbacks) callback(change)
  }

  /** Reconcile the whole small managed root after directory/atomic-write events. */
  private reconcileTree(): void {
    const currentFiles = new Set<string>()
    const visit = (directory: string): void => {
      let entries: import('node:fs').Dirent<string>[]
      try {
        entries = readdirSync(directory, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const absolutePath = join(directory, entry.name)
        if (entry.isDirectory()) {
          visit(absolutePath)
        } else if (entry.isFile()) {
          const path = relative(this.root, absolutePath).split(/\\/g).join('/')
          if (isSafeRelativePath(path)) currentFiles.add(path)
        }
      }
    }
    visit(this.root)
    for (const path of new Set([...currentFiles, ...this.snapshots.keys()])) this.reconcilePath(path)
  }

  private close(): void {
    if (this.closed) return
    this.closed = true
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    for (const timer of this.pendingPaths.values()) clearTimeout(timer)
    this.pendingPaths.clear()
    for (const watcher of this.directoryWatchers.values()) watcher.close()
    this.directoryWatchers.clear()
    watchersByRoot.delete(this.root)
  }
}

const watchersByRoot = new Map<string, WorkspaceMemoryWatcher>()

export function subscribeWorkspaceMemoryChanges(
  workspaceSlug: string,
  callback: (change: WorkspaceMemoryFileChange) => void,
): () => void {
  const root = getWorkspaceMemorySummary(workspaceSlug).autoMemory.directory
  let watcher = watchersByRoot.get(root)
  if (!watcher) {
    watcher = new WorkspaceMemoryWatcher(root)
    watchersByRoot.set(root, watcher)
  }
  return watcher.subscribe(callback)
}
