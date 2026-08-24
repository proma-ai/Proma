/**
 * Git Diff 服务
 *
 * 提供工作区文件变更检测、diff 获取、文件还原等 Git 操作。
 * 使用异步 spawn 模式，避免阻塞主进程。
 */

import { spawn } from 'child_process'
import { createHash } from 'node:crypto'
import { constants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import type { ChangedFileEntry, UnstagedChangesResult, UntrackedFileEntry } from '@proma/shared'
import { normalizePathForCompare } from '@proma/shared'
import type { ChangeSource, ChangedFileStatus } from '@proma/shared'

/** 大文件读取上限：超过则跳过，避免 IPC 序列化撑爆内存 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/**
 * 归一化换行符为 LF。
 *
 * diff 两侧内容来源不同：旧版本来自 `git show`（读对象库 blob，换行符为 LF），
 * 新版本来自磁盘工作区文件（Windows 在 core.autocrlf=true 下检出为 CRLF）。
 * 若不归一化，逐行 diff 会把每一行都判定为变更，导致整文件「全删全增」。
 * 此处只影响 diff 显示比较，不改写磁盘文件。
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

/**
 * 改动面板默认不展示隐藏目录内的文件，避免 .github/.vscode 等元数据淹没业务改动。
 * 根目录的 dotfile（如 .gitignore、.env.example）仍然展示；只判断父目录。
 */
function shouldDisplayChangedFile(filePath: string): boolean {
  const pathParts = filePath.split(/[\\/]/)
  return pathParts.slice(0, -1).every((part) => !part.startsWith('.'))
}

function normalizeComparablePath(filePath: string): string {
  return normalizePathForCompare(resolve(filePath))
}

interface ChangeCandidate {
  /** 原始候选路径，保留给 git root 搜索 */
  searchPath: string
  /** 用于过滤变更文件的规范化路径 */
  matchPath: string
  /** true 表示只匹配这个文件，false 表示匹配目录下所有文件 */
  fileOnly: boolean
}

function toChangeCandidate(input: string): ChangeCandidate | null {
  if (!input || typeof input !== 'string') return null
  const resolved = resolve(input)
  try {
    const stats = statSync(resolved)
    if (stats.isFile()) {
      return {
        searchPath: dirname(resolved),
        matchPath: normalizeComparablePath(resolved),
        fileOnly: true,
      }
    }
    if (stats.isDirectory()) {
      return {
        searchPath: resolved,
        matchPath: normalizeComparablePath(resolved),
        fileOnly: false,
      }
    }
  } catch {
    // 附加文件被删除后仍可能需要展示 git 删除记录；此时用父目录找仓库、按文件精确匹配。
    return {
      searchPath: dirname(resolved),
      matchPath: normalizeComparablePath(resolved),
      fileOnly: true,
    }
  }
  return null
}

/**
 * 校验并规范化 filePath，确保其位于 root 目录内。
 * 支持相对路径和绝对路径。绝对路径会被自动转为相对路径。
 * 拒绝越过 root 的路径；合法文件名中的 `..` 子串应被保留。
 * 返回安全的相对路径，或 null 表示不安全。
 */
function normalizeSafePath(root: string, filePath: string): string | null {
  if (!filePath || typeof filePath !== 'string') return null
  let resolvedRoot: string
  try {
    resolvedRoot = realpathSync(resolve(root))
  } catch {
    resolvedRoot = resolve(root)
  }
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep

  if (isAbsolute(filePath)) {
    let resolvedFile: string
    try {
      resolvedFile = realpathSync(resolve(filePath))
    } catch {
      return null
    }
    if (!resolvedFile.startsWith(rootWithSep)) return null
    return resolvedFile.slice(rootWithSep.length)
  }

  const resolvedTarget = resolve(resolvedRoot, filePath)
  let realTarget: string
  try {
    realTarget = realpathSync(resolvedTarget)
  } catch {
    realTarget = resolvedTarget
  }
  if (!realTarget.startsWith(rootWithSep) && realTarget !== resolvedRoot) return null
  return filePath
}

/**
 * 异步执行 Git 命令
 *
 * @param args - Git 命令参数
 * @param cwd - 工作目录
 * @returns 命令输出，如果失败返回 null
 */
/** 进程级 Git 子进程上限，避免多个 Diff 面板刷新时放大 I/O。 */
const MAX_CONCURRENT_GIT_COMMANDS = 6
/** 未追踪文件并发读取上限，避免大量新文件占满文件系统线程池。 */
const MAX_CONCURRENT_UNTRACKED_FILE_READS = 6

class AsyncSemaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  private async acquire(): Promise<void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active += 1
  }

  private release(): void {
    this.active -= 1
    this.waiters.shift()?.()
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await operation()
    } finally {
      this.release()
    }
  }
}

