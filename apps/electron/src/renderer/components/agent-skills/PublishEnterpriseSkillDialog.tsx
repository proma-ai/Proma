/** 发布企业 Skill 的一次确认弹窗；版本直接采用本地 SKILL.md 元数据。 */
import * as React from 'react'
import { Loader2, ShieldCheck, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { SkillMeta } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface PublishEnterpriseSkillDialogProps {
  skill: SkillMeta | null
  workspaceSlug: string
  onOpenChange: (open: boolean) => void
  onPublished: () => void
}

export function PublishEnterpriseSkillDialog({ skill, workspaceSlug, onOpenChange, onPublished }: PublishEnterpriseSkillDialogProps): React.ReactElement {
  const [publishing, setPublishing] = React.useState(false)
  const version = skill?.version?.trim()
  const enterpriseSource = skill?.enterpriseSource
  const isVersionUpdate = enterpriseSource !== undefined

  const publish = async (): Promise<void> => {
    if (!skill || !version || publishing) return
    setPublishing(true)
    try {
      const input = {
        skillSlug: skill.slug,
        version,
        name: skill.name,
        description: skill.description,
      }
      if (enterpriseSource) {
        await window.electronAPI.enterpriseSkills.publishVersion(workspaceSlug, enterpriseSource.skillId, input)
      } else {
        await window.electronAPI.enterpriseSkills.publish(workspaceSlug, input)
      }
      toast.success(isVersionUpdate ? `已推送 ${skill.name} 更新` : `已发布 ${skill.name}`, {
        description: `v${version} 已向企业成员开放手动安装。`,
      })
      onPublished()
      onOpenChange(false)
    } catch (error) {
      toast.error(isVersionUpdate ? '推送更新失败' : '发布失败', { description: error instanceof Error ? error.message : '请稍后重试' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={skill !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck size={18} className="text-primary" />{isVersionUpdate ? '推送企业 Skill 更新' : '发布到企业 Skills'}</DialogTitle>
          <DialogDescription className="leading-6">{isVersionUpdate ? '确认后会将当前本地修改打包为新的不可变版本。请先在 SKILL.md 中递增 version；企业成员可手动更新。' : '确认后会将当前本地 Skill 打包为不可变制品，并向本企业成员开放手动安装。'}</DialogDescription>
        </DialogHeader>

        {skill && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <div className="font-medium text-foreground">{skill.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{skill.slug}</div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{isVersionUpdate ? `当前版本 v${enterpriseSource?.installedVersion}` : '发布版本'}</span>
              <span className="rounded-md bg-background px-2 py-1 font-medium tabular-nums text-foreground">{version ? `v${version}` : '未在 SKILL.md 中设置版本'}</span>
            </div>
          </div>
        )}

        {skill && !version && <p className="text-xs leading-5 text-destructive">请先在该 Skill 的 SKILL.md frontmatter 中补充有效的 SemVer `version`，然后再发布。</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>取消</Button>
          <Button onClick={() => void publish()} disabled={!version || publishing}>
            {publishing ? <Loader2 className="animate-spin" /> : <Upload />}
            {publishing ? (isVersionUpdate ? '推送中…' : '发布中…') : (isVersionUpdate ? '确认推送更新' : '确认发布')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
