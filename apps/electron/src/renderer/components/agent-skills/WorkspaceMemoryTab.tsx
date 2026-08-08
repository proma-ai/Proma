import * as React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { BookOpen, Brain, ChevronDown, ChevronRight, Code2, Eye, FileText, FolderOpen, Loader2, RefreshCw, Save, Sparkles } from 'lucide-react'
import type { SkillFileNode, WorkspaceMemorySummary } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsCard } from '@/components/settings/primitives'
import { DefaultAppOpenButton } from '@/components/diff/DefaultAppOpenButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MessageResponse } from '@/components/ai-elements/message'
import { agentPendingPromptAtom } from '@/atoms/agent-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'
import { cn } from '@/lib/utils'

type SelectedMemoryFile =
  | { kind: 'agents'; relativePath: 'AGENTS.md'; title: string; absolutePath: string }
  | { kind: 'auto'; relativePath: string; title: string; absolutePath: string }

interface WorkspaceMemoryTabProps {
  workspaceSlug: string
  search: string
}

const AUTO_MEMORY_INDEX = 'MEMORY.md'

type MemoryHistoryRange = '1m' | '2m' | '3m' | 'all'

const MEMORY_HISTORY_RANGE_OPTIONS: Array<{ value: MemoryHistoryRange; label: string; promptLabel: string }> = [
  { value: '1m', label: '近 1 个月', promptLabel: '最近 1 个月内' },
  { value: '2m', label: '近 2 个月', promptLabel: '最近 2 个月内' },
  { value: '3m', label: '近 3 个月', promptLabel: '最近 3 个月内' },
  { value: 'all', label: '全部', promptLabel: '全部可用历史' },
]

function getMemoryHistoryRangeLabel(value: MemoryHistoryRange): string {
  return MEMORY_HISTORY_RANGE_OPTIONS.find((option) => option.value === value)?.promptLabel ?? '最近 1 个月内'
}

