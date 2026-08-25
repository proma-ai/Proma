import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, Brain, ChevronDown, ChevronRight, Code2, Eye, FileText, FolderOpen, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'
import type { SkillFileNode, WorkspaceMemorySummary } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsCard } from '@/components/settings/primitives'
import { DefaultAppOpenButton } from '@/components/diff/DefaultAppOpenButton'
import { AgentActionHint } from '@/components/agent/AgentActionHint'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MessageResponse } from '@/components/ai-elements/message'
import { agentPendingPromptAtom } from '@/atoms/agent-atoms'
import { memoryFileNavigationAtom, workspaceMemoryChangesAtom } from '@/atoms/memory-change-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'
import { cn } from '@/lib/utils'
import {
  buildWorkspaceKnowledgeBootstrapPrompt,
  buildWorkspaceSessionEvidencePrompt,
  MEMORY_HISTORY_RANGE_OPTIONS,
  type MemoryHistoryRange,
} from './workspaceMemoryInitPrompt'

type SelectedMemoryFile =
  | { kind: 'agents'; relativePath: 'AGENTS.md'; title: string; absolutePath: string }
  | { kind: 'auto'; relativePath: string; title: string; absolutePath: string }

interface WorkspaceMemoryTabProps {
  workspaceSlug: string
  /** 能力中心传入的统一搜索词；嵌入组件未传时提供自己的内容搜索。 */
  search?: string
  embedded?: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function autoMemoryPath(summary: WorkspaceMemorySummary, relativePath: string): string {
  const directory = summary.autoMemory.directory
  // directory 由主进程 join() 生成，Windows 上使用反斜杠；沿用其分隔符风格，
  // 并把 relativePath 里的正斜杠归一化，避免拼出 C:\...\memory/MEMORY.md 这类混合路径。
  const sep = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[\\/]/g, sep)
  const trimmedDir = directory.replace(/[\\/]+$/, '')
  return `${trimmedDir}${sep}${normalizedRelative}`
}

/** 取绝对路径的父目录，兼容 / 与 \ 两种分隔符 */
function dirnameOf(absolutePath: string): string {
  const idx = Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\'))
  return idx < 0 ? absolutePath : absolutePath.slice(0, idx)
}

function filterNodes(nodes: SkillFileNode[], query: string, contentMatchPaths = new Set<string>()): SkillFileNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const result: SkillFileNode[] = []
  for (const node of nodes) {
    const children = node.children ? filterNodes(node.children, query, contentMatchPaths) : undefined
    const selfMatch =
      node.name.toLowerCase().includes(q) ||
      node.relativePath.toLowerCase().includes(q) ||
      contentMatchPaths.has(node.relativePath)
    if (selfMatch || (children && children.length > 0)) {
      result.push({ ...node, children })
    }
  }
  return result
}