const gitCommandSemaphore = new AsyncSemaphore(MAX_CONCURRENT_GIT_COMMANDS)
const untrackedFileReadSemaphore = new AsyncSemaphore(MAX_CONCURRENT_UNTRACKED_FILE_READS)

function runGitProcess(args: string[], cwd: string, options?: { quiet?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      // -c core.quotePath=false：禁用 git 对非 ASCII 路径的八进制转义（如中文文件名
      // 默认会输出为 "\347\250\213.md" 并加引号），保证 diff/ls-files 等输出原始 UTF-8 路径
      const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      })

      // 显式指定 UTF-8 编码：由 StringDecoder 正确处理跨 chunk 的多字节字符边界，
      // 避免中文文件名/内容在 chunk 切分处出现乱码（逐块 data.toString() 会损坏）
      child.stdout?.setEncoding('utf-8')
      child.stderr?.setEncoding('utf-8')

      let stdout = ''
      let stderr = ''
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null
      let forceKillTimeout: ReturnType<typeof setTimeout> | null = null
      const finish = (value: string | null) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        if (forceKillTimeout) clearTimeout(forceKillTimeout)
        resolve(value)
      }

      child.stdout?.on('data', (data) => { stdout += data })
      child.stderr?.on('data', (data) => { stderr += data })

      timeout = setTimeout(() => {
        child.kill('SIGTERM')
        console.warn('[git-diff-service] git 命令超时:', args.join(' '))
        // SIGTERM 被忽略时再强制结束，避免永久占据全局 semaphore。
        forceKillTimeout = setTimeout(() => {
          if (settled) return
          child.kill('SIGKILL')
          finish(null)
        }, 1000)
      }, 10000)

      child.on('close', (code) => {
        if (code === 0) {
          finish(stdout.trim())
        } else {
          if (!options?.quiet) console.error('[git-diff-service] git 命令失败:', args.join(' '), stderr.trim())
          finish(null)
        }
      })

      child.on('error', (err) => {
        if (!options?.quiet) console.error('[git-diff-service] git 命令错误:', err)
        finish(null)
      })
    } catch {
      resolve(null)
    }
  })
}

function runGitCommand(args: string[], cwd: string, options?: { quiet?: boolean }): Promise<string | null> {
  return gitCommandSemaphore.run(() => runGitProcess(args, cwd, options))
}

const WORKTREE_FETCH_TTL_MS = 30_000
interface WorktreeFetchState {
  lastAttemptAt: number
  inFlight?: Promise<void>
}
const worktreeFetchStates = new Map<string, WorktreeFetchState>()

/** 远端同步只允许单飞，并在短时间内复用结果，避免刷新风暴放大 Git/网络进程。 */
async function refreshWorktreeRemote(fetchKey: string, cwd: string): Promise<void> {
  const now = Date.now()
  const current = worktreeFetchStates.get(fetchKey)
  if (current?.inFlight) {
    await current.inFlight
    return
  }
  if (current && now - current.lastAttemptAt < WORKTREE_FETCH_TTL_MS) return

  const inFlight = runGitCommand(
    ['fetch', 'origin', 'main', '--quiet'],
    cwd,
    { quiet: true },
  ).then(() => undefined)
  worktreeFetchStates.set(fetchKey, { lastAttemptAt: now, inFlight })

  try {
    await inFlight
  } finally {
    const latest = worktreeFetchStates.get(fetchKey)
    if (latest?.inFlight === inFlight) latest.inFlight = undefined
  }
}

/**
 * 计算文件的来源标识
 *
 * filePath 是相对于 gitRoot 的路径，需要拼成绝对路径后再和 session/workspace 路径比较
 */
function computeSource(
  filePath: string,
  gitRoot: string,
  sessionPath?: string,
  workspaceFilesPath?: string,
): ChangeSource {
  const absolutePath = join(gitRoot, filePath)
  let inSession = false
  let inWorkspace = false

  if (sessionPath) {
    const normalized = sessionPath.endsWith(sep) ? sessionPath : sessionPath + sep
    if (absolutePath.startsWith(normalized)) {
      inSession = true
    }
  }

  if (workspaceFilesPath) {
    const normalized = workspaceFilesPath.endsWith(sep) ? workspaceFilesPath : workspaceFilesPath + sep
    if (absolutePath.startsWith(normalized)) {
      inWorkspace = true
    }
  }

  if (inSession && inWorkspace) return 'both'
  if (inSession) return 'session'
  if (inWorkspace) return 'workspace'
  return 'none'
}

/**
 * 解析 numstat 输出为 path -> { additions, deletions } 映射。
 * 对 rename/copy 行（格式 `add\tdel\told => new` 或带 `{...}` 的），以新路径为 key。
 */
