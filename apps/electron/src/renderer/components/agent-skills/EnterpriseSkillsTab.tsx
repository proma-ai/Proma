/** 企业 Skills内嵌 Tab：远端访问和文件写入均经主进程 IPC。 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Building2, Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { EnterpriseSkill, EnterpriseSkillListResponse, SkillMeta } from '@proma/shared'
import { cloudUserAtom } from '@/atoms/cloud-auth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EnterpriseSkillDetailSheet } from './EnterpriseSkillDetailSheet'

interface EnterpriseSkillsTabProps {
  workspaceSlug: string
  search: string
  installedSkills: SkillMeta[]
  /** 本地安装完成后刷新宿主的 Skills 快照；支持异步，避免卡片保留旧安装状态。 */
  onInstalled: () => void | Promise<void>
}

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000

interface CachedCatalogResponse {
  response: EnterpriseSkillListResponse
  loadedAt: number
}

const catalogResponsesByUserId = new Map<string, CachedCatalogResponse>()
const catalogRequestsByUserId = new Map<string, Promise<EnterpriseSkillListResponse>>()

function unavailableCatalog(reason: string): EnterpriseSkillListResponse {
  return { items: [], availability: { enabled: false, reason } }
}

async function loadEnterpriseSkillsCatalog(
  userId: string,
  force = false,
): Promise<EnterpriseSkillListResponse> {
  const cached = catalogResponsesByUserId.get(userId)
  if (!force && cached && Date.now() - cached.loadedAt < CATALOG_CACHE_TTL_MS) return cached.response

  const inFlight = catalogRequestsByUserId.get(userId)
  if (inFlight) return inFlight

  const request = window.electronAPI.enterpriseSkills.list()
    .then((response) => {
      catalogResponsesByUserId.set(userId, { response, loadedAt: Date.now() })
      return response
    })
    .finally(() => {
      catalogRequestsByUserId.delete(userId)
    })
  catalogRequestsByUserId.set(userId, request)
  return request
}

interface EnterpriseSkillInstallState {
  localSkill?: SkillMeta
  isInstalled: boolean
  hasUpdate: boolean
}

export function EnterpriseSkillsTab({ workspaceSlug, search, installedSkills, onInstalled }: EnterpriseSkillsTabProps): React.ReactElement {
  const cloudUser = useAtomValue(cloudUserAtom)
  const userId = cloudUser?.id ?? null
  const [response, setResponse] = React.useState<EnterpriseSkillListResponse | null>(() => (
    userId ? catalogResponsesByUserId.get(userId)?.response ?? null : null
  ))
  const [loading, setLoading] = React.useState(() => Boolean(userId && !catalogResponsesByUserId.has(userId)))
  const [installingId, setInstallingId] = React.useState<string | null>(null)
  const [selectedSkill, setSelectedSkill] = React.useState<EnterpriseSkill | null>(null)

  const load = React.useCallback(async (force = false) => {
    if (!userId) {
      setResponse(unavailableCatalog('请登录企业账号，或联系企业管理员开通此功能。'))
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setResponse(await loadEnterpriseSkillsCatalog(userId, force))
    } catch (error) {
      console.error('[企业 Skills] 加载失败:', error)
      setResponse(unavailableCatalog('无法连接企业 Skills 服务'))
    } finally {
      setLoading(false)
    }
  }, [userId])

  React.useEffect(() => {
    setResponse(userId ? catalogResponsesByUserId.get(userId)?.response ?? null : null)
    void load()
  }, [load, userId])

  const localSkillsByEnterpriseId = React.useMemo(() => new Map(
    installedSkills.flatMap((skill) => skill.enterpriseSource ? [[skill.enterpriseSource.skillId, skill] as const] : []),
  ), [installedSkills])

  const query = search.trim().toLowerCase()
  const visibleSkills = React.useMemo(() => {
    if (!query) return response?.items ?? []
    return (response?.items ?? []).filter((skill) =>
      skill.name.toLowerCase().includes(query) ||
      skill.slug.toLowerCase().includes(query) ||
      (skill.description ?? '').toLowerCase().includes(query) ||
      (skill.group ?? '').toLowerCase().includes(query),
    )
  }, [query, response?.items])
  const availability = response?.availability

  const getInstallState = React.useCallback((skill: EnterpriseSkill): EnterpriseSkillInstallState => {
    const localSkill = localSkillsByEnterpriseId.get(skill.id)
    const source = localSkill?.enterpriseSource
    return {
      localSkill,
      isInstalled: source !== undefined,
      hasUpdate: source !== undefined && source.versionId !== skill.latestVersion.id,
    }
  }, [localSkillsByEnterpriseId])

  const install = async (skill: EnterpriseSkill): Promise<void> => {
    if (!workspaceSlug || installingId) return
    const state = getInstallState(skill)
    setInstallingId(skill.id)
    try {
      const result = await window.electronAPI.enterpriseSkills.install(workspaceSlug, skill)
      toast.success(state.isInstalled ? `已更新 ${skill.name}` : `已安装 ${skill.name}`, {
        description: `当前本地版本：${result.installedVersion}`,
      })
      await onInstalled()
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : '安装失败'
      toast.error(`无法${state.isInstalled ? '更新' : '安装'} ${skill.name}`, { description: message })
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <div className="flex min-h-[520px] flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4 px-1">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Building2 size={19} className="text-primary" />
            企业 Skills
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">企业管理员集中发布；安装、更新和本地修改均由你手动控制。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading} className="min-h-8">
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          刷新
        </Button>
      </header>

      {loading && !response ? (
        <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />加载中…</div>
      ) : !availability?.enabled ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl bg-muted/40 px-6 py-16 text-center shadow-sm">
          <Building2 className="size-8 text-foreground/25" />
          <div className="mt-3 text-sm font-medium text-foreground/80">企业 Skills暂不可用</div>
          <div className="mt-2 max-w-md text-sm text-muted-foreground">{availability?.reason ?? '请登录企业账号，或联系企业管理员开通此功能。'}</div>
        </div>
      ) : visibleSkills.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl bg-muted/35 px-6 py-16 text-center text-sm text-muted-foreground shadow-sm">
          {query ? '没有匹配的企业 Skill。' : '暂时没有可安装的企业 Skill。'}
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[13px] font-medium text-foreground/55">企业 Skills</span>
            <span className="text-[12px] tabular-nums text-foreground/35">{visibleSkills.length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSkills.map((skill) => {
              const installState = getInstallState(skill)
              return (
                <EnterpriseSkillCard
                  key={skill.id}
                  skill={skill}
                  installState={installState}
                  installing={installingId === skill.id}
                  onOpen={() => setSelectedSkill(skill)}
                  onInstall={() => void install(skill)}
                />
              )
            })}
          </div>
        </section>
      )}

      <EnterpriseSkillDetailSheet
        skill={selectedSkill}
        installState={selectedSkill ? getInstallState(selectedSkill) : null}
        installing={selectedSkill !== null && installingId === selectedSkill.id}
        onOpenChange={(open) => { if (!open) setSelectedSkill(null) }}
        onInstall={() => { if (selectedSkill) void install(selectedSkill) }}
      />
    </div>
  )
}

