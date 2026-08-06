import { applyManagedCalendarProfileItems, applyPlanningNativeConnectionItems, getCalendarEvent, getTodo, completePlanningNativeOutbox, completePlanningSyncCleanup, completePlanningSyncOutbox, failPlanningNativeOutbox, failPlanningSyncCleanup, failPlanningSyncOutbox, hideMissingManagedCalendarProfileItems, hideMissingPlanningNativeConnectionItems, listDuePlanningNativeOutbox, listDuePlanningSyncCleanup, listDuePlanningSyncOutbox, listEnabledManagedCalendarProfiles, listPlanningNativeBindingIdentifiers, listPlanningNativeConnections, listPlanningSyncBindingIdentifiers, planningNativeCalendarHash, type PlanningNativeOutboxItem, type PlanningSyncCleanupItem, type PlanningSyncOutboxItem } from './planning-manager'
import { broadcastPlanningChanged, onPlanningChanged } from './planning-events'
import { getPlanningNativeSyncStatus, listPlanningNativeConnectionItems, listPlanningNativeConnectionItemsByIdentifier, removePlanningNativeSyncItem, subscribePlanningNativeSyncChanges, upsertPlanningNativeSyncItem } from './planning-native-sync-service'

const POLL_INTERVAL_MS = 30_000
let timer: ReturnType<typeof setInterval> | null = null
let disposePlanningListener: (() => void) | null = null
let syncing = false
let queued = false
let queuedForceReconcile = false
let lastExternalReconcileAt = 0
let lastManagedCalendarReconcileAt = 0
let nativeChangeDebounce: ReturnType<typeof setTimeout> | null = null
// EventKit 不提供可靠的跨账户变更增量 token；仅轮询用户明确连接的集合。
const EXTERNAL_RECONCILE_INTERVAL_MS = POLL_INTERVAL_MS

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

async function syncNativeItem(item: PlanningNativeOutboxItem): Promise<void> {
  if (item.operation === 'hide') {
    // 连接的可写 Calendar / Reminder 均按用户选择真实删除 EventKit 项。
    // 升级前只读集合可能残留 hide outbox；该历史项只能继续本地隐藏，不能借升级越权删除。
    if (item.connection.canWrite) await removePlanningNativeSyncItem(item.connection.entity, { targetId: item.connection.targetId, identity: item.promaEntityId, calendarItemIdentifier: item.calendarItemIdentifier })
    completePlanningNativeOutbox(item)
    return
  }
  if (!item.connection.canWrite) throw new Error('该系统集合为只读，不能写入')
  if (item.connection.entity === 'calendar') {
    const event = getCalendarEvent(item.promaEntityId)
    if (!event) { completePlanningNativeOutbox({ ...item, operation: 'hide' }); return }
    const identifiers = await upsertPlanningNativeSyncItem('calendar', { targetId: item.connection.targetId, identity: item.promaEntityId, calendarItemIdentifier: item.calendarItemIdentifier, allowRecreate: item.recreatePending, title: event.title, notes: event.notes, startAt: event.startAt, endAt: event.endAt, allDay: event.allDay })
    completePlanningNativeOutbox(item, identifiers)
    return
  } else {
    const todo = getTodo(item.promaEntityId)
    if (!todo) { completePlanningNativeOutbox({ ...item, operation: 'hide' }); return }
    const identifiers = await upsertPlanningNativeSyncItem('reminder', { targetId: item.connection.targetId, identity: item.promaEntityId, calendarItemIdentifier: item.calendarItemIdentifier, allowRecreate: item.recreatePending, title: todo.title, notes: todo.notes, dueAt: todo.dueAt, dueDateOnly: item.dueDateOnly ?? isTodoDueDateOnly(todo.dueAt), priority: todo.priority, completed: todo.status === 'completed', completedAt: todo.completedAt })
    completePlanningNativeOutbox(item, identifiers)
  }
}