function parseNumstat(numStat: string | null): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  if (!numStat) return map
  for (const line of numStat.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const additions = parseInt(parts[0]!, 10)
    const deletions = parseInt(parts[1]!, 10)
    let path = parts.slice(2).join('\t')
    // 处理 rename 格式 `old => new`
    const arrowIdx = path.indexOf(' => ')
    if (arrowIdx >= 0) {
      path = path.slice(arrowIdx + 4)
    }
    map.set(path, {
      additions: isNaN(additions) ? 0 : additions,
      deletions: isNaN(deletions) ? 0 : deletions,
    })
  }
  return map
}

/** 仅接受位于仓库根目录内的相对路径；允许合法文件名中的 `..` 子串。 */
function resolveUntrackedFilePath(gitRoot: string, filePath: string): string | null {
  if (!filePath || isAbsolute(filePath)) return null
  const resolvedRoot = resolve(gitRoot)
  const resolvedPath = resolve(resolvedRoot, filePath)
  const rootWithSep = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  return resolvedPath.startsWith(rootWithSep) ? resolvedPath : null
}

function isPathInsideRoot(root: string, target: string): boolean {
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  return target.startsWith(rootWithSep)
}

/**
 * 统计未追踪文本文件的新增行数。
 *
 * Git 不会为 untracked 文件提供 numstat，因此仅读取受大小限制的普通文本文件。
 * 路径校验与 I/O 均在受限队列内异步执行；使用 LF 字节计数以匹配 Git 对 CRLF
 * 文本的统计，没有末尾 LF 的非空内容仍算一行。
 */
async function countUntrackedFileAdditions(realGitRoot: string, filePath: string): Promise<number> {
  return untrackedFileReadSemaphore.run(async () => {
    const fullPath = resolveUntrackedFilePath(realGitRoot, filePath)
    if (!fullPath) return 0

    try {
      const linkStat = await lstat(fullPath)
      if (!linkStat.isFile() || linkStat.size > MAX_FILE_SIZE_BYTES) return 0

      const realPath = await realpath(fullPath)
      if (!isPathInsideRoot(realGitRoot, realPath)) return 0

      // O_NOFOLLOW 在支持的平台拒绝末级符号链接；随后校验打开的对象仍是 lstat 时的文件。
      const fileHandle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const fileStat = await fileHandle.stat()
        if (
          !fileStat.isFile()
          || fileStat.size > MAX_FILE_SIZE_BYTES
          || fileStat.dev !== linkStat.dev
          || fileStat.ino !== linkStat.ino
        ) return 0

        // 重新确认当前路径仍指向仓库内、且与已打开对象相同的普通文件。
        const [currentLinkStat, currentRealPath] = await Promise.all([lstat(fullPath), realpath(fullPath)])
        if (
          !currentLinkStat.isFile()
          || currentLinkStat.dev !== fileStat.dev
          || currentLinkStat.ino !== fileStat.ino
          || !isPathInsideRoot(realGitRoot, currentRealPath)
        ) return 0

        const content = Buffer.alloc(fileStat.size)
        const { bytesRead } = await fileHandle.read(content, 0, content.length, 0)
        if (bytesRead === 0 || content.subarray(0, bytesRead).includes(0)) return 0

        let lines = 0
        for (let index = 0; index < bytesRead; index += 1) {
          if (content[index] === 0x0a) lines += 1
        }
        return lines + (content[bytesRead - 1] === 0x0a ? 0 : 1)
      } finally {
        await fileHandle.close()
      }
    } catch {
      return 0
    }
  })
}

/** 受限 worker 队列：避免为全部未追踪文件同时创建 Promise。 */
async function buildUntrackedFileEntries(gitRoot: string, filePaths: string[]): Promise<UntrackedFileEntry[]> {
  const entries: UntrackedFileEntry[] = filePaths.map((filePath) => ({
    filePath,
    additions: 0,
    deletions: 0,
    gitRoot,
  }))
  if (entries.length === 0) return entries

  let realGitRoot: string
  try {
    realGitRoot = await realpath(gitRoot)
  } catch {
    return entries
  }

  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < entries.length) {
      const index = nextIndex
      nextIndex += 1
      entries[index]!.additions = await countUntrackedFileAdditions(realGitRoot, entries[index]!.filePath)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_UNTRACKED_FILE_READS, entries.length) }, worker))
  return entries
}

interface CachedRepoScan {
  files: Array<Omit<ChangedFileEntry, 'source'>>
  untrackedFiles: UntrackedFileEntry[]
}

interface CachedRepoScanEntry {
  revision: number
  fingerprint: string
  value: CachedRepoScan
}

interface InFlightRepoScan {
  revision: number
  fingerprint: string | null
  promise: Promise<CachedRepoScan>
}

/** 每个仓库独立 revision；定向失效绝不影响无关仓库。 */
const repoRevisions = new Map<string, number>()
const repoScanCache = new Map<string, CachedRepoScanEntry>()
const inFlightRepoScans = new Map<string, InFlightRepoScan>()