function buildWorkspaceMemoryInitPrompt(historyRange: MemoryHistoryRange): string {
  const rangeLabel = getMemoryHistoryRangeLabel(historyRange)
  const rangeGuidance =
    historyRange === '1m'
      ? '本次只处理最近 1 个月。若认为必须查看更早会话，不能自行扩大范围；请在最终回复中说明理由并建议用户在界面中扩大范围后再处理。'
      : historyRange === 'all'
        ? '用户已在界面中明确选择“全部”历史；历史很多时仍优先最新、最有代表性且实际完成工作的会话，避免把临时过程写入长期记忆。'
        : `用户已在界面中明确将范围扩大到${rangeLabel}；本次只在该范围内处理。若仍需要更早历史，请在最终回复中说明理由并建议用户进一步扩大范围。`

  return `请为当前项目初始化并沉淀长期记忆。这里的“项目”指系统提示中的“项目根目录”及其关联的 Agent 工作会话；不要把 Proma 工作区笼统当作项目。

处理范围：
1. 默认读取当前项目最近 1 个月的 Agent 工作会话，优先近期、最有代表性且用户实际完成工作的会话。证据不足时要明确说明，不得编造。只有用户通过界面明确选择更大范围时，才可处理超过 1 个月的会话。
2. ${rangeGuidance}

路径与职责边界：
- 系统提示中的“Proma 工作区目录”是 Proma 管理配置与隔离资料的位置，存放 MCP、Skills、Proma 管理的 AGENTS.md 与 Auto Memory；它不是用户项目根目录。必须按系统提示给出的绝对路径操作，不得猜测或替换路径。
- “项目根目录”是用户项目资料的边界，并不一定等于实际 cwd：新会话通常从项目根目录运行，历史会话可能仍从会话工作台运行。允许从项目级 Context 及明确关联的长期项目资料读取证据；不要自动读取、创建或修改项目根内的 \`.claude/\`、\`AGENTS.md\`、MCP 或 Skills 配置，除非用户明确要求。
- 系统提示中的“会话工作台目录”是当前会话的 sidecar/workbench：新会话直接在其根目录存放 todo、plan、临时笔记和中间结论；历史会话可能保留 \`.context/\` 子目录。它不应作为项目级长期记忆的写入位置。绝不读取、创建或修改其中的 \`.claude/settings.json\`。
- 系统提示中的“项目级 Context”与项目级长期资料用于跨会话保留调研、架构分析和项目知识。先区分它们与会话级临时产物，再决定可作为长期记忆证据的内容。

沉淀目标：
1. 从允许读取的会话和 Context 中提炼稳定的项目知识：项目结构、常用命令、架构边界、可靠决策、踩坑经验、用户偏好，以及未来 Agent 必须注意的事项。不要把聊天流水账、单次调试过程或当前任务的临时产物当作长期知识。
2. 只更新系统提示明确给出的“Proma 工作区 AGENTS.md”绝对路径。这里是 Proma 管理的项目指令文件；内容仅限稳定、跨会话有效的项目规则、入口和工作方法，不得混入临时调试、聊天记录或长篇资料。
3. 只更新系统提示明确给出的“Proma 工作区 Auto Memory 目录”中的 \`MEMORY.md\`、必要的主题文件和 \`user-profile.md\`，不要在其他目录创建记忆文件。\`MEMORY.md\` 保持简短的主题索引与路由，主题细节拆分到主题文件。
4. \`user-profile.md\` 是持续迭代的用户画像：基于现有内容增量合并，条目化且可追溯地记录有充分证据的角色与技术背景、稳定协作偏好、反复出现的关注点、工具链倾向和明确的“下次请这样做”要求。只出现一次或证据不足的信号标为“待确认”，不要当作稳定结论。

写入规则：
1. 写入前先读取已有的 \`user-profile.md\`、\`MEMORY.md\` 与相关主题文件，并保留仍然有效的内容；不要整体重写或删除有效信息。发现过时内容时，保守修订或标注。
2. 只有明确重复出现、用户明确指定，或删除后会导致未来 Agent 明显犯错的知识才能写入。弱信号、临时过程和证据不足的判断不写入长期记忆，留在最终回复的待确认项。
3. 优先小幅、可审阅的增量更新：AGENTS.md 保持精炼，MEMORY.md 不承载长正文，跨会话的长资料仍留在项目级长期资料或项目级 Context。

完成后必须报告：读取的会话与 Context 范围、更新的文件、关键沉淀主题、用户画像新增或修订，以及仍需用户确认的项目。`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ts?: number): string {
  if (!ts) return '尚未创建'
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
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

function filterNodes(nodes: SkillFileNode[], query: string): SkillFileNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const result: SkillFileNode[] = []
  for (const node of nodes) {
    const children = node.children ? filterNodes(node.children, query) : undefined
    const selfMatch =
      node.name.toLowerCase().includes(q) ||
      node.relativePath.toLowerCase().includes(q)
    if (selfMatch || (children && children.length > 0)) {
      result.push({ ...node, children })
    }
  }
  return result
}

function withVirtualMemoryIndex(nodes: SkillFileNode[]): SkillFileNode[] {
  if (nodes.some((node) => node.relativePath === AUTO_MEMORY_INDEX)) return nodes
  return [
    {
      relativePath: AUTO_MEMORY_INDEX,
      name: AUTO_MEMORY_INDEX,
      type: 'file',
      size: 0,
      isText: true,
    },
    ...nodes,
  ]
}

