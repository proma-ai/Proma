/**
 * DiffChangesList — 代码改动文件列表
 *
 * 显示当前工作树相对 HEAD 的代码改动，按目录分组，支持 hover 操作按钮。
 */

import * as React from 'react'
import { Box, ChevronRight, FolderSearch, Search, SquareTerminal, Undo2, X } from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FileTypeIcon } from '@/components/file-browser/FileTypeIcon'
import { agentDiffUnseenFilesAtom, agentDiffDataAtom, agentNonGitFileChangesAtom, agentSelectedWorktreeAtom, agentSessionsAtom, workspaceGitDiffRefreshVersionAtom } from '@/atoms/agent-atoms'
import type { ChangedFileEntry, ChangedFileStatus, ChangeSource, UntrackedFileEntry, WorktreeInfo } from '@proma/shared'
import { WorktreeSelector } from './WorktreeSelector'
import { groupSessionFileChanges, arePathsEqual } from '@/lib/session-file-changes'
import { detectIsWindows } from '@/lib/platform'
import type { SessionFileChange } from '@/lib/session-file-changes'
import { buildDiffFileTree } from './diff-file-tree'
import type { DiffFileTreeNode } from './diff-file-tree'
import { collectDiffChangeSources, DIFF_CHANGE_SOURCE_CONFIG } from './diff-change-sources'

interface GitFileEntry {
  filePath: string
  status: ChangedFileStatus
  additions: number
  deletions: number
  /** 已追踪文件的来源；未追踪文件没有来源归属。 */
  source?: ChangeSource
  gitRoot: string
}

/** 按目录分组后的数据结构 */
interface FileGroup {
  /** 完整 Git 仓库路径（用作 React key，避免同名目录冲突） */
  gitRoot: string
  /** 显示用的目录名（仓库的最后一段） */
  dirName: string
  /** 保留会话、项目与附加目录的改动来源标识。 */
  sources: ChangeSource[]
  /** 当前 Git 仓库的改动文件数和行数汇总（不受文件树层级影响）。 */
  fileCount: number
  totalAdditions: number
  totalDeletions: number
  tree: Array<DiffFileTreeNode<GitFileEntry>>
}

interface DiffChangesListProps {
  /** Git 仓库根目录 */
  dirPath: string
  /** 当前 Agent 会话 ID，用于主进程路径授权 */
  sessionId: string
  /** 会话工作目录（用于 badge 计算） */
  sessionPath?: string
  /** 工作区共享文件目录（用于 badge 计算） */
  workspaceFilesPath?: string
  /** 点击文件回调 */
  onFileClick: (filePath: string, isUntracked: boolean, gitRoot?: string) => void
  /** 自动刷新信号（版本号递增触发） */
  refreshVersion?: number
  /** 当前选中的文件路径（高亮显示） */
  selectedFilePath?: string
  /** 额外的候选目录（附加目录等） */
  extraPaths?: string[]
  /** 工作区 slug，用于 WorktreeSelector 拉取 worktree 列表 */
  workspaceSlug?: string
  /** 用于自动发现 worktree 的仓库候选路径 */
  worktreeRepoPaths?: string[]
  /** 在指定 Worktree 根目录创建右侧终端 */
  onOpenWorktreeTerminal?: (worktree: WorktreeInfo) => void
  /** 在右侧工作区中以 Git 目录为 cwd 打开终端。 */
  onOpenDirectoryTerminal?: (directoryPath: string, directoryName: string) => void
  /** 本会话在非 Git 目录中成功写入的文件 */
  nonGitFileChanges?: SessionFileChange[]
  /** 当前 Agent run ID，用于将文件变更划分为本轮和更早 */
  currentFileChangeRunId?: string
  /** 点击非 Git 文件时打开纯文件预览 */
  onPlainFileClick?: (filePath: string) => void
}

