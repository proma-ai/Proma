/**
 * 任务/日程 SQLite 数据层。
 *
 * Todo 和日程是独立表；分组按 Todo / 日程隔离，标签与提醒在同一 planning.db 内通过关系表连接。
 */

import { randomUUID } from 'node:crypto'
import type {
  ActivePlanningReminder,
  CalendarEvent,
  CreateCalendarEventInput,
  CreatePlanningGroupInput,
  CreatePlanningReminderRequest,
  CreatePlanningTagInput,
  CreateTodoInput,
  PlanningGroup,
  PlanningGroupScope,
  PlanningReminder,
  PlanningReminderOrigin,
  PlanningReminderTargetType,
  PlanningTag,
  Todo,
  TodoSessionLink,
  UpdateCalendarEventInput,
  UpdatePlanningGroupInput,
  UpdatePlanningTagInput,
  UpdateTodoInput,
} from '@proma/shared'
import { getPlanningDatabasePath } from './config-paths'

interface SqliteStatement {
  all(params?: Record<string, unknown>): unknown[]
  get(params?: Record<string, unknown>): unknown
  run(params?: Record<string, unknown>): unknown
}
interface SqliteDatabase { exec(sql: string): void; prepare(sql: string): SqliteStatement }
interface SqliteModule { DatabaseSync: new (path: string) => SqliteDatabase }

type TodoRow = {
  id: string; title: string; notes: string | null; status: 'open' | 'completed'; priority: 'low' | 'medium' | 'high'
  due_at: number | null; group_id: string | null; workspace_id: string | null; scratch_excerpt: string | null
  created_at: number; updated_at: number; completed_at: number | null
}
type CalendarEventRow = {
  id: string; title: string; notes: string | null; start_at: number; end_at: number | null; all_day: number
  calendar_group_id: string | null; workspace_id: string | null; todo_id: string | null; scratch_excerpt: string | null
  created_at: number; updated_at: number
}
type GroupRow = { id: string; name: string; color: string | null; sort_order: number; archived_at: number | null; created_at: number; updated_at: number }
type TagRow = { id: string; name: string; color: string | null; created_at: number; updated_at: number }
type ReminderRow = {
  id: string; target_type: PlanningReminderTargetType; target_id: string; trigger_at: number; snoozed_until: number | null
  status: 'pending' | 'acknowledged' | 'completed'; origin: PlanningReminderOrigin; acknowledged_at: number | null; last_notified_at: number | null; created_at: number; updated_at: number
}
type TodoSessionLinkRow = { todo_id: string; session_id: string; first_touched_at: number; last_touched_at: number }

let database: SqliteDatabase | null = null

