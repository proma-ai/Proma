/**
 * ProactiveTodayView — Proactive Center 的 Today 首页
 *
 * 回答三个问题：
 * 1. Proma 今天主动做了什么？（Active 主动任务 + Insights 洞察）
 * 2. Proma 建议我开启什么？（Recommended 建议卡）
 * 3. 有哪些事项需要我确认？（Needs approval 审批）
 *
 * 对应蓝图 §5.1 Today 首页设计。数据源聚合：
 * - suggestions（主动建议引擎）→ Recommended + 反馈统计
 * - automations（定时任务）→ Active 主动任务
 * - memory（主动记忆）→ Needs approval（pending corrections）+ Insights
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Bot, Brain, Check, Clock, RefreshCw, Sparkles, X, Wand2 } from 'lucide-react'
import type { Automation, MemoryAtom, MemoryCorrection, MemoryStats, SceneBlock, SuggestionRecord, SuggestionStats } from '@proma/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { activeViewAtom, agentSkillsTabAtom } from '@/atoms/active-view'
import { suggestionActionLabel, useSuggestionAction } from '@/components/planning/useSuggestionAction'

interface ProactiveTodayViewProps {
  standalone?: boolean
}

/** 建议类型 → 展示标签 */
const SUGGESTION_KIND_LABEL: Record<string, string> = {
  correction: '记住纠正',
  followup: '跟进提醒',
  automation: '定时任务',
  skill: 'Skill 沉淀',
  todo: '待办记录',
}

/** 建议类型展示顺序（与主进程 groupSuggestionsByKind 一致） */
const SUGGESTION_KIND_ORDER: SuggestionRecord['kind'][] = ['correction', 'followup', 'automation', 'skill', 'todo']

/** 按类型分组待展示建议（多候选 pred@k：给用户选择权，而非单一打断） */
function groupSuggestionsByKind(records: SuggestionRecord[]): Array<{ kind: SuggestionRecord['kind']; items: SuggestionRecord[] }> {
  const groups = new Map<SuggestionRecord['kind'], SuggestionRecord[]>()
  for (const r of records) {
    const list = groups.get(r.kind) ?? []
    list.push(r)
    groups.set(r.kind, list)
  }
  const result: Array<{ kind: SuggestionRecord['kind']; items: SuggestionRecord[] }> = []
  for (const kind of SUGGESTION_KIND_ORDER) {
    const items = groups.get(kind)
    if (items && items.length > 0) result.push({ kind, items })
  }
  return result
}

