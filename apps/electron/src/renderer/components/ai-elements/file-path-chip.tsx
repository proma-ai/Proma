/**
 * FilePathChip — 文件路径可点击芯片
 *
 * 在 Agent 消息中检测到文件路径时，渲染为可点击的芯片。
 * 支持绝对路径和相对路径（相对于 basePath 解析）。
 * 点击后按用户偏好（标签页 / 侧边分屏）打开文件预览。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { FileTypeIcon } from '@/components/file-browser/FileTypeIcon'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  getFileName,
  getFilePathDisplayPath,
  isAbsoluteFilePath,
  isAsyncResultCurrent,
  isImageFilePath,
  isRelativeFilePath,
  stripLineCol,
} from './file-path-chip-utils'

interface FileResolutionCacheEntry {
  exists: boolean
  resolvedPath?: string
}

/** 文件存在性缓存（模块级共享，避免重复 IPC）。key = filePath + basePaths */
const fileExistsCache = new Map<string, FileResolutionCacheEntry>()
function existsCacheKey(filePath: string, bases: string[]): string {
  return `${filePath}\0${bases.join('\0')}`
}

interface FilePathChipProps {
  /** 文件路径（绝对或相对，可能带行号后缀） */
  filePath: string
  /** 基础目录路径（向后兼容，单值） */
  basePath?: string
  /** 多个候选基础目录（如主 cwd + 附加目录），点击时由主进程依次解析 */
  basePaths?: string[]
  className?: string
}

/** 文件路径芯片 — 可点击，触发文件预览 */
export function FilePathChip({ filePath, basePath, basePaths, className }: FilePathChipProps): React.ReactElement {
  const trimmedPath = filePath.trim()
  const { path: cleanPath, suffix: lineColSuffix } = stripLineCol(trimmedPath)
  const filename = getFileName(cleanPath)

  const chipRef = React.useRef<HTMLButtonElement>(null)
  const requestGenerationRef = React.useRef(0)
  const resolutionRequestRef = React.useRef<{ key: string; promise: Promise<void> } | null>(null)
  const mountedRef = React.useRef(true)
  const [fileStatus, setFileStatus] = React.useState<'idle' | 'resolved' | 'broken'>('idle')
  const [resolvedPath, setResolvedPath] = React.useState<string | undefined>()
  const store = useStore()
  const openPreview = useOpenPreview()

  const candidateBases = React.useMemo<string[]>(() => {
    if (basePaths && basePaths.length > 0) return basePaths.filter(Boolean)
    if (basePath) return [basePath]
    return []
  }, [basePath, basePaths])

  const displayPath = React.useMemo(() => getFilePathDisplayPath({
    originalPath: trimmedPath,
    resolvedPath,
    lineColSuffix: resolvedPath ? lineColSuffix : '',
  }), [trimmedPath, resolvedPath, lineColSuffix])

  const resolveCurrentPath = React.useCallback((): Promise<void> => {
    const key = existsCacheKey(cleanPath, candidateBases)
    const inFlight = resolutionRequestRef.current
    if (inFlight?.key === key) return inFlight.promise

    const generation = ++requestGenerationRef.current
    const bases = candidateBases.length > 0 ? candidateBases : undefined
    const sessionId = store.get(currentAgentSessionIdAtom)
    let promise: Promise<void>
    promise = window.electronAPI.resolveFilePath(cleanPath, {
      sessionId: sessionId ?? undefined,
      candidateBasePaths: bases,
    })
      .then((resolved) => {
        if (!isAsyncResultCurrent(generation, requestGenerationRef.current, mountedRef.current)) return
        const entry: FileResolutionCacheEntry = {
          exists: resolved !== null,
          ...(resolved?.resolvedPath ? { resolvedPath: resolved.resolvedPath } : {}),
        }
        fileExistsCache.set(key, entry)
        setFileStatus(entry.exists ? 'resolved' : 'broken')
        setResolvedPath(entry.resolvedPath)
      })
      .catch(() => { /* IPC 失败时保留当前状态 */ })
      .finally(() => {
        if (resolutionRequestRef.current?.promise === promise) {
          resolutionRequestRef.current = null
        }
      })
    resolutionRequestRef.current = { key, promise }
    return promise
  }, [cleanPath, candidateBases, store])

  // IntersectionObserver 首次懒检查可使用缓存；Tooltip 打开时会绕过缓存重新解析。
  React.useEffect(() => {
    const el = chipRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    requestGenerationRef.current += 1
    mountedRef.current = true
    setFileStatus('idle')
    setResolvedPath(undefined)
    const key = existsCacheKey(cleanPath, candidateBases)
    const cached = fileExistsCache.get(key)
    if (cached) {
      setFileStatus(cached.exists ? 'resolved' : 'broken')
      setResolvedPath(cached.resolvedPath)
      return () => {
        mountedRef.current = false
        requestGenerationRef.current += 1
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        void resolveCurrentPath()
      },
      { threshold: 0 },
    )
    observer.observe(el)
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
      observer.disconnect()
    }
  }, [cleanPath, candidateBases, resolveCurrentPath])

  const handleTooltipOpenChange = React.useCallback((open: boolean) => {
    if (open) void resolveCurrentPath()
  }, [resolveCurrentPath])

  const handleClick = React.useCallback(() => {
    const sessionId = store.get(currentAgentSessionIdAtom)
    if (!sessionId) return

    openPreview(sessionId, {
      filePath: cleanPath,
      previewOnly: true,
      basePaths: candidateBases.length > 0 ? candidateBases : undefined,
    })
  }, [store, openPreview, cleanPath, candidateBases])

  const handleShowInFolder = React.useCallback(() => {
    const bases = candidateBases.length > 0 ? candidateBases : undefined
    window.electronAPI.showItemInFolder(cleanPath, bases)
      .then((ok) => { if (!ok) toast.error(`未找到文件：${filename}`) })
      .catch(() => toast.error(`未找到文件：${filename}`))
  }, [cleanPath, candidateBases, filename])

  return (
    <ContextMenu>
      <Tooltip onOpenChange={handleTooltipOpenChange}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              ref={chipRef}
              type="button"
              onClick={handleClick}
              className={cn(
                'inline-flex items-center gap-[0.25em] rounded px-[0.35em] py-[0.15em] text-[0.875em] font-medium leading-none',
                'cursor-pointer transition-colors duration-150',
                'align-baseline not-prose',
                fileStatus === 'broken'
                  ? 'opacity-50 border border-dashed border-muted-foreground/30 text-muted-foreground hover:opacity-70 hover:bg-muted/20'
                  : 'bg-primary/10 text-primary hover:bg-primary/20',
                className,
              )}
            >
              <FileTypeIcon name={filename} isDirectory={false} size={12} />
              <span className="truncate max-w-[240px] leading-none">{filename}{lineColSuffix}</span>
            </button>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" className="max-w-[400px] break-all font-mono text-[11px]">
          {fileStatus === 'broken' ? `文件不存在: ${displayPath}` : displayPath}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-48 z-[9999]">
        <ContextMenuItem onClick={handleClick}>
          打开预览
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleShowInFolder}>
          在文件管理器中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { isAbsoluteFilePath, isImageFilePath, isRelativeFilePath }
