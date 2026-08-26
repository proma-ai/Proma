/** 企业库 Skill 的只读详情抽屉，复用本地 Skills 的右侧预览交互。 */
import * as React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Building2, Check, Download, Loader2, RefreshCw } from 'lucide-react'
import type { EnterpriseSkill, EnterpriseSkillDetail, SkillMeta } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { extractSkillBody } from './skillMdUtils'

interface EnterpriseSkillInstallState {
  localSkill?: SkillMeta
  isInstalled: boolean
  hasUpdate: boolean
}

interface EnterpriseSkillDetailSheetProps {
  skill: EnterpriseSkill | null
  installState: EnterpriseSkillInstallState | null
  installing: boolean
  onOpenChange: (open: boolean) => void
  onInstall: () => void
}

export function EnterpriseSkillDetailSheet({ skill, installState, installing, onOpenChange, onInstall }: EnterpriseSkillDetailSheetProps): React.ReactElement {
  return (
    <Sheet open={skill !== null} onOpenChange={onOpenChange}>
      <SheetContent hideClose side="right" className="flex w-[62vw] min-w-[680px] max-w-[1100px] flex-col gap-0 p-0 sm:max-w-[1100px]" aria-describedby={undefined}>
        <SheetTitle className="sr-only">企业 Skill 详情</SheetTitle>
        {skill && installState && <EnterpriseSkillDetailBody key={skill.id} skill={skill} installState={installState} installing={installing} onClose={() => onOpenChange(false)} onInstall={onInstall} />}
      </SheetContent>
    </Sheet>
  )
}

function EnterpriseSkillDetailBody({ skill, installState, installing, onClose, onInstall }: {
  skill: EnterpriseSkill
  installState: EnterpriseSkillInstallState
  installing: boolean
  onClose: () => void
  onInstall: () => void
}): React.ReactElement {
  const [detail, setDetail] = React.useState<EnterpriseSkillDetail | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.electronAPI.enterpriseSkills.get(skill.id)
      .then((result) => { if (!cancelled) setDetail(result) })
      .catch((error) => console.error('[企业 Skills] 加载 Skill 详情失败:', error))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [skill.id])

  const displayedSkill = detail ?? skill
  const localVersion = installState.localSkill?.enterpriseSource?.installedVersion ?? installState.localSkill?.version
  const body = extractSkillBody(detail?.skillMdContent ?? '')
  const actionLabel = installing
    ? (installState.isInstalled ? '更新中…' : '安装中…')
    : installState.hasUpdate
      ? `更新到 v${skill.latestVersion.version}`
      : installState.isInstalled
        ? '已安装'
        : '安装到当前工作区'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-8" type="button" onClick={onClose}>
            <ArrowLeft size={18} />
          </Button>
          <h3 className="text-lg font-medium text-foreground">Skill 详情</h3>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-primary/10 p-2 text-primary shadow-sm"><Building2 size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-base font-semibold text-foreground">{displayedSkill.name}</h4>
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">云端 v{displayedSkill.latestVersion.version}</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{displayedSkill.slug}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"><Building2 size={12} />企业 Skills</span>
          {installState.isInstalled && <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><Check size={12} />本地 v{localVersion}</span>}
          {installState.hasUpdate && <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">有更新</span>}
          <Button className="ml-auto" size="sm" variant={installState.isInstalled && !installState.hasUpdate ? 'secondary' : 'default'} onClick={onInstall} disabled={installing || (installState.isInstalled && !installState.hasUpdate)}>
            {installing ? <Loader2 className="animate-spin" /> : installState.isInstalled && !installState.hasUpdate ? <Check /> : installState.hasUpdate ? <RefreshCw /> : <Download />}
            {actionLabel}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />加载详情中…</div>
        ) : (
          <div className="flex flex-col gap-5 p-5">
            <section>
              <h5 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">元数据</h5>
              <div className="rounded-xl bg-muted/45 p-4 shadow-sm">
                <div className="grid gap-3 text-sm sm:grid-cols-[84px_minmax(0,1fr)]">
                  <span className="text-muted-foreground">说明</span><span className="text-foreground">{displayedSkill.description ?? '暂无描述'}</span>
                  <span className="text-muted-foreground">分组</span><span className="text-foreground">{displayedSkill.group ?? '未分组'}</span>
                  <span className="text-muted-foreground">版本状态</span><span className="text-foreground">{installState.hasUpdate ? `本地 v${localVersion}，可更新到云端 v${displayedSkill.latestVersion.version}` : installState.isInstalled ? `已下载云端 v${displayedSkill.latestVersion.version} 到本地` : `云端最新 v${displayedSkill.latestVersion.version}，尚未安装`}</span>
                </div>
              </div>
            </section>

            {displayedSkill.latestVersion.changelog && (
              <section>
                <h5 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">版本说明</h5>
                <div className="rounded-xl bg-muted/45 p-4 text-sm leading-6 text-muted-foreground shadow-sm">{displayedSkill.latestVersion.changelog}</div>
              </section>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between"><h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SKILL.md</h5><span className="text-[11px] text-muted-foreground">云端只读预览</span></div>
              <div className="rounded-xl bg-muted/45 p-4 shadow-sm">
                {body ? <div className="prose prose-sm dark:prose-invert max-w-none"><Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown></div> : <p className="text-sm text-muted-foreground">暂无可预览的 Skill 说明。</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