function EnterpriseSkillCard({ skill, installState, installing, onOpen, onInstall }: {
  skill: EnterpriseSkill
  installState: EnterpriseSkillInstallState
  installing: boolean
  onOpen: () => void
  onInstall: () => void
}): React.ReactElement {
  const localVersion = installState.localSkill?.enterpriseSource?.installedVersion ?? installState.localSkill?.version
  const actionLabel = installing
    ? (installState.isInstalled ? '更新中…' : '安装中…')
    : installState.hasUpdate
      ? `更新到 v${skill.latestVersion.version}`
      : installState.isInstalled
        ? '已安装'
        : '安装到当前工作区'

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="flex h-full cursor-pointer flex-col gap-3 rounded-xl border border-border/60 bg-content-area p-4 text-left shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-primary/10 p-2 text-primary shadow-sm">
          <Building2 size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{skill.name}</span>
            {installState.hasUpdate && <span className="shrink-0 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">有更新</span>}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{skill.slug}</div>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[40px] text-[13px] leading-6 text-muted-foreground">{skill.description ?? '暂无描述'}</p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium">
        {skill.group && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">{skill.group}</span>}
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">云端 v{skill.latestVersion.version}</span>
        {installState.isInstalled && <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400"><Check size={12} />本地 v{localVersion}</span>}
      </div>

      {skill.latestVersion.changelog && <p className="line-clamp-2 text-xs leading-5 text-muted-foreground/80">{skill.latestVersion.changelog}</p>}

      <div className="mt-auto pt-1">
        <Button className="w-full" size="sm" variant={installState.isInstalled && !installState.hasUpdate ? 'secondary' : 'default'} onClick={(event) => { event.stopPropagation(); onInstall() }} disabled={installing || (installState.isInstalled && !installState.hasUpdate)}>
          {installing ? <Loader2 className="animate-spin" /> : installState.isInstalled && !installState.hasUpdate ? <Check /> : <Download />}
          {actionLabel}
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {installState.hasUpdate ? '手动更新，不会覆盖本地修改。' : installState.isInstalled ? '当前云端版本已下载到本地。' : '不会自动更新或覆盖本地修改。'}
        </p>
      </div>
    </article>
  )
}