function getRepoRevision(gitRoot: string): number {
  return repoRevisions.get(gitRoot) ?? 0
}

function isSameOrDescendant(path: string, possibleParent: string): boolean {
  return path === possibleParent || path.startsWith(possibleParent.endsWith('/') ? possibleParent : `${possibleParent}/`)
}

function getPathFingerprint(path: string): string {
  try {
    // git diff 会刷新 index 的 stat cache；不能用 mtime/ctime，否则每次扫描都会错过缓存。
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
    return `${path}:${digest}`
  } catch {
    return `${path}:missing`
  }
}

function getGitCommonDirPath(gitDir: string): string {
  try {
    const commonDir = readFileSync(join(gitDir, 'commondir'), 'utf-8').trim()
    return commonDir ? resolve(gitDir, commonDir) : gitDir
  } catch {
    return gitDir
  }
}

function getGitDirPath(gitRoot: string): string | null {
  const dotGitPath = join(gitRoot, '.git')
  try {
    if (statSync(dotGitPath).isDirectory()) return dotGitPath
    const match = readFileSync(dotGitPath, 'utf-8').match(/^gitdir:\s*(.+)\s*$/m)
    return match ? resolve(gitRoot, match[1]!) : null
  } catch {
    return null
  }
}

/** linked worktree 的符号 HEAD 的 ref 位于 common git-dir，必须单独校验扫描期间它没有改变。 */
function getGitHeadFingerprint(gitRoot: string): string | null {
  const gitDir = getGitDirPath(gitRoot)
  if (!gitDir) return null
  try {
    const headPath = join(gitDir, 'HEAD')
    const headContent = readFileSync(headPath, 'utf-8')
    const fingerprints = [getPathFingerprint(headPath)]
    const symbolicRef = headContent.match(/^ref:\s*(.+)\s*$/m)?.[1]
    if (symbolicRef) {
      const commonDir = getGitCommonDirPath(gitDir)
      const refPath = join(commonDir, symbolicRef)
      fingerprints.push(getPathFingerprint(refPath))
      if (!existsSync(refPath)) fingerprints.push(getPathFingerprint(join(commonDir, 'packed-refs')))
    }
    return fingerprints.join('|')
  } catch {
    return null
  }
}

/** 返回会影响 `git diff HEAD` 的轻量状态指纹。 */
function getGitStateFingerprint(gitRoot: string): string | null {
  const gitDir = getGitDirPath(gitRoot)
  const headFingerprint = getGitHeadFingerprint(gitRoot)
  return gitDir && headFingerprint ? `${headFingerprint}|${getPathFingerprint(join(gitDir, 'index'))}` : null
}

/**
 * 让指定路径所属的已知仓库缓存失效；未给路径时失效全部。
 * 扫描会捕获 revision，完成时仅当 revision 未变才允许写回缓存。
 */
export function invalidateGitDiffCache(changedPath?: string): void {
  const roots = new Set([...repoRevisions.keys(), ...repoScanCache.keys(), ...inFlightRepoScans.keys()])
  const target = changedPath ? normalizeGitRoot(changedPath) : null

  for (const root of roots) {
    if (target && !isSameOrDescendant(target, root) && !isSameOrDescendant(root, target)) continue
    repoRevisions.set(root, getRepoRevision(root) + 1)
    repoScanCache.delete(root)
  }
}

async function scanGitRoot(gitRoot: string): Promise<CachedRepoScan | null> {
  // 三条查询没有数据依赖；在全局 semaphore 约束下并行可缩短单仓库延迟。
  const [nameStatus, numStat, untrackedOutput] = await Promise.all([
    runGitCommand(['diff', 'HEAD', '--name-status'], gitRoot),
    runGitCommand(['diff', 'HEAD', '--numstat'], gitRoot),
    runGitCommand(['ls-files', '--others', '--exclude-standard'], gitRoot),
  ])
  // Git 暂时不可用/超时不能被缓存为“干净仓库”，否则会长期显示空 Diff。
  if (nameStatus === null || numStat === null || untrackedOutput === null) return null

  const numStatMap = parseNumstat(numStat)
  const files: Array<Omit<ChangedFileEntry, 'source'>> = []
  if (nameStatus) {
    for (const statusLine of nameStatus.split('\n').filter(Boolean)) {
      const simpleMatch = statusLine.match(/^([MDAT])\t(.+)$/)
      const renameMatch = statusLine.match(/^([RC])\d*\t([^\t]+)\t(.+)$/)
      let status: ChangedFileStatus
      let filePath: string

      if (simpleMatch) {
        status = simpleMatch[1] === 'D' ? 'deleted' : 'modified'
        filePath = simpleMatch[2]!
      } else if (renameMatch) {
        status = 'modified'
        filePath = renameMatch[3]!
      } else {
        continue
      }

      if (!shouldDisplayChangedFile(filePath)) continue
      const stats = numStatMap.get(filePath) ?? { additions: 0, deletions: 0 }
      files.push({ filePath, status, additions: stats.additions, deletions: stats.deletions, gitRoot })
    }
  }

  const untrackedFiles = await buildUntrackedFileEntries(
    gitRoot,
    untrackedOutput ? untrackedOutput.split('\n').filter(Boolean).filter(shouldDisplayChangedFile) : [],
  )

  return { files, untrackedFiles }
}

