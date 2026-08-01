import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, CalendarDays, Check, ChevronRight, ExternalLink, Flag, ListTodo, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PLANNING_CONFLICT_ERROR } from '@proma/shared'
import type { PlanningGroup, Todo } from '@proma/shared'
import { cn } from '@/lib/utils'
import { automationsAtom, automationFormAtom, createEmptyDraft } from '@/atoms/automation-atoms'
import { AutomationsListView } from '@/components/automation/AutomationsListView'
import { CalendarWorkspace } from '@/components/planning/CalendarWorkspace'
import { PlanningFloatingInspector } from '@/components/planning/PlanningFloatingInspector'
import { PlanningGroupManager } from '@/components/planning/PlanningGroupManager'
import { agentChannelIdAtom, agentModelIdAtom, agentPendingPromptAtom, agentSessionsAtom, agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { planningCalendarCreateRequestAtom, planningSelectedTodoIdAtom, planningTabAtom, planningTagsAtom, planningTodoCreateRequestAtom, todoPlanningGroupsAtom, todosAtom, type PlanningTab } from '@/atoms/planning-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useShortcut } from '@/hooks/useShortcut'
import { buildTodoAgentPrompt } from '@/lib/todo-agent-prompt'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { TodoDatePicker, formatTodoDueDate } from '@/components/ui/todo-date-picker'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'
import { detectIsWindows, WINDOW_CONTROLS_INSET_RIGHT } from '@/lib/platform'

const TABS: Array<{ id: PlanningTab; label: string }> = [
  { id: 'todos', label: 'Todo' },
  { id: 'calendar', label: '日程' },
  { id: 'automations', label: '定时任务' },
]

function CreateShortcutHint(): React.ReactElement | null {
  return (
    <ShortcutKeycaps
      shortcutId="new-session"
      className="ml-1.5"
      keycapClassName="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground shadow-none"
      separatorClassName="text-primary-foreground/70"
    />
  )
}

export function PlanningView({ standalone = false }: { standalone?: boolean } = {}): React.ReactElement {
  const [tab, setTab] = useAtom(planningTabAtom)
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const automations = useAtomValue(automationsAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const requestTodoCreate = useSetAtom(planningTodoCreateRequestAtom)
  const requestCalendarCreate = useSetAtom(planningCalendarCreateRequestAtom)
  const createAutomation = (): void => {
    let maxN = 0
    for (const automation of automations) {
      const match = /^定时任务\s*(\d+)$/.exec(automation.name.trim())
      if (match) maxN = Math.max(maxN, Number(match[1]))
    }
    const draft = createEmptyDraft()
    draft.name = `定时任务 ${maxN + 1}`
    setAutomationForm({ open: true, draft })
  }

  const triggerTodoCreate = React.useCallback(() => {
    requestTodoCreate((count) => count + 1)
  }, [requestTodoCreate])
  const triggerCalendarCreate = React.useCallback(() => {
    requestCalendarCreate((count) => count + 1)
  }, [requestCalendarCreate])
  const openPlanningWindow = React.useCallback((): void => {
    void window.electronAPI.openPlanningWindow().catch((error) => {
      console.error('[任务/日程] 打开独立窗口失败:', error)
      toast.error('打开独立窗口失败')
    })
  }, [])
  useShortcut('new-session', React.useCallback(() => {
    if (tab === 'todos') triggerTodoCreate()
    else if (tab === 'calendar') triggerCalendarCreate()
    else createAutomation()
  }, [createAutomation, tab, triggerCalendarCreate, triggerTodoCreate]), true, { exclusive: true })
  return (
    <div className="flex h-full flex-col overflow-hidden bg-content-area">
      <header className={cn('relative flex w-full items-center justify-between titlebar-no-drag', standalone ? 'px-5 pb-4 pt-8' : 'px-6 pb-5 pt-8 sm:px-8 xl:px-10')}>
        <div className={cn('absolute inset-y-0 left-0 z-0 titlebar-drag-region', isWindows ? WINDOW_CONTROLS_INSET_RIGHT : 'right-0')} />
        <div className="relative z-[1]">
          <h1 className="text-2xl font-semibold tracking-tight text-wrap-balance">任务/日程</h1>
          <p className="mt-1 text-sm text-muted-foreground">安排待办、日程与定时任务</p>
        </div>
        <div className="relative z-[1] titlebar-no-drag flex items-center gap-2">
          {!standalone && (
            <button
              type="button"
              onClick={openPlanningWindow}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/60 active:scale-[0.96]"
            >
              <ExternalLink size={16} /> 独立窗口
            </button>
          )}
          {tab === 'todos' && (
            <button
              type="button"
              onClick={triggerTodoCreate}
              aria-keyshortcuts="Meta+N Control+N"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <Plus size={16} /> 新建 Todo<CreateShortcutHint />
            </button>
          )}
          {tab === 'calendar' && (
            <button
              type="button"
              onClick={triggerCalendarCreate}
              aria-keyshortcuts="Meta+N Control+N"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <Plus size={16} /> 新建日程<CreateShortcutHint />
            </button>
          )}
          {tab === 'automations' && automations.length > 0 && (
            <button
              type="button"
              onClick={createAutomation}
              aria-keyshortcuts="Meta+N Control+N"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.96]"
            >
              <Plus size={16} /> 新建定时任务<CreateShortcutHint />
            </button>
          )}
        </div>
      </header>
      <div className={cn('titlebar-no-drag w-full', standalone ? 'px-5' : 'px-6 sm:px-8 xl:px-10')}>
        <nav className="inline-flex rounded-xl bg-muted/60 p-1 shadow-inner" aria-label="任务日程视图">
          {TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn('min-h-9 rounded-lg px-3 text-sm transition-colors', tab === item.id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{item.label}</button>)}
        </nav>
      </div>
      <main className={cn('min-h-0 flex-1 titlebar-no-drag', standalone ? 'px-5 pb-5 pt-4' : 'px-6 pb-8 pt-6 sm:px-8 xl:px-10', tab === 'calendar' || tab === 'todos' ? 'overflow-hidden' : 'overflow-y-auto')}>
        <div className={cn('w-full', (tab === 'calendar' || tab === 'todos') && 'h-full')}>
          {tab === 'todos' && <TodoWorkspace standalone={standalone} />}
          {tab === 'calendar' && <CalendarWorkspace />}
          {tab === 'automations' && <AutomationsListView />}
        </div>
      </main>
    </div>
  )
}

type TodoListView = 'all' | 'today' | 'upcoming' | 'completed' | `group:${string}`

function endOfToday(value: number | Date = Date.now()): number {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function addLocalDays(value: number, amount: number): number {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date.getTime()
}

function useLocalDayVersion(): number {
  const [dayStart, setDayStart] = React.useState(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  })
  React.useEffect(() => {
    const scheduleNextMidnight = (): (() => void) => {
      const now = new Date()
      const next = new Date(now)
      next.setHours(24, 0, 0, 50)
      const timer = window.setTimeout(() => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        setDayStart(today.getTime())
        cleanup = scheduleNextMidnight()
      }, Math.max(1_000, next.getTime() - now.getTime()))
      return () => window.clearTimeout(timer)
    }
    let cleanup = scheduleNextMidnight()
    return () => cleanup()
  }, [])
  return dayStart
}

