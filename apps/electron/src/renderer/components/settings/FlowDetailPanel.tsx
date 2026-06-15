/**
 * FlowDetailPanel — Flow 详情面板
 *
 * 显示 Flow 元数据、flow.js 内容预览和编辑功能。
 */

import * as React from 'react'
import { Workflow, Pencil, Save, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { FlowMeta } from '@proma/shared'

export interface FlowDetailPanelProps {
  flow: FlowMeta
  workspaceSlug: string
  onDelete: () => void
  onSaved: () => void
  /** 更新 Flow 从默认源（仅内置 Flow 有更新时可用） */
  onUpdate?: () => void
}

export function FlowDetailPanel({ flow, workspaceSlug, onDelete, onSaved, onUpdate }: FlowDetailPanelProps): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.readFlowContent(workspaceSlug, flow.slug)
      .then((text) => { if (!cancelled) { setContent(text); setEditContent(text) } })
      .catch(() => { if (!cancelled) setContent(null) })
    return () => { cancelled = true }
  }, [workspaceSlug, flow.slug])

  const handleSave = (): void => {
    setSaving(true)
    window.electronAPI.writeFlowContent(workspaceSlug, flow.slug, editContent)
      .then(() => {
        setEditing(false)
        setContent(editContent)
        onSaved()
        toast.success('Flow 已保存')
      })
      .catch((err: unknown) => {
        toast.error(`保存失败: ${(err as Error).message}`)
      })
      .finally(() => { setSaving(false) })
  }

  const isBuiltin = flow.type === 'builtin'

  return (
    <div className="p-4 space-y-4">
      {/* 元数据 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Workflow size={16} className="text-amber-500" />
          <span className="text-sm font-medium">{flow.name.replace(/^!/, '')}</span>
          {isBuiltin && (
            <span className="text-xs text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted/50">内置</span>
          )}
          {flow.hasUpdate && (
            <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30">
              <RefreshCw size={10} />
              有更新
            </span>
          )}
        </div>
        {flow.description && (
          <p className="text-xs text-muted-foreground">{flow.description}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Slug: <code className="font-mono">{flow.slug}</code></span>
          {flow.version && <span>版本: {flow.version}</span>}
          {flow.group && <span>分组: {flow.group}</span>}
        </div>
      </div>

      {/* 操作按钮 */}
      {!isBuiltin && (
      <div className="flex items-center gap-2">
        {flow.hasUpdate && onUpdate && (
          <Button size="sm" variant="outline" className="text-amber-600 hover:text-amber-700" onClick={onUpdate}>
            <RefreshCw size={14} />
            <span>更新到最新版</span>
          </Button>
        )}
        {!editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            <span>编辑 flow.js</span>
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save size={14} />
              <span>{saving ? '保存中...' : '保存'}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setEditContent(content ?? '') }}>
              取消
            </Button>
          </>
        )}
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 size={14} />
          <span>删除</span>
        </Button>
      </div>
      )}

      {/* flow.js 内容 */}
      {content !== null ? (
        editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-80 p-3 rounded-lg border border-border bg-background font-mono text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            spellCheck={false}
          />
        ) : (
          <pre className="p-3 rounded-lg border border-border bg-muted/30 font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all">
            {content}
          </pre>
        )
      ) : (
        <div className="text-sm text-muted-foreground py-4 text-center">无法加载 flow.js</div>
      )}
    </div>
  )
}