async function getCachedRepoScan(gitRoot: string): Promise<CachedRepoScan> {
  const root = normalizeGitRoot(gitRoot)
  const revision = getRepoRevision(root)
  const fingerprint = getGitStateFingerprint(root)
  const headFingerprint = getGitHeadFingerprint(root)
  const cached = repoScanCache.get(root)
  if (fingerprint !== null && cached?.revision === revision && cached.fingerprint === fingerprint) return cached.value

  const inFlight = inFlightRepoScans.get(root)
  if (inFlight?.revision === revision && inFlight.fingerprint === fingerprint) return inFlight.promise

  const promise = scanGitRoot(root).then((value) => {
    if (value === null) return { files: [], untrackedFiles: [] }
    const completedFingerprint = getGitStateFingerprint(root)
    const completedHeadFingerprint = getGitHeadFingerprint(root)
    // Git diff 会刷新 index stat cache；但 HEAD/ref 在扫描期间变化会让两个并发查询混用基准，不能缓存。
    if (
      completedFingerprint !== null
      && headFingerprint !== null
      && headFingerprint === completedHeadFingerprint
      && getRepoRevision(root) === revision
      && inFlightRepoScans.get(root)?.promise === promise
    ) {
      repoScanCache.set(root, { revision, fingerprint: completedFingerprint, value })
    }
    return value
  }).finally(() => {
    if (inFlightRepoScans.get(root)?.promise === promise) inFlightRepoScans.delete(root)
  })
  inFlightRepoScans.set(root, { revision, fingerprint, promise })
  return promise
}

/**
 * 获取当前工作树相对 HEAD 的文件变更列表（支持多 Git 仓库）。
 *
 * 包含 staged + unstaged 改动；函数名保留为 getUnstagedChanges 以兼容现有 IPC。
 */
export async function getUnstagedChanges(
  dirPath: string,
  sessionPath?: string,
  workspaceFilesPath?: string,
  extraPaths?: string[],
): Promise<UnstagedChangesResult> {
  const rawCandidates = [dirPath, sessionPath, workspaceFilesPath, ...(extraPaths || [])].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  const candidates = rawCandidates.map(toChangeCandidate).filter((candidate): candidate is ChangeCandidate => candidate !== null)
  const gitRoots: string[] = []

  const rootsByCandidate = await Promise.all(candidates.map((candidate) => findAllGitRoots(candidate.searchPath)))
  for (const roots of rootsByCandidate) {
    for (const root of roots) {
      if (!gitRoots.includes(root)) gitRoots.push(root)
    }
  }
  if (gitRoots.length === 0) return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }

  const isUnderAnyCandidate = (absolutePath: string): boolean => {
    const normalized = normalizeComparablePath(absolutePath)
    return candidates.some((candidate) => candidate.fileOnly
      ? normalized === candidate.matchPath
      : normalized === candidate.matchPath || normalized.startsWith(`${candidate.matchPath}/`))
  }

  const scans = await Promise.all(gitRoots.map(getCachedRepoScan))
  const files: ChangedFileEntry[] = []
  const untrackedFiles: UntrackedFileEntry[] = []
  for (const scan of scans) {
    for (const file of scan.files) {
      if (!isUnderAnyCandidate(join(file.gitRoot, file.filePath))) continue
      files.push({ ...file, source: computeSource(file.filePath, file.gitRoot, sessionPath, workspaceFilesPath) })
    }
    for (const file of scan.untrackedFiles) {
      if (isUnderAnyCandidate(join(file.gitRoot, file.filePath))) untrackedFiles.push(file)
    }
  }

  return { isGitRepo: true, files, untrackedFiles, gitRootNames: gitRoots.map((root) => basename(root)) }
}

/**
 * 归一化仓库根路径，用于去重。
 *
 * 两个数据源的分隔符风格不一致：`git rev-parse --show-toplevel` 在 Windows 返回正斜杠
 * （`C:/.../repo`），而 Node `path.join` 返回反斜杠（`C:\...\repo`）。统一用 resolve
 * 规范化并转为正斜杠，确保同一仓库的两种写法被识别为同一个根，避免重复跑 git diff。
 */
export function normalizeGitRoot(p: string): string {
  return resolve(p).replace(/\\/g, '/')
}

