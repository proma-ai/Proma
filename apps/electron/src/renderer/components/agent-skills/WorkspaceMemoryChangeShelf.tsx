import * as React from 'react'
import type { WorkspaceMemoryFileChange } from '@proma/shared'
import { Button } from '@/components/ui/button'

interface WorkspaceMemoryChangeShelfProps {
  changes: WorkspaceMemoryFileChange[]
  /** 用户主动从局部 Diff 打开某一个对应的原始记忆文件。 */
  onOpenFile?: (change: WorkspaceMemoryFileChange) => void
  onBackToMemory?: () => void
  className?: string
}

function formatKind(kind: WorkspaceMemoryFileChange['kind']): string {
  if (kind === 'created') return '新增'
  if (kind === 'deleted') return '删除'
  return '更新'
}

function MemoryChangeDiff({
  change,
  onOpenFile,
}: {
  change: WorkspaceMemoryFileChange
  onOpenFile?: (change: WorkspaceMemoryFileChange) => void
}): React.ReactElement {
  const hasDiff = Boolean(change.diffAvailable && change.diff && (change.diff.added.length > 0 || change.diff.removed.length > 0))

  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-background/40">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={change.relativePath}>{change.relativePath}</p>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatKind(change.kind)}</span>
          {onOpenFile && change.kind !== 'deleted' && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onOpenFile(change)}>查看原文件</Button>
          )}
        </div>
      </div>
      {hasDiff ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5">
          {change.diff?.context.map((line, lineIndex) => <div key={`context-${lineIndex}`} className="text-muted-foreground">  {line || ' '}</div>)}
          {change.diff?.removed.map((line, lineIndex) => <div key={`removed-${lineIndex}`} className="bg-red-500/10 px-1 text-red-700 dark:text-red-300">- {line || ' '}</div>)}
          {change.diff?.added.map((line, lineIndex) => <div key={`added-${lineIndex}`} className="bg-emerald-500/10 px-1 text-emerald-700 dark:text-emerald-300">+ {line || ' '}</div>)}
          {change.diff?.truncated && <div className="mt-1 text-muted-foreground">… 其余变更请打开文件查看</div>}
        </pre>
      ) : (
        <p className="p-4 text-xs leading-relaxed text-muted-foreground">该文件已变化，但无法生成受限文本 Diff。</p>
      )}
    </article>
  )
}

/** 项目记忆变更的只读 Diff 列表；完整记忆由用户主动切换查看。 */
export function WorkspaceMemoryChangeShelf({ changes, onOpenFile, onBackToMemory, className }: WorkspaceMemoryChangeShelfProps): React.ReactElement | null {
  if (changes.length === 0) return null

  return (
    <section className={className ?? 'h-full min-h-0 overflow-y-auto bg-content-area p-4'} aria-label="项目记忆更新">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">项目记忆已更新</h2>
          <p className="mt-1 text-xs text-muted-foreground">{changes.length} 个文件变更</p>
        </div>
        {onBackToMemory && <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={onBackToMemory}>全部记忆</Button>}
      </div>
      <div className="space-y-5">
        {changes.map((change) => <MemoryChangeDiff key={`${change.relativePath}:${change.changedAt}`} change={change} onOpenFile={onOpenFile} />)}
      </div>
    </section>
  )
}
