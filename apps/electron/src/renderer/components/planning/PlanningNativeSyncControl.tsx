import * as React from 'react'
import { CalendarDays, CheckCircle2, CircleAlert, ExternalLink, ListTodo, Loader2, Settings2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type {
  PlanningNativeSyncEntity,
  PlanningNativeSyncPermissionResult,
  PlanningNativeSyncStatus,
  PlanningNativeSyncTarget,
  PlanningNativeConnection,
  PlanningNativeSyncConflict,
  PlanningSyncProfile,
} from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { detectIsMac } from '@/lib/platform'

const COPY: Record<PlanningNativeSyncEntity, { label: string; targetLabel: string; icon: typeof CalendarDays }> = {
  calendar: { label: '系统日历', targetLabel: 'Calendar', icon: CalendarDays },
  reminder: { label: '提醒事项', targetLabel: 'Reminders List', icon: ListTodo },
}

function permissionMessage(permission: PlanningNativeSyncPermissionResult): string {
  switch (permission.status) {
    case 'not-determined': return `授权后选择一个 ${COPY[permission.entity].targetLabel}；Proma 不会读取或导入其他系统项目。`
    case 'write-only': return '当前只有“仅写入”权限，无法列出可选目标。请升级为“完整访问权限”。'
    case 'denied': return '系统已拒绝访问。请在 macOS 系统设置中允许 Proma 访问。'
    case 'restricted': return '此 Mac 的系统策略限制了此权限。'
    case 'unsupported': return '仅支持 macOS。'
    case 'unavailable': return permission.error ? `系统桥不可用：${permission.error}` : '系统桥不可用。'
    case 'full-access': return '请选择一个受管同步目标。'
  }
}

export function PlanningNativeSyncControl({ entity }: { entity: PlanningNativeSyncEntity }): React.ReactElement | null {
  const isMac = React.useMemo(() => detectIsMac(), [])
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<PlanningNativeSyncStatus | null>(null)
  const [profiles, setProfiles] = React.useState<PlanningSyncProfile[]>([])
  const [targets, setTargets] = React.useState<PlanningNativeSyncTarget[]>([])
  const [connectionTargets, setConnectionTargets] = React.useState<PlanningNativeSyncTarget[]>([])
  const [connections, setConnections] = React.useState<PlanningNativeConnection[]>([])
  const [conflicts, setConflicts] = React.useState<PlanningNativeSyncConflict[]>([])
  const [loading, setLoading] = React.useState(false)
  const [requesting, setRequesting] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextStatus, nextProfiles] = await Promise.all([
        window.electronAPI.getPlanningNativeSyncStatus(),
        window.electronAPI.listPlanningSyncProfiles(),
      ])
      setStatus(nextStatus)
      setProfiles(nextProfiles)
      if (nextStatus[entity].status === 'full-access') {
        const [nextTargets, nextConnectionTargets, nextConnections, nextConflicts] = await Promise.all([
          window.electronAPI.listPlanningNativeSyncTargets(entity),
          window.electronAPI.listPlanningNativeConnectionTargets(entity),
          window.electronAPI.listPlanningNativeConnections(entity),
          window.electronAPI.listPlanningNativeSyncConflicts(),
        ])
        setTargets(nextTargets); setConnectionTargets(nextConnectionTargets); setConnections(nextConnections); setConflicts(nextConflicts.filter((conflict) => conflict.entity === entity))
      } else { setTargets([]); setConnectionTargets([]); setConnections([]); setConflicts([]) }
    } catch (error) {
      console.error('[Planning 同步] 读取设置失败:', error)
      toast.error('读取同步设置失败')
    } finally {
      setLoading(false)
    }
  }, [entity])

  React.useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const requestAccess = async (): Promise<void> => {
    setRequesting(true)
    try {
      const result = await window.electronAPI.requestPlanningNativeSyncAccess(entity)
      await refresh()
      if (result.status === 'full-access') toast.success(`${COPY[entity].label}已授权，请选择同步目标`)
      else if (result.status === 'write-only') toast.error('需要“完整访问权限”才能选择同步目标')
      else if (result.status === 'unavailable') {
        toast.error('系统授权未响应，已打开 macOS 隐私设置，请手动授予完整访问权限')
        await window.electronAPI.openPlanningNativeSyncPrivacySettings(entity)
      } else if (result.status !== 'not-determined') toast.error(permissionMessage(result))
    } catch (error) {
      console.error('[Planning 同步] 请求权限失败:', error)
      toast.error('未能请求系统权限')
    } finally {
      setRequesting(false)
    }
  }

  const saveTarget = async (id: string): Promise<void> => {
    const target = targets.find((item) => item.id === id)
    if (!target) return
    setSaving(true)
    try {
      const saved = await window.electronAPI.savePlanningSyncProfile({ entity, target })
      setProfiles((current) => [...current.filter((item) => item.entity !== entity), saved])
      toast.success(`${COPY[entity].label}同步目标已保存`)
      setOpen(false)
    } catch (error) {
      console.error('[Planning 同步] 保存目标失败:', error)
      toast.error('保存同步目标失败')
    } finally {
      setSaving(false)
    }
  }

  const connectExisting = async (id: string): Promise<void> => {
    const target = connectionTargets.find((item) => item.id === id)
    if (!target) return
    setSaving(true)
    try { await window.electronAPI.connectPlanningNativeConnection({ entity, target }); await refresh(); toast.success(`已连接 ${target.title}`) }
    catch (error) { console.error('[Planning 同步] 连接失败:', error); toast.error('连接系统集合失败') }
    finally { setSaving(false) }
  }
  const disconnect = async (id: string): Promise<void> => {
    setSaving(true)
    try { await window.electronAPI.disconnectPlanningNativeConnection(id); await refresh(); toast.success('已从 Proma 隐藏该系统集合') }
    catch (error) { console.error('[Planning 同步] 断开失败:', error); toast.error('断开系统集合失败') }
    finally { setSaving(false) }
  }

  const resolveConflict = async (id: string, resolution: 'keep_proma' | 'keep_system'): Promise<void> => {
    setSaving(true)
    try { await window.electronAPI.resolvePlanningNativeSyncConflict({ id, resolution }); await refresh(); toast.success(resolution === 'keep_proma' ? '将以 Proma 版本覆盖系统项目' : '已保留系统版本') }
    catch (error) { console.error('[Planning 同步] 解决冲突失败:', error); toast.error('解决同步冲突失败') }
    finally { setSaving(false) }
  }

  const permission = status?.[entity]
  const profile = profiles.find((item) => item.entity === entity)
  const Icon = COPY[entity].icon
  // 避免在非 macOS 上为每个 Todo / 日程增加无效控件；首次打开后也依照真实状态隐藏。
  if (!isMac || (status && !status.supported)) return null

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
        {profile ? <Settings2 className="size-3.5" /> : <Icon className="size-3.5" />}
        {profile ? '同步设置' : `同步到${COPY[entity].label}`}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 space-y-3 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{COPY[entity].label}同步</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">设置 Proma 受管的{COPY[entity].label}；仅同步到你明确选择的一个目标。Calendar 会双向回流，Reminder 保持单向发布。</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">建议先在系统中创建一个名为「Proma」的{entity === 'calendar' ? '日历' : '提醒事项列表'}，再将它设为同步目标，避免与个人项目混杂。</p>
      </div>
      {loading || !permission ? <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在检查授权…</div>
        : permission.status === 'full-access' ? <div className="space-y-2"><Select value={profile?.targetId ?? ''} onValueChange={(id) => void saveTarget(id)} disabled={saving || targets.length === 0}><SelectTrigger className="h-9 text-xs"><SelectValue placeholder={targets.length ? `选择一个 ${COPY[entity].targetLabel}` : '未找到可写目标'} /></SelectTrigger><SelectContent>{targets.map((target) => <SelectItem key={target.id} value={target.id}>{target.sourceTitle ? `${target.sourceTitle} · ` : ''}{target.title}{target.sourceType === 'local' ? ' · 仅此 Mac' : target.isCloudBacked ? ' · 云端账户' : ''}</SelectItem>)}</SelectContent></Select>{profile && <p className="text-[11px] leading-relaxed text-muted-foreground">当前受管目标：{profile.sourceTitle ? `${profile.sourceTitle} · ` : ''}{profile.targetTitle}。</p>}{!profile && <p className="text-[11px] leading-relaxed text-muted-foreground">选择后会开始发布现有 Proma 项目。</p>}
          <div className="border-t pt-2"><p className="mb-1 text-xs font-medium">连接已有系统集合</p><p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground">仅导入你明确选择的集合；在 Proma 修改或删除可写 Calendar / Reminder 项都会回写系统。</p><Select value="" onValueChange={(id) => void connectExisting(id)} disabled={saving || connectionTargets.length === 0}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择要连接的日历或列表" /></SelectTrigger><SelectContent>{connectionTargets.filter((target) => profile?.targetId !== target.id && !connections.some((connection) => connection.targetId === target.id)).map((target) => <SelectItem key={target.id} value={target.id}>{target.sourceTitle ? `${target.sourceTitle} · ` : ''}{target.title}{target.canWrite ? '' : ' · 只读'}</SelectItem>)}</SelectContent></Select>{connections.map((connection) => <div key={connection.id} className="mt-1.5 flex items-center justify-between gap-2 text-[11px]"><span className="truncate text-muted-foreground">{connection.sourceTitle ? `${connection.sourceTitle} · ` : ''}{connection.targetTitle}{connection.canWrite ? '' : ' · 只读'}</span><Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" disabled={saving} onClick={() => void disconnect(connection.id)}>断开</Button></div>)}{conflicts.length > 0 && <div className="mt-2 space-y-1.5 rounded-md border border-amber-300/60 bg-amber-50/50 p-2 text-[11px] dark:bg-amber-950/20"><p className="font-medium text-amber-800 dark:text-amber-200">{conflicts.length} 个同步冲突需要确认</p>{conflicts.map((conflict) => <div key={conflict.id}><p className="truncate text-muted-foreground">{conflict.title}：系统端{conflict.kind === 'deleted' ? '已删除' : '有新修改'}</p><div className="mt-1 flex gap-1"><Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" disabled={saving} onClick={() => void resolveConflict(conflict.id, 'keep_proma')}>保留 Proma</Button><Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" disabled={saving} onClick={() => void resolveConflict(conflict.id, 'keep_system')}>保留系统</Button></div></div>)}</div>}</div></div>
        : <div className="space-y-2.5 rounded-md bg-muted/55 p-2.5"><div className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />{permissionMessage(permission)}</div>{permission.status === 'not-determined' && <Button type="button" size="sm" className="w-full" disabled={requesting} onClick={() => void requestAccess()}>{requesting ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}授权并选择目标</Button>}{(permission.status === 'write-only' || permission.status === 'denied') && <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void window.electronAPI.openPlanningNativeSyncPrivacySettings(entity)}><ExternalLink className="size-3.5" />前往系统设置授予完整访问权限</Button>}</div>}
      {permission?.status === 'full-access' && <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3.5" />已获得完整访问权限</div>}
    </PopoverContent>
  </Popover>
}
