import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { CalendarDays, ChevronLeft, ChevronRight, Folder, ListTodo, Plus, Repeat2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PLANNING_CONFLICT_ERROR, AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY, getAutomationOccurrencesByDay } from '@proma/shared'
import type { Automation, CalendarEvent, PlanningGroup, PlanningTag, Todo } from '@proma/shared'
import { cn } from '@/lib/utils'
import { automationsAtom } from '@/atoms/automation-atoms'
import { calendarEventsAtom, calendarPlanningGroupsAtom, planningCalendarCreateRequestAtom, planningTagsAtom, todosAtom } from '@/atoms/planning-atoms'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TodoDatePicker, isTodoDateOnly } from '@/components/ui/todo-date-picker'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { PlanningFloatingInspector } from '@/components/planning/PlanningFloatingInspector'
import { PlanningGroupManager } from '@/components/planning/PlanningGroupManager'

const DEFAULT_EVENT_DURATION = 60 * 60 * 1000
const DRAG_SNAP_MINUTES = 15
const CALENDAR_GROUP_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#d97706', '#059669', '#0891b2']

function calendarGroupColor(group?: { id: string; color?: string }): string | undefined {
  if (!group) return undefined
  if (group.color) return group.color
  let hash = 0
  for (const character of group.id) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return CALENDAR_GROUP_COLORS[Math.abs(hash) % CALENDAR_GROUP_COLORS.length]
}

function calendarEventGroupColor(event: CalendarEvent): string | undefined {
  return calendarGroupColor(event.group)
}

type CalendarMode = 'month' | 'week'

interface CalendarCreatePointer {
  clientX: number
  clientY: number
}

interface CalendarPopoverAnchor {
  x: number
  y: number
}

interface CalendarDraftPreview {
  startAt: number
  endAt: number
  allDay: boolean
}

interface EventDraft {
  title: string
  notes: string
  startAt: number
  endAt: number
  allDay: boolean
  groupId: string
  tagIds: string[]
  todoId: string
}

type EventSaveResult =
  | { kind: 'saved'; event: CalendarEvent }
  | { kind: 'conflict' }
  | { kind: 'failed' }

function isPlanningConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(PLANNING_CONFLICT_ERROR)
}