export function WorkspaceMemoryTab({ workspaceSlug, search, embedded = false }: WorkspaceMemoryTabProps): React.ReactElement {
  const { createAgent } = useCreateSession()
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const [memoryNavigationRequest, setMemoryNavigationRequest] = useAtom(memoryFileNavigationAtom)
  const workspaceMemoryChanges = useAtomValue(workspaceMemoryChangesAtom)
  const latestMemoryChange = workspaceMemoryChanges.get(workspaceSlug)?.[0]
  const [summary, setSummary] = React.useState<WorkspaceMemorySummary | null>(null)
  const [autoFiles, setAutoFiles] = React.useState<SkillFileNode[]>([])
  const [selected, setSelected] = React.useState<SelectedMemoryFile | null>(null)
  const [editText, setEditText] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [loadingFile, setLoadingFile] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [isDirty, setIsDirty] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<'preview' | 'edit'>('preview')
  const [bootstrapping, setBootstrapping] = React.useState(false)
  const [scanningHistory, setScanningHistory] = React.useState(false)
  const [historyRange, setHistoryRange] = React.useState<MemoryHistoryRange>('1m')
  const [contentMatches, setContentMatches] = React.useState<Map<string, string>>(new Map())
  // 右侧项目记忆 Tab 不提供搜索；全屏能力中心仍复用其顶部搜索框。
  const effectiveSearch = embedded ? '' : (search ?? '')

  // 自动保存：用 ref 持有最新的编辑状态，供防抖定时器与"切换文件前 flush"复用，
  // 避免把 selected/editText 塞进一堆回调的依赖数组里。
  const saveStateRef = React.useRef<{ selected: SelectedMemoryFile | null; editText: string; isDirty: boolean }>({
    selected: null,
    editText: '',
    isDirty: false,
  })
  React.useEffect(() => {
    saveStateRef.current = { selected, editText, isDirty }
  }, [selected, editText, isDirty])
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistInFlightRef = React.useRef<Promise<void> | null>(null)
  const historyRangeLabel = React.useMemo(
    () => MEMORY_HISTORY_RANGE_OPTIONS.find((option) => option.value === historyRange)?.label ?? '近 1 个月',
    [historyRange],
  )

  const refreshSummaryAndTree = React.useCallback(async (): Promise<WorkspaceMemorySummary> => {
    const [nextSummary, files] = await Promise.all([
      window.electronAPI.getWorkspaceMemorySummary(workspaceSlug),
      window.electronAPI.listWorkspaceAutoMemoryFiles(workspaceSlug),
    ])
    setSummary(nextSummary)
    setAutoFiles(files)
    return nextSummary
  }, [workspaceSlug])

  /** 底层写入：把指定内容写回目标文件并刷新摘要，供手动保存与自动保存复用 */
  const persistTarget = React.useCallback(async (target: SelectedMemoryFile, text: string): Promise<void> => {
    if (target.kind === 'agents') {
      await window.electronAPI.writeWorkspaceAgentsMd(workspaceSlug, text)
    } else {
      await window.electronAPI.writeWorkspaceAutoMemoryFile(workspaceSlug, target.relativePath, text)
    }
    const nextSummary = await refreshSummaryAndTree()
    const nextAbsolute = target.kind === 'agents'
      ? nextSummary.agentsMd.path
      : autoMemoryPath(nextSummary, target.relativePath)
    // 仅当用户仍停留在同一文件时才回写 absolutePath，避免覆盖已切换到别处的 selected
    setSelected((prev) => (prev && prev.kind === target.kind && prev.relativePath === target.relativePath
      ? { ...prev, absolutePath: nextAbsolute }
      : prev))
  }, [workspaceSlug, refreshSummaryAndTree])

  /**
   * 把待保存的脏内容立即刷盘（静默，失败才提示）。
   * showSaving=true 时（防抖自动保存路径）在保存按钮上展示 loading 动画并保证最短可见时长；
   * 切换文件/刷新/卸载前的 flush 传 false，保持即时不拖慢手感。
   */
  const flushPendingSave = React.useCallback(async (opts?: { showSaving?: boolean }): Promise<void> => {
    const showSaving = opts?.showSaving ?? false
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (persistInFlightRef.current) {
      await persistInFlightRef.current.catch(() => {})
    }
    const { selected: curSelected, editText: curText, isDirty: curDirty } = saveStateRef.current
    if (!curSelected || !curDirty) return
    setIsDirty(false)
    if (showSaving) setSaving(true)
    // 写入通常很快，saving 一闪而过看不到动画；自动保存时保证"保存中"至少显示一小段时间
    const startedAt = performance.now()
    try {
      const p = persistTarget(curSelected, curText)
      persistInFlightRef.current = p
      await p
    } catch (err) {
      console.error('[工作区记忆] 自动保存失败:', err)
      toast.error(err instanceof Error ? err.message : '自动保存失败')
      setIsDirty(true)
    } finally {
      persistInFlightRef.current = null
      if (showSaving) {
        const elapsed = performance.now() - startedAt
        const MIN_SAVING_MS = 450
        if (elapsed < MIN_SAVING_MS) {
          await new Promise((r) => setTimeout(r, MIN_SAVING_MS - elapsed))
        }
        setSaving(false)
      }
    }
  }, [persistTarget])

  const openAgents = React.useCallback(async (knownSummary?: WorkspaceMemorySummary): Promise<void> => {
    await flushPendingSave()
    setLoadingFile(true)
    try {
      const currentSummary = knownSummary ?? summary ?? await window.electronAPI.getWorkspaceMemorySummary(workspaceSlug)
      const file = await window.electronAPI.readWorkspaceAgentsMd(workspaceSlug)
      setSelected({
        kind: 'agents',
        relativePath: 'AGENTS.md',
        title: 'AGENTS.md',
        absolutePath: currentSummary.agentsMd.path,
      })
      setEditText(file.content ?? '')
      setIsDirty(false)
    } catch (err) {
      console.error('[工作区记忆] 读取 AGENTS.md 失败:', err)
      toast.error(err instanceof Error ? err.message : '读取 AGENTS.md 失败')
    } finally {
      setLoadingFile(false)
    }
  }, [summary, workspaceSlug, flushPendingSave])

  const openAutoFile = React.useCallback(async (relativePath: string, knownSummary?: WorkspaceMemorySummary): Promise<void> => {
    await flushPendingSave()
    setLoadingFile(true)
    try {
      const currentSummary = knownSummary ?? summary ?? await window.electronAPI.getWorkspaceMemorySummary(workspaceSlug)
      const file = await window.electronAPI.readWorkspaceAutoMemoryFile(workspaceSlug, relativePath)
      setSelected({
        kind: 'auto',
        relativePath: file.relativePath,
        title: file.relativePath,
        absolutePath: autoMemoryPath(currentSummary, file.relativePath),
      })
      setEditText(file.content ?? '')
      setIsDirty(false)
    } catch (err) {
      console.error('[工作区记忆] 读取长期记忆文件失败:', err)
      toast.error(err instanceof Error ? err.message : '读取长期记忆文件失败')
    } finally {
      setLoadingFile(false)
    }
  }, [summary, workspaceSlug, flushPendingSave])

  React.useEffect(() => {
    if (!memoryNavigationRequest || memoryNavigationRequest.workspaceSlug !== workspaceSlug) return
    void (async () => {
      await openAutoFile(memoryNavigationRequest.relativePath)
      setViewMode(memoryNavigationRequest.mode)
      setMemoryNavigationRequest(null)
    })()
  }, [memoryNavigationRequest, openAutoFile, setMemoryNavigationRequest, workspaceSlug])

  React.useEffect(() => {
    if (!latestMemoryChange) return
    void refreshSummaryAndTree().catch((error) => console.error('[工作区记忆] 刷新全局变更失败:', error))
  }, [latestMemoryChange?.changedAt, refreshSummaryAndTree])

  const refresh = React.useCallback(async (): Promise<void> => {
    await flushPendingSave()
    setLoading(true)
    try {
      const nextSummary = await refreshSummaryAndTree()
      if (selected?.kind === 'auto') {
        await openAutoFile(selected.relativePath, nextSummary)
      } else {
        await openAgents(nextSummary)
      }
    } catch (err) {
      console.error('[工作区记忆] 刷新失败:', err)
      toast.error('刷新协作知识失败')
    } finally {
      setLoading(false)
    }
  }, [openAutoFile, openAgents, refreshSummaryAndTree, selected, flushPendingSave])

  React.useEffect(() => {
    let cancelled = false
    setSelected(null)
    setEditText('')
    setIsDirty(false)
    setExpanded(new Set())
    setLoading(true)
    void (async () => {
      try {
        const [nextSummary, files, claudeFile] = await Promise.all([
          window.electronAPI.getWorkspaceMemorySummary(workspaceSlug),
          window.electronAPI.listWorkspaceAutoMemoryFiles(workspaceSlug),
          window.electronAPI.readWorkspaceAgentsMd(workspaceSlug),
        ])
        if (cancelled) return
        setSummary(nextSummary)
        setAutoFiles(files)
        setSelected({
          kind: 'agents',
          relativePath: 'AGENTS.md',
          title: 'AGENTS.md',
          absolutePath: nextSummary.agentsMd.path,
        })
        setEditText(claudeFile.content ?? '')
        setIsDirty(false)
      } catch (err) {
        console.error('[工作区记忆] 加载失败:', err)
        toast.error('加载协作知识失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [workspaceSlug])

  // 防抖自动保存：编辑内容变脏后 800ms 内无新输入则自动保存（按钮显示 loading 动画）
  React.useEffect(() => {
    if (!selected || !isDirty || loadingFile) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      void flushPendingSave({ showSaving: true })
    }, 800)
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [editText, selected, isDirty, loadingFile, flushPendingSave])

  // 组件卸载（如切走 Tab）时，把未保存内容刷盘，防止编辑丢失
  React.useEffect(() => {
    return () => {
      void flushPendingSave()
    }
  }, [flushPendingSave])

  const handleSave = async (): Promise<void> => {
    if (!selected) return
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    setSaving(true)
    try {
      setIsDirty(false)
      await persistTarget(selected, editText)
      toast.success('记忆文件已保存')
    } catch (err) {
      console.error('[工作区记忆] 保存失败:', err)
      toast.error(err instanceof Error ? err.message : '保存失败')
      setIsDirty(true)
    } finally {
      setSaving(false)
    }
  }

  const startGuidedSession = async (message: string, kind: 'bootstrap' | 'history'): Promise<void> => {
    const setLoadingState = kind === 'bootstrap' ? setBootstrapping : setScanningHistory
    setLoadingState(true)
    try {
      const sessionId = await createAgent()
      if (!sessionId) {
        toast.error('创建 Agent 会话失败')
        return
      }
      setPendingPrompt({ sessionId, message })
      toast.success(kind === 'bootstrap' ? '已创建项目地图与协作画像引导会话' : '已创建会话补证据任务')
    } catch (err) {
      console.error('[工作区记忆] 创建引导会话失败:', err)
      toast.error(err instanceof Error ? err.message : '创建引导会话失败')
    } finally {
      setLoadingState(false)
    }
  }

  const handleBootstrapKnowledge = async (): Promise<void> => {
    if (bootstrapping) return
    try {
      await window.electronAPI.approveWorkspaceProjectKnowledgeMaintenance(workspaceSlug)
      await startGuidedSession(buildWorkspaceKnowledgeBootstrapPrompt(), 'bootstrap')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '记录项目知识维护授权失败')
    }
  }

  const handleScanSessionEvidence = async (): Promise<void> => {
    if (scanningHistory || !hasProfile) return
    await startGuidedSession(buildWorkspaceSessionEvidencePrompt(historyRange), 'history')
  }

  // 文件名之外也可按正文内容检索。只在用户主动搜索时读取文本文件，做 180ms 防抖、
  // 忽略大文件并限制候选数，避免右侧面板的每次输入触发大量 IPC 或重渲染。
  React.useEffect(() => {
    const query = effectiveSearch.trim().toLowerCase()
    if (!query) {
      setContentMatches(new Map())
      return
    }
    const candidates: SkillFileNode[] = []
    const collect = (nodes: SkillFileNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'directory') collect(node.children ?? [])
        else if (node.isText !== false && (node.size ?? 0) <= 512 * 1024) candidates.push(node)
      }
    }
    collect(autoFiles)
    let cancelled = false
    const timer = window.setTimeout(() => {
      void Promise.all(candidates.slice(0, 60).map(async (node) => {
        try {
          const file = await window.electronAPI.readWorkspaceAutoMemoryFile(workspaceSlug, node.relativePath)
          const line = (file.content ?? '').split(/\r?\n/).find((item) => item.toLowerCase().includes(query))
          return line ? [node.relativePath, line.trim().slice(0, 160)] as const : null
        } catch {
          return null
        }
      })).then((results) => {
        if (cancelled) return
        setContentMatches(new Map(results.filter((result): result is readonly [string, string] => result !== null)))
      })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [autoFiles, effectiveSearch, workspaceSlug])

  const visibleAutoFiles = React.useMemo(
    () => filterNodes(autoFiles, effectiveSearch, new Set(contentMatches.keys())),
    [autoFiles, contentMatches, effectiveSearch],
  )
  const hasProfile = autoFiles.some((node) => node.relativePath === 'user-profile.md')
  const migrationIssues = [
    summary?.legacyAutoMemory ? '长期记忆迁移' : null,
    summary?.instructionConflict ? '工作区规则迁移' : null,
  ].filter((issue): issue is string => issue !== null)
  const migrationReminderTitle = [
    summary?.legacyAutoMemory ? `长期记忆：${summary.legacyAutoMemory.directory}` : null,
    summary?.instructionConflict ? `工作区规则：${summary.instructionConflict.legacyPath}` : null,
  ].filter((detail): detail is string => detail !== null).join('\n')

  if (loading || !summary) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载协作知识中...</div>
  }

  return (
    <div className={cn('flex flex-col gap-5', embedded && 'h-full min-h-0 gap-3')}>
      {embedded && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl bg-muted/45 px-3 py-2">
          <Brain className="size-4 shrink-0 text-foreground/65" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">项目记忆</div>
            <div className="text-[11px] text-muted-foreground">{summary.autoMemory.fileCount} 个主题文件 · 可搜索正文并直接编辑</div>
          </div>
        </div>
      )}
      {embedded && <AgentActionHint action="查找、补充或整理项目记忆" />}
      {!embedded && <SettingsCard divided={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">建立项目地图与协作画像</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              点击即授权 Agent 基于可验证证据维护项目根与 Proma 工作区的 AGENTS.md；随后在真实协作中逐步校准你的偏好。不会扫描历史会话。
            </div>
          </div>
          <Button onClick={handleBootstrapKnowledge} disabled={bootstrapping}>
            <Sparkles size={14} className="mr-1.5" />
            {bootstrapping ? '创建中...' : '同意并开始建立'}
          </Button>
        </div>
      </SettingsCard>}

      {!embedded && <SettingsCard divided={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">授权会话补证据</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {hasProfile
                ? `仅在你授权的范围内，分批选择少量高信号工作会话补充证据；不会全量扫描，协作记忆仍须确认后写入。`
                : '先在真实协作中建立初步协作画像，再决定是否用历史会话补充证据。'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={historyRange} onValueChange={(value) => setHistoryRange(value as MemoryHistoryRange)} disabled={scanningHistory || !hasProfile}>
              <SelectTrigger className="h-9 w-[116px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEMORY_HISTORY_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleScanSessionEvidence} disabled={scanningHistory || !hasProfile} title={hasProfile ? undefined : '请先建立协作画像'}>
              <Sparkles size={14} className="mr-1.5" />
              {scanningHistory ? '创建中...' : '授权整理'}
            </Button>
          </div>
        </div>
      </SettingsCard>}

      <div className={cn('grid min-h-[520px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]', embedded && 'min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)] gap-3')}>
        <SettingsCard divided={false} className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
              <div className="text-[13px] font-medium text-foreground/75">记忆文件</div>
              <button
                type="button"
                title="刷新"
                onClick={() => void refresh()}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {migrationIssues.length > 0 && (
              <div
                role="status"
                title={migrationReminderTitle}
                className="mx-2 mt-2 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
              >
                <AlertTriangle size={13} className="shrink-0" />
                <span>待处理：{migrationIssues.join('、')}，请检查旧文件。</span>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <FileButton
                active={selected?.kind === 'agents'}
                icon={<FileText size={14} />}
                label="AGENTS.md"
                meta="Proma 工作区项目指令"
                onClick={() => void openAgents(summary)}
              />
              <div className="mt-3 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                长期记忆
              </div>
              <div className="space-y-0.5">
                {visibleAutoFiles.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配的记忆文件</div>
                ) : (
                  visibleAutoFiles.map((node) => (
                    <MemoryTreeNode
                      key={node.relativePath}
                      node={node}
                      level={0}
                      selectedPath={selected?.kind === 'auto' ? selected.relativePath : null}
                      expanded={expanded}
                      contentMatches={contentMatches}
                      onToggle={(path) => {
                        setExpanded((prev) => {
                          const next = new Set(prev)
                          if (next.has(path)) next.delete(path)
                          else next.add(path)
                          return next
                        })
                      }}
                      onOpen={(path) => void openAutoFile(path, summary)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard divided={false} className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {selected?.title ?? '未选择文件'}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {selected?.absolutePath ?? '从左侧选择一个记忆文件'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selected && (
                  <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('preview')}
                      className={cn(
                        'flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
                        viewMode === 'preview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Eye size={13} />
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('edit')}
                      className={cn(
                        'flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
                        viewMode === 'edit' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Code2 size={13} />
                      编辑
                    </button>
                  </div>
                )}
                {selected && (
                  <DefaultAppOpenButton
                    filePath={selected.absolutePath}
                    variant="labeled"
                    className="h-8 max-w-[170px] border border-border/60 bg-background px-2 shadow-sm"
                  />
                )}
                {selected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.electronAPI.showItemInFolder(selected.absolutePath)}
                  >
                    <FolderOpen size={14} className="mr-1.5" />
                    打开文件夹
                  </Button>
                )}
                {selected && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" onClick={handleSave} disabled={!selected || saving || loadingFile}>
                        {saving ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
                        {saving ? '保存中...' : '保存'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">编辑后会自动保存，也可点此立即保存</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            {loadingFile ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">读取文件中...</div>
            ) : selected && viewMode === 'edit' ? (
              <textarea
                value={editText}
                onChange={(event) => {
                  setIsDirty(true)
                  setEditText(event.target.value)
                }}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={selected.kind === 'agents'
                  ? '# 项目指令\n\n写下未来 Agent 必须知道的项目规范、命令和决策。'
                  : '# MEMORY\n\n写下稳定、可复用的自动记忆索引。'}
              />
            ) : selected ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {editText.trim() ? (
                  <MessageResponse
                    className="text-[14px] prose-headings:scroll-mt-4"
                    basePath={dirnameOf(selected.absolutePath)}
                  >
                    {editText}
                  </MessageResponse>
                ) : (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
                    当前文件为空，切换到编辑后可以写入 Markdown 内容。
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">从左侧选择一个记忆文件</div>
            )}
          </div>
        </SettingsCard>
      </div>
    </div>
  )
}

function FileButton({
  active,
  icon,
  label,
  meta,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  meta?: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && <span className="truncate text-[11px] text-muted-foreground">{meta}</span>}
    </button>
  )
}

function MemoryTreeNode({
  node,
  level,
  selectedPath,
  expanded,
  contentMatches,
  onToggle,
  onOpen,
}: {
  node: SkillFileNode
  level: number
  selectedPath: string | null
  expanded: Set<string>
  contentMatches: Map<string, string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}): React.ReactElement {
  const isDirectory = node.type === 'directory'
  const isExpanded = expanded.has(node.relativePath)
  const isActive = selectedPath === node.relativePath
  const contentExcerpt = contentMatches.get(node.relativePath)
  const paddingLeft = 8 + level * 14

  return (
    <div>
      <button
        type="button"
        onClick={() => isDirectory ? onToggle(node.relativePath) : onOpen(node.relativePath)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px] transition-colors',
          isActive ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-accent/60',
        )}
        style={{ paddingLeft }}
      >
        {isDirectory ? (
          isExpanded ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
        ) : (
          <FileText size={13} className="shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="block truncate">{node.name}</span>
          {contentExcerpt && <span className="block truncate text-[10px] text-muted-foreground" title={contentExcerpt}>{contentExcerpt}</span>}
        </span>
        {!isDirectory && node.size != null && (
          <span className="shrink-0 text-[10px] text-muted-foreground/75">{formatBytes(node.size)}</span>
        )}
      </button>
      {isDirectory && isExpanded && node.children && (
        <div className="space-y-0.5">
          {node.children.map((child) => (
            <MemoryTreeNode
              key={child.relativePath}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              contentMatches={contentMatches}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
