/**
 * FileSearchBar — 文件搜索栏
 *
 * 位于侧面板工作区文件和会话文件之间，输入关键词搜索所有文件。
 * 分别搜索会话目录和工作区文件目录，确保两边都使用相对路径。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FileTypeIcon } from './FileTypeIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fileBrowserAutoRevealAtom } from '@/atoms/agent-atoms'
import type { FileIndexEntry } from '@proma/shared'

interface FileSearchBarProps {
  workspaceFilesPath: string | null
  sessionPath: string | null
  sessionAttachedDirs: string[]
  workspaceAttachedDirs: string[]
  placeholder?: string
  /** 当前 session ID，用于文件自动定位 */
  sessionId?: string
  onFilePreview?: (filePath: string) => void
}

export function FileSearchBar({
  workspaceFilesPath,
  sessionPath,
  sessionAttachedDirs,
  workspaceAttachedDirs,
  placeholder = '搜索文件...',
  sessionId,
  onFilePreview,
}: FileSearchBarProps): React.ReactElement | null {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<FileIndexEntry[]>([])
  const [isOpen, setIsOpen] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [searching, setSearching] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>()
  const abortRef = React.useRef<AbortController>()
  /** 用户手动关闭下拉后置为 true，阻止 focus/渲染等副作用重新弹出 */
  const dismissedRef = React.useRef(false)
  /** 上次的 query，用来区分 effect rerun 是"用户输入"还是"父组件 prop 引用变化" */
  const prevQueryRef = React.useRef('')
  /** 用户输入了新 query 但下拉还没打开过 — 跨 rerun 持久化"待显示"意图 */
  const pendingShowRef = React.useRef(false)

  const setAutoReveal = useSetAtom(fileBrowserAutoRevealAtom)

  const hasAnyRoot = !!workspaceFilesPath || !!sessionPath

  /** 将搜索结果的相对路径转为绝对路径，供 FileBrowser 自动定位使用 */
  const resolveAbsolutePath = React.useCallback((entry: FileIndexEntry): string => {
    if (entry.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry.path)) return entry.path
    const base = entry.source === 'workspace' ? workspaceFilesPath : sessionPath
    if (!base) return entry.path
    const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
    return `${base.replace(/[\\/]+$/, '')}${sep}${entry.path}`
  }, [workspaceFilesPath, sessionPath])

  // 防抖搜索 — 分别搜索两个目录
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    const trimmed = query.trim()
    // 判断这次 effect 是不是"用户输入"导致的（query 变了）
    // 否则是父组件 re-render 让 attachedDirs/wsAttachedDirs 等 prop 引用变化引发的 rerun，
    // 这种情况下不应该改变下拉的开/关状态。
    const queryChanged = prevQueryRef.current !== query
    prevQueryRef.current = query

    if (!trimmed || !hasAnyRoot) {
      setResults([])
      setIsOpen(false)
      pendingShowRef.current = false
      return
    }

    // 只有用户输入新内容时才清掉"已关闭"守卫并标记"待显示"
    if (queryChanged) {
      dismissedRef.current = false
      pendingShowRef.current = true
    }

    const ac = new AbortController()
    abortRef.current = ac

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const allResults: FileIndexEntry[] = []

        // 分别搜索工作区文件和会话文件，确保两边都用相对路径
        const searches: Promise<FileIndexEntry[]>[] = []

        if (workspaceFilesPath) {
          searches.push(
            window.electronAPI.searchWorkspaceFiles(
              workspaceFilesPath,
              trimmed,
              30,
              workspaceAttachedDirs.length > 0 ? workspaceAttachedDirs : undefined,
            ).then((r) => r.entries.map((e) => ({ ...e, source: 'workspace' as const })))
            .catch(() => [] as FileIndexEntry[]),
          )
        }

        if (sessionPath) {
          searches.push(
            window.electronAPI.searchWorkspaceFiles(
              sessionPath,
              trimmed,
              30,
              sessionAttachedDirs.length > 0 ? sessionAttachedDirs : undefined,
            ).then((r) => r.entries.map((e) => ({ ...e, source: 'session' as const })))
            .catch(() => [] as FileIndexEntry[]),
          )
        }

        const results_ = await Promise.all(searches)
        for (const r of results_) allResults.push(...r)

        if (ac.signal.aborted) return

        setResults(allResults)
        setSelectedIndex(0)
        // 只在"用户输入触发的待显示"且未被主动关闭时才打开下拉；
        // 父组件重渲染引发的 rerun 只静默更新 results，不动 isOpen。
        if (pendingShowRef.current && !dismissedRef.current) {
          setIsOpen(allResults.length > 0)
          pendingShowRef.current = false
        } else if (allResults.length === 0) {
          setIsOpen(false)
        }
      } catch (err) {
        console.error('[FileSearchBar] 搜索失败:', err)
        if (!ac.signal.aborted) {
          setResults([])
          setIsOpen(false)
        }
      } finally {
        if (!ac.signal.aborted) setSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [query, workspaceFilesPath, sessionPath, sessionAttachedDirs, workspaceAttachedDirs, hasAnyRoot])

  // 点击外部关闭
  React.useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    // 忽略 IME 组合输入期间的按键（如中文输入法敲回车确认候选词）
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      dismissedRef.current = true
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0))
      return
    }
    if (e.key === 'Enter' && isOpen && results.length > 0) {
      e.preventDefault()
      const entry = results[selectedIndex]
      if (entry) {
        const absPath = resolveAbsolutePath(entry)
        if (sessionId) setAutoReveal({ sessionId, path: absPath, ts: Date.now(), select: true })
        // 文件才打开预览；文件夹仅在文件树中定位+选中
        if (entry.type === 'file') onFilePreview?.(absPath)
        setIsOpen(false)
        dismissedRef.current = true
        inputRef.current?.blur()
      }
    }
  }, [results, selectedIndex, isOpen, onFilePreview, sessionId, setAutoReveal, resolveAbsolutePath])

  const handleClick = React.useCallback((entry: FileIndexEntry) => {
    const absPath = resolveAbsolutePath(entry)
    if (sessionId) setAutoReveal({ sessionId, path: absPath, ts: Date.now(), select: true })
    // 文件才打开预览；文件夹仅在文件树中定位+选中
    if (entry.type === 'file') onFilePreview?.(absPath)
    setIsOpen(false)
    dismissedRef.current = true
    inputRef.current?.blur()
  }, [onFilePreview, sessionId, setAutoReveal, resolveAbsolutePath])

  const sessionResults = React.useMemo(() => results.filter((e) => e.source === 'session'), [results])
  const workspaceResults = React.useMemo(() => results.filter((e) => e.source === 'workspace'), [results])

  if (!hasAnyRoot) return null

  return (
    <div ref={containerRef} className="relative mx-2 flex-shrink-0">
      {/* 搜索输入框 */}
      <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-muted/40 border border-transparent focus-within:border-primary/40 focus-within:bg-muted/70 transition-colors">
        {searching ? (
          <Loader2 className="size-3 text-muted-foreground flex-shrink-0 animate-spin" />
        ) : (
          <Search className="size-3 text-muted-foreground flex-shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClick={() => {
            dismissedRef.current = false
            if (results.length > 0 && !isOpen) setIsOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* 结果浮层（绝对定位，不影响布局） */}
      {isOpen && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border bg-popover shadow-lg overflow-hidden">
          <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
            {/* 会话文件分组 */}
            {sessionResults.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium text-muted-foreground bg-muted/30">
                  <span>会话文件</span>
                  <span className="text-muted-foreground/40">{sessionResults.length}</span>
                </div>
                {sessionResults.map((entry) => {
                  const globalIdx = results.indexOf(entry)
                  return (
                    <ResultItem
                      key={entry.path}
                      entry={entry}
                      isSelected={globalIdx === selectedIndex}
                      onClick={handleClick}
                      onHover={() => setSelectedIndex(globalIdx)}
                    />
                  )
                })}
              </>
            )}

            {/* 工作区文件分组 */}
            {workspaceResults.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium text-muted-foreground bg-muted/30">
                  <span>工作区文件</span>
                  <span className="text-muted-foreground/40">{workspaceResults.length}</span>
                </div>
                {workspaceResults.map((entry) => {
                  const globalIdx = results.indexOf(entry)
                  return (
                    <ResultItem
                      key={entry.path}
                      entry={entry}
                      isSelected={globalIdx === selectedIndex}
                      onClick={handleClick}
                      onHover={() => setSelectedIndex(globalIdx)}
                    />
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 单条搜索结果 */
function ResultItem({
  entry,
  isSelected,
  onClick,
  onHover,
}: {
  entry: FileIndexEntry
  isSelected: boolean
  onClick: (entry: FileIndexEntry) => void
  onHover: () => void
}): React.ReactElement {
  // 从完整路径中提取父目录（去掉文件名），避免路径里重复显示文件名。
  // 兼容 POSIX (`/`) 与 Windows (`\`) 分隔符。
  const dirPath = React.useMemo(() => {
    if (entry.path === entry.name) return ''
    const sepLen = entry.name.length + 1
    const tail = entry.path.slice(-sepLen)
    if (tail === `/${entry.name}` || tail === `\\${entry.name}`) {
      return entry.path.slice(0, -sepLen)
    }
    return entry.path
  }, [entry.path, entry.name])

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
            isSelected ? 'bg-accent' : 'hover:bg-accent/40',
          )}
          onClick={() => onClick(entry)}
          onMouseEnter={onHover}
        >
          <FileTypeIcon name={entry.name} isDirectory={entry.type === 'dir'} size={12} />
          <span className="text-[11px] font-medium truncate max-w-[90px]">
            {entry.name}
          </span>
          {dirPath && (
            <span
              className="text-[10px] text-muted-foreground/55 truncate flex-1 min-w-0"
            >
              {dirPath}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="z-[10000] max-w-xs break-all">
        <p>{entry.path}</p>
      </TooltipContent>
    </Tooltip>
  )
}