function startOfDay(value: number | Date): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function startOfWeek(value: number | Date): number {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

function addDays(value: number, amount: number): number {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date.getTime()
}

function nextDayStart(value: number): number {
  return addDays(startOfDay(value), 1)
}

function previousDayStart(value: number): number {
  return addDays(startOfDay(value), -1)
}

function atLocalMinute(day: number, minute: number): number {
  const date = new Date(day)
  date.setMinutes(minute, 0, 0)
  return date.getTime()
}

function useLocalDayStart(): number {
  const [dayStart, setDayStart] = React.useState(() => startOfDay(Date.now()))
  React.useEffect(() => {
    const scheduleNextMidnight = (): (() => void) => {
      const now = new Date()
      const next = new Date(now)
      next.setHours(24, 0, 0, 50)
      const timer = window.setTimeout(() => {
        setDayStart(startOfDay(Date.now()))
        cleanup = scheduleNextMidnight()
      }, Math.max(1_000, next.getTime() - now.getTime()))
      return () => window.clearTimeout(timer)
    }
    let cleanup = scheduleNextMidnight()
    return () => cleanup()
  }, [])
  return dayStart
}

function addMonths(value: number, amount: number): number {
  const date = new Date(value)
  date.setMonth(date.getMonth() + amount, 1)
  return date.getTime()
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
}

function formatDay(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(value)
}

function eventEndAt(event: CalendarEvent): number {
  return event.endAt ?? (event.allDay ? nextDayStart(event.startAt) : event.startAt + 30 * 60 * 1000)
}

function eventOccursOnDay(event: CalendarEvent, day: number): boolean {
  const dayEnd = nextDayStart(day)
  return event.startAt < dayEnd && eventEndAt(event) > day
}

function draftFromEvent(event?: CalendarEvent, startAt = Math.ceil(Date.now() / DEFAULT_EVENT_DURATION) * DEFAULT_EVENT_DURATION, endAt = startAt + DEFAULT_EVENT_DURATION): EventDraft {
  return {
    title: event?.title ?? '',
    notes: event?.notes ?? '',
    startAt: event?.startAt ?? startAt,
    endAt: event?.endAt ?? endAt,
    allDay: event?.allDay ?? false,
    groupId: event?.groupId ?? '__none__',
    tagIds: event?.tags.map((tag) => tag.id) ?? [],
    todoId: event?.todoId ?? '__none__',
  }
}

export function CalendarWorkspace(): React.ReactElement {
  const calendarRef = React.useRef<HTMLElement>(null)
  const calendarBodyRef = React.useRef<HTMLDivElement>(null)
  const [events, setEvents] = useAtom(calendarEventsAtom)
  const todos = useAtomValue(todosAtom)
  const automations = useAtomValue(automationsAtom)
  const groups = useAtomValue(calendarPlanningGroupsAtom)
  const setGroups = useSetAtom(calendarPlanningGroupsAtom)
  const tags = useAtomValue(planningTagsAtom)
  const [mode, setMode] = React.useState<CalendarMode>('week')
  const [cursor, setCursor] = React.useState(() => Date.now())
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedTodoId, setSelectedTodoId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createAnchor, setCreateAnchor] = React.useState<CalendarPopoverAnchor | undefined>()
  const [showDraftPreview, setShowDraftPreview] = React.useState(false)
  const [eventPendingDeletion, setEventPendingDeletion] = React.useState<CalendarEvent | null>(null)
  const [draft, setDraft] = React.useState<EventDraft>(() => draftFromEvent())
  const [saving, setSaving] = React.useState(false)
  const today = useLocalDayStart()

  const selected = events.find((event) => event.id === selectedId)
  const selectedTodo = todos.find((todo) => todo.id === selectedTodoId)
  const openTodos = todos.filter((todo) => todo.status === 'open')
  const activeAutomations = automations.filter((automation) => automation.active)
  const calendarGroupUsageCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of events) if (event.groupId) counts.set(event.groupId, (counts.get(event.groupId) ?? 0) + 1)
    return counts
  }, [events])
  const calendarCreateRequest = useAtomValue(planningCalendarCreateRequestAtom)
  const handledCreateRequest = React.useRef(calendarCreateRequest)
  const rangeStart = mode === 'week' ? startOfWeek(cursor) : new Date(new Date(cursor).getFullYear(), new Date(cursor).getMonth(), 1).getTime()
  const heading = mode === 'week'
    ? `${formatDay(rangeStart)} — ${formatDay(addDays(rangeStart, 6))}`
    : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(rangeStart)

  const openCreate = React.useCallback((startAt?: number, endAt?: number, pointer?: CalendarCreatePointer): void => {
    const base = startAt ?? Math.ceil(Date.now() / DEFAULT_EVENT_DURATION) * DEFAULT_EVENT_DURATION
    const finish = endAt && endAt > base ? endAt : base + DEFAULT_EVENT_DURATION
    const bounds = calendarRef.current?.getBoundingClientRect()
    setCreateAnchor(bounds && pointer ? {
      x: Math.max(16, Math.min(bounds.width - 16, pointer.clientX - bounds.left)),
      y: Math.max(16, Math.min(bounds.height - 16, pointer.clientY - bounds.top)),
    } : undefined)
    setDraft(draftFromEvent(undefined, base, finish))
    setShowDraftPreview(endAt !== undefined)
    setCreateOpen(true)
  }, [])

  React.useEffect(() => {
    if (calendarCreateRequest === handledCreateRequest.current) return
    handledCreateRequest.current = calendarCreateRequest
    openCreate()
  }, [calendarCreateRequest, openCreate])

  const createCalendarGroup = React.useCallback(async (name: string): Promise<PlanningGroup | undefined> => {
    try {
      const group = await window.electronAPI.createPlanningGroup({ scope: 'calendar', name })
      setGroups((current) => [...current, group].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN')))
      return group
    } catch (error) {
      console.error('[日程] 创建分组失败:', error)
      toast.error('创建日程分组失败：名称可能已存在')
      return undefined
    }
  }, [setGroups])

  const renameCalendarGroup = React.useCallback(async (group: PlanningGroup, name: string): Promise<PlanningGroup | undefined> => {
    try {
      const updated = await window.electronAPI.updatePlanningGroup({ id: group.id, scope: 'calendar', name })
      if (!updated) throw new Error('分组不存在')
      setGroups((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEvents((current) => current.map((event) => event.groupId === updated.id ? { ...event, group: updated } : event))
      toast.success('已重命名日程分组')
      return updated
    } catch (error) {
      console.error('[日程] 重命名分组失败:', error)
      toast.error('重命名日程分组失败：名称可能已存在')
      return undefined
    }
  }, [setEvents, setGroups])

  const deleteCalendarGroup = React.useCallback(async (group: PlanningGroup): Promise<boolean> => {
    try {
      const deleted = await window.electronAPI.deletePlanningGroup('calendar', group.id)
      if (!deleted) throw new Error('分组不存在')
      setGroups((current) => current.filter((item) => item.id !== group.id))
      setEvents((current) => current.map((event) => event.groupId === group.id ? { ...event, groupId: undefined, group: undefined } : event))
      setDraft((current) => current.groupId === group.id ? { ...current, groupId: '__none__' } : current)
      toast.success('已删除日程分组')
      return true
    } catch (error) {
      console.error('[日程] 删除分组失败:', error)
      toast.error('删除日程分组失败')
      return false
    }
  }, [setEvents, setGroups])

  const createEvent = async (): Promise<void> => {
    if (!draft.title.trim()) return
    if (draft.endAt < draft.startAt) {
      toast.error('结束时间不能早于开始时间')
      return
    }
    setSaving(true)
    try {
      const event = await window.electronAPI.createCalendarEvent({
        title: draft.title.trim(),
        notes: draft.notes,
        startAt: draft.startAt,
        endAt: draft.endAt,
        allDay: draft.allDay,
        groupId: draft.groupId === '__none__' ? undefined : draft.groupId,
        tagIds: draft.tagIds,
        todoId: draft.todoId === '__none__' ? undefined : draft.todoId,
      })
      setEvents((current) => [...current, event].sort((a, b) => a.startAt - b.startAt))
      setSelectedTodoId(null)
      setSelectedId(null)
      setShowDraftPreview(false)
      setCreateOpen(false)
      toast.success('已创建日程')
    } catch (error) {
      console.error('[日程] 创建失败:', error)
      toast.error('创建日程失败')
    } finally {
      setSaving(false)
    }
  }

  const updateEvent = React.useCallback(async (id: string, next: EventDraft, expectedUpdatedAt: number, silent = false): Promise<EventSaveResult> => {
    if (!next.title.trim()) return { kind: 'failed' }
    if (next.endAt < next.startAt) {
      if (!silent) toast.error('结束时间不能早于开始时间')
      return { kind: 'failed' }
    }
    try {
      const event = await window.electronAPI.updateCalendarEvent({
        id,
        title: next.title.trim(),
        notes: next.notes,
        startAt: next.startAt,
        endAt: next.endAt,
        allDay: next.allDay,
        groupId: next.groupId === '__none__' ? null : next.groupId,
        tagIds: next.tagIds,
        todoId: next.todoId === '__none__' ? null : next.todoId,
        expectedUpdatedAt,
      })
      if (!event) throw new Error('日程不存在')
      setEvents((current) => current.map((item) => item.id === id ? event : item))
      if (!silent) toast.success('已更新日程')
      return { kind: 'saved', event }
    } catch (error) {
      if (isPlanningConflictError(error)) {
        if (!silent) toast.error('日程已在其他窗口更新，请重新加载后再试')
        return { kind: 'conflict' }
      }
      console.error('[日程] 更新失败:', error)
      if (!silent) toast.error('更新日程失败')
      return { kind: 'failed' }
    }
  }, [setEvents])

  const requestDeleteEvent = async (event: CalendarEvent): Promise<void> => {
    setEventPendingDeletion(event)
  }
  const deleteEvent = async (): Promise<void> => {
    const event = eventPendingDeletion
    if (!event) return
    try {
      await window.electronAPI.deleteCalendarEvent(event.id)
      setEvents((current) => current.filter((item) => item.id !== event.id))
      setSelectedId(null)
      setEventPendingDeletion(null)
      toast.success('已删除日程')
    } catch (error) {
      console.error('[日程] 删除失败:', error)
      toast.error('删除日程失败')
    }
  }

  const selectEvent = (id: string): void => {
    setSelectedTodoId(null)
    setSelectedId(id)
  }
  const selectTodo = (id: string): void => {
    setSelectedId(null)
    setSelectedTodoId(id)
  }

  const navigate = (amount: number): void => setCursor((current) => mode === 'week' ? addDays(current, amount * 7) : addMonths(current, amount))

  // 月视图保留离散翻页；周视图由 WeekCalendar 的原生横向轨道处理连续触控板滚动。
  React.useEffect(() => {
    if (mode !== 'month') return
    const element = calendarBodyRef.current
    if (!element) return
    const FLIP_THRESHOLD_PX = 120
    const FLIP_COOLDOWN_MS = 700
    let accumulatedX = 0
    let lastFlipAt = 0
    const handleWheel = (event: WheelEvent): void => {
      const deltaX = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaX * 33 : event.deltaX
      if (Math.abs(deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      const now = Date.now()
      if (now - lastFlipAt < FLIP_COOLDOWN_MS) {
        accumulatedX = 0 // 冷却期持续清零，吸收惯性滑动的尾巴，避免连翻
        return
      }
      accumulatedX += deltaX
      if (Math.abs(accumulatedX) >= FLIP_THRESHOLD_PX) {
        const direction = accumulatedX > 0 ? 1 : -1
        setCursor((current) => addMonths(current, direction))
        accumulatedX = 0
        lastFlipAt = now
      }
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [mode])
  const handleCreateOpenChange = (open: boolean): void => {
    setCreateOpen(open)
    if (!open) {
      // Radix 会在退出动画结束前保留 Content；此时重置锚点会让它短暂跳回默认新建位置。
      // 下一次 openCreate 会主动设置新锚点，因此关闭时保留当前锚点即可。
      setShowDraftPreview(false)
    }
  }

  return (
    <section ref={calendarRef} className="relative flex h-full min-h-[560px] flex-col overflow-hidden rounded-none border border-border/60 bg-card">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5">
            <Button type="button" variant={mode === 'week' ? 'secondary' : 'ghost'} size="sm" className="h-10" onClick={() => setMode('week')}>周</Button>
            <Button type="button" variant={mode === 'month' ? 'secondary' : 'ghost'} size="sm" className="h-10" onClick={() => setMode('month')}>月</Button>
          </div>
          <PlanningGroupManager scope="calendar" groups={groups} itemLabel="日程" getUsageCount={(groupId) => calendarGroupUsageCounts.get(groupId) ?? 0} onCreate={createCalendarGroup} onRename={renameCalendarGroup} onDelete={deleteCalendarGroup} trigger={<Button type="button" variant="ghost" className="h-10 gap-1.5 px-2.5 text-sm"><Folder size={16} />分组</Button>} />
        </div>
        <div className="flex items-center gap-1.5"><Button type="button" variant="ghost" size="icon" className="size-10" aria-label="上一段时间" onClick={() => navigate(-1)}><ChevronLeft size={17} /></Button><h2 className="min-w-44 text-center text-sm font-semibold tabular-nums">{heading}</h2><Button type="button" variant="ghost" size="icon" className="size-10" aria-label="下一段时间" onClick={() => navigate(1)}><ChevronRight size={17} /></Button></div>
      </div>
      <div className="relative grid min-h-0 flex-1 grid-cols-1">
        <div ref={calendarBodyRef} className="min-h-0 overflow-hidden">
          {mode === 'month' ? <MonthCalendar monthStart={rangeStart} today={today} events={events} todos={openTodos} automations={activeAutomations} onSelectEvent={selectEvent} onSelectTodo={selectTodo} /> : <WeekCalendar weekStart={rangeStart} events={events} todos={openTodos} automations={activeAutomations} draftPreview={showDraftPreview && createOpen ? draft : undefined} quickCreateOpen={createOpen} onNavigate={navigate} onSelectEvent={selectEvent} onCreateAt={openCreate} onSelectTodo={selectTodo} />}
        </div>
        {selected && <CalendarEventDetail event={selected} groups={groups} tags={tags} todos={openTodos} onClose={() => setSelectedId(null)} onSave={updateEvent} onDelete={requestDeleteEvent} />}
        {selectedTodo && <CalendarTodoDetail todo={selectedTodo} onClose={() => setSelectedTodoId(null)} />}
      </div>
      <CalendarQuickCreatePopover open={createOpen} anchor={createAnchor} draft={draft} setDraft={setDraft} groups={groups} saving={saving} onCreateGroup={createCalendarGroup} onOpenChange={handleCreateOpenChange} onSave={() => void createEvent()} />
      <AlertDialog open={eventPendingDeletion !== null} onOpenChange={(open) => { if (!open) setEventPendingDeletion(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除日程</AlertDialogTitle><AlertDialogDescription>删除「{eventPendingDeletion?.title}」后无法恢复。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void deleteEvent()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** 月视图一天内的定时任务条目：同一任务同一天只显示一个标记，count 为当天触发次数 */
interface AutomationDayEntry {
  automation: Automation
  count: number
}

interface CalendarDayItems {
  events: CalendarEvent[]
  todos: Todo[]
  automations: AutomationDayEntry[]
}

function MonthCalendar({ monthStart, today, events, todos, automations, onSelectEvent, onSelectTodo }: { monthStart: number; today: number; events: CalendarEvent[]; todos: Todo[]; automations: Automation[]; onSelectEvent: (id: string) => void; onSelectTodo: (id: string) => void }): React.ReactElement {
  const monthDate = new Date(monthStart)
  const firstWeekday = monthDate.getDay()
  const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate()
  const weekCount = Math.ceil((firstWeekday + days) / 7)
  const cells = React.useMemo(() => Array.from({ length: weekCount * 7 }, (_, index) => index - firstWeekday + 1), [firstWeekday, weekCount])
  const visibleDays = React.useMemo(() => cells.flatMap((day) => {
    if (day <= 0 || day > days) return []
    return [startOfDay(new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 9).getTime())]
  }), [cells, days, monthStart])
  const itemsByDay = React.useMemo(() => {
    const result = new Map<number, CalendarDayItems>()
    for (const day of visibleDays) result.set(day, { events: [], todos: [], automations: [] })
    for (const event of events) {
      for (const day of visibleDays) if (eventOccursOnDay(event, day)) result.get(day)!.events.push(event)
    }
    for (const todo of todos) {
      if (!todo.dueAt) continue
      result.get(startOfDay(todo.dueAt))?.todos.push(todo)
    }
    // 定时任务：按调度规则展开可见范围内的全部触发日（调度器只持久化 nextRunAt 一个锚点），
    // 同一任务同一天聚合为一个标记 + count，避免高频 interval 刷屏
    const monthRangeStart = visibleDays[0]
    const monthRangeEndDay = visibleDays[visibleDays.length - 1]
    if (monthRangeStart !== undefined && monthRangeEndDay !== undefined) {
      const monthRangeEnd = nextDayStart(monthRangeEndDay) - 1
      for (const automation of automations) {
        for (const occurrence of getAutomationOccurrencesByDay(automation, monthRangeStart, monthRangeEnd)) {
          result.get(occurrence.day)?.automations.push({ automation, count: occurrence.count })
        }
      }
    }
    return result
  }, [automations, events, todos, visibleDays])

  return <div className="flex h-full min-h-0 flex-col"><div className="grid shrink-0 grid-cols-7 border-b border-border/60 text-center text-xs text-muted-foreground">{['日', '一', '二', '三', '四', '五', '六'].map((day) => <div key={day} className="py-2.5">{day}</div>)}</div><div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}>{cells.map((day, index) => { const valid = day > 0 && day <= days; const timestamp = valid ? startOfDay(new Date(monthDate.getFullYear(), monthDate.getMonth(), day, 9).getTime()) : undefined; const items = timestamp === undefined ? undefined : itemsByDay.get(timestamp); return <div key={index} className="flex min-h-0 flex-col border-b border-r border-border/50 p-2 last:border-r-0 hover:bg-muted/20 sm:p-2.5"><time className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums', timestamp === today && 'bg-primary text-primary-foreground')}>{valid ? day : ''}</time><div className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto scrollbar-thin">{items?.events.map((event) => <CalendarEventMarker key={event.id} event={event} onSelect={() => onSelectEvent(event.id)} className="flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-left text-[11px]" />)}{items?.todos.map((todo) => <TodoCalendarMarker key={todo.id} todo={todo} onSelect={() => onSelectTodo(todo.id)} className="bg-amber-500/15 text-amber-800 dark:text-amber-200" />)}{items?.automations.map((entry) => <AutomationCalendarMarker key={entry.automation.id} automation={entry.automation} occurrenceCount={entry.count} className="flex min-w-0 items-center gap-1 bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-700 dark:text-violet-300" />)}</div></div> })}</div></div>
}

function TodoCalendarMarker({ todo, onSelect, className }: { todo: Todo; onSelect: () => void; className: string }): React.ReactElement {
  return <Tooltip delayDuration={250}><TooltipTrigger asChild><button type="button" onClick={(event) => { event.stopPropagation(); onSelect() }} className={cn('flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-left text-[11px] shadow-sm', className)}><ListTodo className="size-3 shrink-0" /><span className="truncate">{todo.title}</span></button></TooltipTrigger><TooltipContent side="right" className="w-72 rounded-none p-3"><TodoPreviewContent todo={todo} /></TooltipContent></Tooltip>
}

function TodoPreviewContent({ todo }: { todo: Todo }): React.ReactElement {
  const priority = todo.priority === 'high' ? '高优先级' : todo.priority === 'low' ? '低优先级' : '中优先级'
  return <div className="space-y-2"><div><p className="font-medium text-tooltip-foreground">{todo.title}</p>{todo.notes && <p className="mt-1 line-clamp-3 leading-relaxed text-tooltip-muted">{todo.notes}</p>}</div><div className="flex flex-wrap gap-1.5 text-[11px] text-tooltip-muted"><span>{priority}</span>{todo.dueAt && <span>计划 {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(todo.dueAt)}</span>}{todo.group && <span>{todo.group.name}</span>}{todo.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div></div>
}

function formatAutomationTimestamp(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
}

function formatAutomationSchedule(automation: Automation): string {
  const time = automation.timeOfDay ?? '09:00'
  if (automation.scheduleType === 'interval') {
    const minutes = Math.max(1, automation.intervalMinutes)
    return minutes % 60 === 0 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`
  }
  if (automation.scheduleType === 'daily') return `每天 ${time}`
  if (automation.scheduleType === 'weekly') {
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][automation.dayOfWeek ?? 1] ?? '周一'
    return `每${weekday} ${time}`
  }
  if (automation.scheduleType === 'monthly') return `每月 ${automation.dayOfMonth ?? 1} 日 ${time}`
  return '单次执行'
}

function AutomationPreviewContent({ automation, occurrenceCount }: { automation: Automation; occurrenceCount: number }): React.ReactElement {
  const nextRun = formatAutomationTimestamp(automation.nextRunAt)
  const runBudget = automation.maxRuns === undefined ? undefined : `已运行 ${automation.runCount ?? 0}/${automation.maxRuns} 次`
  return <div className="space-y-2"><div><p className="font-medium text-tooltip-foreground">{automation.name}</p>{automation.prompt && <p className="mt-1 line-clamp-3 leading-relaxed text-tooltip-muted">{automation.prompt}</p>}</div><div className="flex flex-wrap gap-1.5 text-[11px] text-tooltip-muted"><span>{formatAutomationSchedule(automation)}</span>{nextRun && <span>下次 {nextRun}</span>}{occurrenceCount > 1 && <span>当天计划 {occurrenceCount} 次</span>}{runBudget && <span>{runBudget}</span>}</div></div>
}

function AutomationCalendarMarker({ automation, occurrenceCount = 1, className, iconClassName, style }: { automation: Automation; occurrenceCount?: number; className: string; iconClassName?: string; style?: React.CSSProperties }): React.ReactElement {
  return <Tooltip delayDuration={250}><TooltipTrigger asChild><div data-calendar-item className={className} style={style}><Repeat2 className={cn('size-3 shrink-0', iconClassName)} /><span className="truncate">{automation.name}</span>{occurrenceCount > 1 && <span className="shrink-0 tabular-nums opacity-70">×{occurrenceCount}</span>}</div></TooltipTrigger><TooltipContent side="right" className="w-72 rounded-none p-3"><AutomationPreviewContent automation={automation} occurrenceCount={occurrenceCount} /></TooltipContent></Tooltip>
}


function CalendarEventMarker({ event, onSelect, className, style, children }: { event: CalendarEvent; onSelect: () => void; className: string; style?: React.CSSProperties; children?: React.ReactNode }): React.ReactElement {
  const groupColor = calendarEventGroupColor(event)
  const markerStyle = groupColor ? { ...style, backgroundColor: groupColor } : style
  return <Tooltip delayDuration={250}><TooltipTrigger asChild><button type="button" onClick={(click) => { click.stopPropagation(); onSelect() }} className={cn('transition-[filter,opacity] hover:brightness-95', groupColor ? 'text-white' : 'bg-primary/90 text-primary-foreground hover:bg-primary', className)} style={markerStyle}>{children ?? <><CalendarDays className="size-3 shrink-0" /><span className="truncate">{event.title}</span></>}</button></TooltipTrigger><TooltipContent side="right" className="w-72 rounded-none p-3"><CalendarEventPreviewContent event={event} /></TooltipContent></Tooltip>
}

function CalendarEventPreviewContent({ event }: { event: CalendarEvent }): React.ReactElement {
  const time = event.allDay
    ? '全天'
    : `${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(event.startAt)} – ${formatTime(eventEndAt(event))}`
  return <div className="space-y-2"><div><p className="font-medium text-tooltip-foreground">{event.title}</p>{event.notes && <p className="mt-1 line-clamp-3 leading-relaxed text-tooltip-muted">{event.notes}</p>}</div><div className="flex flex-wrap gap-1.5 text-[11px] text-tooltip-muted"><span>{time}</span>{event.group && <span>{event.group.name}</span>}{event.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div></div>
}

type TimedItem =
  | { kind: 'event'; id: string; startAt: number; endAt: number; event: CalendarEvent }
  | { kind: 'todo'; id: string; startAt: number; endAt: number; todo: Todo }
  | { kind: 'automation'; id: string; startAt: number; endAt: number; automation: Automation; count: number }

interface TimedSegment {
  item: TimedItem
  startAt: number
  endAt: number
  lane: number
  laneCount: number
}

interface WeekDayItems {
  allDayEvents: CalendarEvent[]
  allDayTodos: Todo[]
  timedSegments: TimedSegment[]
}

/**
 * 对同一天内所有有时间点的项目做简单分栏：相交的项目并排，不相交的项目占满宽度。
 * Todo / 自动化采用短视觉时段，只解决可读性，不改变它们的真实截止/触发时间。
 */
function getTimedSegments(items: TimedItem[], day: number): TimedSegment[] {
  const dayEnd = nextDayStart(day)
  const raw = items
    .filter((item) => item.startAt < dayEnd && item.endAt > day)
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)

  const result: TimedSegment[] = []
  let active: TimedSegment[] = []
  let cluster: TimedSegment[] = []
  let clusterEnd = -Infinity
  let clusterLaneCount = 1

  const finishCluster = (): void => {
    for (const segment of cluster) segment.laneCount = clusterLaneCount
  }

  for (const item of raw) {
    const startAt = Math.max(item.startAt, day)
    const endAt = Math.min(item.endAt, dayEnd)
    if (startAt >= clusterEnd) {
      finishCluster()
      active = []
      cluster = []
      clusterEnd = -Infinity
      clusterLaneCount = 1
    }

    active = active.filter((segment) => segment.endAt > startAt)
    const occupiedLanes = new Set(active.map((segment) => segment.lane))
    let lane = 0
    while (occupiedLanes.has(lane)) lane += 1

    const segment: TimedSegment = { item, startAt, endAt, lane, laneCount: 1 }
    active.push(segment)
    cluster.push(segment)
    clusterEnd = Math.max(clusterEnd, endAt)
    clusterLaneCount = Math.max(clusterLaneCount, ...active.map((activeSegment) => activeSegment.lane + 1))
    result.push(segment)
  }

  finishCluster()
  return result
}

function minuteOffset(value: number, day: number): number {
  if (value <= day) return 0
  if (value >= nextDayStart(day)) return 24 * 60
  const date = new Date(value)
  return date.getHours() * 60 + date.getMinutes()
}

interface WeekTimeDrag {
  day: number
  anchorMinute: number
  pointerId: number
  clientY: number
  isDragging: boolean
}

interface WeekTimeSelection {
  day: number
  startMinute: number
  endMinute: number
}

interface WeekView {
  weekStart: number
  days: number[]
  dayItems: Map<number, WeekDayItems>
}

function buildWeekView(weekStart: number, events: CalendarEvent[], todos: Todo[], automations: Automation[]): WeekView {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const items = new Map<number, { allDayEvents: CalendarEvent[]; allDayTodos: Todo[]; timedItems: TimedItem[] }>()
  for (const day of days) items.set(day, { allDayEvents: [], allDayTodos: [], timedItems: [] })

  for (const event of events) {
    for (const day of days) {
      if (!eventOccursOnDay(event, day)) continue
      if (event.allDay) items.get(day)!.allDayEvents.push(event)
      else items.get(day)!.timedItems.push({ id: event.id, kind: 'event', startAt: event.startAt, endAt: eventEndAt(event), event })
    }
  }
  for (const todo of todos) {
    if (!todo.dueAt) continue
    const day = startOfDay(todo.dueAt)
    const item = items.get(day)
    if (!item) continue
    if (isTodoDateOnly(todo.dueAt)) item.allDayTodos.push(todo)
    else item.timedItems.push({ id: todo.id, kind: 'todo', startAt: todo.dueAt, endAt: todo.dueAt + 30 * 60 * 1000, todo })
  }

  const weekRangeEnd = nextDayStart(days[days.length - 1]!) - 1
  for (const automation of automations) {
    for (const occurrence of getAutomationOccurrencesByDay(automation, weekStart, weekRangeEnd)) {
      const item = items.get(occurrence.day)
      if (!item) continue
      if (occurrence.count <= AUTOMATION_OCCURRENCE_SAMPLES_PER_DAY) {
        for (const ts of occurrence.times) {
          item.timedItems.push({ id: `${automation.id}@${ts}`, kind: 'automation', startAt: ts, endAt: ts + 30 * 60 * 1000, automation, count: 1 })
        }
      } else {
        const first = occurrence.times[0]!
        item.timedItems.push({ id: `${automation.id}@${occurrence.day}`, kind: 'automation', startAt: first, endAt: first + 30 * 60 * 1000, automation, count: occurrence.count })
      }
    }
  }

  return {
    weekStart,
    days,
    dayItems: new Map(days.map((day) => {
      const item = items.get(day)!
      const result: WeekDayItems = { allDayEvents: item.allDayEvents, allDayTodos: item.allDayTodos, timedSegments: getTimedSegments(item.timedItems, day) }
      return [day, result]
    })),
  }
}

function WeekHeaderPanel({ week, today, active }: { week: WeekView; today: number; active: boolean }): React.ReactElement {
  return <div aria-hidden={!active} className="grid w-1/3 min-w-0 shrink-0 grid-cols-7 snap-start">{week.days.map((day) => <div key={day} className={cn('min-w-0 border-r border-border/60 px-2 py-2 text-center text-xs font-medium', startOfDay(day) === today && 'bg-primary/8 text-primary')}><span className="block">{new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(day)}</span><span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full tabular-nums">{new Date(day).getDate()}</span></div>)}</div>
}

function WeekAllDayPanel({ week, active, onSelectEvent, onSelectTodo }: { week: WeekView; active: boolean; onSelectEvent: (id: string) => void; onSelectTodo: (id: string) => void }): React.ReactElement {
  return <div aria-hidden={!active} className={cn('grid w-1/3 min-w-0 shrink-0 grid-cols-7 snap-start', !active && 'pointer-events-none')}>{week.days.map((day) => {
    const items = week.dayItems.get(day)!
    return <div key={day} className="min-h-12 min-w-0 border-r border-border/60 p-1.5">{items.allDayEvents.map((event) => <CalendarEventMarker key={event.id} event={event} onSelect={() => onSelectEvent(event.id)} className="mb-1 flex w-full min-w-0 items-center gap-1 px-1.5 py-1 text-left text-[11px] shadow-sm" />)}{items.allDayTodos.map((todo) => <div key={todo.id} className="mb-1"><TodoCalendarMarker todo={todo} onSelect={() => onSelectTodo(todo.id)} className="bg-amber-500/20 text-amber-900 dark:text-amber-100" /></div>)}</div>
  })}</div>
}

interface WeekTimePanelProps {
  week: WeekView
  hours: number[]
  hourHeight: number
  today: number
  currentMinute: number
  dragSelection: WeekTimeSelection | null
  previewSelection?: WeekTimeSelection
  interactive: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, day: number) => void
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>, day: number) => void
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>, day: number) => void
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>, day: number) => void
  onSelectEvent: (id: string) => void
  onSelectTodo: (id: string) => void
}

function WeekTimePanel({ week, hours, hourHeight, today, currentMinute, dragSelection, previewSelection, interactive, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onSelectEvent, onSelectTodo }: WeekTimePanelProps): React.ReactElement {
  const includesToday = today >= week.weekStart && today < addDays(week.weekStart, 7)
  return <div aria-hidden={!interactive} className={cn('grid h-full w-1/3 min-w-0 shrink-0 grid-cols-7 snap-start', !interactive && 'pointer-events-none')}>{week.days.map((day) => {
    const segments = week.dayItems.get(day)!.timedSegments
    const selection = interactive ? (dragSelection?.day === day ? dragSelection : previewSelection?.day === day ? previewSelection : undefined) : undefined
    return <div key={day} onPointerDown={interactive ? (event) => onPointerDown(event, day) : undefined} onPointerMove={interactive ? (event) => onPointerMove(event, day) : undefined} onPointerUp={interactive ? (event) => onPointerUp(event, day) : undefined} onPointerCancel={interactive ? (event) => onPointerCancel(event, day) : undefined} className={cn('relative min-w-0 border-r border-border/60', interactive && 'cursor-crosshair select-none')}>
      {hours.map((hour) => <div key={hour} className="absolute left-0 right-0 border-t-[0.5px] border-border/40" style={{ top: `${hour * hourHeight}px` }} />)}
      {segments.map((segment) => {
        const top = minuteOffset(segment.startAt, day) / 60 * hourHeight
        const height = Math.max(18, (minuteOffset(segment.endAt, day) - minuteOffset(segment.startAt, day)) / 60 * hourHeight)
        const laneWidth = 100 / segment.laneCount
        const style = { top: `${top}px`, height: `${height}px`, left: `calc(${segment.lane * laneWidth}% + 2px)`, width: `calc(${laneWidth}% - 4px)` }
        if (segment.item.kind === 'event') {
          const event = segment.item.event
          return <CalendarEventMarker key={`event-${event.id}`} event={event} onSelect={() => onSelectEvent(event.id)} className="absolute z-10 overflow-hidden border-l-2 border-primary-foreground/50 px-1.5 py-1 text-left text-[11px] shadow-sm" style={style}><span className="block truncate font-medium">{event.title}</span>{height >= 28 && <span className="block truncate text-primary-foreground/75">{formatTime(segment.startAt)}–{formatTime(segment.endAt)}</span>}</CalendarEventMarker>
        }
        if (segment.item.kind === 'todo') return <div key={`todo-${segment.item.id}`} className="absolute z-20" style={style}><TodoCalendarMarker todo={segment.item.todo} onSelect={() => onSelectTodo(segment.item.id)} className="h-full bg-amber-500/20 text-amber-900 dark:text-amber-100" /></div>
        return <AutomationCalendarMarker key={`automation-${segment.item.id}`} automation={segment.item.automation} occurrenceCount={segment.item.count} iconClassName="mt-0.5" className="absolute z-20 flex items-start gap-1 overflow-hidden bg-violet-500/20 px-1 py-0.5 text-[10px] text-violet-900 shadow-sm dark:text-violet-100" style={style} />
      })}
      {selection && <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 z-20 overflow-hidden border border-primary/70 border-l-2 bg-primary/15 px-1.5 py-1 text-[11px] text-primary shadow-sm" style={{ top: `${selection.startMinute / 60 * hourHeight}px`, height: `${(selection.endMinute - selection.startMinute) / 60 * hourHeight}px` }}>{selection.endMinute - selection.startMinute >= 30 && <span className="block truncate font-medium">新建日程 · {formatTime(atLocalMinute(day, selection.startMinute))}–{formatTime(atLocalMinute(day, selection.endMinute))}</span>}</div>}
      {includesToday && startOfDay(day) === today && <div className="pointer-events-none absolute inset-x-0 z-30 flex -translate-y-1/2 items-center" style={{ top: `${currentMinute / 60 * hourHeight}px` }}><span className="ml-0.5 size-2 shrink-0 rounded-full bg-primary" /><span className="h-px flex-1 bg-primary" /></div>}
    </div>
  })}</div>
}

function WeekCalendar({ weekStart, events, todos, automations, draftPreview, quickCreateOpen, onNavigate, onSelectEvent, onCreateAt, onSelectTodo }: { weekStart: number; events: CalendarEvent[]; todos: Todo[]; automations: Automation[]; draftPreview?: CalendarDraftPreview; quickCreateOpen: boolean; onNavigate: (amount: number) => void; onSelectEvent: (id: string) => void; onCreateAt: (startAt: number, endAt?: number, pointer?: CalendarCreatePointer) => void; onSelectTodo: (id: string) => void }): React.ReactElement {
  const weekViews = React.useMemo(() => [
    buildWeekView(addDays(weekStart, -7), events, todos, automations),
    buildWeekView(weekStart, events, todos, automations),
    buildWeekView(addDays(weekStart, 7), events, todos, automations),
  ], [automations, events, todos, weekStart])
  const hours = Array.from({ length: 24 }, (_, hour) => hour)
  const timeScrollRef = React.useRef<HTMLDivElement>(null)
  const headerScrollRef = React.useRef<HTMLDivElement>(null)
  const allDayScrollRef = React.useRef<HTMLDivElement>(null)
  const bodyScrollRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<WeekTimeDrag | null>(null)
  const [dragSelection, setDragSelection] = React.useState<WeekTimeSelection | null>(null)
  const [currentTime, setCurrentTime] = React.useState(() => Date.now())
  const [hourHeight, setHourHeight] = React.useState(56)
  const [viewportReady, setViewportReady] = React.useState(false)
  const focusedWeekRef = React.useRef<number | null>(null)
  const recenteringRef = React.useRef(false)
  const navigationPendingRef = React.useRef(false)
  const scrollSettlingRef = React.useRef(false)
  const scrollSettleTimerRef = React.useRef<number | undefined>()
  const scrollSettleFrameRef = React.useRef<number | undefined>()

  React.useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const now = currentTime
  const today = startOfDay(now)
  const isCurrentWeek = today >= weekStart && today < addDays(weekStart, 7)
  const currentMinute = minuteOffset(now, today)
  const totalHeight = hourHeight * 24
  const previewSelection = React.useMemo<WeekTimeSelection | undefined>(() => {
    if (!draftPreview || draftPreview.allDay) return undefined
    const day = startOfDay(draftPreview.startAt)
    const startMinute = minuteOffset(draftPreview.startAt, day)
    const endMinute = Math.max(startMinute + DRAG_SNAP_MINUTES, Math.min(24 * 60, minuteOffset(draftPreview.endAt, day)))
    return { day, startMinute, endMinute }
  }, [draftPreview?.allDay, draftPreview?.endAt, draftPreview?.startAt])

  React.useEffect(() => {
    if (previewSelection) setDragSelection(null)
  }, [previewSelection?.day, previewSelection?.endMinute, previewSelection?.startMinute])

  React.useLayoutEffect(() => {
    const viewport = timeScrollRef.current
    if (!viewport) return
    const updateHourHeight = (): void => {
      // 约 12 小时落在可视区：24 小时需要纵向滚动，同时短日程仍有可点击高度。
      setHourHeight(Math.max(44, Math.min(80, Math.round(viewport.clientHeight / 12))))
      setViewportReady(true)
    }
    updateHourHeight()
    const observer = new ResizeObserver(updateHourHeight)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  React.useLayoutEffect(() => {
    if (!isCurrentWeek) {
      focusedWeekRef.current = null
      return
    }
    const viewport = timeScrollRef.current
    if (!viewport || !viewportReady || focusedWeekRef.current === weekStart) return
    const frame = window.requestAnimationFrame(() => {
      const nowTop = currentMinute / 60 * hourHeight
      viewport.scrollTop = Math.max(0, Math.min(totalHeight - viewport.clientHeight, nowTop - viewport.clientHeight / 2))
      focusedWeekRef.current = weekStart
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentMinute, hourHeight, isCurrentWeek, totalHeight, viewportReady, weekStart])

  const getHorizontalScrollers = React.useCallback((): HTMLDivElement[] => [headerScrollRef.current, allDayScrollRef.current, bodyScrollRef.current].filter((element): element is HTMLDivElement => element !== null), [])
  const scrollToPanel = React.useCallback((panelIndex: number, behavior: ScrollBehavior = 'auto'): void => {
    for (const element of getHorizontalScrollers()) {
      const left = element.clientWidth * panelIndex
      if (behavior === 'auto') element.scrollLeft = left
      else element.scrollTo({ left, behavior })
    }
  }, [getHorizontalScrollers])
  const syncHorizontalScroll = React.useCallback((source: HTMLDivElement): void => {
    const ratio = source.clientWidth > 0 ? source.scrollLeft / source.clientWidth : 1
    for (const element of getHorizontalScrollers()) {
      if (element === source) continue
      const left = ratio * element.clientWidth
      if (Math.abs(element.scrollLeft - left) > 0.5) element.scrollLeft = left
    }
  }, [getHorizontalScrollers])
  const completeHorizontalScroll = React.useCallback((panelIndex: number): void => {
    if (panelIndex === 1 || navigationPendingRef.current) return
    navigationPendingRef.current = true
    recenteringRef.current = true
    onNavigate(panelIndex === 2 ? 1 : -1)
  }, [onNavigate])
  const settleHorizontalScroll = React.useCallback((): void => {
    if (recenteringRef.current || navigationPendingRef.current || scrollSettlingRef.current) return
    const viewport = bodyScrollRef.current
    if (!viewport || viewport.clientWidth <= 0) return
    const panelIndex = Math.max(0, Math.min(2, Math.round(viewport.scrollLeft / viewport.clientWidth)))
    const targetLeft = viewport.clientWidth * panelIndex
    const complete = (): void => {
      scrollSettlingRef.current = false
      completeHorizontalScroll(panelIndex)
    }
    if (Math.abs(viewport.scrollLeft - targetLeft) <= 1) {
      complete()
      return
    }
    scrollSettlingRef.current = true
    scrollToPanel(panelIndex, 'smooth')
    const startedAt = performance.now()
    const waitForSnap = (): void => {
      const current = bodyScrollRef.current
      if (!current) {
        scrollSettlingRef.current = false
        return
      }
      if (Math.abs(current.scrollLeft - targetLeft) <= 1 || performance.now() - startedAt > 700) {
        if (Math.abs(current.scrollLeft - targetLeft) > 1) scrollToPanel(panelIndex)
        complete()
        return
      }
      scrollSettleFrameRef.current = window.requestAnimationFrame(waitForSnap)
    }
    scrollSettleFrameRef.current = window.requestAnimationFrame(waitForSnap)
  }, [completeHorizontalScroll, scrollToPanel])
  const handleHorizontalScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    if (recenteringRef.current || navigationPendingRef.current || scrollSettlingRef.current) return
    syncHorizontalScroll(event.currentTarget)
    if (scrollSettleTimerRef.current !== undefined) window.clearTimeout(scrollSettleTimerRef.current)
    scrollSettleTimerRef.current = window.setTimeout(settleHorizontalScroll, 160)
  }, [settleHorizontalScroll, syncHorizontalScroll])

  React.useLayoutEffect(() => {
    recenteringRef.current = true
    scrollToPanel(1)
    const frame = window.requestAnimationFrame(() => {
      recenteringRef.current = false
      navigationPendingRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [scrollToPanel, weekStart])
  React.useEffect(() => () => {
    if (scrollSettleTimerRef.current !== undefined) window.clearTimeout(scrollSettleTimerRef.current)
    if (scrollSettleFrameRef.current !== undefined) window.cancelAnimationFrame(scrollSettleFrameRef.current)
  }, [])

  const minuteAtPosition = (clientY: number, target: HTMLDivElement): number => {
    const bounds = target.getBoundingClientRect()
    const rawMinutes = ((clientY - bounds.top) / bounds.height) * 24 * 60
    return Math.max(0, Math.min(24 * 60 - DRAG_SNAP_MINUTES, Math.round(rawMinutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES))
  }
  const selectionFrom = (day: number, anchorMinute: number, cursorMinute: number): WeekTimeSelection => ({
    day,
    startMinute: Math.min(anchorMinute, cursorMinute),
    endMinute: Math.min(24 * 60, Math.max(anchorMinute, cursorMinute) + DRAG_SNAP_MINUTES),
  })
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, day: number): void => {
    // 快速创建卡片打开期间，外部点击只用于关闭卡片，不能同时开启下一次拖拽创建。
    if (quickCreateOpen || event.button !== 0 || (event.target instanceof Element && event.target.closest('button, [data-calendar-item]'))) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { day, anchorMinute: minuteAtPosition(event.clientY, event.currentTarget), pointerId: event.pointerId, clientY: event.clientY, isDragging: false }
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>, day: number): void => {
    const drag = dragRef.current
    if (!drag || drag.day !== day || drag.pointerId !== event.pointerId) return
    const minimumDragDistance = hourHeight / 6
    if (!drag.isDragging && Math.abs(event.clientY - drag.clientY) < minimumDragDistance) return
    drag.isDragging = true
    setDragSelection(selectionFrom(day, drag.anchorMinute, minuteAtPosition(event.clientY, event.currentTarget)))
  }
  const finishTimeDrag = (event: React.PointerEvent<HTMLDivElement>, day: number, cancelled = false): void => {
    const drag = dragRef.current
    if (!drag || drag.day !== day || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    const verticalDistance = Math.abs(event.clientY - drag.clientY)
    const didDrag = drag.isDragging || verticalDistance >= hourHeight / 6
    if (cancelled || !didDrag) {
      setDragSelection(null)
      return
    }
    const selection = selectionFrom(day, drag.anchorMinute, minuteAtPosition(event.clientY, event.currentTarget))
    setDragSelection(selection)
    onCreateAt(atLocalMinute(day, selection.startMinute), atLocalMinute(day, selection.endMinute), { clientX: event.clientX, clientY: event.clientY })
  }

  const horizontalScrollStyle: React.CSSProperties = { overscrollBehaviorX: 'contain' }

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 border-b border-border/60">
          <div className="w-14 shrink-0 border-r border-border/60" />
          <div ref={headerScrollRef} onScroll={handleHorizontalScroll} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-none" style={horizontalScrollStyle}>
            <div className="flex w-[300%]">
              {weekViews.map((week, index) => <WeekHeaderPanel key={week.weekStart} week={week} today={today} active={index === 1} />)}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 border-b border-border/60">
          <div className="w-14 shrink-0 border-r border-border/60 px-2 py-2 text-right text-[11px] text-muted-foreground">全天</div>
          <div ref={allDayScrollRef} onScroll={handleHorizontalScroll} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-none" style={horizontalScrollStyle}>
            <div className="flex w-[300%]">
              {weekViews.map((week, index) => <WeekAllDayPanel key={week.weekStart} week={week} active={index === 1} onSelectEvent={onSelectEvent} onSelectTodo={onSelectTodo} />)}
            </div>
          </div>
        </div>
        <div ref={timeScrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
          <div className="flex min-w-0" style={{ height: `${totalHeight}px` }}>
            <div className="relative w-14 shrink-0 border-r border-border/60">
              {hours.map((hour) => <div key={hour} className="absolute left-0 right-0 border-t-[0.5px] border-border/40 pr-2 text-right text-[11px] text-muted-foreground" style={{ top: `${hour * hourHeight}px` }}><span className="relative -top-2.5 tabular-nums">{String(hour).padStart(2, '0')}:00</span></div>)}
            </div>
            <div ref={bodyScrollRef} onScroll={handleHorizontalScroll} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-none" style={horizontalScrollStyle}>
              <div className="flex h-full w-[300%]">
                {weekViews.map((week, index) => <WeekTimePanel key={week.weekStart} week={week} hours={hours} hourHeight={hourHeight} today={today} currentMinute={currentMinute} dragSelection={dragSelection} previewSelection={previewSelection} interactive={index === 1} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event, day) => finishTimeDrag(event, day)} onPointerCancel={(event, day) => finishTimeDrag(event, day, true)} onSelectEvent={onSelectEvent} onSelectTodo={onSelectTodo} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
      {quickCreateOpen && (
        // 首次外部点击仍会冒泡给 Radix 关闭 Popover，但不会穿透至时段网格开始拖拽。
        <div aria-hidden className="absolute inset-0 z-[35]" />
      )}
    </div>
  )
}

function CalendarEventDetail({ event, groups, tags, todos, onClose, onSave, onDelete }: { event: CalendarEvent; groups: Array<{ id: string; name: string }>; tags: PlanningTag[]; todos: Todo[]; onClose: () => void; onSave: (id: string, draft: EventDraft, expectedUpdatedAt: number, silent?: boolean) => Promise<EventSaveResult>; onDelete: (event: CalendarEvent) => Promise<void> }): React.ReactElement {
  const [draft, setDraft] = React.useState(() => draftFromEvent(event))
  const [saveState, setSaveState] = React.useState<'saved' | 'saving' | 'failed' | 'invalid' | 'conflict'>('saved')
  const [saveGeneration, setSaveGeneration] = React.useState(0)
  const savedDraftRef = React.useRef(JSON.stringify(draftFromEvent(event)))
  const draftRef = React.useRef(draft)
  const baseUpdatedAtRef = React.useRef(event.updatedAt)
  const eventIdRef = React.useRef(event.id)
  const savingRef = React.useRef(false)
  const failedDraftRef = React.useRef<string | null>(null)
  const conflictRef = React.useRef(false)
  const serializedDraft = JSON.stringify(draft)

  React.useEffect(() => {
    draftRef.current = draft
  }, [draft])

  React.useEffect(() => {
    const next = draftFromEvent(event)
    const nextSerialized = JSON.stringify(next)
    if (eventIdRef.current !== event.id) {
      eventIdRef.current = event.id
      baseUpdatedAtRef.current = event.updatedAt
      savedDraftRef.current = nextSerialized
      failedDraftRef.current = null
      conflictRef.current = false
      setDraft(next)
      setSaveState('saved')
      return
    }
    if (event.updatedAt === baseUpdatedAtRef.current || savingRef.current) return
    if (JSON.stringify(draftRef.current) !== savedDraftRef.current) {
      conflictRef.current = true
      setSaveState('conflict')
      return
    }
    baseUpdatedAtRef.current = event.updatedAt
    savedDraftRef.current = nextSerialized
    failedDraftRef.current = null
    conflictRef.current = false
    setDraft(next)
    setSaveState('saved')
  }, [event.id, event.updatedAt])

  // 分组被删除时，详情面板中的草稿不能继续持有已失效的分组 ID。
  React.useEffect(() => {
    if (draft.groupId === '__none__' || groups.some((group) => group.id === draft.groupId)) return
    setDraft((current) => current.groupId === draft.groupId ? { ...current, groupId: '__none__' } : current)
  }, [draft.groupId, groups])

  React.useEffect(() => {
    if (serializedDraft === savedDraftRef.current || conflictRef.current) return
    if (!draft.title.trim() || draft.endAt < draft.startAt) {
      setSaveState('invalid')
      return
    }
    if (failedDraftRef.current === serializedDraft || savingRef.current) return

    const timer = window.setTimeout(async () => {
      if (savingRef.current || conflictRef.current) return
      savingRef.current = true
      setSaveState('saving')
      const snapshot = serializedDraft
      const result = await onSave(event.id, draft, baseUpdatedAtRef.current, true)
      if (result.kind === 'saved') {
        baseUpdatedAtRef.current = result.event.updatedAt
        savedDraftRef.current = snapshot
        failedDraftRef.current = null
        setSaveState('saved')
      } else if (result.kind === 'conflict') {
        conflictRef.current = true
        setSaveState('conflict')
      } else {
        failedDraftRef.current = snapshot
        setSaveState('failed')
      }
      savingRef.current = false
      setSaveGeneration((generation) => generation + 1)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [draft, event.id, onSave, saveGeneration, serializedDraft])

  const reloadLatest = (): void => {
    const next = draftFromEvent(event)
    baseUpdatedAtRef.current = event.updatedAt
    savedDraftRef.current = JSON.stringify(next)
    failedDraftRef.current = null
    conflictRef.current = false
    setDraft(next)
    setSaveState('saved')
  }
  const handleClose = (): void => {
    if (serializedDraft !== savedDraftRef.current && !window.confirm('有未保存的日程修改，确定关闭吗？')) return
    onClose()
  }
  const statusLabel = saveState === 'saving' ? '正在自动保存…'
    : saveState === 'failed' ? '保存失败，请继续编辑后重试'
      : saveState === 'invalid' ? '请补全有效标题和时间'
        : saveState === 'conflict' ? '此日程已在其他窗口更新'
          : '已自动保存'

  return <PlanningFloatingInspector label="日程详情" onClose={handleClose}><div className="space-y-6 p-5 pr-14"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">日程详情</p><div className="mt-1 flex items-center gap-2"><p className="text-xs text-muted-foreground">{statusLabel}</p>{saveState === 'conflict' && <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={reloadLatest}>重新加载</Button>}</div></div><CalendarEventFields draft={draft} setDraft={setDraft} groups={groups} tags={tags} todos={todos} /><div className="flex items-center justify-between border-t border-border/60 pt-4"><Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void onDelete(event)}><Trash2 size={15} />删除</Button><span className="text-xs text-muted-foreground">编辑后自动保存</span></div></div></PlanningFloatingInspector>
}

function CalendarTodoDetail({ todo, onClose }: { todo: Todo; onClose: () => void }): React.ReactElement {
  const priority = todo.priority === 'high' ? '高优先级' : todo.priority === 'low' ? '低优先级' : '中优先级'
  const plannedAt = todo.dueAt ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(todo.dueAt) : undefined
  return <PlanningFloatingInspector label="Todo 详情" onClose={onClose}><div className="space-y-6 p-5 pr-14"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Todo 详情</p><h3 className="mt-2 text-lg font-semibold leading-snug">{todo.title}</h3></div><div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground"><span className="rounded-md bg-muted px-2 py-1">{priority}</span>{plannedAt && <span className="rounded-md bg-muted px-2 py-1">计划 {plannedAt}</span>}{todo.group && <span className="rounded-md bg-muted px-2 py-1">{todo.group.name}</span>}{todo.tags.map((tag) => <span key={tag.id} className="rounded-md bg-muted px-2 py-1">#{tag.name}</span>)}</div><section><h4 className="mb-2 text-sm font-medium">更多信息</h4><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{todo.notes || '暂无更多信息'}</p></section><div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm"><div><p className="text-xs text-muted-foreground">提醒</p><p className="mt-1 font-medium">{todo.reminders.filter((item) => item.status === 'pending').length} 条待处理</p></div><div><p className="text-xs text-muted-foreground">关联会话</p><p className="mt-1 font-medium">{todo.sessionLinks.length} 个</p></div></div></div></PlanningFloatingInspector>
}

function CalendarQuickCreatePopover({ open, anchor, draft, setDraft, groups, saving, onCreateGroup, onOpenChange, onSave }: { open: boolean; anchor?: CalendarPopoverAnchor; draft: EventDraft; setDraft: React.Dispatch<React.SetStateAction<EventDraft>>; groups: PlanningGroup[]; saving: boolean; onCreateGroup: (name: string) => Promise<PlanningGroup | undefined>; onOpenChange: (open: boolean) => void; onSave: () => void }): React.ReactElement {
  const [newGroupName, setNewGroupName] = React.useState('')
  const [creatingGroup, setCreatingGroup] = React.useState(false)
  const [savingGroup, setSavingGroup] = React.useState(false)
  const selectedGroup = groups.find((group) => group.id === draft.groupId)
  const groupColor = calendarGroupColor(selectedGroup) ?? 'hsl(var(--primary))'
  const anchorStyle: React.CSSProperties = anchor ? { left: anchor.x, top: anchor.y } : { left: '50%', top: '22%' }
  const update = <K extends keyof EventDraft>(key: K, value: EventDraft[K]): void => setDraft((current) => ({ ...current, [key]: value }))

  React.useEffect(() => {
    if (open) return
    setNewGroupName('')
    setCreatingGroup(false)
  }, [open])

  const setAllDay = (allDay: boolean): void => setDraft((current) => {
    const startAt = allDay ? startOfDay(current.startAt) : current.startAt
    const endAt = allDay ? Math.max(nextDayStart(startAt), nextDayStart(current.endAt)) : Math.max(current.endAt, startAt + 30 * 60 * 1000)
    return { ...current, allDay, startAt, endAt }
  })
  const setStart = (startAt: number): void => setDraft((current) => {
    const normalizedStartAt = current.allDay ? startOfDay(startAt) : startAt
    return { ...current, startAt: normalizedStartAt, endAt: current.endAt < normalizedStartAt ? (current.allDay ? nextDayStart(normalizedStartAt) : normalizedStartAt + DEFAULT_EVENT_DURATION) : current.endAt }
  })
  const setEnd = (endAt: number): void => setDraft((current) => ({ ...current, endAt: current.allDay ? nextDayStart(endAt) : endAt }))
  const createGroup = async (): Promise<void> => {
    const name = newGroupName.trim()
    if (!name || savingGroup) return
    setSavingGroup(true)
    try {
      const group = await onCreateGroup(name)
      if (!group) return
      update('groupId', group.id)
      setNewGroupName('')
      setCreatingGroup(false)
    } finally {
      setSavingGroup(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild><span aria-hidden="true" className="pointer-events-none absolute size-px" style={anchorStyle} /></PopoverAnchor>
      <PopoverContent side={anchor ? 'right' : 'bottom'} align={anchor ? 'start' : 'center'} sideOffset={12} className="w-[380px] rounded-2xl border-border/60 p-3 shadow-xl">
        <form onSubmit={(event) => { event.preventDefault(); onSave() }} className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-muted/45 p-2">
            <label className="min-w-0 flex-1"><span className="sr-only">日程标题</span><Input autoFocus value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="新建日程" className="h-10 border-0 bg-transparent px-1 text-lg font-semibold shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0" /></label>
            <div className="flex shrink-0 items-center gap-1">
              <Select value={draft.groupId} onValueChange={(value) => update('groupId', value)}><SelectTrigger aria-label="选择日程分组" className="h-10 w-32 border-0 bg-background/70 px-2 shadow-none hover:bg-background"><span className="flex min-w-0 items-center gap-1.5"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: groupColor }} /><SelectValue /></span></SelectTrigger><SelectContent><SelectItem value="__none__"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-primary" />未分组</span></SelectItem>{groups.map((group) => <SelectItem key={group.id} value={group.id}><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ backgroundColor: calendarGroupColor(group) }} />{group.name}</span></SelectItem>)}</SelectContent></Select>
              <Button type="button" variant="ghost" size="icon" className="size-10" aria-label="新建日程分组" title="新建日程分组" onClick={() => setCreatingGroup(true)}><Plus size={16} /></Button>
            </div>
          </div>
          {creatingGroup && <div className="flex items-center gap-2 rounded-xl bg-muted/35 p-2"><Input autoFocus value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createGroup() }; if (event.key === 'Escape') { setCreatingGroup(false); setNewGroupName('') } }} placeholder="日程分组名称" className="h-9 border-0 bg-background px-2 text-sm shadow-none" /><Button type="button" size="sm" className="h-9" disabled={!newGroupName.trim() || savingGroup} onClick={() => void createGroup()}>{savingGroup ? '添加中…' : '添加'}</Button></div>}
          <div className="space-y-2 rounded-xl bg-muted/35 p-3"><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">时间</span><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={draft.allDay} onChange={(event) => setAllDay(event.target.checked)} className="size-3.5 accent-primary" />全天</label></div><div className="grid grid-cols-2 gap-2"><label className="grid gap-1"><span className="text-[11px] text-muted-foreground">开始</span><TodoDatePicker value={draft.startAt} onChange={(value) => { if (value !== undefined) setStart(value) }} dateOnly={draft.allDay} allowClear={false} timeRequired={!draft.allDay} label="选择开始日期时间" className="h-9 w-full justify-start rounded-lg border-0 bg-background px-2 text-xs text-foreground hover:bg-background" /></label><label className="grid gap-1"><span className="text-[11px] text-muted-foreground">结束</span><TodoDatePicker value={draft.allDay ? Math.max(draft.startAt, previousDayStart(draft.endAt)) : draft.endAt} onChange={(value) => { if (value !== undefined) setEnd(value) }} dateOnly={draft.allDay} allowClear={false} timeRequired={!draft.allDay} label="选择结束日期时间" className="h-9 w-full justify-start rounded-lg border-0 bg-background px-2 text-xs text-foreground hover:bg-background" /></label></div></div>
          <div className="flex items-center justify-between gap-3 px-1 pt-0.5"><span className="text-[11px] text-muted-foreground">更多信息可在创建后补充</span><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" className="h-9 px-2" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" size="sm" className="h-9 px-3" disabled={saving || !draft.title.trim()}>{saving ? '创建中…' : '创建'}</Button></div></div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function CalendarEventFields({ draft, setDraft, groups, tags, todos }: { draft: EventDraft; setDraft: React.Dispatch<React.SetStateAction<EventDraft>>; groups: Array<{ id: string; name: string }>; tags: PlanningTag[]; todos: Todo[] }): React.ReactElement {
  const update = <K extends keyof EventDraft>(key: K, value: EventDraft[K]): void => setDraft((current) => ({ ...current, [key]: value }))
  const setAllDay = (allDay: boolean): void => setDraft((current) => {
    const startAt = allDay ? startOfDay(current.startAt) : current.startAt
    const endAt = allDay ? Math.max(nextDayStart(startAt), nextDayStart(current.endAt)) : Math.max(current.endAt, startAt + 30 * 60 * 1000)
    return { ...current, allDay, startAt, endAt }
  })
  const setStart = (startAt: number): void => setDraft((current) => {
    const normalizedStartAt = current.allDay ? startOfDay(startAt) : startAt
    return { ...current, startAt: normalizedStartAt, endAt: current.endAt < normalizedStartAt ? (current.allDay ? nextDayStart(normalizedStartAt) : normalizedStartAt + DEFAULT_EVENT_DURATION) : current.endAt }
  })
  const setEnd = (endAt: number): void => setDraft((current) => ({ ...current, endAt: current.allDay ? nextDayStart(endAt) : endAt }))
  return <div className="space-y-5"><div><label className="mb-2 block text-sm font-medium" htmlFor="calendar-event-title">标题</label><Input id="calendar-event-title" autoFocus value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="例如：产品评审" className="text-base" /></div><div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"><div><p className="text-sm font-medium">全天</p><p className="text-xs text-muted-foreground">不占用具体小时段</p></div><input type="checkbox" checked={draft.allDay} onChange={(event) => setAllDay(event.target.checked)} className="size-4 accent-primary" /></div><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">开始<TodoDatePicker value={draft.startAt} onChange={(value) => { if (value !== undefined) setStart(value) }} dateOnly={draft.allDay} allowClear={false} timeRequired={!draft.allDay} label="选择开始日期时间" className="h-10 w-full justify-start rounded-none border border-border/60 bg-transparent px-3 text-foreground hover:bg-muted/40" /></label><label className="grid gap-2 text-sm font-medium">结束<TodoDatePicker value={draft.allDay ? Math.max(draft.startAt, previousDayStart(draft.endAt)) : draft.endAt} onChange={(value) => { if (value !== undefined) setEnd(value) }} dateOnly={draft.allDay} allowClear={false} timeRequired={!draft.allDay} label="选择结束日期时间" className="h-10 w-full justify-start rounded-none border border-border/60 bg-transparent px-3 text-foreground hover:bg-muted/40" /></label></div><div><label className="mb-2 block text-sm font-medium" htmlFor="calendar-event-notes">更多信息</label><Textarea id="calendar-event-notes" value={draft.notes} onChange={(event) => update('notes', event.target.value)} placeholder="补充地点、议程、会议链接或其他上下文；Agent 可以读取这里的内容。" className="min-h-28 resize-y" /></div><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">日程分组<Select value={draft.groupId} onValueChange={(value) => update('groupId', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">不分组</SelectItem>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-2 text-sm font-medium">关联 Todo<Select value={draft.todoId} onValueChange={(value) => update('todoId', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">不关联 Todo</SelectItem>{todos.map((todo) => <SelectItem key={todo.id} value={todo.id}>{todo.title}</SelectItem>)}</SelectContent></Select></label></div><div><p className="mb-2 text-sm font-medium">标签</p><div className="flex flex-wrap gap-1.5">{tags.length ? tags.map((tag) => { const selected = draft.tagIds.includes(tag.id); return <button key={tag.id} type="button" onClick={() => update('tagIds', selected ? draft.tagIds.filter((id) => id !== tag.id) : [...draft.tagIds, tag.id])} className={cn('rounded-md px-2 py-1 text-xs transition-colors', selected ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted')}>#{tag.name}</button> }) : <span className="text-xs text-muted-foreground">暂无标签</span>}</div></div></div>
}
