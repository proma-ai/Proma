import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from 'lucide-react'
import type { WorkspaceMemoryFileChange } from '@proma/shared'
import { Button } from '@/components/ui/button'

interface MemoryFileListItem {
  relativePath: string
  modifiedAt?: number
}

interface WorkspaceMemoryChangeShelfProps {
  changes: WorkspaceMemoryFileChange[]
  memoryFiles: MemoryFileListItem[]
  onOpen: (change?: WorkspaceMemoryFileChange) => void
  onOpenFile: (relativePath: string) => void
  className?: string
}

function formatKind(kind: WorkspaceMemoryFileChange['kind']): string {
  if (kind === 'created') return '新增'
  if (kind === 'deleted') return '删除'
  return '更新'
}

function formatUpdatedAt(updatedAt?: number): string {
  if (!updatedAt) return '最近更新未知'
  return new Date(updatedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Persistent file-panel status. Its body portal is deliberately outside SidePanel
 * so hover content cannot be clipped or obscured by panel layout layers.
 */
export function WorkspaceMemoryChangeShelf({ changes, memoryFiles, onOpen, onOpenFile, className }: WorkspaceMemoryChangeShelfProps): React.ReactElement {
  const [index, setIndex] = React.useState(0)
  const [hovered, setHovered] = React.useState(false)
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const change = changes[index]
  const hasDiff = Boolean(change?.diffAvailable && change.diff && (change.diff.added.length > 0 || change.diff.removed.length > 0))

  React.useEffect(() => setIndex(0), [changes[0]?.changedAt])
  React.useEffect(() => setIndex((current) => current >= changes.length ? 0 : current), [changes.length])
  React.useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const measureAnchor = React.useCallback(() => {
    if (anchorRef.current) setAnchorRect(anchorRef.current.getBoundingClientRect())
  }, [])
  const keepOpen = React.useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    measureAnchor()
    setHovered(true)
  }, [measureAnchor])
  const scheduleClose = React.useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setHovered(false), 120)
  }, [])

  React.useEffect(() => {
    if (!hovered) return
    window.addEventListener('resize', measureAnchor)
    window.addEventListener('scroll', measureAnchor, true)
    return () => {
      window.removeEventListener('resize', measureAnchor)
      window.removeEventListener('scroll', measureAnchor, true)
    }
  }, [hovered, measureAnchor])

  const detail = hovered && anchorRect && typeof document !== 'undefined'
    ? createPortal(
        <div
          role="dialog"
          aria-label={change ? '记忆更新详情' : '工作区记忆文件'}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
          className="fixed z-[1000] w-[min(440px,calc(100vw-32px))] rounded-xl border border-border/80 bg-popover p-3 shadow-2xl"
          style={{
            left: Math.max(16, Math.min(window.innerWidth - 456, anchorRect.right - 440)),
            bottom: Math.max(16, window.innerHeight - anchorRect.top + 8),
          }}
        >
          {change ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground">记忆更新</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{change.relativePath}</div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatKind(change.kind)} · {index + 1}/{changes.length}</span>
              </div>
              {changes.length > 1 && (
                <div className="mb-2 flex justify-end gap-1">
                  <button type="button" aria-label="上一条记忆更新" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setIndex((value) => (value - 1 + changes.length) % changes.length)}><ChevronLeft size={14} /></button>
                  <button type="button" aria-label="下一条记忆更新" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setIndex((value) => (value + 1) % changes.length)}><ChevronRight size={14} /></button>
                </div>
              )}
              {hasDiff ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-2 font-mono text-[11px] leading-5">
                  {change.diff?.context.map((line, lineIndex) => <div key={`context-${lineIndex}`} className="text-muted-foreground">  {line || ' '}</div>)}
                  {change.diff?.removed.map((line, lineIndex) => <div key={`removed-${lineIndex}`} className="bg-red-500/10 px-1 text-red-700 dark:text-red-300">- {line || ' '}</div>)}
                  {change.diff?.added.map((line, lineIndex) => <div key={`added-${lineIndex}`} className="bg-emerald-500/10 px-1 text-emerald-700 dark:text-emerald-300">+ {line || ' '}</div>)}
                  {change.diff?.truncated && <div className="mt-1 text-muted-foreground">… 其余变更请打开文件查看</div>}
                </pre>
              ) : (
                <p className="rounded-lg bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">该文件已变化，但无法生成受限文本 diff。</p>
              )}
              {change.kind !== 'deleted' && <div className="mt-3 flex justify-end"><Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onOpen(change)}>编辑文件 <ExternalLink size={12} className="ml-1" /></Button></div>}
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-foreground">项目记忆</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{memoryFiles.length} 个文件 · 点击即可编辑</div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onOpen()}>打开编辑器 <ExternalLink size={12} className="ml-1" /></Button>
              </div>
              {memoryFiles.length > 0 ? (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border/60 p-1">
                  {memoryFiles.map((file) => (
                    <button key={file.relativePath} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent" onClick={() => onOpenFile(file.relativePath)}>
                      <FileText size={13} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{file.relativePath}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatUpdatedAt(file.modifiedAt)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">还没有记忆文件。打开编辑器后可创建 `MEMORY.md`。</p>
              )}
            </>
          )}
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <div
        ref={anchorRef}
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        className={className ?? 'shrink-0 border-t border-border/70'}
      >
        <button
          type="button"
          onClick={() => onOpen(change)}
          className="flex h-10 w-full items-center gap-2 px-3 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <span className="font-medium">{change ? '项目记忆已更新' : '项目记忆'}</span>
          {changes.length > 1 && <span className="text-[11px] tabular-nums text-muted-foreground">{changes.length}</span>}
          {change && <span className="ml-auto text-[11px] text-muted-foreground">悬浮查看变更</span>}
        </button>
      </div>
      {detail}
    </>
  )
}
