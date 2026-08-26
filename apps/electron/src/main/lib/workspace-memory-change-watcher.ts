import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorkspaceMemoryFileChange } from '@proma/shared'
import { getWorkspaceAutoMemoryDir } from './agent-workspace-manager'

const MAX_DIFF_FILE_BYTES = 96 * 1024
const MAX_DIFF_LINES = 8
const CHANGE_DEBOUNCE_MS = 180
const MAX_WATCH_DEPTH = 6
const MAX_WATCHED_DIRECTORIES = 128
const MAX_TRACKED_FILES = 512

interface FileSnapshot { signature: string; text?: string }

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex') }
function isSafeRelativePath(path: string): boolean { return path !== '' && path !== '.' && !path.startsWith('..') && !isAbsolute(path) }
function isRegularDirectory(path: string): boolean {
  try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink() } catch { return false }
}
function readSnapshot(path: string): FileSnapshot | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined
    if (stat.size > MAX_DIFF_FILE_BYTES) return { signature: `large:${stat.size}:${stat.mtimeMs}` }
    const raw = readFileSync(path)
    if (raw.includes(0)) return { signature: `binary:${sha256(raw)}` }
    return { signature: sha256(raw), text: raw.toString('utf8') }
  } catch { return undefined }
}
function firstMeaningfulLine(lines: string[]): string | undefined { return lines.find((line) => line.trim())?.trim().slice(0, 180) }
function createChange(relativePath: string, before: FileSnapshot | undefined, after: FileSnapshot | undefined, changedAt: number): WorkspaceMemoryFileChange | undefined {
  if (before?.signature === after?.signature) return undefined
  const kind = !before ? 'created' : !after ? 'deleted' : 'modified'
  if ((before && before.text === undefined) || (after && after.text === undefined)) return { relativePath, kind, changedAt, diffAvailable: false }
  const previous = (before?.text ?? '').split(/\r?\n/)
  const next = (after?.text ?? '').split(/\r?\n/)
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1
  const removed = previous.slice(prefix, previous.length - suffix)
  const added = next.slice(prefix, next.length - suffix)
  return {
    relativePath, kind, changedAt, diffAvailable: true,
    preview: firstMeaningfulLine(added) ?? firstMeaningfulLine(removed),
    diff: { context: previous.slice(Math.max(0, prefix - 1), prefix), removed: removed.slice(0, MAX_DIFF_LINES), added: added.slice(0, MAX_DIFF_LINES), truncated: removed.length > MAX_DIFF_LINES || added.length > MAX_DIFF_LINES },
  }
}

/** Bounded, symlink-safe watcher for one workspace's managed memory/ root. */
class WorkspaceMemoryWatcher {
  private readonly snapshots = new Map<string, FileSnapshot>()
  private readonly callbacks = new Set<(change: WorkspaceMemoryFileChange) => void>()
  private readonly directoryWatchers = new Map<string, FSWatcher>()
  private rootParentWatcher?: FSWatcher
  private readonly pendingPaths = new Map<string, { timer: ReturnType<typeof setTimeout>; observedAt: number }>()
  private rescanTimer?: ReturnType<typeof setTimeout>
  private rescanObservedAt?: number
  private closed = false

  constructor(private readonly root: string) {
    this.captureInitialSnapshots()
    this.watchRootParent()
    this.reconcileDirectoryWatchers()
  }

  subscribe(callback: (change: WorkspaceMemoryFileChange) => void): () => void {
    this.callbacks.add(callback)
    return () => { this.callbacks.delete(callback); if (this.callbacks.size === 0) this.close() }
  }

  /** Retains active subscribers when memory/ is externally deleted and later recreated. */
  private watchRootParent(): void {
    if (this.closed || this.rootParentWatcher) return
    const parent = dirname(this.root)
    const rootName = basename(this.root)
    try {
      this.rootParentWatcher = watch(parent, (_eventType, filename) => {
        if (!filename || filename.toString() === rootName) this.scheduleRescan()
      })
      this.rootParentWatcher.on('error', () => {
        this.rootParentWatcher?.close()
        this.rootParentWatcher = undefined
        this.scheduleRescan()
      })
    } catch { /* Workspace root may be unavailable during teardown; existing watchers still clean up normally. */ }
  }