/** 调度类型 → 可读文案 */
function formatSchedule(a: Automation): string {
  if (a.scheduleType === 'once') {
    return a.scheduledAt
      ? `仅一次 ${new Date(a.scheduledAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : '仅一次'
  }
  if (a.scheduleType === 'daily') return `每天 ${a.timeOfDay ?? '09:00'}`
  if (a.scheduleType === 'weekly') {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `每${names[a.dayOfWeek ?? 1]} ${a.timeOfDay ?? '09:00'}`
  }
  if (a.scheduleType === 'monthly') return `每月 ${a.dayOfMonth ?? 1} 号 ${a.timeOfDay ?? '09:00'}`
  const min = a.intervalMinutes ?? 60
  return min < 60 ? `每 ${min} 分钟` : min < 1440 ? `每 ${min / 60} 小时` : `每 ${min / 1440} 天`
}

export function ProactiveTodayView({ standalone }: ProactiveTodayViewProps): React.ReactElement {
  const [suggestions, setSuggestions] = React.useState<SuggestionRecord[]>([])
  const [stats, setStats] = React.useState<SuggestionStats | null>(null)
  const [automations, setAutomations] = React.useState<Automation[]>([])
  const [memoryStats, setMemoryStats] = React.useState<MemoryStats | null>(null)
  const [pendingCorrections, setPendingCorrections] = React.useState<MemoryCorrection[]>([])
  const [pendingAtoms, setPendingAtoms] = React.useState<MemoryAtom[]>([])
  const [dnd, setDnd] = React.useState<{ enabled: boolean; startMin: number; endMin: number }>({ enabled: false, startMin: 1350, endMin: 480 })
  const [loading, setLoading] = React.useState(true)
  const [analyzing, setAnalyzing] = React.useState(false)
  const [recentAtoms, setRecentAtoms] = React.useState<MemoryAtom[]>([])
  const [hotScenes, setHotScenes] = React.useState<SceneBlock[]>([])
  const [analysisState, setAnalysisState] = React.useState<{ status: 'idle' | 'running' | 'succeeded' | 'empty' | 'unavailable' | 'failed'; startedAt?: number; completedAt?: number; added?: number; message?: string }>({ status: 'idle' })
  const setActiveView = useSetAtom(activeViewAtom)
  const setAgentSkillsTab = useSetAtom(agentSkillsTabAtom)
  const executeSuggestionAction = useSuggestionAction(standalone)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [sug, sugStats, auto, mem, corrections, atoms, dndCfg, recent, scenes, analysis] = await Promise.all([
        window.electronAPI.listSuggestions('suggested'),
        window.electronAPI.getSuggestionStats(),
        window.electronAPI.listAutomations(),
        window.electronAPI.getMemoryStats(),
        window.electronAPI.listMemoryCorrections('pending'),
        window.electronAPI.listMemoryPendingAtoms(),
        window.electronAPI.getSuggestionDnd(),
        window.electronAPI.listMemoryAtoms({ page: 1, pageSize: 3, sort: 'newest', confirmed: true }),
        window.electronAPI.getMemoryHotScenes(),
        window.electronAPI.getSuggestionAnalysisState(),
      ])
      setSuggestions(sug)
      setStats(sugStats)
      setAutomations(auto.filter((a) => a.active))
      setMemoryStats(mem)
      setPendingCorrections(corrections)
      setPendingAtoms(atoms)
      setDnd(dndCfg)
      setRecentAtoms(recent.atoms)
      setHotScenes(scenes)
      setAnalysisState(analysis)
    } catch (error) {
      console.error('[Proactive Today] 加载失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSuggestionFeedback = async (id: string, feedback: 'accepted' | 'ignored' | 'never'): Promise<void> => {
    try {
      const result = await window.electronAPI.actOnSuggestion(id, feedback)
      if (!result.ok) {
        toast.error(result.error ?? '操作失败')
        return
      }
      const labels: Record<string, string> = {
        accepted: '已接受建议',
        ignored: '已忽略，同类建议会减少',
        never: '已屏蔽这类建议',
      }
      toast.success(labels[feedback])
      await refresh()
    } catch (error) {
      console.warn('[Proactive Today] 反馈失败:', error)
      toast.error('操作失败')
    }
  }

  const handleSuggestionAccept = async (suggestion: SuggestionRecord): Promise<void> => {
    const actionResult = await executeSuggestionAction(suggestion)
    if (actionResult === 'failed') {
      toast.error('无法打开建议的下一步，请检查当前 Agent 配置')
      return
    }
    if (actionResult === 'handoff') {
      toast.info('已打开主窗口，请在那里完成此建议')
      return
    }
    await handleSuggestionFeedback(suggestion.id, 'accepted')
  }

  const handleDeleteSuggestion = async (id: string): Promise<void> => {
    try {
      const result = await window.electronAPI.deleteSuggestion(id)
      if (!result.ok) {
        toast.error(result.error ?? '删除失败')
        return
      }
      toast.success('已删除该建议')
      await refresh()
    } catch (error) {
      console.warn('[Proactive Today] 删除失败:', error)
      toast.error('操作失败')
    }
  }

  const handleRunAnalysis = async (): Promise<void> => {
    if (analyzing) return
    setAnalyzing(true)
    setAnalysisState((prev) => ({ ...prev, status: 'running', startedAt: Date.now() }))
    try {
      const result = await window.electronAPI.runSuggestionAnalysis()
      if (!result.ok) {
        toast.error(result.error ?? '分析失败')
      } else if (result.added > 0) {
        toast.success(`分析完成，发现 ${result.added} 条可沉淀的工作模式`)
      } else {
        toast.info('分析完成，暂未发现新的可沉淀模式')
      }
      await refresh()
    } catch (error) {
      console.warn('[Proactive Today] 分析失败:', error)
      setAnalysisState({ status: 'failed', completedAt: Date.now(), message: '分析服务暂时不可用，请稍后重试' })
      toast.error('分析服务暂时不可用，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleCorrection = async (id: string, action: 'confirm' | 'reject'): Promise<void> => {
    try {
      if (action === 'confirm') {
        await window.electronAPI.confirmMemoryCorrection(id)
        toast.success('纠正已生效，并已更新用户画像')
      } else {
        await window.electronAPI.rejectMemoryCorrection(id)
        toast.success('已拒绝该纠正')
      }
      await refresh()
    } catch (error) {
      console.warn('[Proactive Today] 纠正处理失败:', error)
      toast.error('操作失败')
    }
  }

  const handleAtom = async (id: string, action: 'confirm' | 'reject'): Promise<void> => {
    try {
      if (action === 'confirm') {
        await window.electronAPI.confirmMemoryAtom(id)
        toast.success('记忆已确认，将参与跨会话回忆')
      } else {
        await window.electronAPI.rejectMemoryAtom(id)
        toast.success('已删除该记忆')
      }
      await refresh()
    } catch (error) {
      console.warn('[Proactive Today] 记忆处理失败:', error)
      toast.error('操作失败')
    }
  }

  const handleDndToggle = async (enabled: boolean): Promise<void> => {
    try {
      const result = await window.electronAPI.setSuggestionDnd({ enabled })
      if (!result.ok) {
        toast.error(result.error ?? '更新失败')
        return
      }
      setDnd((prev) => ({ ...prev, enabled }))
      toast.success(enabled ? '免打扰时段已开启（该时段内不弹建议）' : '免打扰时段已关闭')
    } catch (error) {
      console.warn('[Proactive Today] DND 更新失败:', error)
      toast.error('操作失败')
    }
  }

  const handleDndTimeChange = async (field: 'startMin' | 'endMin', value: string): Promise<void> => {
    const minute = parseTimeInput(value)
    if (minute === null) return
    try {
      const result = await window.electronAPI.setSuggestionDnd({ [field]: minute })
      if (!result.ok) {
        toast.error(result.error ?? '更新失败')
        return
      }
      setDnd((prev) => ({ ...prev, [field]: minute }))
    } catch (error) {
      console.warn('[Proactive Today] DND 时间更新失败:', error)
      toast.error('更新失败')
    }
  }

  const openMemoryBoard = (): void => {
    if (standalone) {
      void window.electronAPI.agentIsland.openMainWindow()
        .then(() => toast.info('已打开主窗口，可在 Agent/Memory 中继续查看'))
        .catch(() => toast.error('打开主窗口失败'))
      return
    }
    setActiveView('agent-skills')
    setAgentSkillsTab('memory')
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <RefreshCw className="size-4 animate-spin mr-2" /> 加载中…
      </div>
    )
  }

  const activeCount = automations.length
  const memoryCount = memoryStats?.atomCount ?? 0
  const personaExists = memoryStats?.personaExists ?? false
  const todayAccepted = stats?.todayAccepted ?? 0
  const todayIgnored = stats?.todayIgnored ?? 0

  return (
    <div className={cn('flex h-full flex-col gap-5 overflow-y-auto', standalone ? '' : 'pb-8')}>
      {/* 顶部：今日概览 */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">主动中心</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeCount > 0 || memoryCount > 0
              ? `Proma 正在主动关注 ${activeCount} 件事，另有 ${suggestions.length} 条建议待你决定`
              : 'Proma 还没有主动任务。使用对话时，Proma 会在合适的时机给出建议。'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          onClick={handleRunAnalysis}
          disabled={analyzing}
          title="分析近期记忆与工作模式，发现值得沉淀/自动化的规律"
        >
          <Wand2 className="size-3.5" />
          {analyzing ? '分析中…' : '分析工作模式'}
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Clock className="size-4" />} label="主动任务" value={String(activeCount)} />
        <StatCard icon={<Sparkles className="size-4" />} label="待定建议" value={String(suggestions.length)} />
        <StatCard icon={<Brain className="size-4" />} label="长期记忆" value={String(memoryCount)} />
        <StatCard icon={<Check className="size-4" />} label="今日采纳" value={`${todayAccepted} 采纳 / ${todayIgnored} 忽略`} />
      </div>

      {analysisState.status !== 'idle' && (
        <AnalysisStatus state={analysisState} />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <SectionTitle title="最近学到的内容" count={recentAtoms.length} />
          {recentAtoms.length === 0 ? (
            <EmptyHint text="尚未沉淀已确认记忆。完成几次对话后，Proma 会把稳定信息放在这里供你确认。" />
          ) : (
            <div className="space-y-2">
              {recentAtoms.map((atom) => (
                <button key={atom.id} type="button" onClick={openMemoryBoard} className="w-full rounded-lg border border-border/60 bg-card p-3 text-left transition-colors hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">{atom.type}</span>
                    <span className="text-[11px] text-muted-foreground">{formatRelativeDate(atom.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-foreground">{atom.content}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle title="当前关注" count={hotScenes.length} />
          {hotScenes.length === 0 ? (
            <EmptyHint text="暂未形成近期热点场景。持续对话后，Proma 会在这里聚合你正在推进的主题。" />
          ) : (
            <div className="space-y-2">
              {hotScenes.map((scene) => (
                <button key={scene.id} type="button" onClick={openMemoryBoard} className="w-full rounded-lg border border-border/60 bg-card p-3 text-left transition-colors hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground">{scene.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">热度 {scene.heat}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">关联 {scene.atomIds.length} 条已确认记忆</p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 推荐区：建议引擎生成的待展示建议（按类型分组 = 多候选 pred@k） */}
      <section>
        <SectionTitle title="Proma 建议" count={suggestions.length} />
        {suggestions.length === 0 ? (
          <EmptyHint text="暂无待处理建议。会话中出现纠正、跟进或重复行为时，Proma 会在这里生成建议。" />
        ) : (
          <div className="space-y-3">
            {groupSuggestionsByKind(suggestions).map((group) => (
              <div key={group.kind} className="rounded-xl border border-border/40 bg-background/40 p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-primary" />
                  <h4 className="text-xs font-medium text-foreground">{SUGGESTION_KIND_LABEL[group.kind] ?? group.kind}</h4>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{group.items.length}</span>
                </div>
                <div className="mt-2 space-y-2">
                  {group.items.map((s) => (
                    <div key={s.id} className="rounded-xl border border-border/60 bg-card p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {s.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => void handleSuggestionFeedback(s.id, 'never')}
                          >
                            不再建议这类
                          </button>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                            title="删除这条建议"
                            onClick={() => void handleDeleteSuggestion(s.id)}
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-foreground">{s.reason}</p>
                      {s.evidence && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground/80 border-l-2 border-border pl-2">
                          依据：{s.evidence}
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => void handleSuggestionFeedback(s.id, 'ignored')}>
                          忽略
                        </Button>
                        <Button variant="default" size="sm" className="h-7 px-3 text-xs" onClick={() => void handleSuggestionAccept(s)}>
                          <Check className="size-3 mr-1" /> {suggestionActionLabel(s, standalone)}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 免打扰时段（DND）：该时段内不弹建议（Proactive Today 列表不受影响） */}
      <section className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">免打扰时段</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dnd.enabled}
            onClick={() => void handleDndToggle(!dnd.enabled)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
              dnd.enabled ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              className={cn(
                'inline-block size-4 transform rounded-full bg-background shadow transition-transform',
                dnd.enabled ? 'translate-x-[18px]' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">开始
            <input type="time" value={formatMinute(dnd.startMin)} onChange={(event) => void handleDndTimeChange('startMin', event.target.value)} className="h-7 rounded border border-border bg-background px-1.5 text-xs text-foreground" />
          </label>
          <label className="flex items-center gap-1.5">结束
            <input type="time" value={formatMinute(dnd.endMin)} onChange={(event) => void handleDndTimeChange('endMin', event.target.value)} className="h-7 rounded border border-border bg-background px-1.5 text-xs text-foreground" />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {dnd.enabled
            ? `已开启：${formatMinute(dnd.startMin)}–${formatMinute(dnd.endMin)} 内不会在会话中弹建议（主动中心列表照常）。`
            : '默认关闭。可先调整时段，再开启免打扰。'}
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 主动任务：启用中的定时任务 + 记忆状态 */}
        <section>
          <SectionTitle title="正在关注" count={activeCount} />
          {activeCount === 0 ? (
            <EmptyHint text="没有启用的主动任务。可以在「定时任务」页创建。" />
          ) : (
            <div className="space-y-2">
              {automations.map((a) => (
                <div key={a.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{a.name}</span>
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{formatSchedule(a)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.prompt}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 待确认：pending atoms + pending corrections + persona 状态 */}
        <section>
          <SectionTitle title="需要确认" count={pendingAtoms.length + pendingCorrections.length} />
          {pendingAtoms.length === 0 && pendingCorrections.length === 0 ? (
            <EmptyHint text="没有待确认的记忆或行为纠正。" />
          ) : (
            <div className="space-y-2">
              {pendingAtoms.map((a) => (
                <div key={a.id} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">{a.type}</span>
                    <span className="text-[11px] text-muted-foreground">自动提取 · 待确认</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{a.content}</p>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => void handleAtom(a.id, 'reject')}>
                      <X className="size-3 mr-1" /> 删除
                    </Button>
                    <Button variant="default" size="sm" className="h-7 px-3 text-xs" onClick={() => void handleAtom(a.id, 'confirm')}>
                      <Check className="size-3 mr-1" /> 确认
                    </Button>
                  </div>
                </div>
              ))}
              {pendingCorrections.map((c) => (
                <div key={c.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <p className="text-sm text-foreground">{c.rule}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{c.raw}</p>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => void handleCorrection(c.id, 'reject')}>
                      <X className="size-3 mr-1" /> 拒绝
                    </Button>
                    <Button variant="default" size="sm" className="h-7 px-3 text-xs" onClick={() => void handleCorrection(c.id, 'confirm')}>
                      <Check className="size-3 mr-1" /> 确认
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Persona 状态 */}
          <button type="button" onClick={openMemoryBoard} className="mt-3 w-full rounded-xl border border-border/60 bg-card p-3 text-left transition-colors hover:bg-muted/40">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-primary" />
              <span className="text-sm font-medium text-foreground">用户画像</span>
              <span className={cn('rounded-md px-2 py-0.5 text-[11px]', personaExists ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                {personaExists ? '已生成' : '未生成'}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {personaExists
                ? '查看画像、来源证据与注入开关。'
                : '随着对话积累，Proma 会自动生成你的画像，让长期协作更顺畅。'}
            </p>
          </button>
        </section>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function SectionTitle({ title, count }: { title: string; count: number }): React.ReactElement {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    </div>
  )
}

function EmptyHint({ text }: { text: string }): React.ReactElement {
  return <p className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">{text}</p>
}

function AnalysisStatus({ state }: { state: { status: 'idle' | 'running' | 'succeeded' | 'empty' | 'unavailable' | 'failed'; startedAt?: number; completedAt?: number; added?: number; message?: string } }): React.ReactElement {
  const label = state.status === 'running'
    ? '正在分析近期记忆与工作模式…'
    : state.status === 'succeeded'
      ? `上次分析发现 ${state.added ?? 0} 条建议`
      : state.status === 'empty'
        ? '上次分析未发现新的可沉淀模式'
        : state.status === 'unavailable'
          ? '工作模式分析暂不可用'
          : '工作模式分析未完成'
  const tone = state.status === 'failed' || state.status === 'unavailable' ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-border/60 bg-card'
  const time = state.completedAt ?? state.startedAt
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <p className="font-medium text-foreground">{label}</p>
      {state.message && <p className="mt-0.5 text-muted-foreground">{state.message}</p>}
      {time && <p className="mt-0.5 text-muted-foreground">{formatRelativeDate(time)}</p>}
    </div>
  )
}

function formatRelativeDate(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function parseTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** 分钟数（0-1439）→ "HH:MM" */
function formatMinute(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