export const DiffChangesList = React.memo(function DiffChangesList({
  dirPath,
  sessionPath,
  sessionId,
  workspaceFilesPath,
  onFileClick,
  refreshVersion,
  selectedFilePath,
  extraPaths,
  workspaceSlug,
  worktreeRepoPaths,
  onOpenWorktreeTerminal,
  onOpenDirectoryTerminal,
  nonGitFileChanges = [],
  currentFileChangeRunId,
  onPlainFileClick,
}: DiffChangesListProps): React.ReactElement {
  // Worktree 选择状态（内联 WorktreeSelector）
  const selectedWorktreeMap = useAtomValue(agentSelectedWorktreeAtom)
  const setSelectedWorktreeMap = useSetAtom(agentSelectedWorktreeAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const setSessions = useSetAtom(agentSessionsAtom)
  const persistedWorktreePath = sessions.find((session) => session.id === sessionId)?.activeWorktree?.path ?? null
  const selectedWorktreePath = selectedWorktreeMap.get(sessionId) ?? persistedWorktreePath
  const diffCacheKey = selectedWorktreePath ? `${sessionId}:worktree:${selectedWorktreePath}` : `${sessionId}:session`
  const worktreeMode = React.useMemo(
    () => selectedWorktreePath ? { path: selectedWorktreePath, baseBranch: 'origin/main' } : undefined,
    [selectedWorktreePath],
  )

  React.useEffect(() => {
    setSelectedWorktreeMap((prev) => {
      const previous = prev.get(sessionId) ?? null
      if (previous === persistedWorktreePath) return prev
      const next = new Map(prev)
      next.set(sessionId, persistedWorktreePath)
      return next
    })
  }, [persistedWorktreePath, sessionId, setSelectedWorktreeMap])

  const handleWorktreeSelect = React.useCallback(async (worktree: WorktreeInfo | null) => {
    try {
      const updated = await window.electronAPI.setAgentSessionActiveWorktree({
        sessionId,
        worktreePath: worktree?.path ?? null,
      })
      setSessions((previous) => previous.map((session) => session.id === sessionId ? updated : session))
      setSelectedWorktreeMap((prev) => {
        const next = new Map(prev)
        next.set(sessionId, updated.activeWorktree?.path ?? null)
        return next
      })
    } catch (error) {
      console.error('[DiffChangesList] 保存活动 worktree 失败:', error)
      window.alert(`切换 worktree 失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }, [sessionId, setSelectedWorktreeMap, setSessions])

  // Diff 数据缓存：mount 时若已有上次结果，立即用作初值，避免空数组闪 1s "没有代码改动"
  const diffDataMap = useAtomValue(agentDiffDataAtom)
  const setDiffDataMap = useSetAtom(agentDiffDataAtom)
  const workspaceGitDiffRefreshVersion = useAtomValue(workspaceGitDiffRefreshVersionAtom)
  const cached = diffDataMap.get(diffCacheKey)
  const [files, setFiles] = React.useState<ChangedFileEntry[]>(() => cached?.files ?? [])
  const [untrackedFiles, setUntrackedFiles] = React.useState<UntrackedFileEntry[]>(() => cached?.untrackedFiles ?? [])
  const [isGitRepo, setIsGitRepo] = React.useState(() => cached?.isGitRepo ?? true)
  /** 首次 fetch 是否已返回——区分 loading 与真·空，避免 "没有代码改动" 误闪 */
  const [hasFetched, setHasFetched] = React.useState<boolean>(() => cached !== undefined)
  const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = React.useState('')
  /** 单调递增的 fetch 序号，用于丢弃乱序到达的旧响应 */
  const fetchSeqRef = React.useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset state on cache key switch, not on every diffDataMap update
  React.useEffect(() => {
    fetchSeqRef.current += 1
    const nextCached = diffDataMap.get(diffCacheKey)
    setFiles(nextCached?.files ?? [])
    setUntrackedFiles(nextCached?.untrackedFiles ?? [])
    setIsGitRepo(nextCached?.isGitRepo ?? true)
    setHasFetched(nextCached !== undefined)
  }, [diffCacheKey])

  // Agent 本轮刚修改但尚未查看的文件
  const unseenFilesMap = useAtomValue(agentDiffUnseenFilesAtom)
  const setUnseenFilesMap = useSetAtom(agentDiffUnseenFilesAtom)
  const unseenFiles = unseenFilesMap.get(sessionId) ?? new Set<string>()

  const markFileAsSeen = React.useCallback((filePath: string) => {
    setUnseenFilesMap((prev) => {
      const s = prev.get(sessionId)
      if (!s?.has(filePath)) return prev
      const m = new Map(prev)
      const next = new Set(s)
      next.delete(filePath)
      m.set(sessionId, next)
      return m
    })
  }, [sessionId, setUnseenFilesMap])

  const fetchChanges = React.useCallback(async () => {
    if (!dirPath && !worktreeMode) return
    const requestId = ++fetchSeqRef.current
    try {
      const result = worktreeMode
        ? await window.electronAPI.getWorktreeChanges(worktreeMode.path, worktreeMode.baseBranch, sessionId)
        : await window.electronAPI.getUnstagedChanges(dirPath, sessionPath, workspaceFilesPath, extraPaths, sessionId)
      if (requestId !== fetchSeqRef.current) return
      setIsGitRepo(result.isGitRepo)
      setFiles(result.files || [])
      setUntrackedFiles(result.untrackedFiles || [])
      setHasFetched(true)
      setDiffDataMap((prev) => {
        const next = new Map(prev)
        next.set(diffCacheKey, result)
        return next
      })
    } catch {
      if (requestId !== fetchSeqRef.current) return
      setIsGitRepo(true)
      setHasFetched(true)
    }
  }, [dirPath, sessionPath, workspaceFilesPath, extraPaths, sessionId, setDiffDataMap, worktreeMode, diffCacheKey])

  React.useEffect(() => {
    fetchChanges()
  }, [fetchChanges, refreshVersion, workspaceGitDiffRefreshVersion])

  // 窗口聚焦刷新已统一在 useGlobalAgentListeners 中处理（递增 refreshVersion）

  /** Revert 文件 */
  const handleRevert = React.useCallback(async (filePath: string, gitRoot: string) => {
    if (!window.confirm(`确定要还原 ${filePath} 的所有变更吗？此操作不可撤销。`)) return
    try {
      await window.electronAPI.revertFile({ dirPath, filePath, gitRoot, sessionId })
      await fetchChanges()
    } catch (err) {
      window.alert(`还原失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }, [dirPath, fetchChanges, sessionId])

  /** 切换文件夹折叠 */
  const toggleDir = React.useCallback((dirName: string) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirName)) {
        next.delete(dirName)
      } else {
        next.add(dirName)
      }
      return next
    })
  }, [])

  // 按 Git 仓库分组（在所有 hooks 之后、条件返回之前调用）
  const { fileGroups, matchedFilesCount } = React.useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    const allFiles: GitFileEntry[] = [
      ...files,
      ...untrackedFiles.map((file) => ({
        ...file,
        status: 'untracked' as const,
      })),
    ]
    const filteredFiles = q
      ? allFiles.filter((file) => file.filePath.toLowerCase().includes(q))
      : allFiles

    // 用完整 gitRoot 做 key，避免同名目录冲突。
    const groups = new Map<string, GitFileEntry[]>()
    for (const file of filteredFiles) {
      const key = file.gitRoot || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(file)
    }
    const result: FileGroup[] = [...groups.entries()].map(([gitRoot, groupFiles]) => ({
      gitRoot,
      dirName: gitRoot ? gitRoot.split('/').pop() || gitRoot : '/',
      sources: collectDiffChangeSources(groupFiles),
      fileCount: groupFiles.length,
      totalAdditions: groupFiles.reduce((sum, file) => sum + file.additions, 0),
      totalDeletions: groupFiles.reduce((sum, file) => sum + file.deletions, 0),
      tree: buildDiffFileTree(groupFiles),
    }))
    return { fileGroups: result, matchedFilesCount: filteredFiles.length }
  }, [files, untrackedFiles, searchQuery])

  const isEmpty = fileGroups.length === 0
  const hasAnyChanges = files.length > 0 || untrackedFiles.length > 0
  const hasGitChanges = isGitRepo && hasAnyChanges
  const hasNonGitFileChanges = nonGitFileChanges.length > 0
  const hasAnyVisibleChanges = hasGitChanges || hasNonGitFileChanges
  const shouldShowSearch = isGitRepo && (hasAnyChanges || searchQuery.length > 0)
  const shouldShowWorktreeSelector = isGitRepo && Boolean(workspaceSlug || (worktreeRepoPaths?.length ?? 0) > 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Worktree 分支选择器仅作用于 Git 改动。 */}
      {shouldShowWorktreeSelector && (
        <WorktreeSelector
          sessionId={sessionId}
          workspaceSlug={workspaceSlug}
          repoPaths={worktreeRepoPaths}
          selectedPath={selectedWorktreePath}
          onSelect={handleWorktreeSelect}
          onOpenTerminal={onOpenWorktreeTerminal}
        />
      )}

      {/* 搜索框 — 有改动文件时才显示 */}
      {shouldShowSearch && (
        <div className="flex-shrink-0 sticky top-0 z-10 bg-content-area px-2 pt-1.5 pb-1">
          <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-muted/50 border border-transparent focus-within:border-primary/40 focus-within:bg-muted/70 transition-colors">
            <Search className="size-3 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              aria-label="搜索改动文件"
              className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40"
              placeholder="搜索改动文件..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <>
                <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 tabular-nums">
                  {matchedFilesCount}
                </span>
                <button
                  type="button"
                  aria-label="清除搜索"
                  className="flex-shrink-0 p-0.5 rounded-sm hover:bg-foreground/[0.08] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="size-3" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {hasNonGitFileChanges && (
        <NonGitChangesList
          changes={nonGitFileChanges}
          currentRunId={currentFileChangeRunId}
          sessionId={sessionId}
          onFileClick={onPlainFileClick}
        />
      )}

      {!hasAnyVisibleChanges && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
          <p className="text-[12px] text-center">
            {isGitRepo ? (hasFetched ? '没有文件改动' : '加载中…') : '当前目录不是 Git 仓库，或暂无文件改动'}
          </p>
        </div>
      )}
      {hasGitChanges && isEmpty && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
          <p className="text-[12px] text-center">没有匹配的代码改动</p>
        </div>
      )}
      {hasGitChanges && !isEmpty && (
        <>
          {fileGroups.map((group) => {
            return (
              <div key={group.gitRoot} className="py-1">
                <div className="group flex items-center gap-1.5 px-3 py-1.5 text-[14px] font-medium text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{group.dirName}</span>
                  {group.sources.map((source) => {
                    const config = DIFF_CHANGE_SOURCE_CONFIG[source]
                    return (
                      <span key={source} className={cn('shrink-0 rounded px-1 py-0.5 text-[11px] leading-none', config.color)}>
                        {config.label}
                      </span>
                    )
                  })}
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-normal tabular-nums">
                    <span className="text-muted-foreground/60">{group.fileCount} 个文件</span>
                    {group.totalAdditions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{group.totalAdditions}</span>}
                    {group.totalDeletions > 0 && <span className="text-red-600 dark:text-red-400">-{group.totalDeletions}</span>}
                  </span>
                  {onOpenDirectoryTerminal && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`在 ${group.dirName} 打开终端`}
                          title={`在 ${group.dirName} 打开终端`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] hover:bg-accent/70 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.96]"
                          onClick={() => onOpenDirectoryTerminal(group.gitRoot, group.dirName)}
                        >
                          <SquareTerminal className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">在右侧标签中打开终端</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {group.tree.map((node) => (
                  <GitFileTreeNode
                    key={`${group.gitRoot}:${node.path}`}
                    node={node}
                    depth={0}
                    gitRoot={group.gitRoot}
                    dirPath={dirPath}
                    selectedFilePath={selectedFilePath}
                    unseenFiles={unseenFiles}
                    collapsedDirs={collapsedDirs}
                    forceExpanded={searchQuery.trim().length > 0}
                    onToggle={toggleDir}
                    onFileClick={(file, absPath) => {
                      markFileAsSeen(absPath)
                      onFileClick(file.filePath, file.status === 'untracked', file.gitRoot)
                    }}
                    onRevert={(file) => handleRevert(file.filePath, file.gitRoot)}
                    onOpenDirectoryTerminal={onOpenDirectoryTerminal}
                  />
                ))}
              </div>
            )
          })}
        </>
      )}
      </div>
    </div>
  )
})