/** 向下递归搜索所有 .git 目录，返回所有找到的仓库根（不提前停止） */
function findAllGitRootsDown(dirPath: string, maxDepth: number): string[] {
  if (maxDepth <= 0) return []

  let entries: string[]
  try {
    entries = readdirSync(dirPath)
  } catch {
    return []
  }

  const found: string[] = []
  for (const name of entries) {
    if (name === '.git') {
      found.push(dirPath)
      continue
    }
    if (name.startsWith('.') || name === 'node_modules') continue

    const fullPath = join(dirPath, name)
    let st
    try { st = statSync(fullPath) } catch { continue }
    if (!st.isDirectory()) continue

    if (existsSync(join(fullPath, '.git'))) {
      found.push(fullPath)
      // 已确认是 git root，不再深入避免重复
      continue
    }
    found.push(...findAllGitRootsDown(fullPath, maxDepth - 1))
  }

  return found
}

/** 查找 Git 仓库根目录（支持向上搜索子目录内的 repos），返回所有找到的根 */
export async function findAllGitRoots(baseDir: string): Promise<string[]> {
  if (!existsSync(baseDir)) return []

  // 1. 向上搜索：git rev-parse --show-toplevel
  const toplevel = await runGitCommand(['rev-parse', '--show-toplevel'], baseDir, { quiet: true })
  const roots: string[] = []
  if (toplevel && existsSync(toplevel)) {
    const normalized = normalizeGitRoot(toplevel)
    if (!roots.includes(normalized)) roots.push(normalized)
  }

  // 2. 向下搜索所有子 .git
  for (const r of findAllGitRootsDown(baseDir, 3)) {
    const normalized = normalizeGitRoot(r)
    if (!roots.includes(normalized)) roots.push(normalized)
  }

  return roots
}

/** 查找 Git 仓库根目录，先向上后向下搜索，失败返回 null */
async function findGitRoot(baseDir: string): Promise<string | null> {
  const roots = await findAllGitRoots(baseDir)
  return roots[0] ?? null
}

/**
 * 获取单个文件的 unified diff
 */
export async function getFileDiff(dirPath: string, filePath: string, gitRoot?: string): Promise<string> {
  const root = gitRoot || await findGitRoot(dirPath)
  if (!root) return ''
  const safePath = normalizeSafePath(root, filePath)
  if (!safePath) {
    console.warn('[git-diff-service] getFileDiff 拒绝不安全路径:', filePath)
    return ''
  }
  const diff = await runGitCommand(['diff', '--', safePath], root)
  return diff || ''
}

/**
 * 获取文件的旧版本（git HEAD 或指定 baseRef）和新版本（磁盘）内容
 */
export async function getDiffContents(dirPath: string, filePath: string, gitRoot?: string, baseRef?: string): Promise<{ oldContent: string; newContent: string } | null> {
  const root = gitRoot || await findGitRoot(dirPath)

  // 无 git root：纯文件预览（无 git HEAD 可比较），仅读磁盘文件，安全检查依赖 dirPath
  if (!root) {
    const safePath = normalizeSafePath(dirPath, filePath)
    if (!safePath) {
      console.warn('[git-diff-service] getDiffContents 拒绝不安全路径（无 git root）:', filePath)
      return null
    }
    const fullPath = join(dirPath, safePath)
    let newContent = ''
    if (existsSync(fullPath)) {
      try {
        const st = statSync(fullPath)
        if (st.size > MAX_FILE_SIZE_BYTES) {
          console.warn('[git-diff-service] 文件超过大小上限，跳过读取:', fullPath, st.size)
        } else {
          newContent = readFileSync(fullPath, 'utf-8')
        }
      } catch {
        // 读取失败保持空字符串
      }
    }
    return { oldContent: '', newContent: normalizeLineEndings(newContent) }
  }

  const safePath = normalizeSafePath(root, filePath)
  if (!safePath) {
    console.warn('[git-diff-service] getDiffContents 拒绝不安全路径:', filePath)
    return null
  }

  // 旧版本从 git HEAD（或指定 baseRef）读取
  const ref = baseRef || 'HEAD'
  let oldContent = ''
  try {
    const oldGitContent = await runGitCommand(['show', `${ref}:${safePath}`], root)
    if (oldGitContent !== null) {
      oldContent = oldGitContent
    }
  } catch {
    // 文件在 HEAD 中不存在（新文件）
  }

  // 新版本从磁盘读取
  let newContent = ''
  const fullPath = join(root, safePath)
  if (existsSync(fullPath)) {
    try {
      const st = statSync(fullPath)
      if (st.size > MAX_FILE_SIZE_BYTES) {
        console.warn('[git-diff-service] 文件超过大小上限，跳过读取:', fullPath, st.size)
      } else {
        newContent = readFileSync(fullPath, 'utf-8')
      }
    } catch {
      // 读取失败保持空字符串
    }
  }

  return { oldContent: normalizeLineEndings(oldContent), newContent: normalizeLineEndings(newContent) }
}

