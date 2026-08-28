/**
 * SkillDetailView — Skills Tab 内的详情视图。
 *
 * 复用 Skills 列表所在的右侧工作区 Tab，不再以抽屉覆盖会话历史。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Sparkles, Pencil, Save, X, FolderOpen, RefreshCw, Trash2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsCard } from '@/components/settings/primitives'
import { SkillFilesPanel } from '@/components/settings/SkillFilesPanel'
import { LiveMarkdownEditor } from '@/components/markdown/LiveMarkdownEditor'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@proma/shared'
import { extractSkillBody, rebuildSkillMd } from './skillMdUtils'

export interface SkillDetailViewProps {
  skill: SkillMeta
  workspaceSlug: string
  isBuiltin: boolean
  updating: boolean
  onBack: () => void
  onToggle: (enabled: boolean) => void
  onUpdate: () => void
  onRequestDelete: () => void
  onOpenFolder: () => void
  onChanged: () => void
}

export function SkillDetailView({
  skill,
  workspaceSlug,
  isBuiltin,
  updating,
  onBack,
  onToggle,
  onUpdate,
  onRequestDelete,
  onOpenFolder,
  onChanged,
}: SkillDetailViewProps): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [loadingContent, setLoadingContent] = React.useState(true)

  const [isEditingMeta, setIsEditingMeta] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [editBody, setEditBody] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const [detailTab, setDetailTab] = React.useState<'body' | 'files'>('body')
  const [fileCount, setFileCount] = React.useState<number | null>(null)

  React.useEffect(() => {
    setLoadingContent(true)
    window.electronAPI.readSkillContent(workspaceSlug, skill.slug)
      .then((text) => {
        setContent(text)
        setEditBody(extractSkillBody(text))
      })
      .catch((err) => {
        console.error('[SkillDetail] 加载内容失败:', err)
        setContent(null)
      })
      .finally(() => setLoadingContent(false))
  }, [skill.slug, workspaceSlug])

  const body = React.useMemo(() => extractSkillBody(content ?? ''), [content])

  const startEditMeta = (): void => {
    setEditName(skill.name)
    setEditDescription(skill.description ?? '')
    setIsEditingMeta(true)
  }

  const saveMeta = async (): Promise<void> => {
    if (!content) return
    setSaving(true)
    try {
      const newContent = rebuildSkillMd(content, { name: editName, description: editDescription })
      await window.electronAPI.writeSkillContent(workspaceSlug, skill.slug, newContent)
      setContent(newContent)
      setIsEditingMeta(false)
      onChanged()
      toast.success('元数据已保存')
    } catch (err) {
      console.error('[SkillDetail] 保存元数据失败:', err)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveBody = async (): Promise<void> => {
    if (!content) return
    setSaving(true)
    try {
      const newContent = rebuildSkillMd(content, { body: editBody })
      await window.electronAPI.writeSkillContent(workspaceSlug, skill.slug, newContent)
      setContent(newContent)
      onChanged()
      toast.success('说明已保存')
    } catch (err) {
      console.error('[SkillDetail] 保存说明失败:', err)
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const sourceLabel = isBuiltin
    ? 'PROMA 内置'
    : skill.importSource
      ? `从 ${skill.importSource.sourceWorkspaceName} 导入`
      : '当前项目'

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 头部 */}
      <div className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-10 gap-1.5 px-2" type="button" onClick={onBack}>
            <ArrowLeft size={16} />
            返回 Skills
          </Button>
          <h3 className="text-lg font-medium text-foreground">Skill 详情</h3>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm shrink-0">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">{skill.name}</h3>
              {skill.version && (
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  v{skill.version}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{skill.slug}</div>
          </div>
        </div>

        {/* 操作行 */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            <Switch checked={skill.enabled} onCheckedChange={onToggle} />
            <span className="text-xs text-muted-foreground">{skill.enabled ? '已启用' : '已禁用'}</span>
          </div>
          {skill.hasUpdate && (
            <Button size="sm" variant="outline" onClick={onUpdate} disabled={updating}>
              <RefreshCw size={14} className={cn(updating && 'animate-spin')} />
              {updating ? '更新中' : '更新'}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={onOpenFolder}>
                <FolderOpen size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">打开目录</TooltipContent>
          </Tooltip>
          {!isBuiltin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onRequestDelete}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">卸载</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {loadingContent ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">加载中...</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <div className="flex flex-col gap-4 p-5">
            {/* 元数据 */}
            <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">元数据</h4>
              {!isEditingMeta ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={startEditMeta}
                      className="flex items-center rounded p-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Pencil size={12} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">编辑</TooltipContent>
                </Tooltip>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setIsEditingMeta(false)} disabled={saving}>
                    <X size={14} /> 取消
                  </Button>
                  <Button size="sm" onClick={() => void saveMeta()} disabled={saving}>
                    <Save size={14} /> {saving ? '保存中...' : '保存'}
                  </Button>
                </div>
              )}
            </div>
            <SettingsCard divided>
              {isEditingMeta ? (
                <>
                  <MetaEditRow label="名称" value={editName} onChange={setEditName} />
                  <MetaEditRow label="描述" value={editDescription} onChange={setEditDescription} multiline />
                </>
              ) : (
                <>
                  <MetaRow label="名称" value={skill.name} />
                  <MetaRow label="描述" value={skill.description ?? '无描述'} />
                </>
              )}
              <MetaRow label="数据源" value={sourceLabel} />
              <MetaRow label="位置" value={`skills/${skill.slug}`} />
            </SettingsCard>
          </div>

          {/* 说明 / 资源文件 */}
          <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as 'body' | 'files')} className="flex flex-col">
            <TabsList className="self-start shrink-0">
              <TabsTrigger value="body">说明</TabsTrigger>
              <TabsTrigger value="files">
                资源文件
                {fileCount !== null && (
                  <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-muted-foreground/15 px-1 text-[10px] font-medium">
                    {fileCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="body" className="mt-3">
              <div className="flex flex-col">
                <div className="flex min-h-[28px] shrink-0 items-center justify-between px-1 pb-2">
                  <div className="font-mono text-xs text-muted-foreground">SKILL.md</div>
                  <Button
                    size="sm"
                    onClick={() => void saveBody()}
                    disabled={saving || !content || editBody === body}
                  >
                    <Save size={14} /> {saving ? '保存中...' : '保存'}
                  </Button>
                </div>
                <SettingsCard divided={false}>
                  <div className="p-4">
                    <LiveMarkdownEditor
                      value={editBody}
                      onChange={setEditBody}
                      onSave={() => { void saveBody() }}
                      className="live-markdown-external-scroll skill-detail-live-markdown"
                    />
                  </div>
                </SettingsCard>
              </div>
            </TabsContent>

            <TabsContent value="files" className="mt-3">
              <div className="min-h-[480px]">
                <SkillFilesPanel
                  workspaceSlug={workspaceSlug}
                  skillSlug={skill.slug}
                  onFileCountChange={setFileCount}
                />
              </div>
            </TabsContent>
          </Tabs>
          </div>
        </div>
      )}
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-4 px-4 py-2.5">
      <span className="w-16 shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words text-sm text-foreground">{value}</span>
    </div>
  )
}

function MetaEditRow({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }): React.ReactElement {
  return (
    <div className="flex items-start gap-4 px-4 py-2.5">
      <span className="w-16 shrink-0 pt-2 text-xs text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 resize-y rounded-md border border-border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          rows={3}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  )
}
