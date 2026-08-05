import { getCalendarEvent, getTodo, completePlanningSyncCleanup, completePlanningSyncOutbox, failPlanningSyncCleanup, failPlanningSyncOutbox, listDuePlanningSyncCleanup, listDuePlanningSyncOutbox, type PlanningSyncCleanupItem, type PlanningSyncOutboxItem } from './planning-manager'
import { onPlanningChanged } from './planning-events'
import { getPlanningNativeSyncStatus, removePlanningNativeSyncItem, upsertPlanningNativeSyncItem } from './planning-native-sync-service'

const POLL_INTERVAL_MS = 30_000
let timer: ReturnType<typeof setInterval> | null = null
let disposePlanningListener: (() => void) | null = null
let syncing = false
let queued = false

/** Todo 日期选择器把“仅日期”持久化为当地 23:59；同步时恢复为 EventKit 的无时分 DateComponents。 */
function isTodoDueDateOnly(dueAt: number | undefined): boolean {
  if (!dueAt) return false
  const date = new Date(dueAt)
  return date.getHours() === 23 && date.getMinutes() === 59
}

async function cleanupItem(item: PlanningSyncCleanupItem): Promise<void> {
  await removePlanningNativeSyncItem(item.entity, { targetId: item.targetId, identity: item.promaEntityId, calendarItemIdentifier: item.calendarItemIdentifier, startAt: item.nativeStartAt })
  completePlanningSyncCleanup(item)
}

async function syncItem(item: PlanningSyncOutboxItem): Promise<void> {
  const entity = item.profile.entity
  if (item.operation === 'delete') {
    await removePlanningNativeSyncItem(entity, { targetId: item.profile.targetId, identity: item.promaEntityId, calendarItemIdentifier: item.calendarItemIdentifier, startAt: item.nativeStartAt })
    completePlanningSyncOutbox(item)
    return
  }

  if (entity === 'calendar') {
    const event = getCalendarEvent(item.promaEntityId)
    if (!event) {
      completePlanningSyncOutbox({ ...item, operation: 'delete' })
      return
    }
    const identifiers = await upsertPlanningNativeSyncItem('calendar', {
      targetId: item.profile.targetId,
      identity: item.promaEntityId,
      calendarItemIdentifier: item.calendarItemIdentifier,
      title: event.title,
      notes: event.notes,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
    })
    completePlanningSyncOutbox(item, identifiers)
    return
  }

  const todo = getTodo(item.promaEntityId)
  if (!todo) {
    completePlanningSyncOutbox({ ...item, operation: 'delete' })
    return
  }
  const identifiers = await upsertPlanningNativeSyncItem('reminder', {
    targetId: item.profile.targetId,
    identity: item.promaEntityId,
    calendarItemIdentifier: item.calendarItemIdentifier,
    title: todo.title,
    notes: todo.notes,
    dueAt: todo.dueAt,
    dueDateOnly: isTodoDueDateOnly(todo.dueAt),
    priority: todo.priority,
    completed: todo.status === 'completed',
    completedAt: todo.completedAt,
  })
  completePlanningSyncOutbox(item, identifiers)
}

export async function runPlanningNativeSync(): Promise<void> {
  if (syncing || process.platform !== 'darwin') return
  syncing = true
  try {
    const status = await getPlanningNativeSyncStatus()
    if (!status.supported) return
    for (const item of listDuePlanningSyncCleanup()) {
      if ((item.entity === 'calendar' ? status.calendar : status.reminder).status !== 'full-access') continue
      try {
        await cleanupItem(item)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[计划同步] ${item.entity}/cleanup 失败: ${message}`)
        failPlanningSyncCleanup(item, message)
      }
    }
    for (const item of listDuePlanningSyncOutbox()) {
      if ((item.profile.entity === 'calendar' ? status.calendar : status.reminder).status !== 'full-access') continue
      try {
        await syncItem(item)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[计划同步] ${item.profile.entity}/${item.operation} 失败: ${message}`)
        failPlanningSyncOutbox(item, message)
      }
    }
  } finally {
    syncing = false
    if (queued) {
      queued = false
      void runPlanningNativeSync()
    }
  }
}

/** 本地 Planning 变更后立即尝试发布；定时轮询只用于重启、离线和失败重试恢复。 */
export function startPlanningNativeSyncCoordinator(): void {
  if (timer) return
  disposePlanningListener = onPlanningChanged(() => {
    if (syncing) queued = true
    else void runPlanningNativeSync()
  })
  void runPlanningNativeSync()
  timer = setInterval(() => { void runPlanningNativeSync() }, POLL_INTERVAL_MS)
}

export function stopPlanningNativeSyncCoordinator(): void {
  if (timer) clearInterval(timer)
  timer = null
  disposePlanningListener?.()
  disposePlanningListener = null
}