function GitFileTreeNode({
  node,
  depth,
  gitRoot,
  dirPath,
  selectedFilePath,
  unseenFiles,
  collapsedDirs,
  forceExpanded,
  onToggle,
  onFileClick,
  onRevert,
  onOpenDirectoryTerminal,
}: {
  node: DiffFileTreeNode<GitFileEntry>
  depth: number
  gitRoot: string
  dirPath: string
  selectedFilePath?: string
  unseenFiles: Set<string>
  collapsedDirs: Set<string>
  forceExpanded: boolean
  onToggle: (path: string) => void
  onFileClick: (file: GitFileEntry, absPath: string) => void
  onRevert: (file: GitFileEntry) => void
  onOpenDirectoryTerminal?: (directoryPath: string, directoryName: string) => void
}): React.ReactElement {
  if (node.kind === 'file') {
    const file = node.entry
    const absPath = `${file.gitRoot || dirPath}/${file.filePath}`.replace(/\/+/g, '/')
    return (
      <FileRow
        file={file}
        depth={depth}
        isSelected={absPath === selectedFilePath || file.filePath === selectedFilePath}
        isUnseen={unseenFiles.has(absPath)}
        onClick={() => onFileClick(file, absPath)}
        onRevert={file.status === 'untracked' ? undefined : () => onRevert(file)}
        dirPath={dirPath}
      />
    )
  }

  const stateKey = `${gitRoot}:${node.path}`
  const isCollapsed = !forceExpanded && collapsedDirs.has(stateKey)
  const directoryPath = `${gitRoot}/${node.path}`.replace(/\/+/g, '/')
  const rowPaddingLeft = 8 + depth * 16
  const guideLeft = 23 + depth * 16

  return (
    <div className="relative">
      <div className="group mx-2 flex h-8 items-center gap-1.5 rounded-md pr-2 text-[13px] font-medium text-foreground/75 transition-colors hover:bg-accent/50">
      <button
        type="button"
        aria-expanded={!isCollapsed}
        title={node.name}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        style={{ paddingLeft: rowPaddingLeft }}
        onClick={() => onToggle(stateKey)}
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150', !isCollapsed && 'rotate-90')}
        />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {onOpenDirectoryTerminal && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`在 ${node.name} 打开终端`}
              title={`在 ${node.name} 打开终端`}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-[background-color,color,opacity,transform] hover:bg-accent/70 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.96]"
              onClick={() => onOpenDirectoryTerminal(directoryPath, node.name)}
            >
              <SquareTerminal className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">在右侧标签中打开终端</TooltipContent>
        </Tooltip>
      )}
      </div>
      {!isCollapsed && (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 top-0 w-px bg-border/70"
            style={{ left: guideLeft }}
          />
          {node.children.map((child) => (
            <GitFileTreeNode
              key={`${gitRoot}:${child.path}`}
              node={child}
              depth={depth + 1}
              gitRoot={gitRoot}
              dirPath={dirPath}
              selectedFilePath={selectedFilePath}
              unseenFiles={unseenFiles}
              collapsedDirs={collapsedDirs}
              forceExpanded={forceExpanded}
              onToggle={onToggle}
              onFileClick={onFileClick}
              onRevert={onRevert}
              onOpenDirectoryTerminal={onOpenDirectoryTerminal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NonGitChangesList({
  changes,
  currentRunId,
  sessionId,
  onFileClick,
}: {
  changes: SessionFileChange[]
  currentRunId?: string
  sessionId: string
  onFileClick?: (filePath: string) => void
}): React.ReactElement {
  const { current, earlier } = React.useMemo(
    () => groupSessionFileChanges(changes, currentRunId),
    [changes, currentRunId],
  )
  const setNonGitFileChanges = useSetAtom(agentNonGitFileChangesAtom)
  /** 已校验过存在性的路径；组件存活期内同一路径不重复发起 IPC。 */
  const existenceCheckedRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    // 文件变更记录是 append-only 的内存流水账：会话未运行期间被删除的文件
    // watcher 清理不到，展示前对「更早」分组批量校验存在性并剔除。
    const pending = earlier.filter((change) => !existenceCheckedRef.current.has(change.path))
    if (pending.length === 0) return
    for (const change of pending) existenceCheckedRef.current.add(change.path)
    let cancelled = false
    void window.electronAPI
      .filterExistingFilePaths(pending.map((change) => change.path), { sessionId, unrestricted: true })
      .then((existingPaths) => {
        if (cancelled) return
        const isWindows = detectIsWindows()
        const missing = pending.filter(
          (change) => !existingPaths.some((existingPath) => arePathsEqual(existingPath, change.path, isWindows)),
        )
        if (missing.length === 0) return
        setNonGitFileChanges((prev) => {
          const currentChanges = prev.get(sessionId)
          if (!currentChanges) return prev
          const next = currentChanges.filter(
            (change) => !missing.some((m) => arePathsEqual(m.path, change.path, isWindows)),
          )
          if (next.length === currentChanges.length) return prev
          const map = new Map(prev)
          map.set(sessionId, next)
          return map
        })
      })
      .catch(() => {
        // 校验失败不清记录，允许下次渲染重试。
        for (const change of pending) existenceCheckedRef.current.delete(change.path)
      })
    return () => {
      cancelled = true
    }
  }, [earlier, sessionId, setNonGitFileChanges])
  const hasEarlierChanges = earlier.length > 0
  const title = hasEarlierChanges
    ? `本会话文件变更 · ${changes.length}`
    : `本会话文件变更 · 本轮 · ${current.length}`

  return (
    <div className="shrink-0 py-1">
      <div className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-muted-foreground tabular-nums">
        <Box className="size-3.5 shrink-0" />
        <span>{title}</span>
      </div>
      {hasEarlierChanges ? (
        <>
          {current.length > 0 && <NonGitRunGroup title="本轮" changes={current} sessionId={sessionId} onFileClick={onFileClick} />}
          <NonGitRunGroup title="更早" changes={earlier} sessionId={sessionId} onFileClick={onFileClick} />
        </>
      ) : (
        <NonGitFileList changes={current} sessionId={sessionId} onFileClick={onFileClick} />
      )}
    </div>
  )
}

function NonGitRunGroup({
  title,
  changes,
  sessionId,
  onFileClick,
}: {
  title: string
  changes: SessionFileChange[]
  sessionId: string
  onFileClick?: (filePath: string) => void
}): React.ReactElement {
  return (
    <section className="pb-2">
      <div className="px-3 py-1 text-[11px] font-medium text-muted-foreground tabular-nums">{title} · {changes.length}</div>
      <NonGitFileList changes={changes} sessionId={sessionId} onFileClick={onFileClick} />
    </section>
  )
}

function NonGitFileList({
  changes,
  sessionId,
  onFileClick,
}: {
  changes: SessionFileChange[]
  sessionId: string
  onFileClick?: (filePath: string) => void
}): React.ReactElement {
  return (
    <div>
      {changes.map((change) => {
        const parts = change.path.split(/[\\/]/)
        const name = parts.pop() || change.path
        const parent = getCompactFilePath(parts.filter(Boolean).join('/'))
        return (
          <div key={change.path} className="group flex h-9 items-center hover:bg-primary/5 transition-colors">
            <Tooltip delayDuration={700}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onFileClick?.(change.path)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm"
                >
                  <FileTypeIcon name={name} isDirectory={false} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
                  {parent && <span className="max-w-[40%] truncate text-[11px] text-muted-foreground">{parent}</span>}
                  {change.kind === 'created' && <GitStatusMarker status="untracked" className="ml-2" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[400px] break-all">{change.path}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="在文件夹中显示"
                  onClick={() => {
                    void window.electronAPI.showInFolder(change.path, { sessionId, unrestricted: true }).catch((error) => {
                      console.error('[DiffChangesList] 在文件夹中显示失败:', error)
                      toast.error('无法在文件夹中显示该文件')
                    })
                  }}
                  className="mr-1 flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
                >
                  <FolderSearch className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">在文件夹中显示</TooltipContent>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

function getCompactFilePath(path: string): string {
  return path.replace(/^\/Users\/[^/]+\//, '~/')
}

/** Git 文件行：已追踪和未追踪文件共用同一布局。 */
function FileRow({
  file,
  depth,
  onClick,
  onRevert,
  isSelected,
  isUnseen,
  dirPath,
}: {
  file: GitFileEntry
  depth: number
  onClick: () => void
  onRevert?: () => void
  isSelected?: boolean
  isUnseen?: boolean
  dirPath: string
}): React.ReactElement {
  const fileName = file.filePath.split('/').pop()!
  const fullPath = `${file.gitRoot || dirPath}/${file.filePath}`.replace(/\/+/g, '/')
  const hasLineChanges = file.additions > 0 || file.deletions > 0

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group/file relative mx-2 flex h-8 items-center rounded-md pr-2 text-[12px] transition-colors',
        isSelected
          ? 'session-item-selected bg-primary/10 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
          : 'hover:bg-primary/5',
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick()
      }}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <FileTypeIcon name={fileName} isDirectory={false} size={16} />
        {isUnseen && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
          />
        )}
      </span>
      <Tooltip delayDuration={900}>
        <TooltipTrigger asChild>
          <span className="ml-1.5 min-w-0 truncate">{fileName}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[400px] break-all">{fullPath}</TooltipContent>
      </Tooltip>

      {hasLineChanges && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums transition-opacity group-hover/file:opacity-0">
          {file.additions > 0 && (
            <span style={{ color: 'rgb(34 197 94)' }}>+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span style={{ color: 'rgb(239 68 68)' }}>-{file.deletions}</span>
          )}
        </span>
      )}

      {onRevert && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="还原文件变更"
              className="absolute right-7 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center text-foreground/35 opacity-0 transition-opacity hover:text-foreground/80 focus-visible:text-foreground/80 focus-visible:opacity-100 focus-visible:outline-none group-hover/file:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onRevert()
              }}
            >
              <Undo2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">还原文件变更</TooltipContent>
        </Tooltip>
      )}

      <GitStatusMarker status={file.status} className={hasLineChanges ? 'ml-2' : 'ml-auto'} />
    </div>
  )
}

function GitStatusMarker({
  status,
  className,
}: {
  status: ChangedFileStatus
  className?: string
}): React.ReactElement {
  const config: Record<ChangedFileStatus, { label: string; description: string; color: string }> = {
    modified: { label: 'M', description: '已修改', color: 'text-amber-500' },
    deleted: { label: 'D', description: '已删除', color: 'text-red-500' },
    untracked: { label: 'U', description: '未追踪', color: 'text-emerald-500' },
  }
  const { label, description, color } = config[status]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('w-4 shrink-0 text-right text-[11px] font-medium tabular-nums', className, color)}>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{description}</TooltipContent>
    </Tooltip>
  )
}
