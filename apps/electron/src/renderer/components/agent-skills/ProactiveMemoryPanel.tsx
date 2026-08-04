/**
 * ProactiveMemoryPanel — 主动记忆看板
 *
 * 显示 Proactive Memory 统计、待确认纠正、persona 摘要、记忆搜索。
 * 通过 window.electronAPI 与主进程 memory service 通信。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Brain, Check, Loader2, RefreshCw, Search, Sparkles, X, ShieldAlert } from 'lucide-react'
import type { MemoryAtom, MemoryCorrection, MemorySearchResult, MemoryStats } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/settings/primitives'

interface ProactiveMemoryPanelProps {
  workspaceSlug: string
}

function formatTime(ts?: number): string {
  if (!ts) return '未生成'
  return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatCount(n: number): string {
  return n > 0 ? String(n) : '0'
}

export function ProactiveMemoryPanel({ workspaceSlug }: ProactiveMemoryPanelProps): React.ReactElement {
  const [stats, setStats] = React.useState<MemoryStats | null>(null)
  const [persona, setPersona] = React.useState<string | null>(null)
  const [corrections, setCorrections] = React.useState<MemoryCorrection[]>([])
  const [activeCorrections, setActiveCorrections] = React.useState<MemoryCorrection[]>([])
  const [pendingAtoms, setPendingAtoms] = React.useState<MemoryAtom[]>([])
  const [extractionMode, setExtractionMode] = React.useState<'llm' | 'rule' | 'off'>('llm')
  const [personaInjection, setPersonaInjection] = React.useState(true)
  const [personaDraft, setPersonaDraft] = React.useState('')
  const [editingPersona, setEditingPersona] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResult, setSearchResult] = React.useState<MemorySearchResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [searching, setSearching] = React.useState(false)
  const [showPersona, setShowPersona] = React.useState(false)
  const [personaSrc, setPersonaSrc] = React.useState<Array<{ text: string; sources: string[] }>>([])
  const [personaTraceable, setPersonaTraceable] = React.useState(true)
  const [regenerating, setRegenerating] = React.useState(false)
  const [browseType, setBrowseType] = React.useState<MemoryAtom['type'] | 'all'>('all')
  const [browsePage, setBrowsePage] = React.useState(1)
  const [browseResult, setBrowseResult] = React.useState<{ atoms: MemoryAtom[]; total: number; totalPages: number } | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextStats, nextCorrections, nextPersona, nextPendingAtoms, nextMode, nextInjection, nextActive, nextSrc, nextTraceable] = await Promise.all([
        window.electronAPI.getMemoryStats(),
        window.electronAPI.listMemoryCorrections('pending'),
        window.electronAPI.readMemoryPersona(),
        window.electronAPI.listMemoryPendingAtoms(),
        window.electronAPI.getMemoryExtractionMode(),
        window.electronAPI.getPersonaInjectionEnabled(),
        window.electronAPI.listMemoryCorrections('active'),
        window.electronAPI.readMemoryPersonaSources(),
        window.electronAPI.getPersonaTraceable(),
      ])
      setStats(nextStats)
      setCorrections(nextCorrections)
      setActiveCorrections(nextActive)
      setPersona(nextPersona ?? null)
      setPendingAtoms(nextPendingAtoms)
      setExtractionMode(nextMode)
      setPersonaInjection(nextInjection)
      setPersonaSrc(nextSrc)
      setPersonaTraceable(nextTraceable)
    } catch (error) {
      console.error('[主动记忆] 加载失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleSearch = async (): Promise<void> => {
    const query = searchQuery.trim()
    if (!query) return
    setSearching(true)
    try {
      const result = await window.electronAPI.searchMemory(query, 6)
      setSearchResult(result)
    } catch (error) {
      console.error('[主动记忆] 搜索失败:', error)
      toast.error('搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const handleConfirm = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.confirmMemoryCorrection(id)
      toast.success('纠正已生效并写入记忆')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 确认失败:', error)
      toast.error('操作失败')
    }
  }

  const handleReject = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.rejectMemoryCorrection(id)
      toast.success('已拒绝该纠正')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 拒绝失败:', error)
      toast.error('操作失败')
    }
  }

  const handleUndo = async (id: string): Promise<void> => {
    if (!window.confirm('撤销该纠正将删除对应记忆并从画像中移除，确定？')) return
    try {
      const r = await window.electronAPI.undoMemoryCorrection(id)
      if (!r.ok) {
        toast.error(r.error ?? '撤销失败')
        return
      }
      toast.success('已撤销该纠正')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 撤销失败:', error)
      toast.error('操作失败')
    }
  }

  const handleConfirmAtom = async (id: string): Promise<void> => {
    try {
      await window.electronAPI.confirmMemoryAtom(id)
      toast.success('记忆已确认并进入召回')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 确认记忆失败:', error)
      toast.error('操作失败')
    }
  }

  const handleRejectAtom = async (id: string): Promise<void> => {
    // B2：破坏性操作加确认
    if (!window.confirm('确定删除这条记忆？此操作不可撤销。')) return
    try {
      await window.electronAPI.rejectMemoryAtom(id)
      toast.success('已删除该记忆')
      await refresh()
      // 同步刷新分页浏览列表（改进2：删除后 browse 区需实时更新）
      void loadBrowse(browseType, browsePage)
    } catch (error) {
      console.error('[主动记忆] 删除记忆失败:', error)
      toast.error('操作失败')
    }
  }

  const handleSetMode = async (mode: 'llm' | 'rule' | 'off'): Promise<void> => {
    try {
      const r = await window.electronAPI.setMemoryExtractionMode(mode)
      if (!r.ok) {
        toast.error(r.error ?? '设置失败')
        return
      }
      setExtractionMode(mode)
      if (mode === 'llm') {
        toast.success('已开启 LLM 提取。提示：会话内容将发送至配置的 LLM 提供商用于记忆提取')
      } else if (mode === 'rule') {
        toast.success('已切换到仅规则版提取（零外发，不发任何会话内容）')
      } else {
        toast.success('已关闭自动记忆提取')
      }
    } catch (error) {
      console.error('[主动记忆] 设置提取模式失败:', error)
      toast.error('操作失败')
    }
  }

  const handleDeleteAtom = async (id: string): Promise<void> => {
    // B2：破坏性操作加确认
    if (!window.confirm('确定删除这条记忆？此操作不可撤销。')) return
    try {
      const ok = await window.electronAPI.rejectMemoryAtom(id)
      if (ok) toast.success('已删除该记忆')
      else toast.error('删除失败')
      await refresh()
      // 同步刷新分页浏览列表；若当前页因删除而越界则回退一页
      void loadBrowse(browseType, Math.max(1, browsePage - (browseResult && browsePage > 1 && browseResult.atoms.length === 1 ? 1 : 0)))
    } catch (error) {
      console.error('[主动记忆] 删除失败:', error)
      toast.error('操作失败')
    }
  }

  const handleClearAll = async (): Promise<void> => {
    if (!window.confirm('确定清空全部主动记忆（含画像与纠正）？此操作不可撤销。')) return
    try {
      const r = await window.electronAPI.clearAllMemory()
      if (r.ok) toast.success('已清空全部记忆')
      else toast.error(r.error ?? '清空失败')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 清空失败:', error)
      toast.error('操作失败')
    }
  }

  const handleTogglePersonaInjection = async (): Promise<void> => {
    try {
      const next = !personaInjection
      const r = await window.electronAPI.setPersonaInjectionEnabled(next)
      if (!r.ok) {
        toast.error(r.error ?? '操作失败')
        return
      }
      setPersonaInjection(next)
      toast.success(next ? '已开启画像注入' : '已关闭画像注入（不再随系统提示发送画像）')
    } catch (error) {
      console.error('[主动记忆] 切换画像注入失败:', error)
      toast.error('操作失败')
    }
  }

  const handleStartEditPersona = (): void => {
    setPersonaDraft(persona ?? '')
    setEditingPersona(true)
  }

  const handleSavePersona = async (): Promise<void> => {
    try {
      const r = await window.electronAPI.updateMemoryPersona(personaDraft)
      if (!r.ok) {
        toast.error(r.error ?? '保存失败')
        return
      }
      setEditingPersona(false)
      toast.success('画像已更新')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 保存画像失败:', error)
      toast.error('操作失败')
    }
  }

  const handleDeletePersona = async (): Promise<void> => {
    if (!window.confirm('确定删除用户画像？下次会话将重新生成。')) return
    try {
      const r = await window.electronAPI.deleteMemoryPersona()
      if (!r.ok) {
        toast.error(r.error ?? '删除失败')
        return
      }
      toast.success('画像已删除')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 删除画像失败:', error)
      toast.error('操作失败')
    }
  }

  /** B3：手动重新生成画像（让旧数据获得 src 溯源标注） */
  const handleRegeneratePersona = async (): Promise<void> => {
    if (!window.confirm('重新生成用户画像？将根据当前记忆重新构建（含来源标注）。')) return
    setRegenerating(true)
    try {
      const r = await window.electronAPI.regeneratePersona()
      if (!r.ok) {
        toast.error(r.error ?? '生成失败')
        return
      }
      toast.success('画像已重新生成（含来源标注）')
      await refresh()
    } catch (error) {
      console.error('[主动记忆] 重生成画像失败:', error)
      toast.error('操作失败')
    } finally {
      setRegenerating(false)
    }
  }

  /** 画像溯源：用画像条目文本搜索对应记忆 */
  const handleTracePersona = async (sources: string[], fallbackText: string): Promise<void> => {
    try {
      // 优先用源 atom 的 content 片段搜索；取第一条源文本前 12 字作为关键词
      const keyword = (fallbackText || '').replace(/（src:.*）$/, '').trim().slice(0, 12)
      if (!keyword) return
      setSearchQuery(keyword)
      setSearching(true)
      const result = await window.electronAPI.searchMemory(keyword, 6)
      setSearchResult(result)
      if (result.hits.length === 0) toast.info('未找到该画像条目对应的记忆')
      else toast.success(`找到 ${result.hits.length} 条相关记忆`)
    } catch (error) {
      console.error('[主动记忆] 溯源失败:', error)
      toast.error('溯源失败')
    } finally {
      setSearching(false)
    }
  }

  /** 加载分页浏览列表 */
  const loadBrowse = React.useCallback(async (type: MemoryAtom['type'] | 'all', page: number): Promise<void> => {
    try {
      const r = await window.electronAPI.listMemoryAtoms({ type, page, pageSize: 20, sort: 'newest' })
      setBrowseResult({ atoms: r.atoms, total: r.total, totalPages: r.totalPages })
    } catch (error) {
      console.error('[主动记忆] 浏览加载失败:', error)
    }
  }, [])

  const handleBrowseType = (type: MemoryAtom['type'] | 'all'): void => {
    setBrowseType(type)
    setBrowsePage(1)
    void loadBrowse(type, 1)
  }

  React.useEffect(() => {
    void loadBrowse('all', 1)
  }, [loadBrowse])

  const byType = stats?.byType ?? { fact: 0, preference: 0, correction: 0, sop: 0, todo_context: 0 }

  return (
    <SettingsCard divided={false}>
      <div className="flex flex-col gap-4 p-4">
        {/* 标题 + 刷新 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-primary" />
            <div>
              <div className="text-sm font-medium text-foreground">主动记忆（Proactive Memory）</div>
              <div className="text-xs text-muted-foreground">会话自动提取 · 跨会话自动回忆 · 用户画像</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {loading ? '加载中' : '刷新'}
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border/50 bg-content-area p-3">
              <div className="text-xl font-semibold tabular-nums text-foreground">{formatCount(stats.atomCount)}</div>
              <div className="text-[11px] text-muted-foreground">记忆总数</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-content-area p-3">
              <div className="text-xl font-semibold tabular-nums text-foreground">{formatCount(byType.preference + byType.fact)}</div>
              <div className="text-[11px] text-muted-foreground">事实+偏好</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-content-area p-3">
              <div className="text-xl font-semibold tabular-nums text-foreground">{formatCount(stats.pendingCorrections + stats.pendingAtoms)}</div>
              <div className="text-[11px] text-muted-foreground">待确认</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-content-area p-3">
              <div className="text-xl font-semibold tabular-nums text-foreground">{stats.personaExists ? '✓' : '—'}</div>
              <div className="text-[11px] text-muted-foreground">用户画像</div>
            </div>
          </div>
        )}

        {/* 数据控制 */}
        {stats && stats.atomCount > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-content-area px-3 py-2">
            <div className="text-[11px] text-muted-foreground">数据控制</div>
            <button
              type="button"
              onClick={() => void handleClearAll()}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-red-500 transition-colors hover:bg-red-500/10"
            >
              <X size={11} /> 清空全部记忆
            </button>
          </div>
        )}

        {/* 提取模式（外发披露） */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-content-area p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
            <ShieldAlert size={13} className="text-amber-500" />
            记忆提取方式
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>选择会话内容如何被用于记忆提取：</span>
            <span className="font-medium text-amber-600">「LLM 提取」会把最近对话发送至外部 LLM 提供商</span>
          </div>
          <div className="flex gap-1.5 pt-0.5">
            {([
              ['llm', 'LLM 提取（外发）'],
              ['rule', '仅规则版（零外发）'],
              ['off', '关闭'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => void handleSetMode(mode)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                  extractionMode === mode
                    ? 'border-primary/50 bg-primary/10 font-medium text-primary'
                    : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.04]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 待确认的记忆（自动提取，需用户确认才注入） */}
        {pendingAtoms.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-foreground/75">待确认的自动提取记忆</div>
              <div className="text-[10px] text-muted-foreground">确认后才参与跨会话回忆</div>
            </div>
            {pendingAtoms.slice(0, 10).map((atom) => (
              <div key={atom.id} className="flex items-start justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                      {atom.type}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{formatTime(atom.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-[13px] leading-snug text-foreground/90">{atom.content}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleConfirmAtom(atom.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10"
                    title="确认生效"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRejectAtom(atom.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
                    title="拒绝并删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 待确认纠正 */}
        {corrections.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground/75">待确认的行为纠正</div>
            {corrections.slice(0, 5).map((correction) => (
              <div key={correction.id} className="flex items-start justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground/90">{correction.rule}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    提出于 {formatTime(correction.createdAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleConfirm(correction.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10"
                    title="确认生效"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReject(correction.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
                    title="拒绝"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 已生效纠正（可撤销） */}
        {activeCorrections.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-foreground/75">已生效的行为纠正</div>
            {activeCorrections.slice(0, 5).map((correction) => (
              <div key={correction.id} className="flex items-start justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground/90">{correction.rule}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    生效于 {formatTime(correction.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleUndo(correction.id)}
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-red-500 transition-colors hover:bg-red-500/10"
                  title="撤销该纠正（删除记忆并从画像移除）"
                >
                  <X size={12} /> 撤销
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 全部记忆浏览（分页） */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-foreground/75">全部记忆</div>
            {browseResult && (
              <div className="text-[10px] text-muted-foreground">
                共 {browseResult.total} 条 · 第 {browsePage}/{browseResult.totalPages} 页
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', 'fact', 'preference', 'correction', 'sop', 'todo_context', 'event'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleBrowseType(t)}
                className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${
                  browseType === t
                    ? 'border-primary/50 bg-primary/10 font-medium text-primary'
                    : 'border-border/60 text-muted-foreground hover:bg-foreground/[0.04]'
                }`}
              >
                {{ all: '全部', fact: '事实', preference: '偏好', correction: '纠正', sop: '流程', todo_context: '任务', event: '事件' }[t]}
              </button>
            ))}
          </div>
          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto scrollbar-thin">
            {!browseResult || browseResult.atoms.length === 0 ? (
              <div className="text-xs text-muted-foreground">暂无记忆。</div>
            ) : (
              browseResult.atoms.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/40 bg-content-area px-3 py-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{a.type}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(a.createdAt).toISOString().slice(0, 10)}</span>
                      {!a.confirmed && <span className="text-[10px] text-amber-500">待确认</span>}
                    </div>
                    <div className="mt-0.5 text-[12px] leading-snug text-foreground/85">{a.content}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAtom(a.id)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                    title="删除这条记忆"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
          {browseResult && browseResult.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={browsePage <= 1} onClick={() => { const p = Math.max(1, browsePage - 1); setBrowsePage(p); void loadBrowse(browseType, p) }}>
                上一页
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={browsePage >= browseResult.totalPages} onClick={() => { const p = browsePage + 1; setBrowsePage(p); void loadBrowse(browseType, p) }}>
                下一页
              </Button>
            </div>
          )}
        </div>

        {/* 记忆搜索 */}
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/75">搜索记忆</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
              placeholder="输入关键词，如：技术栈 / 偏好 / 项目"
              className="h-9 flex-1 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <Button size="sm" onClick={() => void handleSearch()} disabled={searching || !searchQuery.trim()}>
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              <span className="ml-1">搜索</span>
            </Button>
          </div>
          {searchResult && (
            <div className="flex flex-col gap-1.5">
              {searchResult.hits.length === 0 ? (
                <div className="text-xs text-muted-foreground">未找到相关记忆。</div>
              ) : (
                searchResult.hits.map((hit) => (
                  <div key={hit.atom.id} className="rounded-lg border border-border/40 bg-content-area px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {hit.atom.type}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(hit.atom.createdAt).toISOString().slice(0, 10)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        rel={hit.score >= 0.6 ? 'high' : hit.score >= 0.3 ? 'mid' : 'low'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAtom(hit.atom.id)}
                        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                        title="删除这条记忆"
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <div className="mt-1 text-[13px] leading-snug text-foreground/85">{hit.atom.content}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Persona 摘要 */}
        {persona && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowPersona((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-foreground/75"
              >
                <Sparkles size={12} />
                用户画像（{showPersona ? '收起' : '展开'}）· 更新于 {formatTime(stats?.lastExtractionAt)}
                {persona && !personaTraceable && (
                  <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-600">旧版·可重新生成</span>
                )}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTogglePersonaInjection()}
                  className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors ${
                    personaInjection
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                      : 'border-border/60 text-muted-foreground'
                  }`}
                  title="是否把画像随系统提示发送给 LLM"
                >
                  画像注入：{personaInjection ? '开' : '关'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleStartEditPersona()}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void handleRegeneratePersona()}
                  disabled={regenerating}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                >
                  {regenerating ? '生成中…' : '重新生成'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeletePersona()}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-red-500"
                >
                  删除
                </button>
              </div>
            </div>
            {editingPersona ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={personaDraft}
                  onChange={(e) => setPersonaDraft(e.target.value)}
                  rows={8}
                  className="h-40 w-full rounded-lg border border-border/60 bg-content-area p-3 text-[12px] leading-relaxed text-foreground/85 outline-none scrollbar-thin focus:border-primary/50"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingPersona(false)}>取消</Button>
                  <Button size="sm" onClick={() => void handleSavePersona()}>保存</Button>
                </div>
              </div>
            ) : (
              showPersona && (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border/40 bg-content-area p-3 scrollbar-thin">
                  {/* 溯源条目（有 src 标注的画像条目） */}
                  {personaSrc.length > 0 && (
                    <div className="mb-2 flex flex-col gap-1">
                      <div className="text-[10px] text-muted-foreground">画像条目（点击溯源到记忆）</div>
                      {personaSrc.slice(0, 8).map((entry, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => void handleTracePersona(entry.sources, entry.text)}
                          className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-foreground/85 transition-colors hover:bg-primary/10"
                          title={`溯源到 ${entry.sources.length > 0 ? entry.sources.join(', ') : '未知来源'}`}
                        >
                          <span className="mt-0.5 shrink-0 text-[10px] text-primary">🔗</span>
                          <span className="min-w-0 flex-1">
                            {entry.text}
                            {entry.sources.length > 0 && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                （{entry.sources.length} 条来源）
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/80">{persona}</pre>
                </div>
              )
            )}
          </div>
        )}

        {!stats && !loading && (
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            暂无主动记忆。与 Agent 对话后，它会自动提取你的偏好与项目信息。
          </div>
        )}
      </div>
    </SettingsCard>
  )
}

export default ProactiveMemoryPanel