function addColumnIfNeeded(db: SqliteDatabase, table: string, definition: string): void {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`) } catch { /* 已存在时 SQLite 会报错，忽略即可。 */ }
}

function hasColumn(db: SqliteDatabase, table: 'calendar_events', column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column)
}

/**
 * 将旧版共享日程分组复制为独立日程分组。
 *
 * 旧表的 group_id 保留兼容但不再读取；新 ID 防止同一分组 ID 跨 Todo / 日程被误用。
 * 无日程引用的旧分组保留为 Todo 分组——旧版仅 Todo 页提供新建分组入口，避免其继续出现在日程选择器。
 */
function migrateLegacyCalendarGroups(db: SqliteDatabase): void {
  if (hasColumn(db, 'calendar_events', 'calendar_group_id')) return

  const legacyGroups = db.prepare('SELECT * FROM planning_groups ORDER BY sort_order, name COLLATE NOCASE').all() as GroupRow[]
  const hasLegacyGroupId = hasColumn(db, 'calendar_events', 'group_id')
  const legacyTodoGroupIds = new Set((db.prepare('SELECT DISTINCT group_id FROM todos WHERE group_id IS NOT NULL').all() as Array<{ group_id: string }>).map((row) => row.group_id))
  const legacyCalendarGroupIds = new Set(hasLegacyGroupId ? (db.prepare('SELECT DISTINCT group_id FROM calendar_events WHERE group_id IS NOT NULL').all() as Array<{ group_id: string }>).map((row) => row.group_id) : [])
  const calendarGroupIds = new Map<string, string>()

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('ALTER TABLE calendar_events ADD COLUMN calendar_group_id TEXT REFERENCES calendar_groups(id) ON DELETE SET NULL')
    const insertGroup = db.prepare(`
      INSERT INTO calendar_groups (id, name, color, sort_order, archived_at, created_at, updated_at)
      VALUES (:id, :name, :color, :sortOrder, :archivedAt, :createdAt, :updatedAt)
    `)
    for (const group of legacyGroups) {
      if (!legacyCalendarGroupIds.has(group.id)) continue
      const calendarGroupId = randomUUID()
      calendarGroupIds.set(group.id, calendarGroupId)
      insertGroup.run({
        id: calendarGroupId,
        name: group.name,
        color: group.color,
        sortOrder: group.sort_order,
        archivedAt: group.archived_at,
        createdAt: group.created_at,
        updatedAt: group.updated_at,
      })
    }
    if (hasLegacyGroupId) {
      const updateEventGroup = db.prepare('UPDATE calendar_events SET calendar_group_id = :calendarGroupId WHERE group_id = :legacyGroupId')
      for (const [legacyGroupId, calendarGroupId] of calendarGroupIds) {
        updateEventGroup.run({ legacyGroupId, calendarGroupId })
      }
      // 仅被日程引用的旧共享分组已完整复制，可从 Todo 分组表移除。
      const deleteCalendarOnlyGroup = db.prepare('DELETE FROM planning_groups WHERE id = :id')
      for (const legacyGroupId of legacyCalendarGroupIds) {
        if (!legacyTodoGroupIds.has(legacyGroupId)) deleteCalendarOnlyGroup.run({ id: legacyGroupId })
      }
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length > 0) throw new Error('日程分组迁移后的外键校验失败')
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务尚未开始或已结束时无需处理。 */ }
    throw error
  }
}

function getDatabase(): SqliteDatabase {
  if (database) return database
  const { DatabaseSync } = require('node:sqlite') as SqliteModule
  const db = new DatabaseSync(getPlanningDatabasePath())
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS planning_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100), color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calendar_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100), color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100), color TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 500), notes TEXT,
      status TEXT NOT NULL CHECK(status IN ('open', 'completed')), priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
      due_at INTEGER, group_id TEXT REFERENCES planning_groups(id) ON DELETE SET NULL, workspace_id TEXT, scratch_excerpt TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 500), notes TEXT, start_at INTEGER NOT NULL, end_at INTEGER,
      all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0, 1)), calendar_group_id TEXT REFERENCES calendar_groups(id) ON DELETE SET NULL,
      workspace_id TEXT, todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL, scratch_excerpt TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK(end_at IS NULL OR end_at >= start_at)
    );
    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(todo_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS calendar_event_tags (
      calendar_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(calendar_event_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS planning_reminders (
      id TEXT PRIMARY KEY, target_type TEXT NOT NULL CHECK(target_type IN ('todo', 'calendar_event')), target_id TEXT NOT NULL,
      trigger_at INTEGER NOT NULL, snoozed_until INTEGER, status TEXT NOT NULL CHECK(status IN ('pending', 'acknowledged', 'completed')),
      origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'todo_due_at', 'event_start')),
      acknowledged_at INTEGER, last_notified_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todo_session_links (
      todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      first_touched_at INTEGER NOT NULL,
      last_touched_at INTEGER NOT NULL,
      PRIMARY KEY(todo_id, session_id)
    );
  `)
  // 轻量 SQLite 列扩展；不重建表，也不迁移到 JSON。
  addColumnIfNeeded(db, 'todos', 'group_id TEXT REFERENCES planning_groups(id) ON DELETE SET NULL')
  migrateLegacyCalendarGroups(db)
  addColumnIfNeeded(db, 'planning_reminders', "origin TEXT NOT NULL DEFAULT 'manual'")
  // 仅识别“创建 Todo 时同时生成、触发时间等于旧计划时间、且未被推迟”的旧默认提醒。
  // 其余旧提醒一律保留 manual，避免把用户手动设置的通知错误改期。
  db.exec(`
    UPDATE planning_reminders
    SET origin = 'todo_due_at'
    WHERE origin = 'manual'
      AND target_type = 'todo'
      AND status = 'pending'
      AND snoozed_until IS NULL
      AND EXISTS (
        SELECT 1 FROM todos
        WHERE todos.id = planning_reminders.target_id
          AND todos.due_at = planning_reminders.trigger_at
          AND ABS(todos.created_at - planning_reminders.created_at) <= 5000
      );
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS todos_status_due_at_idx ON todos(status, due_at);
    CREATE INDEX IF NOT EXISTS todos_group_id_idx ON todos(group_id);
    CREATE INDEX IF NOT EXISTS calendar_events_start_at_idx ON calendar_events(start_at);
    CREATE INDEX IF NOT EXISTS calendar_events_calendar_group_id_idx ON calendar_events(calendar_group_id);
    CREATE INDEX IF NOT EXISTS calendar_events_todo_id_idx ON calendar_events(todo_id);
    CREATE INDEX IF NOT EXISTS planning_reminders_due_idx ON planning_reminders(status, snoozed_until, trigger_at);
    CREATE INDEX IF NOT EXISTS planning_reminders_target_idx ON planning_reminders(target_type, target_id);
    CREATE INDEX IF NOT EXISTS todo_session_links_recent_idx ON todo_session_links(todo_id, last_touched_at DESC);
  `)
  database = db
  return db
}

