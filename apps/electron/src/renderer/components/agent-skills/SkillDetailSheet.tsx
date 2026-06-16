/**
 * SkillDetailSheet — Skill 详情右侧抽屉
 *
 * 承载元数据、SKILL.md 说明（可编辑）、资源文件树（复用 SkillFilesPanel），
 * 以及启用 / 更新 / 卸载 / 打开目录等操作。
 */

import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { Sparkles, Pencil, Save, X, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsCard } from '@/components/settings/primitives'
import { SkillFilesPanel } from '@/components/settings/SkillFilesPanel'
import { cn } from '@/lib/utils'
import type { SkillMeta } from '@proma/shared'
import { extractSkillBody, rebuildSkillMd } from './skillMdUtils'

interface SkillDetailSheetProps {
  skill: SkillMeta | null
  workspaceSlug: string
  isBuiltin: boolean
  updating: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (enabled: boolean) => void
  onUpdate: () => void
  onDelete: () => void
  onOpenFolder: () => void
  onChanged: () => void
}

export function SkillDetailSheet(props: SkillDetailSheetProps): React.ReactElement {
  const { skill, onOpenChange } = props
  return (
    <Sheet open={!!skill} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[62vw] min-w-[680px] max-w-[1100px] sm:max-w-[1100px] p-0 flex flex-col gap-0" aria-describedby={undefined}>
        <SheetTitle className="sr-only">Skill 详情</SheetTitle>
        {skill && <SkillDetailBody key={skill.slug} {...props} skill={skill} />}
      </SheetContent>
    </Sheet>
  )
}

function SkillDetailBody({
  skill,
  workspaceSlug,
  isBuiltin,
  updating,
  onToggle,
  onUpdate,
  onDelete,
  onOpenFolder,
  onChanged,
}: SkillDetailSheetProps & { skill: SkillMeta }): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [loadingContent, setLoadingContent] = React.useState(true)

  const [isEditingMeta, setIsEditingMeta] = React.useState(false)
  const [isEditingBody, setIsEditingBody] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [editBody, setEditBody] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const [detailTab, setDetailTab] = React.useState<'body' | 'files'>('body')
  const [fileCount, setFileCount] = React.useState<number | null>(null)

  React.useEffect(() => {
    setLoadingContent(true)
    window.electronAPI.readSkillContent(workspaceSlug, skill.slug)
      .then((text) => setContent(text))
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
      setIsEditingBody(false)
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
      : '当前工作区'

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 头部 */}
      <div className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5 pr-12">
        <div className="flex items-start gap-3">
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
          <Button size="sm" variant="ghost" onClick={onOpenFolder} title="打开目录">
            <FolderOpen size={14} />
          </Button>
          {!isBuiltin && (
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="卸载">
              <Trash2 size={14} />
            </Button>
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
                <button onClick={startEditMeta} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  <Pencil size={12} /> 编辑
                </button>
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
                  {!isEditingBody ? (
                    <button
                      type="button"
                      title="编辑"
                      onClick={() => { setEditBody(body); setIsEditingBody(true) }}
                      className="flex items-center gap-1 rounded p-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Pencil size={14} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setIsEditingBody(false)} disabled={saving}>
                        <X size={14} /> 取消
                      </Button>
                      <Button size="sm" onClick={() => void saveBody()} disabled={saving}>
                        <Save size={14} /> {saving ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  )}
                </div>
                <SettingsCard divided={false}>
                  <div className="p-4">
                    {isEditingBody ? (
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="min-h-[420px] w-full resize-y rounded-md border border-border bg-transparent p-3 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="输入 Skill 说明内容（支持 Markdown）..."
                      />
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <Markdown remarkPlugins={[remarkGfm]}>{body || '暂无说明内容'}</Markdown>
                      </div>
                    )}
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
