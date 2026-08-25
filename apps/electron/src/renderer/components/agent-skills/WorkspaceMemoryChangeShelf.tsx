import * as React from 'react'
import { useAtom } from 'jotai'
import { ChevronLeft, ChevronRight, FileText, Loader2, Save, X } from 'lucide-react'
import type { WorkspaceMemoryFileChange } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { workspaceMemoryEditingStateAtomFamily } from '@/atoms/memory-change-atoms'

interface WorkspaceMemoryChangeShelfProps {
  workspaceSlug: string
  sessionId: string
  changes: WorkspaceMemoryFileChange[]
  className?: string
}

function formatKind(kind: WorkspaceMemoryFileChange['kind']): string {
  if (kind === 'created') return '新增'
  if (kind === 'deleted') return '删除'
  return '更新'
}

/** 项目记忆的紧凑 Diff 预览；文件可直接在右侧工作区 Tab 内编辑和保存。 */
export function WorkspaceMemoryChangeShelf({ workspaceSlug, sessionId, changes, className }: WorkspaceMemoryChangeShelfProps): React.ReactElement | null {
  const [index, setIndex] = React.useState(0)
  const [editingPath, setEditingPath] = React.useState<string | null>(null)
  const [editText, setEditText] = React.useState('')
  const [initialText, setInitialText] = React.useState('')
  const [editingState, setEditingState] = useAtom(workspaceMemoryEditingStateAtomFamily(sessionId))
  const openedAtRef = React.useRef(0)
  const ignoreNextLocalChangeRef = React.useRef<string | null>(null)
  const lastHandledChangeIdRef = React.useRef<string | null>(null)
  const [loadingEditor, setLoadingEditor] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const change = changes[index]
  const hasDiff = Boolean(change?.diffAvailable && change.diff && (change.diff.added.length > 0 || change.diff.removed.length > 0))

  React.useEffect(() => setIndex(0), [changes[0]?.changedAt])
  React.useEffect(() => setIndex((current) => current >= changes.length ? 0 : current), [changes.length])
  React.useEffect(() => () => setEditingState({ editingPath: null, dirty: false, remoteChanged: false }), [setEditingState])
  React.useEffect(() => {
    const latest = changes[0]
    if (!editingPath || !latest || latest.relativePath !== editingPath || latest.changedAt < openedAtRef.current) return
    const changeId = `${latest.relativePath}:${latest.changedAt}`
    if (lastHandledChangeIdRef.current === changeId) return
    lastHandledChangeIdRef.current = changeId
    if (ignoreNextLocalChangeRef.current === latest.relativePath) {
      ignoreNextLocalChangeRef.current = null
      // watcher 对短时间内的写入会合并。确认磁盘最终内容仍等于刚保存的文本后才
      // 忽略该事件；若 Agent/外部进程紧接着又写入，必须标记冲突而非静默覆盖。
      void window.electronAPI.readWorkspaceAutoMemoryFile(workspaceSlug, latest.relativePath)
        .then((file) => {
          if (file.content !== editText) setEditingState((previous) => ({ ...previous, remoteChanged: true }))
        })
        .catch(() => setEditingState((previous) => ({ ...previous, remoteChanged: true })))
      return
    }
    setEditingState((previous) => ({ ...previous, remoteChanged: true }))
  }, [changes, editText, editingPath, setEditingState, workspaceSlug])

  const startEditing = React.useCallback(async (relativePath: string): Promise<void> => {
    setLoadingEditor(true)
    setError(null)
    try {
      const file = await window.electronAPI.readWorkspaceAutoMemoryFile(workspaceSlug, relativePath)
      openedAtRef.current = Date.now()
      setEditingPath(file.relativePath)
      setEditText(file.content ?? '')
      setInitialText(file.content ?? '')
      setEditingState({ editingPath: file.relativePath, dirty: false, remoteChanged: false })
    } catch (cause) {
      console.error('[项目记忆] 读取文件失败:', cause)
      setError(cause instanceof Error ? cause.message : '读取记忆文件失败')
    } finally {
      setLoadingEditor(false)
    }
  }, [workspaceSlug])

  const saveEditing = React.useCallback(async (): Promise<void> => {
    if (!editingPath) return
    if (editingState.remoteChanged) {
      setError('该文件在编辑期间已被外部更新。请返回预览后重新打开，避免覆盖新内容。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.writeWorkspaceAutoMemoryFile(workspaceSlug, editingPath, editText)
      setInitialText(editText)
      setEditingState({ editingPath, dirty: false, remoteChanged: false })
      // watcher 会回传本次本地保存；只忽略这一个相同路径的最新事件。
      ignoreNextLocalChangeRef.current = editingPath
    } catch (cause) {
      console.error('[项目记忆] 保存文件失败:', cause)
      setError(cause instanceof Error ? cause.message : '保存记忆文件失败')
      return
    } finally {
      setSaving(false)
    }
  }, [editText, editingPath, editingState.remoteChanged, setEditingState, workspaceSlug])

  if (editingPath) {
    return (
      <section className={className ?? 'flex h-full min-h-0 flex-col bg-content-area p-3'} aria-label="编辑项目记忆">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">编辑项目记忆</h2>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={editingPath}>{editingPath}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => {
              if (editingState.dirty && !window.confirm('项目记忆有未保存修改。确定丢弃并返回预览吗？')) return
              setEditingPath(null)
              setError(null)
              setEditingState({ editingPath: null, dirty: false, remoteChanged: false })
            }} disabled={saving}>返回预览</Button>
            <Button size="sm" className="h-8 px-2 text-xs" onClick={() => void saveEditing()} disabled={saving}>
              {saving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Save className="mr-1 size-3.5" />}
              保存
            </Button>
          </div>
        </div>
        <textarea
          autoFocus
          value={editText}
          onChange={(event) => {
            const nextText = event.target.value
            setEditText(nextText)
            setEditingState((previous) => ({ ...previous, dirty: nextText !== initialText }))
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              void saveEditing()
            }
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-lg border border-border/70 bg-background p-3 font-mono text-xs leading-5 text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-2 focus:ring-primary/20"
          aria-label={`编辑 ${editingPath}`}
        />
        {editingState.remoteChanged && <p className="mt-2 shrink-0 text-xs text-amber-600 dark:text-amber-400">文件已被外部更新；为避免覆盖，保存已暂停。请返回预览后重新打开。</p>}
        {error && <p className="mt-2 shrink-0 text-xs text-destructive">{error}</p>}
      </section>
    )
  }

  if (!change) return null

  return (
    <section className={className ?? 'h-full overflow-auto bg-content-area p-3'} aria-label="项目记忆更新">
      {loadingEditor && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在打开编辑器…</div>
      )}
      {error && <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"><span>{error}</span><Button size="icon" variant="ghost" className="size-6 text-destructive" onClick={() => setError(null)} aria-label="关闭错误提示"><X size={14} /></Button></div>}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">项目记忆已更新</h2>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={change.relativePath}>{change.relativePath}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{formatKind(change.kind)} · {index + 1}/{changes.length}</span>
        </div>

        {changes.length > 1 && (
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" className="size-7" aria-label="上一条记忆更新" onClick={() => setIndex((value) => (value - 1 + changes.length) % changes.length)}><ChevronLeft size={15} /></Button>
            <Button size="icon" variant="ghost" className="size-7" aria-label="下一条记忆更新" onClick={() => setIndex((value) => (value + 1) % changes.length)}><ChevronRight size={15} /></Button>
          </div>
        )}

        {hasDiff ? (
          <pre className="max-h-[min(520px,calc(100vh-220px))] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
            {change.diff?.context.map((line, lineIndex) => <div key={`context-${lineIndex}`} className="text-muted-foreground">  {line || ' '}</div>)}
            {change.diff?.removed.map((line, lineIndex) => <div key={`removed-${lineIndex}`} className="bg-red-500/10 px-1 text-red-700 dark:text-red-300">- {line || ' '}</div>)}
            {change.diff?.added.map((line, lineIndex) => <div key={`added-${lineIndex}`} className="bg-emerald-500/10 px-1 text-emerald-700 dark:text-emerald-300">+ {line || ' '}</div>)}
            {change.diff?.truncated && <div className="mt-1 text-muted-foreground">… 其余变更请打开文件查看</div>}
          </pre>
        ) : (
          <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">该文件已变化，但无法生成受限文本 Diff。</p>
        )}

        {change.kind !== 'deleted' && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void startEditing(change.relativePath)} disabled={loadingEditor}><FileText size={13} className="mr-1" />编辑文件</Button>
          </div>
        )}
      </div>
    </section>
  )
}
