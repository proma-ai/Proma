/**
 * Git Diff 服务
 *
 * 提供工作区文件变更检测、diff 获取、文件还原等 Git 操作。
 * 使用异步 spawn 模式，避免阻塞主进程。
 */

import { spawn } from 'child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import type { ChangedFileEntry, UnstagedChangesResult, UntrackedFileEntry } from '@proma/shared'
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
 * 校验并规范化 filePath，确保其位于 root 目录内。
 * 支持相对路径和绝对路径。绝对路径会被自动转为相对路径。
 * 拒绝 `..` 穿越和 root 外的路径。
 * 返回安全的相对路径，或 null 表示不安全。
 */
function normalizeSafePath(root: string, filePath: string): string | null {
  if (!filePath || typeof filePath !== 'string') return null
  const resolvedRoot = resolve(root)
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

  if (filePath.includes('..')) return null
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
function runGitCommand(args: string[], cwd: string): Promise<string | null> {
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

      child.stdout?.on('data', (data) => {
        stdout += data
      })

      child.stderr?.on('data', (data) => {
        stderr += data
      })

      // 10 秒超时
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        console.warn('[git-diff-service] git 命令超时:', args.join(' '))
        resolve(null)
      }, 10000)

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          console.error('[git-diff-service] git 命令失败:', args.join(' '), stderr.trim())
          resolve(null)
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        console.error('[git-diff-service] git 命令错误:', err)
        resolve(null)
      })
    } catch {
      resolve(null)
    }
  })
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

/**
 * 获取未暂存的文件变更列表（支持多 Git 仓库）
 */
export async function getUnstagedChanges(
  dirPath: string,
  sessionPath?: string,
  workspaceFilesPath?: string,
  extraPaths?: string[],
): Promise<UnstagedChangesResult> {
  // 收集所有候选目录中的不重复 Git 仓库根
  const candidates = [dirPath, sessionPath, workspaceFilesPath, ...(extraPaths || [])].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  )
  const gitRoots: string[] = []
  for (const cand of candidates) {
    const roots = await findAllGitRoots(cand)
    for (const root of roots) {
      if (!gitRoots.includes(root)) gitRoots.push(root)
    }
  }

  if (gitRoots.length === 0) {
    return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
  }

  const allFiles: ChangedFileEntry[] = []
  const allUntracked: UntrackedFileEntry[] = []

  // 候选目录绝对路径（用于过滤：只显示落在某个候选目录内的文件）
  const candidateRoots = candidates.map((c) => {
    const r = c.replace(/[/\\]+$/, '')
    return r + sep
  })
  const isUnderAnyCandidate = (absPath: string): boolean => {
    return candidateRoots.some((root) => absPath === root.slice(0, -1) || absPath.startsWith(root))
  }

  for (const gitRoot of gitRoots) {
    // 获取变更文件列表 (M=modified, D=deleted, A=added, R=renamed, C=copied, T=type)
    const nameStatus = await runGitCommand(['diff', '--name-status'], gitRoot)
    const numStat = await runGitCommand(['diff', '--numstat'], gitRoot)
    const numStatMap = parseNumstat(numStat)

    if (nameStatus) {
      const statusLines = nameStatus.split('\n').filter(Boolean)

      for (const statusLine of statusLines) {
        const simpleMatch = statusLine.match(/^([MDAT])\t(.+)$/)
        const renameMatch = statusLine.match(/^([RC])\d*\t([^\t]+)\t(.+)$/)

        let status: ChangedFileStatus
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

        // 过滤：只保留落在某个 candidate 内的文件
        const absPath = join(gitRoot, filePath)
        if (!isUnderAnyCandidate(absPath)) continue

        const stats = numStatMap.get(filePath) ?? { additions: 0, deletions: 0 }

        allFiles.push({
          filePath,
          status,
          additions: stats.additions,
          deletions: stats.deletions,
          source: computeSource(filePath, gitRoot, sessionPath, workspaceFilesPath),
          gitRoot,
        })
      }
    }

    // 获取未追踪文件
    const untrackedOutput = await runGitCommand(['ls-files', '--others', '--exclude-standard'], gitRoot)
    if (untrackedOutput) {
      for (const rel of untrackedOutput.split('\n').filter(Boolean)) {
        const absPath = join(gitRoot, rel)
        if (isUnderAnyCandidate(absPath)) {
          allUntracked.push({ filePath: rel, gitRoot })
        }
      }
    }
  }

  return {
    isGitRepo: true,
    files: allFiles,
    untrackedFiles: allUntracked,
    gitRootNames: gitRoots.map((r) => basename(r)),
  }
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
  const toplevel = await runGitCommand(['rev-parse', '--show-toplevel'], baseDir)
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
 * 还原文件的未暂存变更
 */