/**
 * 获取未追踪文件的内容（用于显示全绿新增 diff）
 *
 * filePath 应为相对于 gitRoot 或 dirPath 的相对路径。
 * 拒绝绝对路径和 `..` 穿越。
 */
export async function getUntrackedContent(dirPath: string, filePath: string, gitRoot?: string): Promise<string> {
  if (!filePath || typeof filePath !== 'string') return ''
  const root = gitRoot || await findGitRoot(dirPath) || dirPath
  const safePath = normalizeSafePath(root, filePath)
  if (!safePath) {
    console.warn('[git-diff-service] getUntrackedContent 拒绝不安全路径:', filePath)
    return ''
  }
  const fullPath = resolve(root, safePath)
  try {
    const st = statSync(fullPath)
    if (st.size > MAX_FILE_SIZE_BYTES) {
      console.warn('[git-diff-service] 未追踪文件超过大小上限:', fullPath, st.size)
      return ''
    }
    return normalizeLineEndings(readFileSync(fullPath, 'utf-8'))
  } catch {
    return ''
  }
}

/**
 * 还原文件相对 HEAD 的所有改动（index + working tree）。
 */
export async function revertFile(dirPath: string, filePath: string, gitRoot?: string): Promise<void> {
  const root = gitRoot || await findGitRoot(dirPath)
  if (!root) throw new Error('未找到 Git 仓库')
  const safePath = normalizeSafePath(root, filePath)
  if (!safePath) {
    throw new Error(`不安全的路径: ${filePath}`)
  }
  const result = await runGitCommand(['restore', '--staged', '--worktree', '--', safePath], root)
  if (result === null) {
    throw new Error(`还原失败: git restore --staged --worktree -- ${safePath}`)
  }
  invalidateGitDiffCache(join(root, safePath))
}

async function getGitCommonDir(somePath: string): Promise<string | null> {
  const commonDir = await runGitCommand(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    somePath,
    { quiet: true },
  )
  return commonDir ? normalizeGitRoot(commonDir) : null
}

/**
 * 解析给定路径所属 git 仓库的「主仓库根目录」。
 *
 * 对于 worktree，git 的公共目录（--git-common-dir）始终指向主仓库的 .git，
 * 因此其父目录即主仓库根。普通仓库返回自身根目录。非 git 路径返回 null。
 *
 * 用于安全校验：worktree 常被放在主仓库之外（如 ~/proma-dev/worktrees/xxx），
 * 直接判定其路径会越界；改为校验它回溯到的主仓库是否已授权。
 */
export async function getMainRepoRoot(somePath: string): Promise<string | null> {
  if (!existsSync(somePath)) return null
  const commonDir = await getGitCommonDir(somePath)
  if (!commonDir) return null
  // commonDir 形如 /path/to/main-repo/.git，取其父目录
  return normalizeGitRoot(dirname(commonDir))
}

/**
 * 列出指定路径下所有 Git 仓库的 Worktree。
 *
 * 会话目录可能是包含多个仓库的父目录。不能只使用第一个发现的仓库，否则前面的
 * 普通仓库会遮蔽后面真正拥有 linked worktree 的仓库。
 */
export async function listWorktrees(repoPath: string): Promise<import('@proma/shared').WorktreeInfo[]> {
  const roots = await findAllGitRoots(repoPath)
  const worktreesByPath = new Map<string, import('@proma/shared').WorktreeInfo>()

  for (const root of roots) {
    const output = await runGitCommand(['worktree', 'list', '--porcelain'], root, { quiet: true })
    if (!output) continue

    const mainRepoRoot = await getMainRepoRoot(root)
    const normalizedMainRoot = mainRepoRoot ? normalizeGitRoot(mainRepoRoot) : normalizeGitRoot(root)
    const blocks = output.split('\n\n').filter(Boolean)

    for (const block of blocks) {
      const lines = block.split('\n')
      let path = ''
      let head = ''
      let branch = ''
      let prunable = false

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length)
        } else if (line.startsWith('HEAD ')) {
          head = line.slice('HEAD '.length).slice(0, 7)
        } else if (line.startsWith('branch refs/heads/')) {
          branch = line.slice('branch refs/heads/'.length)
        } else if (line === 'detached') {
          branch = '(detached)'
        } else if (line.startsWith('prunable')) {
          prunable = true
        }
      }

      if (!path || prunable || !existsSync(path)) continue

      const key = normalizeGitRoot(path)
      if (!worktreesByPath.has(key)) {
        worktreesByPath.set(key, {
          path,
          branch: branch || 'unknown',
          head,
          isMain: key === normalizedMainRoot,
          name: basename(path),
        })
      }
    }
  }

  return Array.from(worktreesByPath.values())
}

