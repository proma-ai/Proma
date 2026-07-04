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
  | { kind: 'claude'; relativePath: 'CLAUDE.md'; title: string; absolutePath: string }
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
  const rangeGuidance = historyRange === 'all'
    ? '这次处理全部可用历史；如果历史很多，请优先最新、最有代表性和用户实际完成工作的会话，避免把临时过程写入长期记忆。'
    : `如果你认为需要覆盖超过${rangeLabel.replace('最近', '')}的历史，请先在最终回复里建议用户扩大范围；这次默认只处理${rangeLabel}。`

  return `请帮我初始化并沉淀当前工作区的长期记忆。

目标：
1. 读取当前工作区${rangeLabel}的 Agent 工作会话，优先关注最新、最有代表性、用户实际完成工作的会话。如果证据不足，请说明而不是编造。
2. 同时检查会话级 Context（各会话 cwd 下的 .context/）和工作区级 Context（工作区 workspace-files/.context/ 及相关本地文档），区分当前任务临时产物与跨会话长期资料。
3. 从这些会话和 Context 中提炼工作区级别的稳定知识，包括项目结构、常用命令、架构约定、用户偏好、踩坑经验、重要决策和未来 Agent 必须知道的注意事项。
4. 更新工作区根目录的 CLAUDE.md：只写稳定、跨会话有价值的项目指令和工作方式，避免写临时过程和聊天流水账。
5. 更新工作区 .claude/memory/MEMORY.md，必要时创建主题文件：MEMORY.md 只放主题索引和路由，详细内容拆到主题文件；只记录 SDK auto memory 应该长期回忆的经验。
6. 沉淀并持续迭代一份「用户画像」记忆，写入 .claude/memory/user-profile.md（并在 MEMORY.md 索引中登记）。这份画像用于让未来的 Agent 越来越懂用户，应包含：
   - 用户的角色、技术背景与擅长领域
   - 稳定的工作方式与协作偏好（沟通风格、语言、颗粒度、对确认/自动化的偏好等）
   - 反复出现的关注点、常用工具链和技术栈倾向
   - 明确表达过的好恶、约束和"下次请这样做"的要求
   迭代原则：这是一份会被反复更新的活文档——基于已有内容做增量合并，只在有新证据时新增或修订对应条目，保留仍然成立的旧结论，不要整体推倒重写；对不确定或仅出现一次的信号，标注为"待确认"而非当成稳定画像。
7. 写入长期记忆前先做筛选：只有明确重复出现、用户明确要求记住，或删掉后未来 Agent 明显会犯错的信息才写入；单次弱信号、临时过程和证据不足的判断不要写入，放到最终回复的待确认点里。
8. ${rangeGuidance}

要求：
- 先查看当前工作区可用的会话和文件（包括已有的 user-profile.md），再决定如何写。
- 写入内容要简洁、可维护、方便用户审阅；用户画像要条目化、可追溯，避免笼统空话。
- 优先小幅增量修改，不要为了显得完整而重写已有记忆；MEMORY.md 保持短索引，避免承载长正文。
- 不要删除用户已有的有效内容；发现过时内容时先保守修订或标注。
- 完成后回复：读取了哪些范围、更新了哪些文件、沉淀了哪些关键主题、用户画像这次有哪些新增或修订、还有哪些建议用户确认的点。`
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
    if (target.kind === 'claude') {
      await window.electronAPI.writeWorkspaceClaudeMd(workspaceSlug, text)
    } else {
      await window.electronAPI.writeWorkspaceAutoMemoryFile(workspaceSlug, target.relativePath, text)
    }
    const nextSummary = await refreshSummaryAndTree()
    const nextAbsolute = target.kind === 'claude'
      ? nextSummary.claudeMd.path
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

  const openClaude = React.useCallback(async (knownSummary?: WorkspaceMemorySummary): Promise<void> => {
    await flushPendingSave()
    setLoadingFile(true)
    try {
      const currentSummary = knownSummary ?? summary ?? await window.electronAPI.getWorkspaceMemorySummary(workspaceSlug)
      const file = await window.electronAPI.readWorkspaceClaudeMd(workspaceSlug)
      setSelected({
        kind: 'claude',
        relativePath: 'CLAUDE.md',
        title: 'CLAUDE.md',
        absolutePath: currentSummary.claudeMd.path,
      })
      setEditText(file.content ?? '')
      setIsDirty(false)
    } catch (err) {
      console.error('[工作区记忆] 读取 CLAUDE.md 失败:', err)
      toast.error(err instanceof Error ? err.message : '读取 CLAUDE.md 失败')
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
        await openClaude(nextSummary)
      }
    } catch (err) {
      console.error('[工作区记忆] 刷新失败:', err)
      toast.error('刷新工作区记忆失败')
    } finally {
      setLoading(false)
    }
  }, [openAutoFile, openClaude, refreshSummaryAndTree, selected, flushPendingSave])

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
          window.electronAPI.readWorkspaceClaudeMd(workspaceSlug),
        ])
        if (cancelled) return
        setSummary(nextSummary)
        setAutoFiles(files)
        setSelected({
          kind: 'claude',
          relativePath: 'CLAUDE.md',
          title: 'CLAUDE.md',
          absolutePath: nextSummary.claudeMd.path,
        })
        setEditText(claudeFile.content ?? '')
        setIsDirty(false)
      } catch (err) {
        console.error('[工作区记忆] 加载失败:', err)
        toast.error('加载工作区记忆失败')
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
      toast.success('已创建工作区记忆初始化会话')
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
    return <div className="py-20 text-center text-sm text-muted-foreground">加载工作区记忆中...</div>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 lg:grid-cols-2">
        <MemoryStatCard
          icon={<BookOpen size={18} />}
          title="项目指令"
          subtitle="工作区根目录 CLAUDE.md"
          value={summary.claudeMd.exists ? formatBytes(summary.claudeMd.size) : '尚未创建'}
          detail={`更新于 ${formatTime(summary.claudeMd.updatedAt)}`}
          active={selected?.kind === 'claude'}
          onClick={() => void openClaude(summary)}
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

      <SettingsCard divided={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">从历史会话生成工作区记忆</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              新建一个 Agent 会话，读取当前工作区{historyRangeLabel}的工作会话，沉淀并更新 CLAUDE.md 与 auto memory 文件。
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
              {initializing ? '创建中...' : '生成工作区记忆'}
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
                active={selected?.kind === 'claude'}
                icon={<FileText size={14} />}
                label="CLAUDE.md"
                meta="工作区项目指令"
                onClick={() => void openClaude(summary)}
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
                placeholder={selected.kind === 'claude'
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