export async function revertFile(dirPath: string, filePath: string, gitRoot?: string): Promise<void> {
  const root = gitRoot || await findGitRoot(dirPath)
  if (!root) throw new Error('未找到 Git 仓库')
  const safePath = normalizeSafePath(root, filePath)
  if (!safePath) {
    throw new Error(`不安全的路径: ${filePath}`)
  }
  const result = await runGitCommand(['checkout', '--', safePath], root)
  if (result === null) {
    throw new Error(`还原失败: git checkout -- ${safePath}`)
  }
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
  const commonDir = await runGitCommand(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    somePath,
  )
  if (!commonDir) return null
  // commonDir 形如 /path/to/main-repo/.git，取其父目录
  return normalizeGitRoot(dirname(commonDir))
}

/**
 * 列出指定仓库的所有 Git Worktree
 */
export async function listWorktrees(repoPath: string): Promise<import('@proma/shared').WorktreeInfo[]> {
  const output = await runGitCommand(['worktree', 'list', '--porcelain'], repoPath)
  if (!output) return []

  const worktrees: import('@proma/shared').WorktreeInfo[] = []
  const blocks = output.split('\n\n').filter(Boolean)

  for (const block of blocks) {
    const lines = block.split('\n')
    let path = ''
    let head = ''
    let branch = ''

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length).slice(0, 7)
      } else if (line.startsWith('branch refs/heads/')) {
        branch = line.slice('branch refs/heads/'.length)
      } else if (line === 'detached') {
        branch = '(detached)'
      }
    }

    if (path) {
      const isMain = path === repoPath
      worktrees.push({
        path,
        branch: branch || 'unknown',
        head,
        isMain,
        name: basename(path),
      })
    }
  }

  return worktrees
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

  // 尝试 fetch 远端 main 以确保 baseBranch 最新
  await runGitCommand(['fetch', 'origin', 'main', '--quiet'], worktreePath)

  // 确认是 git 仓库
  const toplevel = await runGitCommand(['rev-parse', '--show-toplevel'], worktreePath)
  if (!toplevel) {
    return { isGitRepo: false, files: [], untrackedFiles: [], gitRootNames: [] }
  }

  const gitRoot = normalizeGitRoot(toplevel)
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

  // 2. 未提交的改动: git diff (working tree vs HEAD)
  const uncommittedStatus = await runGitCommand(['diff', '--name-status'], gitRoot)
  const uncommittedNumstat = await runGitCommand(['diff', '--numstat'], gitRoot)
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
  const untrackedFiles: import('@proma/shared').UntrackedFileEntry[] = []
  const untrackedOutput = await runGitCommand(['ls-files', '--others', '--exclude-standard'], gitRoot)
  if (untrackedOutput) {
    for (const rel of untrackedOutput.split('\n').filter(Boolean)) {
      if (!fileMap.has(rel)) {
        untrackedFiles.push({ filePath: rel, gitRoot })
      }
    }
  }

  return {
    isGitRepo: true,
    files: allFiles,
    untrackedFiles,
    gitRootNames: [basename(gitRoot)],
  }
}