async function reconcileExternalConnections(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - lastExternalReconcileAt < EXTERNAL_RECONCILE_INTERVAL_MS) return
  lastExternalReconcileAt = now
  for (const connection of listPlanningNativeConnections()) {
    try {
      // 有界窗口控制首次连接和定期扫描的主进程成本；范围外项目不会被隐式导入。
      const range = connection.entity === 'calendar' ? { from: now - 30 * 24 * 60 * 60 * 1_000, to: now + 12 * 30 * 24 * 60 * 60 * 1_000 } : undefined
      const items = await listPlanningNativeConnectionItems(connection.entity, connection.targetId, range)
      // 日历 range 是有界的新项目导入；已绑定项目用 identifier 精确检查存在性，防止窗口外误隐藏。
      applyPlanningNativeConnectionItems(connection.id, items, { fullSnapshot: connection.entity === 'reminder' })
      if (connection.entity === 'calendar') {
        const boundIds = listPlanningNativeBindingIdentifiers(connection.id)
        const boundItems = await listPlanningNativeConnectionItemsByIdentifier(connection.entity, connection.targetId, boundIds)
        applyPlanningNativeConnectionItems(connection.id, boundItems, { fullSnapshot: false })
        hideMissingPlanningNativeConnectionItems(connection.id, boundItems.map((item) => item.calendarItemIdentifier))
      }
      broadcastPlanningChanged([connection.entity === 'calendar' ? 'calendar_events' : 'todos'])
    } catch (error) { console.warn(`[计划同步] 外部 ${connection.entity} 回流失败:`, error) }
  }
}

async function reconcileManagedCalendarProfiles(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - lastManagedCalendarReconcileAt < EXTERNAL_RECONCILE_INTERVAL_MS) return
  lastManagedCalendarReconcileAt = now
  for (const profile of listEnabledManagedCalendarProfiles()) {
    try {
      const range = { from: now - 30 * 24 * 60 * 60 * 1_000, to: now + 12 * 30 * 24 * 60 * 60 * 1_000 }
      const items = await listPlanningNativeConnectionItems('calendar', profile.targetId, range)
      applyManagedCalendarProfileItems(profile.id, items)
      // 主查询仅用于枚举可导入项目；已 binding 的系统删除必须 locator 精确确认。
      const boundIds = listPlanningSyncBindingIdentifiers(profile.id, profile.targetId)
      const boundItems = await listPlanningNativeConnectionItemsByIdentifier('calendar', profile.targetId, boundIds)
      applyManagedCalendarProfileItems(profile.id, boundItems)
      hideMissingManagedCalendarProfileItems(profile.id, profile.targetId, boundItems.map((item) => item.calendarItemIdentifier))
      broadcastPlanningChanged(['calendar_events', 'reminders'])
    } catch (error) { console.warn('[计划同步] 受管 calendar 回流失败:', error) }
  }
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
    completePlanningSyncOutbox(item, identifiers, planningNativeCalendarHash(event))
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

export async function runPlanningNativeSync(forceExternalReconcile = false): Promise<void> {
  if (process.platform !== 'darwin') return
  if (syncing) {
    queued = true
    queuedForceReconcile ||= forceExternalReconcile
    return
  }
  syncing = true
  try {
    const status = await getPlanningNativeSyncStatus()
    if (!status.supported) return
    await reconcileExternalConnections(forceExternalReconcile)
    await reconcileManagedCalendarProfiles(forceExternalReconcile)
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
    for (const item of listDuePlanningNativeOutbox()) {
      if ((item.connection.entity === 'calendar' ? status.calendar : status.reminder).status !== 'full-access') continue
      try { await syncNativeItem(item) } catch (error) { const message = error instanceof Error ? error.message : String(error); console.warn(`[计划同步] external/${item.operation} 失败: ${message}`); failPlanningNativeOutbox(item, message) }
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
      const force = queuedForceReconcile
      queued = false
      queuedForceReconcile = false
      void runPlanningNativeSync(force)
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
  // EventKit 只通知“存储发生变化”，不暴露可安全使用的变化项；防抖后仍只 reconcile 用户已连接的集合。
  subscribePlanningNativeSyncChanges(() => {
    if (nativeChangeDebounce) clearTimeout(nativeChangeDebounce)
    nativeChangeDebounce = setTimeout(() => { nativeChangeDebounce = null; void runPlanningNativeSync(true) }, 800)
  })
  void runPlanningNativeSync()
  timer = setInterval(() => { void runPlanningNativeSync() }, POLL_INTERVAL_MS)
}

export function stopPlanningNativeSyncCoordinator(): void {
  if (timer) clearInterval(timer)
  timer = null
  disposePlanningListener?.()
  disposePlanningListener = null
  if (nativeChangeDebounce) clearTimeout(nativeChangeDebounce)
  nativeChangeDebounce = null
}
