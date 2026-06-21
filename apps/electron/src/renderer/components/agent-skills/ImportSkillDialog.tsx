/**
 * ImportSkillDialog — 从其他工作区导入 Skill
 *
 * 列出其他工作区可用的 Skill（自动过滤已安装的同名项），
 * 选择来源工作区后一键导入到当前工作区。逻辑迁移自原 AgentSettings。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsCard } from '@/components/settings/primitives'
import type { OtherWorkspaceSkillsGroup, SkillMeta } from '@proma/shared'

interface ImportSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  installedSkills: SkillMeta[]
  onImported: () => void
}

export function ImportSkillDialog({ open, onOpenChange, workspaceSlug, installedSkills, onImported }: ImportSkillDialogProps): React.ReactElement {
  const [otherWorkspaces, setOtherWorkspaces] = React.useState<OtherWorkspaceSkillsGroup[]>([])
  const [importingSkill, setImportingSkill] = React.useState<string | null>(null)
  const [selectedWorkspaceSlug, setSelectedWorkspaceSlug] = React.useState('')

  React.useEffect(() => {
    if (!open || !workspaceSlug) return
    void (async () => {
      try {
        const groups = await window.electronAPI.getOtherWorkspaceSkills(workspaceSlug)
        setOtherWorkspaces(groups)
      } catch (error) {
        console.error('[Agent 技能] 加载其他工作区 Skill 失败:', error)
      }
    })()
  }, [open, workspaceSlug])

  const installedSlugs = React.useMemo(() => new Set(installedSkills.map((s) => s.slug)), [installedSkills])

  const availableWorkspaces = React.useMemo(
    () =>
      otherWorkspaces
        .map((w) => ({ ...w, skills: w.skills.filter((s) => !installedSlugs.has(s.slug)) }))
        .filter((w) => w.skills.length > 0),
    [otherWorkspaces, installedSlugs],
  )

  const selectedWorkspace = React.useMemo(
    () => availableWorkspaces.find((w) => w.workspaceSlug === selectedWorkspaceSlug) ?? null,
    [availableWorkspaces, selectedWorkspaceSlug],
  )

  React.useEffect(() => {
    if (!open || availableWorkspaces.length === 0) {
      setSelectedWorkspaceSlug('')
      return
    }
    setSelectedWorkspaceSlug((current) =>
      availableWorkspaces.some((w) => w.workspaceSlug === current)
        ? current
        : availableWorkspaces[0]?.workspaceSlug ?? '',
    )
  }, [availableWorkspaces, open])

  const handleImport = async (sourceSlug: string, skillSlug: string): Promise<void> => {
    if (!workspaceSlug || importingSkill) return
    setImportingSkill(skillSlug)
    try {
      const imported = await window.electronAPI.importSkillFromWorkspace(workspaceSlug, sourceSlug, skillSlug)
      onImported()
      onOpenChange(false)
      toast.success(`已导入 Skill：${imported.name}`)
    } catch (error) {
      console.error('[Agent 技能] 导入 Skill 失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('导入 Skill 失败', { description: message })
    } finally {
      setImportingSkill(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>从其他工作区导入 Skill</DialogTitle>
          <DialogDescription>
            从其他工作区中选择 Skill 导入到当前工作区。已安装的同名 Skill 会自动过滤。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 pb-6">
          {availableWorkspaces.length === 0 ? (
            <SettingsCard divided={false}>
              <div className="py-10 text-center text-sm text-muted-foreground">
                没有可导入的 Skill。其他工作区暂无 Skill，或者它们都已经安装到当前工作区了。
              </div>
            </SettingsCard>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">选择来源工作区</div>
                <Select value={selectedWorkspaceSlug} onValueChange={setSelectedWorkspaceSlug}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择来源工作区" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableWorkspaces.map((w) => (
                      <SelectItem key={w.workspaceSlug} value={w.workspaceSlug}>
                        {w.workspaceName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(selectedWorkspace ? [selectedWorkspace] : []).map((w) => (
                <div key={w.workspaceSlug}>
                  <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span className="truncate">{w.workspaceName}</span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                      {w.skills.length} 个
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {w.skills.map((skill) => (
                      <SettingsCard key={skill.slug} divided={false} className="overflow-hidden">
                        <div className="flex h-full flex-col gap-4 p-4">
                          <div className="flex items-start gap-3">
                            <div className="rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm">
                              <Sparkles size={18} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
                                {skill.version ? (
                                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    v{skill.version}
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">{skill.slug}</div>
                            </div>
                          </div>
                          <div className="line-clamp-3 min-h-[40px] text-sm leading-6 text-muted-foreground">
                            {skill.description ?? '暂无描述'}
                          </div>
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => void handleImport(w.workspaceSlug, skill.slug)}
                            disabled={importingSkill !== null}
                          >
                            {importingSkill === skill.slug ? '导入中...' : '导入'}
                          </Button>
                        </div>
                      </SettingsCard>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