/** Todo 默认以“当天”为计划单位；只有用户主动选时间时才显示精确时分。 */
function dateTimeLabel(timestamp: number): string {
  return formatTodoDueDate(timestamp)
}

function TodoWorkspace({ standalone = false }: { standalone?: boolean } = {}): React.ReactElement {
  const todos = useAtomValue(todosAtom)
  const groups = useAtomValue(todoPlanningGroupsAtom)
  const tags = useAtomValue(planningTagsAtom)
  const todoCreateRequest = useAtomValue(planningTodoCreateRequestAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const agentWorkspaces = useAtomValue(agentWorkspacesAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const openSession = useOpenSession()
  const setTodos = useSetAtom(todosAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const setGroups = useSetAtom(todoPlanningGroupsAtom)
  const [view, setView] = React.useState<TodoListView>('all')
  const [selectedId, setSelectedId] = useAtom(planningSelectedTodoIdAtom)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [quickTitle, setQuickTitle] = React.useState('')
  const [quickPriority, setQuickPriority] = React.useState<Todo['priority']>('medium')
  const [quickGroupId, setQuickGroupId] = React.useState<string>('__none__')
  const [quickDueAt, setQuickDueAt] = React.useState<number | undefined>(endOfToday)
  const [isCreatingTodo, setIsCreatingTodo] = React.useState(false)
  const creatingTodoRef = React.useRef(false)
  const [detailTitle, setDetailTitle] = React.useState('')
  const [detailNotes, setDetailNotes] = React.useState('')
  const [todoConflict, setTodoConflict] = React.useState(false)
  const selectedTodoIdRef = React.useRef<string | null>(null)
  const todoBaseUpdatedAtRef = React.useRef<number | null>(null)
  const detailTitleRef = React.useRef('')
  const detailNotesRef = React.useRef('')
  const savedDetailTitleRef = React.useRef('')
  const savedDetailNotesRef = React.useRef('')
  const [todoPendingDeletion, setTodoPendingDeletion] = React.useState<Todo | null>(null)
  const [startingTodoId, setStartingTodoId] = React.useState<string | null>(null)
  const [assigningTodoId, setAssigningTodoId] = React.useState<string | null>(null)
  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false)

  const applyTodoDetailDraft = React.useCallback((todo: Todo): void => {
    const title = todo.title
    const notes = todo.notes ?? ''
    selectedTodoIdRef.current = todo.id
    todoBaseUpdatedAtRef.current = todo.updatedAt
    detailTitleRef.current = title
    detailNotesRef.current = notes
    savedDetailTitleRef.current = title
    savedDetailNotesRef.current = notes
    setDetailTitle(title)
    setDetailNotes(notes)
    setTodoConflict(false)
  }, [])

  const selected = todos.find((todo) => todo.id === selectedId)
  React.useEffect(() => {
    // 用户已在“全部任务”中点击时，保持列表上下文；仅在当前视图看不到目标时才切换定位。
    if (!selected || view === 'all') return
    setView(selected.status === 'completed' ? 'completed' : selected.groupId ? `group:${selected.groupId}` : 'all')
  }, [selected, view])
  React.useEffect(() => {
    if (!selected) {
      selectedTodoIdRef.current = null
      todoBaseUpdatedAtRef.current = null
      return
    }
    if (selectedTodoIdRef.current !== selected.id) {
      applyTodoDetailDraft(selected)
      return
    }
    if (selected.updatedAt === todoBaseUpdatedAtRef.current) return
    const hasDirtyDraft = detailTitleRef.current !== savedDetailTitleRef.current || detailNotesRef.current !== savedDetailNotesRef.current
    if (hasDirtyDraft) {
      setTodoConflict(true)
      return
    }
    applyTodoDetailDraft(selected)
  }, [applyTodoDetailDraft, selected?.id, selected?.updatedAt])

  const updateTodo = React.useCallback(async (
    id: string,
    input: Omit<Parameters<typeof window.electronAPI.updateTodo>[0], 'id'>,
    savedField?: 'title' | 'notes',
  ) => {
    try {
      const updated = await window.electronAPI.updateTodo({ id, ...input })
      if (updated) {
        setTodos((items) => items.map((item) => item.id === id ? updated : item))
        if (selectedTodoIdRef.current === id) {
          todoBaseUpdatedAtRef.current = updated.updatedAt
          if (savedField === 'title') {
            detailTitleRef.current = updated.title
            savedDetailTitleRef.current = updated.title
            setDetailTitle(updated.title)
          }
          if (savedField === 'notes') {
            const notes = updated.notes ?? ''
            detailNotesRef.current = notes
            savedDetailNotesRef.current = notes
            setDetailNotes(notes)
          }
        }
      }
      return updated
    } catch (error) {
      if (error instanceof Error && error.message.includes(PLANNING_CONFLICT_ERROR)) {
        if (selectedTodoIdRef.current === id) setTodoConflict(true)
        toast.error('Todo 已在其他窗口更新，请重新加载后再试')
      } else {
        console.error('[任务/日程] 更新 Todo 失败:', error)
        toast.error('更新 Todo 失败')
      }
      return undefined
    }
  }, [setTodos])

  const reloadTodoDetail = (): void => {
    if (selected) applyTodoDetailDraft(selected)
  }

  const openCreateDialog = React.useCallback((): void => {
    setQuickTitle('')
    setQuickPriority('medium')
    setQuickGroupId(view.startsWith('group:') ? view.slice('group:'.length) : '__none__')
    setQuickDueAt(endOfToday())
    setCreateOpen(true)
  }, [view])
  const handledTodoCreateRequest = React.useRef(todoCreateRequest)
  React.useEffect(() => {
    if (todoCreateRequest === handledTodoCreateRequest.current) return
    handledTodoCreateRequest.current = todoCreateRequest
    openCreateDialog()
  }, [openCreateDialog, todoCreateRequest])

  const createTodo = async (): Promise<void> => {
    const title = quickTitle.trim()
    if (!title || creatingTodoRef.current) return
    creatingTodoRef.current = true
    setIsCreatingTodo(true)
    const dueAt = quickDueAt
    try {
      const todo = await window.electronAPI.createTodo({
        title,
        priority: quickPriority,
        groupId: quickGroupId === '__none__' ? undefined : quickGroupId,
        dueAt,
        // 数据层会以计划完成时间创建默认提醒。
      })
      setTodos((items) => [todo, ...items])
      // 不自动打开详情；同时切换到新任务实际所属的视图，确保创建后立即可见。
      setSelectedId(null)
      setView(quickGroupId === '__none__' ? (dueAt ? 'today' : 'all') : `group:${quickGroupId}`)
      setQuickTitle('')
      setQuickPriority('medium')
      setQuickDueAt(endOfToday())
      setCreateOpen(false)
    } catch (error) {
      console.error('[任务/日程] 创建 Todo 失败:', error)
      toast.error('创建 Todo 失败')
    } finally {
      creatingTodoRef.current = false
      setIsCreatingTodo(false)
    }
  }

  const createTodoGroup = React.useCallback(async (name: string): Promise<PlanningGroup | undefined> => {
    try {
      const group = await window.electronAPI.createPlanningGroup({ scope: 'todo', name })
      setGroups((items) => [...items, group].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN')))
      return group
    } catch (error) {
      console.error('[任务/日程] 创建 Todo 分组失败:', error)
      toast.error('创建 Todo 分组失败：名称可能已存在')
      return undefined
    }
  }, [setGroups])

  const renameTodoGroup = React.useCallback(async (group: PlanningGroup, name: string): Promise<PlanningGroup | undefined> => {
    try {
      const updated = await window.electronAPI.updatePlanningGroup({ id: group.id, scope: 'todo', name })
      if (!updated) throw new Error('分组不存在')
      setGroups((items) => items.map((item) => item.id === updated.id ? updated : item))
      setTodos((items) => items.map((item) => item.groupId === updated.id ? { ...item, group: updated } : item))
      toast.success('已重命名 Todo 分组')
      return updated
    } catch (error) {
      console.error('[任务/日程] 重命名 Todo 分组失败:', error)
      toast.error('重命名 Todo 分组失败：名称可能已存在')
      return undefined
    }
  }, [setGroups, setTodos])

  const deleteTodoGroup = React.useCallback(async (group: PlanningGroup): Promise<boolean> => {
    try {
      const deleted = await window.electronAPI.deletePlanningGroup('todo', group.id)
      if (!deleted) throw new Error('分组不存在')
      setGroups((items) => items.filter((item) => item.id !== group.id))
      setTodos((items) => items.map((item) => item.groupId === group.id ? { ...item, groupId: undefined, group: undefined } : item))
      setView((current) => current === `group:${group.id}` ? 'all' : current)
      toast.success('已删除 Todo 分组')
      return true
    } catch (error) {
      console.error('[任务/日程] 删除 Todo 分组失败:', error)
      toast.error('删除 Todo 分组失败')
      return false
    }
  }, [setGroups, setTodos])

  const completeTodo = async (todo: Todo): Promise<void> => {
    const updated = await updateTodo(todo.id, { status: todo.status === 'completed' ? 'open' : 'completed', expectedUpdatedAt: todo.updatedAt })
    if (updated?.status === 'completed' && selectedId === todo.id && view !== 'completed') setSelectedId(null)
  }

  const deleteTodo = async (): Promise<void> => {
    const todo = todoPendingDeletion
    if (!todo) return
    try {
      await window.electronAPI.deleteTodo(todo.id)
      setTodos((items) => items.filter((item) => item.id !== todo.id))
      if (selectedId === todo.id) setSelectedId(null)
      setTodoPendingDeletion(null)
    } catch (error) {
      console.error('[任务/日程] 删除 Todo 失败:', error)
      toast.error('删除 Todo 失败')
    }
  }

  const assignTodoWorkspace = React.useCallback(async (todo: Todo, workspaceId: string): Promise<void> => {
    if (assigningTodoId) return
    if (todo.workspaceId === workspaceId) {
      setProjectPickerOpen(false)
      return
    }
    setAssigningTodoId(todo.id)
    try {
      const updatedTodo = await window.electronAPI.updateTodo({
        id: todo.id,
        workspaceId,
        expectedUpdatedAt: todo.updatedAt,
      })
      if (!updatedTodo) throw new Error('Todo 不存在')
      setTodos((items) => items.map((item) => item.id === updatedTodo.id ? updatedTodo : item))
      setProjectPickerOpen(false)
    } catch (error) {
      console.error('[Todo] 选择项目失败:', error)
      const message = error instanceof Error ? error.message : '请稍后重试'
      toast.error(message.includes(PLANNING_CONFLICT_ERROR) ? 'Todo 已在其他窗口更新，请重新选择项目' : '选择项目失败', {
        description: message.includes(PLANNING_CONFLICT_ERROR) ? undefined : message,
      })
    } finally {
      setAssigningTodoId(null)
    }
  }, [assigningTodoId, setTodos])

  const startTodoInWorkspace = React.useCallback(async (todo: Todo, workspaceId: string): Promise<void> => {
    if (startingTodoId) return
    if (!agentChannelId) {
      toast.error('请先在设置中配置 Agent 渠道')
      return
    }
    const workspace = agentWorkspaces.find((item) => item.id === workspaceId)
    if (!workspace) {
      toast.error('所选项目已不可用，请重新选择')
      return
    }

    setStartingTodoId(todo.id)
    try {
      const { todo: updatedTodo, session } = await window.electronAPI.startTodoAgent({
        todoId: todo.id,
        workspaceId,
        expectedUpdatedAt: todo.updatedAt,
        channelId: agentChannelId,
        modelId: agentModelId ?? undefined,
      })
      setTodos((items) => items.map((item) => item.id === updatedTodo.id ? updatedTodo : item))
      setAgentSessions((items) => [session, ...items])
      if (!standalone) {
        setCurrentWorkspaceId(workspaceId)
        void window.electronAPI.updateSettings({ agentWorkspaceId: workspaceId }).catch(console.error)
        openSession('agent', session.id, session.title)
        setPendingPrompt({
          sessionId: session.id,
          message: buildTodoAgentPrompt(updatedTodo.id, session.agentRuntime === 'pi'),
          mentionedTodoIds: [updatedTodo.id],
        })
      }
      toast.success('已启动 Agent', { description: standalone ? `已在主窗口的「${workspace.name}」中开始处理` : `将在「${workspace.name}」中处理此 Todo` })
    } catch (error) {
      console.error('[Todo] 启动 Agent 失败:', error)
      const message = error instanceof Error ? error.message : '请稍后重试'
      toast.error(message.includes(PLANNING_CONFLICT_ERROR) ? 'Todo 已在其他窗口更新，请确认项目后再启动' : '启动 Agent 失败', {
        description: message.includes(PLANNING_CONFLICT_ERROR) ? undefined : message,
      })
    } finally {
      setStartingTodoId(null)
    }
  }, [agentChannelId, agentModelId, agentWorkspaces, openSession, setAgentSessions, setCurrentWorkspaceId, setPendingPrompt, setTodos, standalone, startingTodoId])

  const dayVersion = useLocalDayVersion()
  const openTodos = todos.filter((todo) => todo.status === 'open')
  const todoGroupUsageCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const todo of todos) if (todo.status === 'open' && todo.groupId) counts.set(todo.groupId, (counts.get(todo.groupId) ?? 0) + 1)
    return counts
  }, [todos])
  const todoGroupHasAssociatedItems = React.useMemo(() => new Set(todos.flatMap((todo) => todo.groupId ? [todo.groupId] : [])), [todos])
  const todayEnd = React.useMemo(() => endOfToday(dayVersion), [dayVersion])
  const weekEnd = React.useMemo(() => endOfToday(addLocalDays(dayVersion, 7)), [dayVersion])
  const visibleTodos = view === 'all' ? openTodos
    : view === 'today' ? openTodos.filter((todo) => todo.dueAt !== undefined && todo.dueAt <= todayEnd)
      : view === 'upcoming' ? openTodos.filter((todo) => todo.dueAt !== undefined && todo.dueAt > todayEnd && todo.dueAt <= weekEnd)
        : view === 'completed' ? todos.filter((todo) => todo.status === 'completed')
          : openTodos.filter((todo) => todo.groupId === view.slice('group:'.length))
  const viewTitle = view === 'all' ? '全部任务' : view === 'today' ? '今天' : view === 'upcoming' ? '未来 7 天' : view === 'completed' ? '已完成' : groups.find((group) => `group:${group.id}` === view)?.name ?? '分组'
  const count = (predicate: (todo: Todo) => boolean): number => openTodos.filter(predicate).length

  const navItems: Array<{ id: TodoListView; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'all', label: '全部任务', icon: <ListTodo size={15} />, count: openTodos.length },
    { id: 'today', label: '今天', icon: <CalendarDays size={15} />, count: count((todo) => todo.dueAt !== undefined && todo.dueAt <= todayEnd) },
    { id: 'upcoming', label: '未来 7 天', icon: <ChevronRight size={15} />, count: count((todo) => todo.dueAt !== undefined && todo.dueAt > todayEnd && todo.dueAt <= weekEnd) },
    { id: 'completed', label: '已完成', icon: <Check size={15} /> },
  ]

  return (
    <section className="relative h-full min-h-[580px] overflow-hidden rounded-none border border-border/60 bg-card">
      <div className="grid h-full min-h-0 w-full grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-border/60 bg-muted/15 p-3 scrollbar-thin">
          <div className="px-2 pb-3 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Todo</div>
          <nav className="space-y-1" aria-label="Todo 清单">
            {navItems.map((item) => <button key={item.id} type="button" onClick={() => { setView(item.id); setSelectedId(null) }} className={cn('flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors', view === item.id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground')}><span className="text-muted-foreground">{item.icon}</span><span className="flex-1 text-left">{item.label}</span>{item.count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>}</button>)}
          </nav>
          <div className="mt-7"><div className="flex items-center justify-between px-2 pb-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Todo 分组</span><PlanningGroupManager scope="todo" groups={groups} itemLabel="Todo" getUsageCount={(groupId) => todoGroupUsageCounts.get(groupId) ?? 0} hasAssociatedItems={(groupId) => todoGroupHasAssociatedItems.has(groupId)} showDeletionCount={false} onCreate={createTodoGroup} onRename={renameTodoGroup} onDelete={deleteTodoGroup} onCreated={(group) => { setView(`group:${group.id}`); setSelectedId(null) }} trigger={<button type="button" className="min-h-10 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground">管理</button>} /></div><div className="space-y-1">{groups.map((group) => { const id = `group:${group.id}` as TodoListView; return <button key={group.id} type="button" onClick={() => { setView(id); setSelectedId(null) }} className={cn('flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors', view === id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground')}><span className="size-2 rounded-full" style={{ backgroundColor: group.color ?? 'currentColor' }} /><span className="flex-1 truncate text-left">{group.name}</span><span className="text-xs tabular-nums text-muted-foreground">{todoGroupUsageCounts.get(group.id) ?? 0}</span></button> })}</div></div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/60">
          <div className="border-b border-border/60 px-5 py-4">
            <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{viewTitle}</h2>{view !== 'completed' && <span className="text-xs tabular-nums text-muted-foreground">{visibleTodos.length} 项</span>}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{visibleTodos.length ? visibleTodos.map((todo) => <TodoListItem key={todo.id} todo={todo} selected={selectedId === todo.id} todayEnd={todayEnd} onSelect={() => setSelectedId(todo.id)} onToggle={() => void completeTodo(todo)} onDelete={() => setTodoPendingDeletion(todo)} />) : <div className="flex h-full min-h-56 items-center justify-center px-8 text-center text-sm text-muted-foreground">这里还没有任务。点击右上角“新建 Todo”或按 ⌘N 即可添加。</div>}</div>
        </div>

        {selected && <PlanningFloatingInspector label="Todo 详情" onClose={() => setSelectedId(null)}><div className="space-y-7 p-5">
          {todoConflict && <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"><span>此 Todo 已在其他窗口更新，请重新加载后再编辑。</span><Button type="button" variant="link" size="sm" className="h-auto shrink-0 px-0 text-xs" onClick={reloadTodoDetail}>重新加载</Button></div>}
          <div className="pr-12"><label className="sr-only" htmlFor="todo-title">任务标题</label><Input id="todo-title" value={detailTitle} onChange={(event) => { detailTitleRef.current = event.target.value; setDetailTitle(event.target.value) }} onBlur={() => { if (!todoConflict && detailTitle.trim() && detailTitle.trim() !== selected.title) void updateTodo(selected.id, { title: detailTitle.trim(), expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt }, 'title') }} disabled={todoConflict} className="h-auto border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0" /></div><div><label className="mb-2 block text-xs font-medium text-muted-foreground">描述</label><Textarea value={detailNotes} onChange={(event) => { detailNotesRef.current = event.target.value; setDetailNotes(event.target.value) }} onBlur={() => { if (!todoConflict && detailNotes !== (selected.notes ?? '')) void updateTodo(selected.id, { notes: detailNotes, expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt }, 'notes') }} placeholder="添加描述…" disabled={todoConflict} className="min-h-64 resize-y overflow-y-auto scrollbar-thin border-0 bg-muted/35 shadow-none focus-visible:ring-2" /></div><DetailSection title="时间"><DetailField label="计划完成时间"><TodoDatePicker value={selected.dueAt} onChange={(dueAt) => void updateTodo(selected.id, { dueAt: dueAt ?? null, expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt })} className="h-8 w-full justify-start bg-muted/45 text-xs text-foreground hover:bg-muted" /></DetailField></DetailSection><DetailSection title="组织"><DetailField label="优先级"><Select value={selected.priority} onValueChange={(value) => void updateTodo(selected.id, { priority: value as Todo['priority'], expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt })}><SelectTrigger className="h-8 border-0 bg-muted/45 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">高优先级</SelectItem><SelectItem value="medium">中优先级</SelectItem><SelectItem value="low">低优先级</SelectItem></SelectContent></Select></DetailField><DetailField label="Todo 分组"><Select value={selected.groupId ?? '__none__'} onValueChange={(value) => void updateTodo(selected.id, { groupId: value === '__none__' ? null : value, expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt })}><SelectTrigger className="h-8 border-0 bg-muted/45 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">不分组</SelectItem>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></DetailField><DetailField label="标签"><div className="flex flex-wrap gap-1">{tags.length ? tags.map((tag) => <button key={tag.id} type="button" onClick={() => void updateTodo(selected.id, { tagIds: selected.tags.some((item) => item.id === tag.id) ? selected.tags.filter((item) => item.id !== tag.id).map((item) => item.id) : [...selected.tags.map((item) => item.id), tag.id], expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt })} className={cn('rounded-md px-2 py-1 text-xs transition-colors', selected.tags.some((item) => item.id === tag.id) ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted')}>#{tag.name}</button>) : <span className="text-xs text-muted-foreground">暂无标签</span>}</div></DetailField></DetailSection><DetailSection title="项目与 Agent"><DetailField label="执行项目"><Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}><PopoverTrigger asChild><button type="button" disabled={startingTodoId === selected.id || assigningTodoId === selected.id || agentWorkspaces.length === 0} className="flex h-9 w-full items-center gap-2 rounded-md bg-muted/45 px-2 text-left text-xs transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"><span className="min-w-0 flex-1 truncate">{selected.workspaceId ? agentWorkspaces.find((workspace) => workspace.id === selected.workspaceId)?.name ?? '关联项目已不可用' : agentWorkspaces.length ? '选择项目' : '暂无可用项目'}</span><ChevronRight size={14} className="shrink-0 text-muted-foreground" /></button></PopoverTrigger><PopoverContent align="start" className="w-72 overflow-hidden p-1"><p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">选择 Todo 的执行项目</p><div className="max-h-60 overflow-y-auto">{agentWorkspaces.map((workspace) => { const isCurrent = selected.workspaceId === workspace.id; const isAssigning = assigningTodoId === selected.id; return <button key={workspace.id} type="button" disabled={isAssigning} onClick={() => void assignTodoWorkspace(selected, workspace.id)} className={cn('flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60', isCurrent && 'bg-primary/10')}><span className="min-w-0 flex-1 truncate">{workspace.name}</span><span className={cn('shrink-0 text-xs', isCurrent ? 'text-primary' : 'text-muted-foreground')}>{isAssigning ? '选择中…' : isCurrent ? '当前项目' : '选择'}</span></button> })}</div></PopoverContent></Popover></DetailField><Button type="button" size="sm" className="w-full" disabled={!selected.workspaceId || startingTodoId === selected.id || assigningTodoId === selected.id} onClick={() => { if (selected.workspaceId) void startTodoInWorkspace(selected, selected.workspaceId) }}><Bot size={15} />{startingTodoId === selected.id ? '启动中…' : '开始运行 Agent'}</Button><DetailField label="关联会话">{selected.sessionLinks.length ? <div className="space-y-1">{selected.sessionLinks.map((link) => { const session = agentSessions.find((item) => item.id === link.sessionId); return <button key={link.sessionId} type="button" disabled={!session || standalone} title={standalone && session ? '请在主窗口查看关联会话' : undefined} onClick={() => { if (session && !standalone) openSession('agent', session.id, session.title) }} className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors', session && !standalone ? 'bg-muted/45 hover:bg-muted' : 'cursor-not-allowed bg-muted/25 text-muted-foreground/60')}><span className="min-w-0 flex-1 truncate">{session?.title ?? '会话不可用'}</span><time className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{new Date(link.lastTouchedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></button> })}</div> : <span className="text-xs text-muted-foreground">尚未由 Agent Session 操作</span>}</DetailField></DetailSection><div className="flex items-center justify-between border-t border-border/60 pt-4"><Button size="sm" variant="ghost" onClick={() => void updateTodo(selected.id, { status: selected.status === 'completed' ? 'open' : 'completed', expectedUpdatedAt: todoBaseUpdatedAtRef.current ?? selected.updatedAt })}>{selected.status === 'completed' ? '恢复任务' : '标记完成'}</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setTodoPendingDeletion(selected)}><Trash2 size={14} />删除</Button></div></div></PlanningFloatingInspector>}
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="top-[34%] max-w-xl gap-0 p-3" hideClose>
          <DialogTitle className="sr-only">添加 Todo</DialogTitle>
          <form onSubmit={(event) => { event.preventDefault(); void createTodo() }} className="overflow-hidden rounded-none border border-border/60 bg-background focus-within:ring-1 focus-within:ring-ring/40">
            <label className="sr-only" htmlFor="create-todo-title">任务内容</label>
            <Textarea id="create-todo-title" autoFocus value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} onKeyDown={(event) => { if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return; event.preventDefault(); void createTodo() }} placeholder="输入任务内容，Enter 创建，Shift+Enter 换行" className="min-h-28 resize-y rounded-none border-0 bg-transparent px-3 py-3 text-lg shadow-none focus-visible:ring-0" />
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-border/60 bg-muted/20 px-1.5 py-1.5">
              <TodoDatePicker value={quickDueAt} onChange={setQuickDueAt} className="h-9 max-w-52" />
              <Select value={quickPriority} onValueChange={(value) => setQuickPriority(value as Todo['priority'])}><SelectTrigger className={cn('h-9 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm shadow-none hover:bg-muted/70', quickPriority === 'high' && 'text-rose-600 dark:text-rose-400')}><Flag size={18} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">高优先级</SelectItem><SelectItem value="medium">中优先级</SelectItem><SelectItem value="low">低优先级</SelectItem></SelectContent></Select>
              <Select value={quickGroupId} onValueChange={setQuickGroupId}><SelectTrigger className="h-9 w-auto max-w-52 gap-1.5 border-0 bg-transparent px-2 text-sm shadow-none hover:bg-muted/70"><ListTodo size={18} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">不分组</SelectItem>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select>
              <Button type="submit" size="sm" disabled={!quickTitle.trim() || isCreatingTodo} className="ml-auto h-9 px-4">{isCreatingTodo ? '添加中…' : '添加'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={todoPendingDeletion !== null} onOpenChange={(open) => { if (!open) setTodoPendingDeletion(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除 Todo</AlertDialogTitle><AlertDialogDescription>删除「{todoPendingDeletion?.title}」后无法恢复。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void deleteTodo()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <div><label className="mb-2 block text-xs font-medium text-muted-foreground">{label}</label>{children}</div>
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return <section className="space-y-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>
}

function TodoListItem({
  todo,
  selected,
  todayEnd,
  onSelect,
  onToggle,
  onDelete,
}: {
  todo: Todo
  selected: boolean
  todayEnd: number
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
}): React.ReactElement {
  const pendingReminders = todo.reminders.filter((reminder) => reminder.status === 'pending').length
  const priorityLabel = todo.priority === 'high' ? '高优先级' : todo.priority === 'low' ? '低优先级' : '中优先级'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }}
      className={cn('group flex min-h-[68px] w-full items-center gap-3 border-b border-border/50 px-5 py-2 text-left transition-colors focus:outline-none', selected ? 'bg-primary/8' : 'hover:bg-muted/45 focus-visible:bg-muted/45')}
    >
      <button type="button" aria-label={`${todo.status === 'completed' ? '恢复' : '完成'} ${todo.title}`} onClick={(event) => { event.stopPropagation(); onToggle() }} className={cn('mt-0.5 flex size-5 shrink-0 self-start items-center justify-center rounded-sm border transition-colors', todo.status === 'completed' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent hover:border-primary hover:bg-primary hover:text-primary-foreground')}><Check size={12} /></button>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium', todo.status === 'completed' && 'text-muted-foreground line-through')}>{todo.title}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {todo.dueAt && <TodoMetaBadge tone={todo.dueAt < Date.now() && todo.status === 'open' ? 'overdue' : todo.dueAt <= todayEnd ? 'today' : 'neutral'}>{todo.dueAt < Date.now() && todo.status === 'open' ? `已逾期 · ${dateTimeLabel(todo.dueAt)}` : `计划 ${dateTimeLabel(todo.dueAt)}`}</TodoMetaBadge>}
          <TodoMetaBadge tone={todo.priority === 'high' ? 'high' : todo.priority === 'low' ? 'low' : 'medium'}>{priorityLabel}</TodoMetaBadge>
          {todo.group && <TodoMetaBadge>{todo.group.name}</TodoMetaBadge>}
          {todo.tags.map((tag) => <TodoMetaBadge key={tag.id}>#{tag.name}</TodoMetaBadge>)}
          {pendingReminders > 0 && <TodoMetaBadge>提醒 {pendingReminders}</TodoMetaBadge>}
          {todo.sessionLinks.length > 0 && <TodoMetaBadge>会话 {todo.sessionLinks.length}</TodoMetaBadge>}
        </span>
      </span>
      <button type="button" aria-label={`删除 ${todo.title}`} onClick={(event) => { event.stopPropagation(); onDelete() }} onKeyDown={(event) => event.stopPropagation()} className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:outline-none"><Trash2 size={16} /></button>
    </div>
  )
}

function TodoMetaBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'today' | 'overdue' | 'high' | 'medium' | 'low'
}): React.ReactElement {
  const toneClass = tone === 'overdue' ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
    : tone === 'today' ? 'bg-amber-500/12 text-amber-800 dark:text-amber-200'
      : tone === 'high' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : tone === 'medium' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200'
          : tone === 'low' ? 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
            : 'bg-muted/70 text-muted-foreground'
  return <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] leading-none transition-colors', toneClass)}>{children}</span>
}