  private collectDirectories(): Set<string> {
    const directories = new Set<string>()
    const visit = (directory: string, depth: number): void => {
      if (depth > MAX_WATCH_DEPTH || directories.size >= MAX_WATCHED_DIRECTORIES || !isRegularDirectory(directory)) return
      directories.add(directory)
      let entries: import('node:fs').Dirent<string>[]
      try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) visit(join(directory, entry.name), depth + 1)
      }
    }
    visit(this.root, 0)
    return directories
  }

  private captureInitialSnapshots(): void {
    let count = 0
    const visit = (directory: string, depth: number): void => {
      if (depth > MAX_WATCH_DEPTH || count >= MAX_TRACKED_FILES || !isRegularDirectory(directory)) return
      let entries: import('node:fs').Dirent<string>[]
      try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (count >= MAX_TRACKED_FILES || entry.isSymbolicLink()) break
        const absolutePath = join(directory, entry.name)
        if (entry.isDirectory()) visit(absolutePath, depth + 1)
        else if (entry.isFile()) {
          const relativePath = relative(this.root, absolutePath).split(/\\/g).join('/')
          const snapshot = readSnapshot(absolutePath)
          if (snapshot && isSafeRelativePath(relativePath)) { this.snapshots.set(relativePath, snapshot); count += 1 }
        }
      }
    }
    visit(this.root, 0)
  }

  private reconcileDirectoryWatchers(): void {
    if (this.closed) return
    if (!isRegularDirectory(this.root)) {
      for (const watcher of this.directoryWatchers.values()) watcher.close()
      this.directoryWatchers.clear()
      return
    }
    const desired = this.collectDirectories()
    for (const [directory, watcher] of this.directoryWatchers) {
      if (!desired.has(directory)) { watcher.close(); this.directoryWatchers.delete(directory) }
    }
    for (const directory of desired) {
      if (this.directoryWatchers.has(directory)) continue
      try {
        const watcher = watch(directory, (_eventType, filename) => {
          this.scheduleRescan()
          if (!filename) return
          const changedPath = resolve(directory, filename.toString())
          const relativePath = relative(this.root, changedPath).split(/\\/g).join('/')
          if (isSafeRelativePath(relativePath)) this.schedulePath(relativePath)
        })
        watcher.on('error', () => {
          if (this.directoryWatchers.get(directory) === watcher) this.directoryWatchers.delete(directory)
          watcher.close()
          this.scheduleRescan()
        })
        this.directoryWatchers.set(directory, watcher)
      } catch { /* A later fs event or subscription retries this directory. */ }
    }
  }

  private scheduleRescan(): void {
    // 保留同一轮 debounce 的首次观察时间，避免 run 开始前的文件变更因延迟上报被误归属到新 run。
    if (!this.rescanTimer) this.rescanObservedAt = Date.now()
    else clearTimeout(this.rescanTimer)
    this.rescanTimer = setTimeout(() => {
      const observedAt = this.rescanObservedAt ?? Date.now()
      this.rescanTimer = undefined
      this.rescanObservedAt = undefined
      this.watchRootParent()
      this.reconcileDirectoryWatchers()
      if (isRegularDirectory(this.root)) this.reconcileTree(observedAt)
    }, CHANGE_DEBOUNCE_MS)
  }
  private schedulePath(relativePath: string): void {
    const existing = this.pendingPaths.get(relativePath)
    if (existing) clearTimeout(existing.timer)
    const observedAt = existing?.observedAt ?? Date.now()
    const timer = setTimeout(() => {
      this.pendingPaths.delete(relativePath)
      this.reconcilePath(relativePath, observedAt)
    }, CHANGE_DEBOUNCE_MS)
    this.pendingPaths.set(relativePath, { timer, observedAt })
  }
  private reconcilePath(relativePath: string, observedAt = Date.now()): void {
    if (this.closed || !isRegularDirectory(this.root)) return
    const absolutePath = resolve(this.root, relativePath)
    if (!isSafeRelativePath(relative(this.root, absolutePath))) return
    const after = readSnapshot(absolutePath)
    const before = this.snapshots.get(relativePath)
    if (!after && !before) return
    const change = createChange(relativePath, before, after, observedAt)
    if (!change) return
    if (after) this.snapshots.set(relativePath, after); else this.snapshots.delete(relativePath)
    for (const callback of this.callbacks) callback(change)
  }
  private reconcileTree(observedAt = Date.now()): void {
    const currentFiles = new Set<string>()
    let count = 0
    const visit = (directory: string, depth: number): void => {
      if (depth > MAX_WATCH_DEPTH || count >= MAX_TRACKED_FILES || !isRegularDirectory(directory)) return
      let entries: import('node:fs').Dirent<string>[]
      try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (count >= MAX_TRACKED_FILES || entry.isSymbolicLink()) break
        const absolutePath = join(directory, entry.name)
        if (entry.isDirectory()) visit(absolutePath, depth + 1)
        else if (entry.isFile()) { const path = relative(this.root, absolutePath).split(/\\/g).join('/'); if (isSafeRelativePath(path)) { currentFiles.add(path); count += 1 } }
      }
    }
    visit(this.root, 0)
    for (const path of new Set([...currentFiles, ...this.snapshots.keys()])) this.reconcilePath(path, observedAt)
  }
  private close(): void {
    if (this.closed) return
    this.closed = true
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    this.rescanObservedAt = undefined
    for (const { timer } of this.pendingPaths.values()) clearTimeout(timer)
    this.pendingPaths.clear()
    this.rootParentWatcher?.close()
    this.rootParentWatcher = undefined
    for (const watcher of this.directoryWatchers.values()) watcher.close()
    this.directoryWatchers.clear()
    watchersByRoot.delete(this.root)
  }
}

const watchersByRoot = new Map<string, WorkspaceMemoryWatcher>()
export function subscribeWorkspaceMemoryChanges(workspaceSlug: string, callback: (change: WorkspaceMemoryFileChange) => void): () => void {
  // Ensures migration, creates an absent root, and rejects non-directory/symlink roots.
  const root = getWorkspaceAutoMemoryDir(workspaceSlug)
  let watcher = watchersByRoot.get(root)
  if (!watcher) { watcher = new WorkspaceMemoryWatcher(root); watchersByRoot.set(root, watcher) }
  return watcher.subscribe(callback)
}