/**
 * 获取 Worktree 相对于基准分支的全量变更（已 commit + 未提交 + 新文件）
 */
export async function getWorktreeChanges(
  worktreePath: string,
  baseBranch: string = 'origin/main',
): Promise<import('@proma/shared').UnstagedChangesResult> {
  if (!existsSync(worktreePath)) {
    return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
  }

  // 先确认是 git 仓库，非 Git 路径不得启动 fetch 子进程。
  const toplevel = await runGitCommand(['rev-parse', '--show-toplevel'], worktreePath, { quiet: true })
  if (!toplevel) {
    return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
  }

  const gitRoot = normalizeGitRoot(toplevel)
  // Linked worktree 共享同一 git common directory，按它去重 fetch 以避免争抢共享 refs 锁。
  const fetchKey = await getGitCommonDir(gitRoot) ?? gitRoot
  await refreshWorktreeRemote(fetchKey, gitRoot)

  const allFiles: import('@proma/shared').ChangedFileEntry[] = []
  const fileMap = new Map<string, import('@proma/shared').ChangedFileEntry>()

  // 1. 已 commit 但未合并的改动: git diff baseBranch...HEAD
  const committedStatus = await runGitCommand(['diff', `${baseBranch}...HEAD`, '--name-status'], gitRoot)
  const committedNumstat = await runGitCommand(['diff', `${baseBranch}...HEAD`, '--numstat'], gitRoot)
  const committedStats = parseNumstat(committedNumstat)

  if (committedStatus) {
    for (const line of committedStatus.split('\n').filter(Boolean)) {
      const simpleMatch = line.match(/^([MDAT])\t(.+)$/)
      const renameMatch = line.match(/^([RC])\d*\t([^\t]+)\t(.+)$/)

      let status: import('@proma/shared').ChangedFileStatus
      let filePath: string

      if (simpleMatch) {
        const code = simpleMatch[1]!
        status = code === 'D' ? 'deleted' : code === 'A' ? 'untracked' : 'modified'
        filePath = simpleMatch[2]!
      } else if (renameMatch) {
        status = 'modified'
        filePath = renameMatch[3]!
      } else {
        continue
      }

      if (!shouldDisplayChangedFile(filePath)) continue
      const stats = committedStats.get(filePath) ?? { additions: 0, deletions: 0 }
      const entry: import('@proma/shared').ChangedFileEntry = {
        filePath,
        status,
        additions: stats.additions,
        deletions: stats.deletions,
        source: 'none',
        gitRoot,
      }
      fileMap.set(filePath, entry)
    }
  }

  // 2. 未提交的改动：当前工作树相对 HEAD，覆盖 staged + unstaged。
  const uncommittedStatus = await runGitCommand(['diff', 'HEAD', '--name-status'], gitRoot)
  const uncommittedNumstat = await runGitCommand(['diff', 'HEAD', '--numstat'], gitRoot)
  const uncommittedStats = parseNumstat(uncommittedNumstat)

  if (uncommittedStatus) {
    for (const line of uncommittedStatus.split('\n').filter(Boolean)) {
      const simpleMatch = line.match(/^([MDAT])\t(.+)$/)
      const renameMatch = line.match(/^([RC])\d*\t([^\t]+)\t(.+)$/)

      let status: import('@proma/shared').ChangedFileStatus
      let filePath: string

      if (simpleMatch) {
        const code = simpleMatch[1]!
        status = code === 'D' ? 'deleted' : 'modified'
        filePath = simpleMatch[2]!
      } else if (renameMatch) {
        status = 'modified'
        filePath = renameMatch[3]!
      } else {
        continue
      }

      if (!shouldDisplayChangedFile(filePath)) continue
      const stats = uncommittedStats.get(filePath) ?? { additions: 0, deletions: 0 }
      const existing = fileMap.get(filePath)
      if (existing) {
        existing.additions += stats.additions
        existing.deletions += stats.deletions
      } else {
        fileMap.set(filePath, {
          filePath,
          status,
          additions: stats.additions,
          deletions: stats.deletions,
          source: 'none',
          gitRoot,
        })
      }
    }
  }

  allFiles.push(...fileMap.values())

  // 3. 新文件（未追踪）
  const untrackedOutput = await runGitCommand(['ls-files', '--others', '--exclude-standard'], gitRoot)
  const untrackedFiles = await buildUntrackedFileEntries(
    gitRoot,
    untrackedOutput
      ? untrackedOutput.split('\n').filter((filePath) => !fileMap.has(filePath) && shouldDisplayChangedFile(filePath))
      : [],
  )

  return {
    isGitRepo: true,
    files: allFiles,
    untrackedFiles,
    gitRootNames: [basename(gitRoot)],
  }
}