export function WorkspaceMemoryTab({ workspaceSlug, search }: WorkspaceMemoryTabProps): React.ReactElement {
  const { createAgent } = useCreateSession()
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
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
  const [initializing, setInitializing] = React.useState(false)
  const [historyRange, setHistoryRange] = React.useState<MemoryHistoryRange>('1m')

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
      console.error('[工作区记忆] 读取 auto memory 文件失败:', err)
      toast.error(err instanceof Error ? err.message : '读取 auto memory 文件失败')
    } finally {
      setLoadingFile(false)
    }
  }, [summary, workspaceSlug, flushPendingSave])

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
      toast.error('刷新项目记忆失败')
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
        toast.error('加载项目记忆失败')
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

  const handleInitializeMemory = async (): Promise<void> => {
    if (initializing) return
    setInitializing(true)
    try {
      const sessionId = await createAgent()
      if (!sessionId) {
        toast.error('创建 Agent 会话失败')
        return
      }
      setPendingPrompt({
        sessionId,
        message: buildWorkspaceMemoryInitPrompt(historyRange),
      })
      toast.success('已创建项目记忆初始化会话')
    } catch (err) {
      console.error('[工作区记忆] 创建初始化会话失败:', err)
      toast.error(err instanceof Error ? err.message : '创建初始化会话失败')
    } finally {
      setInitializing(false)
    }
  }

  const visibleAutoFiles = React.useMemo(
    () => filterNodes(withVirtualMemoryIndex(autoFiles), search),
    [autoFiles, search],
  )

  if (loading || !summary) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载项目记忆中...</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <MemoryStatCard
          icon={<BookOpen size={18} />}
          title="项目指令"
          subtitle="Proma 工作区 AGENTS.md"
          value={summary.agentsMd.exists ? formatBytes(summary.agentsMd.size) : '尚未创建'}
          detail={`更新于 ${formatTime(summary.agentsMd.updatedAt)}`}
          active={selected?.kind === 'agents'}
          onClick={() => void openAgents(summary)}
        />
        <MemoryStatCard
          icon={<Brain size={18} />}
          title="自动记忆"
          subtitle=".claude/memory/MEMORY.md 与主题文件"
          value={`${summary.autoMemory.fileCount} 个文件`}
          detail={`${formatBytes(summary.autoMemory.totalSize)} · 更新于 ${formatTime(summary.autoMemory.updatedAt)}`}
          active={selected?.kind === 'auto'}
          onClick={() => void openAutoFile(AUTO_MEMORY_INDEX, summary)}
        />
      </div>

      {summary.instructionConflict && (
        <SettingsCard divided={false} className="border-amber-500/40 bg-amber-500/5">
          <div className="p-4 text-sm leading-relaxed text-foreground">
            <div className="font-medium">工作区指令迁移需要处理</div>
            <p className="mt-1 text-muted-foreground">
              检测到内容不同的 legacy CLAUDE.md 与 AGENTS.md。Proma 当前只加载 AGENTS.md，未自动合并或删除旧文件，以避免丢失规则。
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              请手动合并后删除旧文件：{summary.instructionConflict.legacyPath}
            </p>
          </div>
        </SettingsCard>
      )}

      <SettingsCard divided={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">从历史会话生成项目记忆</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              新建一个 Agent 会话，读取当前项目{historyRangeLabel}的工作会话，沉淀并更新 Proma 工作区中的 AGENTS.md 与 auto memory 文件。
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={historyRange}
              onValueChange={(value) => setHistoryRange(value as MemoryHistoryRange)}
              disabled={initializing}
            >
              <SelectTrigger className="h-9 w-[116px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_HISTORY_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleInitializeMemory} disabled={initializing}>
              <Sparkles size={14} className="mr-1.5" />
              {initializing ? '创建中...' : '生成项目记忆'}
            </Button>
          </div>
        </div>
      </SettingsCard>

      <div className="grid min-h-[520px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
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
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <FileButton
                active={selected?.kind === 'agents'}
                icon={<FileText size={14} />}
                label="AGENTS.md"
                meta="Proma 工作区项目指令"
                onClick={() => void openAgents(summary)}
              />
              <div className="mt-3 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Auto Memory
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

function MemoryStatCard({
  icon,
  title,
  subtitle,
  value,
  detail,
  active,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  value: string
  detail: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-content-area p-4 text-left shadow-sm transition-colors',
        active ? 'border-primary/50 bg-primary/[0.04]' : 'border-border/60 hover:bg-foreground/[0.03]',
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs font-medium tabular-nums text-foreground/65">{value}</div>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
        <div className="mt-1 text-[11px] text-muted-foreground/80">{detail}</div>
      </div>
    </button>
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
  onToggle,
  onOpen,
}: {
  node: SkillFileNode
  level: number
  selectedPath: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}): React.ReactElement {
  const isDirectory = node.type === 'directory'
  const isExpanded = expanded.has(node.relativePath)
  const isActive = selectedPath === node.relativePath
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
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
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
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}