function assertText(value: string, field: string, max: number): string {
  const text = value.trim()
  if (!text || text.length > max) throw new Error(`${field}不能为空且不能超过 ${max} 字`)
  return text
}
function assertTitle(value: string, type: string): string { return assertText(value, `${type} 标题`, 500) }
function assertTimestamp(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`${field} 必须是有效时间戳`)
}
function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit 必须是正整数')
  return Math.min(limit, 500)
}
function groupTable(scope: PlanningGroupScope): 'planning_groups' | 'calendar_groups' {
  return scope === 'todo' ? 'planning_groups' : 'calendar_groups'
}
function groupFromRow(row: GroupRow, scope: PlanningGroupScope): PlanningGroup {
  return { id: row.id, scope, name: row.name, color: row.color ?? undefined, sortOrder: row.sort_order, archivedAt: row.archived_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }
}
function tagFromRow(row: TagRow): PlanningTag {
  return { id: row.id, name: row.name, color: row.color ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }
}
function reminderFromRow(row: ReminderRow): PlanningReminder {
  return { id: row.id, targetType: row.target_type, targetId: row.target_id, triggerAt: row.trigger_at, snoozedUntil: row.snoozed_until ?? undefined, status: row.status, origin: row.origin ?? 'manual', acknowledgedAt: row.acknowledged_at ?? undefined, lastNotifiedAt: row.last_notified_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }
}
function getPlanningGroup(id: string | null, scope: PlanningGroupScope): PlanningGroup | undefined {
  if (!id) return undefined
  const row = getDatabase().prepare(`SELECT * FROM ${groupTable(scope)} WHERE id = :id`).get({ id }) as GroupRow | undefined
  return row ? groupFromRow(row, scope) : undefined
}
function getTags(targetType: PlanningReminderTargetType, targetId: string): PlanningTag[] {
  const table = targetType === 'todo' ? 'todo_tags' : 'calendar_event_tags'
  const idColumn = targetType === 'todo' ? 'todo_id' : 'calendar_event_id'
  const rows = getDatabase().prepare(`SELECT tags.* FROM tags JOIN ${table} ON tags.id = ${table}.tag_id WHERE ${table}.${idColumn} = :id ORDER BY tags.name COLLATE NOCASE`).all({ id: targetId }) as TagRow[]
  return rows.map(tagFromRow)
}
function getReminders(targetType: PlanningReminderTargetType, targetId: string): PlanningReminder[] {
  const rows = getDatabase().prepare(`SELECT * FROM planning_reminders WHERE target_type = :targetType AND target_id = :targetId ORDER BY COALESCE(snoozed_until, trigger_at)`).all({ targetType, targetId }) as ReminderRow[]
  return rows.map(reminderFromRow)
}
function getTodoSessionLinks(todoId: string): TodoSessionLink[] {
  const rows = getDatabase().prepare('SELECT * FROM todo_session_links WHERE todo_id = :todoId ORDER BY last_touched_at DESC').all({ todoId }) as TodoSessionLinkRow[]
  return rows.map((row) => ({ sessionId: row.session_id, firstTouchedAt: row.first_touched_at, lastTouchedAt: row.last_touched_at }))
}
function todoFromRow(row: TodoRow): Todo {
  return { id: row.id, title: row.title, notes: row.notes ?? undefined, status: row.status, priority: row.priority, dueAt: row.due_at ?? undefined, groupId: row.group_id ?? undefined, group: getPlanningGroup(row.group_id, 'todo'), tags: getTags('todo', row.id), reminders: getReminders('todo', row.id), sessionLinks: getTodoSessionLinks(row.id), workspaceId: row.workspace_id ?? undefined, scratchReference: row.scratch_excerpt ? { excerpt: row.scratch_excerpt } : undefined, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }
}
function calendarEventFromRow(row: CalendarEventRow): CalendarEvent {
  return { id: row.id, title: row.title, notes: row.notes ?? undefined, startAt: row.start_at, endAt: row.end_at ?? undefined, allDay: row.all_day === 1, groupId: row.calendar_group_id ?? undefined, group: getPlanningGroup(row.calendar_group_id, 'calendar'), tags: getTags('calendar_event', row.id), reminders: getReminders('calendar_event', row.id), workspaceId: row.workspace_id ?? undefined, todoId: row.todo_id ?? undefined, scratchReference: row.scratch_excerpt ? { excerpt: row.scratch_excerpt } : undefined, createdAt: row.created_at, updatedAt: row.updated_at }
}
function replaceTags(targetType: PlanningReminderTargetType, targetId: string, tagIds: string[]): void {
  const unique = [...new Set(tagIds)]
  const db = getDatabase()
  const table = targetType === 'todo' ? 'todo_tags' : 'calendar_event_tags'
  const idColumn = targetType === 'todo' ? 'todo_id' : 'calendar_event_id'
  db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = :id`).run({ id: targetId })
  for (const tagId of unique) {
    const exists = db.prepare('SELECT id FROM tags WHERE id = :id').get({ id: tagId })
    if (!exists) throw new Error('标签不存在')
    db.prepare(`INSERT INTO ${table} (${idColumn}, tag_id) VALUES (:id, :tagId)`).run({ id: targetId, tagId })
  }
}
function createReminders(targetType: PlanningReminderTargetType, targetId: string, inputs: { triggerAt: number }[], origin: PlanningReminderOrigin = 'manual'): void {
  for (const input of inputs) createPlanningReminderWithOrigin({ targetType, targetId, triggerAt: input.triggerAt }, origin)
}

/** 仅同步未推迟的自动 Todo 提醒；手动提醒与用户主动推迟的提醒绝不覆盖。 */
function syncTodoDueAtReminder(todoId: string, dueAt: number | undefined, now: number): void {
  const db = getDatabase()
  const reminders = getReminders('todo', todoId)
  const defaults = reminders.filter((reminder) => reminder.origin === 'todo_due_at')
  if (dueAt === undefined) {
    db.prepare(`DELETE FROM planning_reminders WHERE target_type='todo' AND target_id=:todoId AND origin='todo_due_at' AND status='pending'`).run({ todoId })
    return
  }
  const movable = defaults.find((reminder) => reminder.status === 'pending' && reminder.snoozedUntil === undefined)
  if (movable) {
    db.prepare(`UPDATE planning_reminders SET trigger_at=:triggerAt,last_notified_at=NULL,updated_at=:now WHERE id=:id AND status='pending'`).run({ id: movable.id, triggerAt: dueAt, now })
    return
  }
  // 已推迟的默认提醒保持原样；存在任意手动待处理提醒时也不额外创建默认提醒。
  if (defaults.some((reminder) => reminder.status === 'pending') || reminders.some((reminder) => reminder.status === 'pending')) return
  createReminders('todo', todoId, [{ triggerAt: dueAt }], 'todo_due_at')
}

/** 为未来的“日程开始自动提醒”保留同步路径；当前不会把手动提醒改期。 */
function syncCalendarEventStartReminder(eventId: string, startAt: number, now: number): void {
  getDatabase().prepare(`UPDATE planning_reminders SET trigger_at=:triggerAt,last_notified_at=NULL,updated_at=:now WHERE target_type='calendar_event' AND target_id=:eventId AND origin='event_start' AND status='pending' AND snoozed_until IS NULL`).run({ eventId, triggerAt: startAt, now })
}

function setTodoRemindersCompleted(todoId: string, now: number): void {
  getDatabase().prepare(`UPDATE planning_reminders SET status = 'completed', updated_at = :now WHERE target_type = 'todo' AND target_id = :todoId AND status = 'pending'`).run({ todoId, now })
}

export function listPlanningGroups(scope: PlanningGroupScope, includeArchived = false): PlanningGroup[] {
  const rows = getDatabase().prepare(`SELECT * FROM ${groupTable(scope)} ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY sort_order, name COLLATE NOCASE`).all() as GroupRow[]
  return rows.map((row) => groupFromRow(row, scope))
}
export function createPlanningGroup(input: CreatePlanningGroupInput): PlanningGroup {
  const now = Date.now(); const group: PlanningGroup = { id: randomUUID(), scope: input.scope, name: assertText(input.name, '分组名称', 100), color: input.color?.trim() || undefined, sortOrder: input.sortOrder ?? 0, createdAt: now, updatedAt: now }
  getDatabase().prepare(`INSERT INTO ${groupTable(group.scope)} (id, name, color, sort_order, created_at, updated_at) VALUES (:id, :name, :color, :sortOrder, :createdAt, :updatedAt)`).run({ id: group.id, name: group.name, color: group.color ?? null, sortOrder: group.sortOrder, createdAt: group.createdAt, updatedAt: group.updatedAt })
  return group
}
export function updatePlanningGroup(input: UpdatePlanningGroupInput): PlanningGroup | undefined {
  const old = getPlanningGroup(input.id, input.scope); if (!old) return undefined
  const updated: PlanningGroup = { ...old, name: input.name === undefined ? old.name : assertText(input.name, '分组名称', 100), color: input.color === undefined ? old.color : input.color?.trim() || undefined, sortOrder: input.sortOrder ?? old.sortOrder, archivedAt: input.archivedAt === undefined ? old.archivedAt : input.archivedAt ?? undefined, updatedAt: Date.now() }
  getDatabase().prepare(`UPDATE ${groupTable(input.scope)} SET name=:name,color=:color,sort_order=:sortOrder,archived_at=:archivedAt,updated_at=:updatedAt WHERE id=:id`).run({ id: updated.id, name: updated.name, color: updated.color ?? null, sortOrder: updated.sortOrder, archivedAt: updated.archivedAt ?? null, updatedAt: updated.updatedAt })
  return updated
}
export function deletePlanningGroup(scope: PlanningGroupScope, id: string): boolean {
  const result = getDatabase().prepare(`DELETE FROM ${groupTable(scope)} WHERE id = :id`).run({ id }) as { changes?: number }
  return (result.changes ?? 0) > 0
}
export function listPlanningTags(): PlanningTag[] {
  return (getDatabase().prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all() as TagRow[]).map(tagFromRow)
}
export function createPlanningTag(input: CreatePlanningTagInput): PlanningTag {
  const now = Date.now(); const tag: PlanningTag = { id: randomUUID(), name: assertText(input.name, '标签名称', 100), color: input.color?.trim() || undefined, createdAt: now, updatedAt: now }
  getDatabase().prepare('INSERT INTO tags (id,name,color,created_at,updated_at) VALUES (:id,:name,:color,:createdAt,:updatedAt)').run({ id: tag.id, name: tag.name, color: tag.color ?? null, createdAt: tag.createdAt, updatedAt: tag.updatedAt })
  return tag
}
export function updatePlanningTag(input: UpdatePlanningTagInput): PlanningTag | undefined {
  const row = getDatabase().prepare('SELECT * FROM tags WHERE id = :id').get({ id: input.id }) as TagRow | undefined; if (!row) return undefined
  const old = tagFromRow(row); const updated: PlanningTag = { ...old, name: input.name === undefined ? old.name : assertText(input.name, '标签名称', 100), color: input.color === undefined ? old.color : input.color?.trim() || undefined, updatedAt: Date.now() }
  getDatabase().prepare('UPDATE tags SET name=:name,color=:color,updated_at=:updatedAt WHERE id=:id').run({ id: updated.id, name: updated.name, color: updated.color ?? null, updatedAt: updated.updatedAt }); return updated
}
export function deletePlanningTag(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM tags WHERE id = :id').run({ id }) as { changes?: number }; return (result.changes ?? 0) > 0
}

export interface TodoQuery { status?: Todo['status']; dueBefore?: number; limit?: number }
export function listTodos(query: TodoQuery = {}): Todo[] {
  const where: string[] = []; const params: Record<string, unknown> = {}; const limit = normalizeLimit(query.limit)
  if (query.status) { where.push('status = :status'); params.status = query.status }
  if (query.dueBefore !== undefined) { where.push('due_at IS NOT NULL AND due_at <= :dueBefore'); params.dueBefore = query.dueBefore }
  if (limit) params.limit = limit
  const sql = `SELECT * FROM todos ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_at IS NULL, due_at, updated_at DESC ${limit ? 'LIMIT :limit' : ''}`
  return (getDatabase().prepare(sql).all(params) as TodoRow[]).map(todoFromRow)
}
export function getTodo(id: string): Todo | undefined {
  const row = getDatabase().prepare('SELECT * FROM todos WHERE id = :id').get({ id }) as TodoRow | undefined; return row ? todoFromRow(row) : undefined
}

/** 将 Agent Session 与 Todo 去重关联；仅成功持久化的 Agent 写操作调用。 */
export function touchTodoSession(todoId: string, sessionId: string): void {
  if (!sessionId || !getTodo(todoId)) return
  const now = Date.now()
  getDatabase().prepare(`
    INSERT INTO todo_session_links (todo_id, session_id, first_touched_at, last_touched_at)
    VALUES (:todoId, :sessionId, :now, :now)
    ON CONFLICT(todo_id, session_id) DO UPDATE SET last_touched_at = excluded.last_touched_at
  `).run({ todoId, sessionId, now })
}
export function createTodo(input: CreateTodoInput): Todo {
  assertTimestamp(input.dueAt, 'dueAt'); const now = Date.now(); const todo = { id: randomUUID(), title: assertTitle(input.title, 'Todo'), notes: input.notes?.trim() || undefined, status: 'open' as const, priority: input.priority ?? 'medium', dueAt: input.dueAt, groupId: input.groupId, workspaceId: input.workspaceId || undefined, scratchReference: input.scratchReference, createdAt: now, updatedAt: now }
  if (todo.groupId && !getPlanningGroup(todo.groupId, 'todo')) throw new Error('Todo 分组不存在')
  getDatabase().prepare(`INSERT INTO todos (id,title,notes,status,priority,due_at,group_id,workspace_id,scratch_excerpt,created_at,updated_at,completed_at) VALUES (:id,:title,:notes,:status,:priority,:dueAt,:groupId,:workspaceId,:scratchExcerpt,:createdAt,:updatedAt,NULL)`).run({ id: todo.id, title: todo.title, notes: todo.notes ?? null, status: todo.status, priority: todo.priority, dueAt: todo.dueAt ?? null, groupId: todo.groupId ?? null, workspaceId: todo.workspaceId ?? null, scratchExcerpt: todo.scratchReference?.excerpt ?? null, createdAt: todo.createdAt, updatedAt: todo.updatedAt })
  if (input.tagIds) replaceTags('todo', todo.id, input.tagIds)
  // 未显式传入提醒时，完成时间即默认提醒时间；保持各入口行为一致。
  if (input.reminders) createReminders('todo', todo.id, input.reminders, 'manual')
  else if (todo.dueAt) createReminders('todo', todo.id, [{ triggerAt: todo.dueAt }], 'todo_due_at')
  return getTodo(todo.id)!
}
export function updateTodo(input: UpdateTodoInput): Todo | undefined {
  const old = getTodo(input.id); if (!old) return undefined; if (input.dueAt !== undefined && input.dueAt !== null) assertTimestamp(input.dueAt, 'dueAt')
  const status = input.status ?? old.status; const updated = { ...old, title: input.title === undefined ? old.title : assertTitle(input.title, 'Todo'), notes: input.notes === undefined ? old.notes : input.notes.trim() || undefined, priority: input.priority ?? old.priority, dueAt: input.dueAt === undefined ? old.dueAt : input.dueAt ?? undefined, groupId: input.groupId === undefined ? old.groupId : input.groupId ?? undefined, workspaceId: input.workspaceId === undefined ? old.workspaceId : input.workspaceId ?? undefined, scratchReference: input.scratchReference === undefined ? old.scratchReference : input.scratchReference ?? undefined, status, completedAt: status === 'completed' ? (old.completedAt ?? Date.now()) : undefined, updatedAt: Date.now() }
  if (updated.groupId && !getPlanningGroup(updated.groupId, 'todo')) throw new Error('Todo 分组不存在')
  getDatabase().prepare(`UPDATE todos SET title=:title,notes=:notes,status=:status,priority=:priority,due_at=:dueAt,group_id=:groupId,workspace_id=:workspaceId,scratch_excerpt=:scratchExcerpt,updated_at=:updatedAt,completed_at=:completedAt WHERE id=:id`).run({ id: updated.id, title: updated.title, notes: updated.notes ?? null, status: updated.status, priority: updated.priority, dueAt: updated.dueAt ?? null, groupId: updated.groupId ?? null, workspaceId: updated.workspaceId ?? null, scratchExcerpt: updated.scratchReference?.excerpt ?? null, updatedAt: updated.updatedAt, completedAt: updated.completedAt ?? null })
  if (input.tagIds !== undefined) replaceTags('todo', old.id, input.tagIds)
  if (input.dueAt !== undefined && old.dueAt !== updated.dueAt) syncTodoDueAtReminder(old.id, updated.dueAt, updated.updatedAt)
  if (status === 'completed') setTodoRemindersCompleted(old.id, updated.updatedAt)
  return getTodo(old.id)
}
export function deleteTodo(id: string): boolean {
  const db = getDatabase(); db.prepare(`DELETE FROM planning_reminders WHERE target_type='todo' AND target_id=:id`).run({ id }); const result = db.prepare('DELETE FROM todos WHERE id=:id').run({ id }) as { changes?: number }; return (result.changes ?? 0) > 0
}

export interface CalendarEventQuery { from?: number; to?: number; limit?: number }
export function listCalendarEvents(query: CalendarEventQuery = {}): CalendarEvent[] {
  const where: string[] = []; const params: Record<string, unknown> = {}; const limit = normalizeLimit(query.limit)
  if (query.from !== undefined) { where.push('COALESCE(end_at,start_at)>=:from'); params.from = query.from }
  if (query.to !== undefined) { where.push('start_at<=:to'); params.to = query.to }
  if (limit) params.limit = limit
  return (getDatabase().prepare(`SELECT * FROM calendar_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY start_at ${limit ? 'LIMIT :limit' : ''}`).all(params) as CalendarEventRow[]).map(calendarEventFromRow)
}
export function getCalendarEvent(id: string): CalendarEvent | undefined { const row = getDatabase().prepare('SELECT * FROM calendar_events WHERE id=:id').get({ id }) as CalendarEventRow | undefined; return row ? calendarEventFromRow(row) : undefined }
export function createCalendarEvent(input: CreateCalendarEventInput): CalendarEvent {
  assertTimestamp(input.startAt, 'startAt'); assertTimestamp(input.endAt, 'endAt'); if (input.endAt && input.endAt < input.startAt) throw new Error('日程 endAt 不能早于 startAt')
  const now = Date.now(); const event = { id: randomUUID(), title: assertTitle(input.title, '日程'), notes: input.notes?.trim() || undefined, startAt: input.startAt, endAt: input.endAt, allDay: input.allDay ?? false, groupId: input.groupId, workspaceId: input.workspaceId || undefined, todoId: input.todoId || undefined, scratchReference: input.scratchReference, createdAt: now, updatedAt: now }
  if (event.groupId && !getPlanningGroup(event.groupId, 'calendar')) throw new Error('日程分组不存在')
  getDatabase().prepare(`INSERT INTO calendar_events (id,title,notes,start_at,end_at,all_day,calendar_group_id,workspace_id,todo_id,scratch_excerpt,created_at,updated_at) VALUES (:id,:title,:notes,:startAt,:endAt,:allDay,:groupId,:workspaceId,:todoId,:scratchExcerpt,:createdAt,:updatedAt)`).run({ id: event.id, title: event.title, notes: event.notes ?? null, startAt: event.startAt, endAt: event.endAt ?? null, allDay: event.allDay ? 1 : 0, groupId: event.groupId ?? null, workspaceId: event.workspaceId ?? null, todoId: event.todoId ?? null, scratchExcerpt: event.scratchReference?.excerpt ?? null, createdAt: event.createdAt, updatedAt: event.updatedAt })
  if (input.tagIds) replaceTags('calendar_event', event.id, input.tagIds); if (input.reminders) createReminders('calendar_event', event.id, input.reminders); return getCalendarEvent(event.id)!
}
export function updateCalendarEvent(input: UpdateCalendarEventInput): CalendarEvent | undefined {
  const old = getCalendarEvent(input.id); if (!old) return undefined; if (input.startAt !== undefined) assertTimestamp(input.startAt, 'startAt'); if (input.endAt !== undefined && input.endAt !== null) assertTimestamp(input.endAt, 'endAt')
  const updated = { ...old, title: input.title === undefined ? old.title : assertTitle(input.title, '日程'), notes: input.notes === undefined ? old.notes : input.notes.trim() || undefined, startAt: input.startAt ?? old.startAt, endAt: input.endAt === undefined ? old.endAt : input.endAt ?? undefined, allDay: input.allDay ?? old.allDay, groupId: input.groupId === undefined ? old.groupId : input.groupId ?? undefined, workspaceId: input.workspaceId === undefined ? old.workspaceId : input.workspaceId ?? undefined, todoId: input.todoId === undefined ? old.todoId : input.todoId ?? undefined, scratchReference: input.scratchReference === undefined ? old.scratchReference : input.scratchReference ?? undefined, updatedAt: Date.now() }
  if (updated.endAt && updated.endAt < updated.startAt) throw new Error('日程 endAt 不能早于 startAt'); if (updated.groupId && !getPlanningGroup(updated.groupId, 'calendar')) throw new Error('日程分组不存在')
  getDatabase().prepare(`UPDATE calendar_events SET title=:title,notes=:notes,start_at=:startAt,end_at=:endAt,all_day=:allDay,calendar_group_id=:groupId,workspace_id=:workspaceId,todo_id=:todoId,scratch_excerpt=:scratchExcerpt,updated_at=:updatedAt WHERE id=:id`).run({ id: updated.id, title: updated.title, notes: updated.notes ?? null, startAt: updated.startAt, endAt: updated.endAt ?? null, allDay: updated.allDay ? 1 : 0, groupId: updated.groupId ?? null, workspaceId: updated.workspaceId ?? null, todoId: updated.todoId ?? null, scratchExcerpt: updated.scratchReference?.excerpt ?? null, updatedAt: updated.updatedAt })
  if (input.tagIds !== undefined) replaceTags('calendar_event', old.id, input.tagIds)
  if (input.startAt !== undefined && old.startAt !== updated.startAt) syncCalendarEventStartReminder(old.id, updated.startAt, updated.updatedAt)
  return getCalendarEvent(old.id)
}
export function deleteCalendarEvent(id: string): boolean {
  const db = getDatabase()
  db.prepare(`DELETE FROM planning_reminders WHERE target_type='calendar_event' AND target_id=:id`).run({ id })
  const result = db.prepare('DELETE FROM calendar_events WHERE id=:id').run({ id }) as { changes?: number }
  return (result.changes ?? 0) > 0
}

function createPlanningReminderWithOrigin(input: CreatePlanningReminderRequest, origin: PlanningReminderOrigin): PlanningReminder {
  assertTimestamp(input.triggerAt, 'triggerAt'); if (input.targetType === 'todo' ? !getTodo(input.targetId) : !getCalendarEvent(input.targetId)) throw new Error('提醒目标不存在')
  const now = Date.now(); const reminder: PlanningReminder = { id: randomUUID(), targetType: input.targetType, targetId: input.targetId, triggerAt: input.triggerAt, status: 'pending', origin, createdAt: now, updatedAt: now }
  getDatabase().prepare(`INSERT INTO planning_reminders (id,target_type,target_id,trigger_at,status,origin,created_at,updated_at) VALUES (:id,:targetType,:targetId,:triggerAt,:status,:origin,:createdAt,:updatedAt)`).run({ id: reminder.id, targetType: reminder.targetType, targetId: reminder.targetId, triggerAt: reminder.triggerAt, status: reminder.status, origin: reminder.origin, createdAt: reminder.createdAt, updatedAt: reminder.updatedAt })
  return reminder
}

/** 外部工具和 UI 创建的提醒均为手动提醒，不会在 Todo/日程改期时被覆盖。 */
export function createPlanningReminder(input: CreatePlanningReminderRequest): PlanningReminder {
  return createPlanningReminderWithOrigin(input, 'manual')
}
export function deletePlanningReminder(id: string): boolean { const result = getDatabase().prepare('DELETE FROM planning_reminders WHERE id=:id').run({ id }) as { changes?: number }; return (result.changes ?? 0) > 0 }
export function updatePlanningReminder(id: string, triggerAt: number): PlanningReminder | undefined {
  assertTimestamp(triggerAt, 'triggerAt')
  const now = Date.now()
  const result = getDatabase().prepare(`UPDATE planning_reminders SET trigger_at=:triggerAt,snoozed_until=NULL,last_notified_at=NULL,updated_at=:now WHERE id=:id AND status='pending'`).run({ id, triggerAt, now }) as { changes?: number }
  return (result.changes ?? 0) > 0 ? getReminder(id) : undefined
}
export function acknowledgePlanningReminder(id: string): PlanningReminder | undefined {
  const now = Date.now()
  const result = getDatabase().prepare(`UPDATE planning_reminders SET status='acknowledged',acknowledged_at=:now,updated_at=:now WHERE id=:id AND status='pending'`).run({ id, now }) as { changes?: number }
  return (result.changes ?? 0) > 0 ? getReminder(id) : undefined
}
export function snoozePlanningReminder(id: string, minutes: number): PlanningReminder | undefined {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('推迟分钟数必须在 1 到 10080 之间')
  const now = Date.now()
  const result = getDatabase().prepare(`UPDATE planning_reminders SET snoozed_until=:snoozedUntil,last_notified_at=NULL,updated_at=:now WHERE id=:id AND status='pending'`).run({ id, snoozedUntil: now + minutes * 60_000, now }) as { changes?: number }
  return (result.changes ?? 0) > 0 ? getReminder(id) : undefined
}
function getReminder(id: string): PlanningReminder | undefined { const row = getDatabase().prepare('SELECT * FROM planning_reminders WHERE id=:id').get({ id }) as ReminderRow | undefined; return row ? reminderFromRow(row) : undefined }
export function listActivePlanningReminders(): ActivePlanningReminder[] {
  const rows = getDatabase().prepare(`SELECT * FROM planning_reminders WHERE status='pending' AND COALESCE(snoozed_until,trigger_at) <= :now ORDER BY COALESCE(snoozed_until,trigger_at)`).all({ now: Date.now() }) as ReminderRow[]
  return rows.flatMap((row): ActivePlanningReminder[] => { const target = row.target_type === 'todo' ? getTodo(row.target_id) : getCalendarEvent(row.target_id); if (!target) return []; return [{ ...reminderFromRow(row), targetTitle: target.title, group: target.group, tags: target.tags }] })
}
/** 返回新增到期提醒并标记已通知，避免每个 30 秒轮询周期重复播放声音。 */
export function claimDuePlanningReminders(now = Date.now()): ActivePlanningReminder[] {
  const rows = getDatabase().prepare(`SELECT * FROM planning_reminders WHERE status='pending' AND COALESCE(snoozed_until,trigger_at) <= :now AND last_notified_at IS NULL ORDER BY COALESCE(snoozed_until,trigger_at)`).all({ now }) as ReminderRow[]
  const result: ActivePlanningReminder[] = []
  for (const row of rows) { getDatabase().prepare('UPDATE planning_reminders SET last_notified_at=:now,updated_at=:now WHERE id=:id').run({ id: row.id, now }); const target = row.target_type === 'todo' ? getTodo(row.target_id) : getCalendarEvent(row.target_id); if (target) result.push({ ...reminderFromRow({ ...row, last_notified_at: now, updated_at: now }), targetTitle: target.title, group: target.group, tags: target.tags }) }
  return result
}
