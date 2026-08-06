/**
 * 任务/日程 SQLite 数据层。
 *
 * Todo 和日程是独立表；分组按 Todo / 日程隔离，标签与提醒在同一 planning.db 内通过关系表连接。
 */

import { randomUUID } from 'node:crypto'
import { PLANNING_CONFLICT_ERROR } from '@proma/shared'
import type {
  ActivePlanningReminder,
  CalendarEvent,
  CalendarEventListQuery,
  CreateCalendarEventInput,
  CreatePlanningGroupInput,
  CreatePlanningReminderRequest,
  CreatePlanningTagInput,
  CreateTodoInput,
  PlanningGroup,
  PlanningGroupScope,
  PlanningNativeConnection,
  PlanningNativeSyncConflict,
  PlanningNativeSyncEntity,
  ResolvePlanningNativeSyncConflictInput,
  PlanningReminder,
  PlanningReminderOrigin,
  PlanningReminderTargetType,
  PlanningTag,
  PlanningSyncProfile,
  ConnectPlanningNativeConnectionInput,
  SavePlanningSyncProfileInput,
  Todo,
  TodoListQuery,
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
  due_at: number | null; group_id: string | null; workspace_id: string | null; native_connection_id: string | null
  created_at: number; updated_at: number; completed_at: number | null
}
type CalendarEventRow = {
  id: string; title: string; notes: string | null; start_at: number; end_at: number | null; all_day: number
  calendar_group_id: string | null; workspace_id: string | null; todo_id: string | null; native_connection_id: string | null
  created_at: number; updated_at: number
}
type GroupRow = { id: string; name: string; color: string | null; sort_order: number; created_at: number; updated_at: number }
type TagRow = { id: string; name: string; color: string | null; created_at: number; updated_at: number }
type ReminderRow = {
  id: string; target_type: PlanningReminderTargetType; target_id: string; trigger_at: number; snoozed_until: number | null
  status: 'pending' | 'acknowledged' | 'completed'; origin: PlanningReminderOrigin; acknowledged_at: number | null; last_notified_at: number | null; created_at: number; updated_at: number
}
type TodoSessionLinkRow = { todo_id: string; session_id: string; first_touched_at: number; last_touched_at: number }
type SyncProfileRow = { id: string; entity: 'calendar' | 'reminder'; target_id: string; target_title: string; source_title: string; enabled: number; created_at: number; updated_at: number }
type SyncOutboxRow = { id: string; profile_id: string; target_id: string | null; operation: 'upsert' | 'delete'; proma_entity_id: string; native_start_at: number | null; attempts: number; next_attempt_at: number; last_error: string | null; revision: number; created_at: number; updated_at: number }
type SyncBindingRow = { profile_id: string; target_id: string | null; proma_entity_id: string; calendar_item_identifier: string | null; calendar_item_external_identifier: string | null; last_synced_hash: string | null; last_synced_at: number | null }
type SyncProfileConflictRow = { id: string; profile_id: string; proma_entity_id: string; kind: 'changed' | 'deleted'; native_item_json: string | null; detected_at: number }
type SyncCleanupRow = { id: string; entity: 'calendar' | 'reminder'; target_id: string; proma_entity_id: string; calendar_item_identifier: string | null; native_start_at: number | null; attempts: number; next_attempt_at: number; last_error: string | null; created_at: number; updated_at: number }
type NativeConnectionRow = { id: string; entity: 'calendar' | 'reminder'; target_id: string; target_title: string; source_title: string; source_type: PlanningNativeConnection['sourceType']; can_write: number; connected_at: number; updated_at: number }
type NativeBindingRow = { connection_id: string; proma_entity_id: string; calendar_item_identifier: string; due_date_only: number; recreate_pending: number; last_native_hash: string | null; last_synced_at: number | null }
type NativeOutboxRow = { id: string; connection_id: string; operation: 'upsert' | 'hide'; proma_entity_id: string; attempts: number; next_attempt_at: number; revision: number }
type NativeConflictRow = { id: string; connection_id: string; entity: 'calendar' | 'reminder'; proma_entity_id: string; kind: 'changed' | 'deleted'; native_item_json: string | null; detected_at: number; resolved_at: number | null }

export interface PlanningSyncOutboxItem {
  id: string
  profile: PlanningSyncProfile
  operation: 'upsert' | 'delete'
  promaEntityId: string
  attempts: number
  /** 防止执行中的旧操作确认/重试覆盖随后写入的本地变更。 */
  revision: number
  calendarItemIdentifier?: string
  /** Calendar 删除的 crash-recovery 查找锚点。 */
  nativeStartAt?: number
}

export interface PlanningNativeExternalItem {
  calendarItemIdentifier: string
  calendarItemExternalIdentifier?: string
  /** 仅由 addon 从 Proma 自己写入的 URL marker 解析，绝不透出任意用户 URL。 */
  promaIdentity?: string
  title: string
  notes?: string
  startAt?: number
  endAt?: number
  allDay?: boolean
  dueAt?: number
  priority?: 'low' | 'medium' | 'high'
  completed?: boolean
  completedAt?: number
  dueDateOnly?: boolean
  isRecurring?: boolean
  lastModifiedAt: number
}

export interface PlanningNativeOutboxItem {
  id: string
  connection: PlanningNativeConnection
  operation: 'upsert' | 'hide'
  promaEntityId: string
  calendarItemIdentifier: string
  dueDateOnly?: boolean
  recreatePending?: boolean
  attempts: number
  revision: number
}

export interface PlanningSyncCleanupItem {
  id: string
  entity: 'calendar' | 'reminder'
  targetId: string
  promaEntityId: string
  calendarItemIdentifier?: string
  nativeStartAt?: number
  attempts: number
}

let database: SqliteDatabase | null = null

function withPlanningTransaction<T>(work: () => T): T {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 事务已由 SQLite 回滚时无需重复处理。 */ }
    throw error
  }
}

const PLANNING_SCHEMA_VERSION = 9

/** EventKit 的内部 locator、marker 与 lastModifiedDate 不属于用户可编辑内容，不能参与双向基线。 */
export function planningNativeCalendarHash(item: Pick<PlanningNativeExternalItem, 'title' | 'notes' | 'startAt' | 'endAt' | 'allDay'>): string {
  return JSON.stringify({ title: item.title, notes: item.notes ?? null, startAt: item.startAt ?? null, endAt: item.endAt ?? null, allDay: Boolean(item.allDay) })
}

/**
 * Planning 在 v0.16.9 前没有 user_version；因此 migration 1 必须幂等地重建既有 schema，
 * 再把已有用户安全带入后续版本。以后只允许追加顺序 migration，避免隐式建表掩盖升级错误。
 */
function migrateDatabase(db: SqliteDatabase): void {
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  let version = versionRow?.user_version ?? 0
  if (version > PLANNING_SCHEMA_VERSION) throw new Error('任务/日程数据版本高于当前 Proma，无法安全打开')

  db.exec('BEGIN IMMEDIATE')
  try {
    if (version < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_groups (
          id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100), color TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS calendar_groups (
          id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100), color TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 100), color TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 500), notes TEXT,
          status TEXT NOT NULL CHECK(status IN ('open', 'completed')), priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high')),
          due_at INTEGER, group_id TEXT REFERENCES planning_groups(id) ON DELETE SET NULL, workspace_id TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS calendar_events (
          id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 500), notes TEXT, start_at INTEGER NOT NULL, end_at INTEGER,
          all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0, 1)), calendar_group_id TEXT REFERENCES calendar_groups(id) ON DELETE SET NULL,
          workspace_id TEXT, todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
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
          origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual', 'todo_due_at')),
          acknowledged_at INTEGER, last_notified_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todo_session_links (
          todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          first_touched_at INTEGER NOT NULL,
          last_touched_at INTEGER NOT NULL,
          PRIMARY KEY(todo_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS todos_status_due_at_idx ON todos(status, due_at);
        CREATE INDEX IF NOT EXISTS todos_group_id_idx ON todos(group_id);
        CREATE INDEX IF NOT EXISTS calendar_events_start_at_idx ON calendar_events(start_at);
        CREATE INDEX IF NOT EXISTS calendar_events_calendar_group_id_idx ON calendar_events(calendar_group_id);
        CREATE INDEX IF NOT EXISTS calendar_events_todo_id_idx ON calendar_events(todo_id);
        CREATE INDEX IF NOT EXISTS planning_reminders_due_idx ON planning_reminders(status, snoozed_until, trigger_at);
        CREATE INDEX IF NOT EXISTS planning_reminders_target_idx ON planning_reminders(target_type, target_id);
        CREATE INDEX IF NOT EXISTS todo_session_links_recent_idx ON todo_session_links(todo_id, last_touched_at DESC);
      `)
      db.exec('PRAGMA user_version = 1')
      version = 1
    }
    if (version < 2) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_sync_profiles (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL UNIQUE CHECK(entity IN ('calendar', 'reminder')),
          target_id TEXT NOT NULL,
          target_title TEXT NOT NULL,
          source_title TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS planning_sync_bindings (
          profile_id TEXT NOT NULL REFERENCES planning_sync_profiles(id) ON DELETE CASCADE,
          proma_entity_id TEXT NOT NULL,
          calendar_item_identifier TEXT,
          calendar_item_external_identifier TEXT,
          last_synced_hash TEXT,
          last_synced_at INTEGER,
          PRIMARY KEY(profile_id, proma_entity_id)
        );
        CREATE TABLE IF NOT EXISTS planning_sync_outbox (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES planning_sync_profiles(id) ON DELETE CASCADE,
          operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
          proma_entity_id TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(profile_id, proma_entity_id)
        );
        CREATE INDEX IF NOT EXISTS planning_sync_outbox_due_idx ON planning_sync_outbox(profile_id, next_attempt_at, created_at);
      `)
      db.exec('PRAGMA user_version = 2')
    }
    if (version < 3) {
      db.exec('ALTER TABLE planning_sync_outbox ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
      db.exec('PRAGMA user_version = 3')
      version = 3
    }
    if (version < 4) {
      // 目标切换期间 profile 会指向新目标，因此执行和 binding 都必须持久化旧目标快照。
      db.exec(`
        ALTER TABLE planning_sync_outbox ADD COLUMN target_id TEXT;
        ALTER TABLE planning_sync_outbox ADD COLUMN native_start_at INTEGER;
        ALTER TABLE planning_sync_bindings ADD COLUMN target_id TEXT;
        UPDATE planning_sync_outbox SET target_id=(SELECT target_id FROM planning_sync_profiles WHERE id=planning_sync_outbox.profile_id) WHERE target_id IS NULL;
        UPDATE planning_sync_bindings SET target_id=(SELECT target_id FROM planning_sync_profiles WHERE id=planning_sync_bindings.profile_id) WHERE target_id IS NULL;
        CREATE TABLE IF NOT EXISTS planning_sync_cleanup (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL CHECK(entity IN ('calendar', 'reminder')),
          target_id TEXT NOT NULL,
          proma_entity_id TEXT NOT NULL,
          calendar_item_identifier TEXT,
          native_start_at INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(entity, target_id, proma_entity_id)
        );
        CREATE INDEX IF NOT EXISTS planning_sync_cleanup_due_idx ON planning_sync_cleanup(next_attempt_at, created_at);
      `)
      db.exec('PRAGMA user_version = 4')
      version = 4
    }
    if (version < 5) {
      db.exec(`
        ALTER TABLE todos ADD COLUMN native_connection_id TEXT;
        ALTER TABLE calendar_events ADD COLUMN native_connection_id TEXT;
        CREATE TABLE IF NOT EXISTS planning_native_connections (
          id TEXT PRIMARY KEY,
          entity TEXT NOT NULL CHECK(entity IN ('calendar', 'reminder')),
          target_id TEXT NOT NULL,
          target_title TEXT NOT NULL,
          source_title TEXT NOT NULL,
          source_type TEXT NOT NULL,
          can_write INTEGER NOT NULL DEFAULT 0 CHECK(can_write IN (0, 1)),
          connected_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(entity, target_id)
        );
        CREATE TABLE IF NOT EXISTS planning_native_bindings (
          connection_id TEXT NOT NULL REFERENCES planning_native_connections(id) ON DELETE CASCADE,
          proma_entity_id TEXT NOT NULL,
          calendar_item_identifier TEXT NOT NULL,
          last_native_hash TEXT,
          last_synced_at INTEGER,
          PRIMARY KEY(connection_id, proma_entity_id),
          UNIQUE(connection_id, calendar_item_identifier)
        );
        CREATE TABLE IF NOT EXISTS planning_native_outbox (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES planning_native_connections(id) ON DELETE CASCADE,
          operation TEXT NOT NULL CHECK(operation IN ('upsert', 'hide')),
          proma_entity_id TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(connection_id, proma_entity_id)
        );
        CREATE INDEX IF NOT EXISTS planning_native_outbox_due_idx ON planning_native_outbox(next_attempt_at, created_at);
        CREATE INDEX IF NOT EXISTS todos_native_connection_idx ON todos(native_connection_id);
        CREATE INDEX IF NOT EXISTS calendar_events_native_connection_idx ON calendar_events(native_connection_id);
      `)
      db.exec('PRAGMA user_version = 5')
      version = 5
    }
    if (version < 6) {
      db.exec('ALTER TABLE planning_native_bindings ADD COLUMN due_date_only INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 6')
      version = 6
    }
    if (version < 7) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_native_sync_conflicts (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL REFERENCES planning_native_connections(id) ON DELETE CASCADE,
          entity TEXT NOT NULL CHECK(entity IN ('calendar', 'reminder')),
          proma_entity_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('changed', 'deleted')),
          native_item_json TEXT,
          detected_at INTEGER NOT NULL,
          resolved_at INTEGER,
          UNIQUE(connection_id, proma_entity_id)
        );
        CREATE INDEX IF NOT EXISTS planning_native_sync_conflicts_open_idx ON planning_native_sync_conflicts(resolved_at, detected_at);
        PRAGMA user_version = 7;
      `)
      version = 7
    }
    if (version < 8) {
      db.exec('ALTER TABLE planning_native_bindings ADD COLUMN recreate_pending INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 8')
      version = 8
    }
    if (version < 9) {
      // 受管 Calendar 与外部连接是两套模型；冲突账本不能复用 connection_id 外键。
      db.exec(`
        CREATE TABLE IF NOT EXISTS planning_sync_profile_conflicts (
          id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES planning_sync_profiles(id) ON DELETE CASCADE,
          proma_entity_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('changed', 'deleted')),
          native_item_json TEXT,
          detected_at INTEGER NOT NULL,
          UNIQUE(profile_id, proma_entity_id)
        );
        CREATE INDEX IF NOT EXISTS planning_sync_profile_conflicts_open_idx
          ON planning_sync_profile_conflicts(profile_id, detected_at);
        PRAGMA user_version = 9;
      `)
      version = 9
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* migration transaction already rolled back */ }
    throw error
  }
}

function getDatabase(): SqliteDatabase {
  if (database) return database
  const { DatabaseSync } = require('node:sqlite') as SqliteModule
  const db = new DatabaseSync(getPlanningDatabasePath())
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrateDatabase(db)
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
  return { id: row.id, scope, name: row.name, color: row.color ?? undefined, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at }
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

function inClause(ids: string[], prefix: string): { placeholders: string; params: Record<string, string> } {
  const params: Record<string, string> = {}
  const placeholders = ids.map((id, index) => {
    const key = `${prefix}${index}`
    params[key] = id
    return `:${key}`
  }).join(', ')
  return { placeholders, params }
}

function groupsById(ids: Array<string | null>, scope: PlanningGroupScope): Map<string, PlanningGroup> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map()
  const { placeholders, params } = inClause(unique, 'groupId')
  const rows = getDatabase().prepare(`SELECT * FROM ${groupTable(scope)} WHERE id IN (${placeholders})`).all(params) as GroupRow[]
  return new Map(rows.map((row) => [row.id, groupFromRow(row, scope)]))
}

function tagsByTarget(targetType: PlanningReminderTargetType, targetIds: string[]): Map<string, PlanningTag[]> {
  if (targetIds.length === 0) return new Map()
  const table = targetType === 'todo' ? 'todo_tags' : 'calendar_event_tags'
  const idColumn = targetType === 'todo' ? 'todo_id' : 'calendar_event_id'
  const { placeholders, params } = inClause(targetIds, 'targetId')
  const rows = getDatabase().prepare(`SELECT ${table}.${idColumn} AS target_id, tags.* FROM tags JOIN ${table} ON tags.id = ${table}.tag_id WHERE ${table}.${idColumn} IN (${placeholders}) ORDER BY tags.name COLLATE NOCASE`).all(params) as Array<TagRow & { target_id: string }>
  const result = new Map<string, PlanningTag[]>()
  for (const row of rows) {
    const tags = result.get(row.target_id) ?? []
    tags.push(tagFromRow(row))
    result.set(row.target_id, tags)
  }
  return result
}

function remindersByTarget(targetType: PlanningReminderTargetType, targetIds: string[]): Map<string, PlanningReminder[]> {
  if (targetIds.length === 0) return new Map()
  const { placeholders, params } = inClause(targetIds, 'targetId')
  const rows = getDatabase().prepare(`SELECT * FROM planning_reminders WHERE target_type=:targetType AND target_id IN (${placeholders}) ORDER BY COALESCE(snoozed_until, trigger_at)`).all({ ...params, targetType }) as ReminderRow[]
  const result = new Map<string, PlanningReminder[]>()
  for (const row of rows) {
    const reminders = result.get(row.target_id) ?? []
    reminders.push(reminderFromRow(row))
    result.set(row.target_id, reminders)
  }
  return result
}

function todoSessionLinksByTodo(todoIds: string[]): Map<string, TodoSessionLink[]> {
  if (todoIds.length === 0) return new Map()
  const { placeholders, params } = inClause(todoIds, 'todoId')
  const rows = getDatabase().prepare(`SELECT * FROM todo_session_links WHERE todo_id IN (${placeholders}) ORDER BY last_touched_at DESC`).all(params) as TodoSessionLinkRow[]
  const result = new Map<string, TodoSessionLink[]>()
  for (const row of rows) {
    const links = result.get(row.todo_id) ?? []
    links.push({ sessionId: row.session_id, firstTouchedAt: row.first_touched_at, lastTouchedAt: row.last_touched_at })
    result.set(row.todo_id, links)
  }
  return result
}

function hydrateTodos(rows: TodoRow[]): Todo[] {
  const ids = rows.map((row) => row.id)
  const groups = groupsById(rows.map((row) => row.group_id), 'todo')
  const tags = tagsByTarget('todo', ids)
  const reminders = remindersByTarget('todo', ids)
  const links = todoSessionLinksByTodo(ids)
  return rows.map((row) => ({
    id: row.id, title: row.title, notes: row.notes ?? undefined, status: row.status, priority: row.priority,
    dueAt: row.due_at ?? undefined, groupId: row.group_id ?? undefined, group: row.group_id ? groups.get(row.group_id) : undefined,
    tags: tags.get(row.id) ?? [], reminders: reminders.get(row.id) ?? [], sessionLinks: links.get(row.id) ?? [],
    workspaceId: row.workspace_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined,
  }))
}

function nativeOrigin(connectionId: string | null): Todo['nativeOrigin'] {
  if (!connectionId) return undefined
  const row = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE id=:id').get({ id: connectionId }) as NativeConnectionRow | undefined
  return row ? { connectionId: row.id, targetTitle: row.target_title, sourceTitle: row.source_title, canWrite: row.can_write === 1 } : undefined
}

function hydrateCalendarEvents(rows: CalendarEventRow[]): CalendarEvent[] {
  const ids = rows.map((row) => row.id)
  const groups = groupsById(rows.map((row) => row.calendar_group_id), 'calendar')
  const tags = tagsByTarget('calendar_event', ids)
  const reminders = remindersByTarget('calendar_event', ids)
  return rows.map((row) => ({
    id: row.id, title: row.title, notes: row.notes ?? undefined, startAt: row.start_at, endAt: row.end_at ?? undefined,
    allDay: row.all_day === 1, groupId: row.calendar_group_id ?? undefined, group: row.calendar_group_id ? groups.get(row.calendar_group_id) : undefined,
    tags: tags.get(row.id) ?? [], reminders: reminders.get(row.id) ?? [], workspaceId: row.workspace_id ?? undefined,
    todoId: row.todo_id ?? undefined, nativeOrigin: nativeOrigin(row.native_connection_id), createdAt: row.created_at, updatedAt: row.updated_at,
  }))
}
function todoFromRow(row: TodoRow): Todo {
  return { id: row.id, title: row.title, notes: row.notes ?? undefined, status: row.status, priority: row.priority, dueAt: row.due_at ?? undefined, groupId: row.group_id ?? undefined, group: getPlanningGroup(row.group_id, 'todo'), tags: getTags('todo', row.id), reminders: getReminders('todo', row.id), sessionLinks: getTodoSessionLinks(row.id), workspaceId: row.workspace_id ?? undefined, nativeOrigin: nativeOrigin(row.native_connection_id), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at ?? undefined }
}
function calendarEventFromRow(row: CalendarEventRow): CalendarEvent {
  return { id: row.id, title: row.title, notes: row.notes ?? undefined, startAt: row.start_at, endAt: row.end_at ?? undefined, allDay: row.all_day === 1, groupId: row.calendar_group_id ?? undefined, group: getPlanningGroup(row.calendar_group_id, 'calendar'), tags: getTags('calendar_event', row.id), reminders: getReminders('calendar_event', row.id), workspaceId: row.workspace_id ?? undefined, todoId: row.todo_id ?? undefined, nativeOrigin: nativeOrigin(row.native_connection_id), createdAt: row.created_at, updatedAt: row.updated_at }
}
function assertTagIdsExist(tagIds: string[]): string[] {
  const unique = [...new Set(tagIds)]
  for (const tagId of unique) {
    if (!getDatabase().prepare('SELECT id FROM tags WHERE id = :id').get({ id: tagId })) throw new Error('标签不存在')
  }
  return unique
}
function replaceTags(targetType: PlanningReminderTargetType, targetId: string, tagIds: string[]): void {
  const unique = assertTagIdsExist(tagIds)
  const db = getDatabase()
  const table = targetType === 'todo' ? 'todo_tags' : 'calendar_event_tags'
  const idColumn = targetType === 'todo' ? 'todo_id' : 'calendar_event_id'
  db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = :id`).run({ id: targetId })
  for (const tagId of unique) db.prepare(`INSERT INTO ${table} (${idColumn}, tag_id) VALUES (:id, :tagId)`).run({ id: targetId, tagId })
}
function assertReminderInputs(inputs: { triggerAt: number }[]): void {
  for (const input of inputs) assertTimestamp(input.triggerAt, 'triggerAt')
}
function createReminders(targetType: PlanningReminderTargetType, targetId: string, inputs: { triggerAt: number }[], origin: PlanningReminderOrigin = 'manual'): void {
  assertReminderInputs(inputs)
  for (const input of inputs) createPlanningReminderWithOrigin({ targetType, targetId, triggerAt: input.triggerAt }, origin)
}

/** 仅同步未推迟的自动 Todo 提醒；手动提醒与用户主动推迟的提醒绝不覆盖。 */
function syncTodoDueAtReminder(todoId: string, dueAt: number | undefined, now: number): void {
  const db = getDatabase()
  const reminders = getReminders('todo', todoId)
  const defaults = reminders.filter((reminder) => reminder.origin === 'todo_due_at')
  if (dueAt === undefined) {
    db.prepare(`DELETE FROM planning_reminders WHERE target_type='todo' AND target_id=:todoId AND origin='todo_due_at' AND status='pending' AND snoozed_until IS NULL`).run({ todoId })
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

function setTodoRemindersCompleted(todoId: string, now: number): void {
  getDatabase().prepare(`UPDATE planning_reminders SET status = 'completed', updated_at = :now WHERE target_type = 'todo' AND target_id = :todoId AND status = 'pending'`).run({ todoId, now })
}

export function listPlanningGroups(scope: PlanningGroupScope): PlanningGroup[] {
  const rows = getDatabase().prepare(`SELECT * FROM ${groupTable(scope)} ORDER BY sort_order, name COLLATE NOCASE`).all() as GroupRow[]
  return rows.map((row) => groupFromRow(row, scope))
}
export function createPlanningGroup(input: CreatePlanningGroupInput): PlanningGroup {
  const now = Date.now(); const group: PlanningGroup = { id: randomUUID(), scope: input.scope, name: assertText(input.name, '分组名称', 100), color: input.color?.trim() || undefined, sortOrder: input.sortOrder ?? 0, createdAt: now, updatedAt: now }
  getDatabase().prepare(`INSERT INTO ${groupTable(group.scope)} (id, name, color, sort_order, created_at, updated_at) VALUES (:id, :name, :color, :sortOrder, :createdAt, :updatedAt)`).run({ id: group.id, name: group.name, color: group.color ?? null, sortOrder: group.sortOrder, createdAt: group.createdAt, updatedAt: group.updatedAt })
  return group
}
export function updatePlanningGroup(input: UpdatePlanningGroupInput): PlanningGroup | undefined {
  const old = getPlanningGroup(input.id, input.scope); if (!old) return undefined
  const updated: PlanningGroup = { ...old, name: input.name === undefined ? old.name : assertText(input.name, '分组名称', 100), color: input.color === undefined ? old.color : input.color?.trim() || undefined, sortOrder: input.sortOrder ?? old.sortOrder, updatedAt: Math.max(Date.now(), old.updatedAt + 1) }
  getDatabase().prepare(`UPDATE ${groupTable(input.scope)} SET name=:name,color=:color,sort_order=:sortOrder,updated_at=:updatedAt WHERE id=:id`).run({ id: updated.id, name: updated.name, color: updated.color ?? null, sortOrder: updated.sortOrder, updatedAt: updated.updatedAt })
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

function syncProfileFromRow(row: SyncProfileRow): PlanningSyncProfile {
  return {
    id: row.id,
    entity: row.entity,
    targetId: row.target_id,
    targetTitle: row.target_title,
    sourceTitle: row.source_title,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 同步配置只保存用户明确选择的受管目标；绝不默认导入系统其他 Calendar/List。 */
export function listPlanningSyncProfiles(): PlanningSyncProfile[] {
  const rows = getDatabase().prepare('SELECT * FROM planning_sync_profiles ORDER BY entity').all() as SyncProfileRow[]
  return rows.map(syncProfileFromRow)
}

/** 仅 Calendar 受管目标允许系统端项目回流；Reminder 仍保持其既有单向模型。 */
export function listEnabledManagedCalendarProfiles(): PlanningSyncProfile[] {
  return (getDatabase().prepare("SELECT * FROM planning_sync_profiles WHERE entity='calendar' AND enabled=1").all() as SyncProfileRow[]).map(syncProfileFromRow)
}

/** 受管目标以 locator 精确验证删除，不能把时间窗口外的项目误判为已删。 */
export function listPlanningSyncBindingIdentifiers(profileId: string, targetId: string): string[] {
  return (getDatabase().prepare('SELECT calendar_item_identifier FROM planning_sync_bindings WHERE profile_id=:profileId AND target_id=:targetId AND calendar_item_identifier IS NOT NULL').all({ profileId, targetId }) as Array<{ calendar_item_identifier: string }>).map((row) => row.calendar_item_identifier)
}

function nativeConnectionFromRow(row: NativeConnectionRow): PlanningNativeConnection {
  return { id: row.id, entity: row.entity, targetId: row.target_id, targetTitle: row.target_title, sourceTitle: row.source_title, sourceType: row.source_type, canWrite: row.can_write === 1, connectedAt: row.connected_at, updatedAt: row.updated_at }
}

export function listPlanningNativeConnections(entity?: PlanningNativeSyncEntity): PlanningNativeConnection[] {
  const rows = getDatabase().prepare(`SELECT * FROM planning_native_connections ${entity ? 'WHERE entity=:entity' : ''} ORDER BY entity, source_title, target_title`).all(entity ? { entity } : {}) as NativeConnectionRow[]
  return rows.map(nativeConnectionFromRow)
}

/** 仅保存用户明确勾选的外部集合；保存本身不读取系统项目。 */
export function connectPlanningNativeConnection(input: ConnectPlanningNativeConnectionInput): PlanningNativeConnection {
  const now = Date.now(); const target = input.target
  if (!target.id || !target.title) throw new Error('系统集合无效')
  if (getDatabase().prepare('SELECT id FROM planning_sync_profiles WHERE entity=:entity AND target_id=:targetId').get({ entity: input.entity, targetId: target.id })) throw new Error('Proma 受管目标不能同时作为外部连接')
  const old = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE entity=:entity AND target_id=:targetId').get({ entity: input.entity, targetId: target.id }) as NativeConnectionRow | undefined
  const row: NativeConnectionRow = { id: old?.id ?? randomUUID(), entity: input.entity, target_id: target.id, target_title: target.title.slice(0, 500), source_title: target.sourceTitle.slice(0, 500), source_type: target.sourceType, can_write: target.canWrite ? 1 : 0, connected_at: old?.connected_at ?? now, updated_at: now }
  getDatabase().prepare(`INSERT INTO planning_native_connections (id,entity,target_id,target_title,source_title,source_type,can_write,connected_at,updated_at) VALUES (:id,:entity,:target_id,:target_title,:source_title,:source_type,:can_write,:connected_at,:updated_at) ON CONFLICT(entity,target_id) DO UPDATE SET target_title=excluded.target_title,source_title=excluded.source_title,source_type=excluded.source_type,can_write=excluded.can_write,updated_at=excluded.updated_at`).run(row)
  return nativeConnectionFromRow(row)
}

/** 断开只移除 Proma 投影与映射，绝不删除用户的系统原始事项。 */
function nativeConflictFromRow(row: NativeConflictRow): PlanningNativeSyncConflict {
  const connection = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE id=:id').get({ id: row.connection_id }) as NativeConnectionRow | undefined
  const table = row.entity === 'reminder' ? 'todos' : 'calendar_events'
  const local = getDatabase().prepare(`SELECT title FROM ${table} WHERE id=:id`).get({ id: row.proma_entity_id }) as { title?: string } | undefined
  return { id: row.id, connectionId: row.connection_id, entity: row.entity, promaEntityId: row.proma_entity_id, title: local?.title ?? connection?.target_title ?? '系统事项', kind: row.kind, detectedAt: row.detected_at }
}

function managedProfileConflictFromRow(row: SyncProfileConflictRow): PlanningNativeSyncConflict {
  const profile = getDatabase().prepare('SELECT * FROM planning_sync_profiles WHERE id=:id').get({ id: row.profile_id }) as SyncProfileRow | undefined
  const local = getDatabase().prepare('SELECT title FROM calendar_events WHERE id=:id').get({ id: row.proma_entity_id }) as { title?: string } | undefined
  return { id: row.id, profileId: row.profile_id, entity: 'calendar', promaEntityId: row.proma_entity_id, title: local?.title ?? profile?.target_title ?? 'Proma 日程', kind: row.kind, detectedAt: row.detected_at }
}

export function listPlanningNativeSyncConflicts(): PlanningNativeSyncConflict[] {
  const external = (getDatabase().prepare('SELECT * FROM planning_native_sync_conflicts WHERE resolved_at IS NULL').all() as NativeConflictRow[]).map(nativeConflictFromRow)
  const managed = (getDatabase().prepare('SELECT * FROM planning_sync_profile_conflicts ORDER BY detected_at DESC').all() as SyncProfileConflictRow[]).map(managedProfileConflictFromRow)
  return [...external, ...managed].sort((a, b) => b.detectedAt - a.detectedAt)
}

/** 冲突必须显式选择；保留系统会回流，保留 Proma 才会继续/重建其出站版本。 */
export function resolvePlanningNativeSyncConflict(input: ResolvePlanningNativeSyncConflictInput): boolean {
  const conflict = getDatabase().prepare('SELECT * FROM planning_native_sync_conflicts WHERE id=:id AND resolved_at IS NULL').get({ id: input.id }) as NativeConflictRow | undefined
  if (!conflict) return resolveManagedCalendarProfileConflict(input)
  const connection = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE id=:id').get({ id: conflict.connection_id }) as NativeConnectionRow | undefined
  if (!connection) return false
  withPlanningTransaction(() => {
    if (input.resolution === 'keep_proma') {
      if (conflict.kind === 'changed' && conflict.native_item_json) {
        // 记录用户已看过的系统版本，强制 reconcile 不会在 outbox 写回前马上重新创建同一冲突。
        getDatabase().prepare('UPDATE planning_native_bindings SET last_native_hash=:hash,last_synced_at=:now WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ hash: conflict.native_item_json, now: Date.now(), connectionId: conflict.connection_id, promaEntityId: conflict.proma_entity_id })
      } else if (conflict.kind === 'deleted') {
        // locator 已失效但仍须保留 binding 供 outbox 取目标；写回成功后会原子更新为新 locator。
        getDatabase().prepare('UPDATE planning_native_bindings SET recreate_pending=1 WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId: conflict.connection_id, promaEntityId: conflict.proma_entity_id })
      }
    }
    if (input.resolution === 'keep_system') {
      getDatabase().prepare('DELETE FROM planning_native_outbox WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId: conflict.connection_id, promaEntityId: conflict.proma_entity_id })
      if (conflict.kind === 'deleted') {
        const table = connection.entity === 'reminder' ? 'todos' : 'calendar_events'
        getDatabase().prepare(`DELETE FROM ${table} WHERE id=:id AND native_connection_id=:connectionId`).run({ id: conflict.proma_entity_id, connectionId: conflict.connection_id })
        getDatabase().prepare('DELETE FROM planning_native_bindings WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId: conflict.connection_id, promaEntityId: conflict.proma_entity_id })
      }
    }
    getDatabase().prepare('DELETE FROM planning_native_sync_conflicts WHERE id=:id').run({ id: conflict.id })
  })
  if (input.resolution === 'keep_system' && conflict.kind === 'changed' && conflict.native_item_json) {
    try { applyPlanningNativeConnectionItems(conflict.connection_id, [JSON.parse(conflict.native_item_json) as PlanningNativeExternalItem], { fullSnapshot: false }) } catch (error) { console.warn('[计划同步] 应用系统冲突版本失败:', error) }
  }
  return true
}

function resolveManagedCalendarProfileConflict(input: ResolvePlanningNativeSyncConflictInput): boolean {
  const conflict = getDatabase().prepare('SELECT * FROM planning_sync_profile_conflicts WHERE id=:id').get({ id: input.id }) as SyncProfileConflictRow | undefined
  if (!conflict) return false
  const profile = getDatabase().prepare("SELECT * FROM planning_sync_profiles WHERE id=:id AND entity='calendar'").get({ id: conflict.profile_id }) as SyncProfileRow | undefined
  if (!profile) return false
  withPlanningTransaction(() => {
    if (input.resolution === 'keep_proma') {
      if (conflict.kind === 'changed' && conflict.native_item_json) {
        const native = JSON.parse(conflict.native_item_json) as PlanningNativeExternalItem
        const currentBinding = getDatabase().prepare('SELECT calendar_item_identifier FROM planning_sync_bindings WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').get({ profileId: profile.id, promaEntityId: conflict.proma_entity_id }) as { calendar_item_identifier?: string | null } | undefined
        if (currentBinding?.calendar_item_identifier === native.calendarItemIdentifier) {
          getDatabase().prepare('UPDATE planning_sync_bindings SET last_synced_hash=:hash,last_synced_at=:now WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ hash: planningNativeCalendarHash(native), now: Date.now(), profileId: profile.id, promaEntityId: conflict.proma_entity_id })
        } else {
          // 这是 locator recovery 冲突：不能将新系统 locator 自动认领；用户选 Proma 后按新项目发布。
          getDatabase().prepare('UPDATE planning_sync_bindings SET calendar_item_identifier=NULL,last_synced_hash=NULL WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId: profile.id, promaEntityId: conflict.proma_entity_id })
        }
        enqueuePlanningSync('calendar_event', conflict.proma_entity_id, 'upsert')
      } else {
        // locator 已失效；用户已选择保留 Proma，重置 locator 并确保下一轮有明确的出站操作。
        getDatabase().prepare('UPDATE planning_sync_bindings SET calendar_item_identifier=NULL,last_synced_hash=NULL WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId: profile.id, promaEntityId: conflict.proma_entity_id })
        enqueuePlanningSync('calendar_event', conflict.proma_entity_id, 'upsert')
      }
    } else {
      getDatabase().prepare('DELETE FROM planning_sync_outbox WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId: profile.id, promaEntityId: conflict.proma_entity_id })
      if (conflict.kind === 'changed' && conflict.native_item_json) {
        const native = JSON.parse(conflict.native_item_json) as PlanningNativeExternalItem
        // 用户明确保留系统版本后才接受新的 locator；随后回流会更新日程内容和 stable hash。
        getDatabase().prepare('UPDATE planning_sync_bindings SET calendar_item_identifier=:calendarItemIdentifier,calendar_item_external_identifier=:calendarItemExternalIdentifier WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId: profile.id, promaEntityId: conflict.proma_entity_id, calendarItemIdentifier: native.calendarItemIdentifier, calendarItemExternalIdentifier: native.calendarItemExternalIdentifier ?? null })
      }
      if (conflict.kind === 'deleted') {
        getDatabase().prepare("DELETE FROM planning_reminders WHERE target_type='calendar_event' AND target_id=:id").run({ id: conflict.proma_entity_id })
        getDatabase().prepare('DELETE FROM calendar_events WHERE id=:id').run({ id: conflict.proma_entity_id })
        getDatabase().prepare('DELETE FROM planning_sync_bindings WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId: profile.id, promaEntityId: conflict.proma_entity_id })
      }
    }
    getDatabase().prepare('DELETE FROM planning_sync_profile_conflicts WHERE id=:id').run({ id: conflict.id })
  })
  if (input.resolution === 'keep_system' && conflict.kind === 'changed' && conflict.native_item_json) {
    try { applyManagedCalendarProfileItems(profile.id, [JSON.parse(conflict.native_item_json) as PlanningNativeExternalItem]) } catch (error) { console.warn('[计划同步] 应用受管日历系统冲突版本失败:', error) }
  }
  return true
}

export function disconnectPlanningNativeConnection(id: string): boolean {
  const connection = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE id=:id').get({ id }) as NativeConnectionRow | undefined
  if (!connection) return false
  return withPlanningTransaction(() => {
    const table = connection.entity === 'reminder' ? 'todos' : 'calendar_events'
    getDatabase().prepare(`DELETE FROM planning_native_outbox WHERE connection_id=:id`).run({ id })
    getDatabase().prepare(`DELETE FROM ${table} WHERE native_connection_id=:id`).run({ id })
    const result = getDatabase().prepare('DELETE FROM planning_native_connections WHERE id=:id').run({ id }) as { changes?: number }
    return (result.changes ?? 0) > 0
  })
}

function syncEntityForPlanningTarget(targetType: PlanningReminderTargetType): 'calendar' | 'reminder' {
  return targetType === 'todo' ? 'reminder' : 'calendar'
}

/** 业务数据与待同步操作在同一事务写入，保证崩溃后仍可恢复发布。 */
function enqueuePlanningSync(targetType: PlanningReminderTargetType, promaEntityId: string, operation: 'upsert' | 'delete', now = Date.now(), nativeStartAt?: number): void {
  const entity = syncEntityForPlanningTarget(targetType)
  const external = getDatabase().prepare('SELECT bindings.connection_id, connections.can_write FROM planning_native_bindings AS bindings JOIN planning_native_connections AS connections ON connections.id=bindings.connection_id WHERE bindings.proma_entity_id=:promaEntityId AND connections.entity=:entity').get({ promaEntityId, entity }) as { connection_id: string; can_write: number } | undefined
  if (external) {
    // 用户明确连接的可写 Calendar / Reminder 在 Proma 删除时都写穿 EventKit；只读集合一律不能本地假成功。
    if (external.can_write !== 1) throw new Error('该系统集合为只读，不能在 Proma 中修改或删除')
    // native outbox 用 hide 表示“本地投影已删除”；coordinator 根据实体执行受限 EventKit remove。
    const externalOperation = operation === 'delete' ? 'hide' : 'upsert'
    getDatabase().prepare(`INSERT INTO planning_native_outbox (id,connection_id,operation,proma_entity_id,attempts,next_attempt_at,created_at,updated_at) VALUES (:id,:connectionId,:operation,:promaEntityId,0,:now,:now,:now) ON CONFLICT(connection_id,proma_entity_id) DO UPDATE SET operation=excluded.operation,attempts=0,next_attempt_at=excluded.next_attempt_at,last_error=NULL,revision=planning_native_outbox.revision+1,updated_at=excluded.updated_at`).run({ id: randomUUID(), connectionId: external.connection_id, operation: externalOperation, promaEntityId, now })
    return
  }
  const profiles = getDatabase().prepare(`SELECT * FROM planning_sync_profiles WHERE entity=:entity AND enabled=1`).all({ entity }) as SyncProfileRow[]
  for (const profile of profiles) {
    getDatabase().prepare(`
      INSERT INTO planning_sync_outbox (id, profile_id, target_id, operation, proma_entity_id, native_start_at, attempts, next_attempt_at, created_at, updated_at)
      VALUES (:id, :profileId, :targetId, :operation, :promaEntityId, :nativeStartAt, 0, :now, :now, :now)
      ON CONFLICT(profile_id, proma_entity_id) DO UPDATE SET
        target_id=excluded.target_id, operation=excluded.operation, native_start_at=excluded.native_start_at,
        attempts=0, next_attempt_at=excluded.next_attempt_at, last_error=NULL,
        revision=planning_sync_outbox.revision+1, updated_at=excluded.updated_at
    `).run({ id: randomUUID(), profileId: profile.id, targetId: profile.target_id, operation, promaEntityId, nativeStartAt: nativeStartAt ?? null, now })
  }
}

/** 清理任务独立于 outbox，保证切换受管目标时可同时“删旧、写新”。 */
function enqueuePlanningSyncCleanup(input: Pick<PlanningSyncCleanupItem, 'entity' | 'targetId' | 'promaEntityId' | 'calendarItemIdentifier' | 'nativeStartAt'>, now = Date.now()): void {
  getDatabase().prepare(`
    INSERT INTO planning_sync_cleanup (id, entity, target_id, proma_entity_id, calendar_item_identifier, native_start_at, attempts, next_attempt_at, created_at, updated_at)
    VALUES (:id, :entity, :targetId, :promaEntityId, :calendarItemIdentifier, :nativeStartAt, 0, :now, :now, :now)
    ON CONFLICT(entity, target_id, proma_entity_id) DO UPDATE SET
      calendar_item_identifier=COALESCE(excluded.calendar_item_identifier, planning_sync_cleanup.calendar_item_identifier),
      native_start_at=COALESCE(excluded.native_start_at, planning_sync_cleanup.native_start_at),
      next_attempt_at=excluded.next_attempt_at, last_error=NULL, updated_at=excluded.updated_at
  `).run({ id: randomUUID(), ...input, calendarItemIdentifier: input.calendarItemIdentifier ?? null, nativeStartAt: input.nativeStartAt ?? null, now })
}

function enqueueAllPlanningItems(profile: PlanningSyncProfile): void {
  const now = Date.now()
  // 首次连接不要把历史会议或已完成 Todo 无差别倒入用户的系统集合；窗口外绑定项仍会由后续更新单独发布。
  const rows = profile.entity === 'calendar'
    ? getDatabase().prepare('SELECT id FROM calendar_events WHERE COALESCE(end_at,start_at)>=:from AND start_at<=:to').all({ from: now - 30 * 24 * 60 * 60 * 1_000, to: now + 18 * 30 * 24 * 60 * 60 * 1_000 }) as Array<{ id: string }>
    : getDatabase().prepare(`SELECT id FROM todos WHERE status='open'`).all() as Array<{ id: string }>
  for (const row of rows) enqueuePlanningSync(profile.entity === 'calendar' ? 'calendar_event' : 'todo', row.id, 'upsert', now)
}

export function savePlanningSyncProfile(input: SavePlanningSyncProfileInput): PlanningSyncProfile {
  const targetId = assertText(input.target.id, '同步目标', 1_000)
  const targetTitle = assertText(input.target.title, '同步目标名称', 500)
  const sourceTitle = input.target.sourceTitle.trim().slice(0, 500)
  const existing = getDatabase().prepare('SELECT * FROM planning_sync_profiles WHERE entity=:entity').get({ entity: input.entity }) as SyncProfileRow | undefined
  const now = Math.max(Date.now(), (existing?.updated_at ?? 0) + 1)
  const profile: PlanningSyncProfile = {
    id: existing?.id ?? randomUUID(), entity: input.entity, targetId, targetTitle, sourceTitle,
    enabled: input.enabled ?? (existing ? existing.enabled === 1 : true), createdAt: existing?.created_at ?? now, updatedAt: now,
  }
  withPlanningTransaction(() => {
    const targetChanged = Boolean(existing && existing.target_id !== targetId)
    if (targetChanged && existing) {
      // 先冻结旧队列并为每个 locator 建独立 cleanup，再切换 profile；旧项绝不会被遗留。
      const bindings = getDatabase().prepare('SELECT * FROM planning_sync_bindings WHERE profile_id=:profileId').all({ profileId: profile.id }) as SyncBindingRow[]
      for (const binding of bindings) enqueuePlanningSyncCleanup({
        entity: existing.entity,
        targetId: binding.target_id ?? existing.target_id,
        promaEntityId: binding.proma_entity_id,
        calendarItemIdentifier: binding.calendar_item_identifier ?? undefined,
      }, now)
      // binding 尚未落库前进程可能已在 EventKit 成功写入；旧 outbox 中的 marker 是仅存恢复证据。
      const pendingUpserts = getDatabase().prepare("SELECT * FROM planning_sync_outbox WHERE profile_id=:profileId AND operation='upsert'").all({ profileId: profile.id }) as SyncOutboxRow[]
      for (const pending of pendingUpserts) enqueuePlanningSyncCleanup({
        entity: existing.entity,
        targetId: pending.target_id ?? existing.target_id,
        promaEntityId: pending.proma_entity_id,
        nativeStartAt: pending.native_start_at ?? undefined,
      }, now)
      getDatabase().prepare('DELETE FROM planning_sync_outbox WHERE profile_id=:profileId').run({ profileId: profile.id })
      getDatabase().prepare('DELETE FROM planning_sync_bindings WHERE profile_id=:profileId').run({ profileId: profile.id })
      // 冲突快照属于已废弃目标；不可阻塞新目标，也不可把旧系统版本误应用到新目标。
      getDatabase().prepare('DELETE FROM planning_sync_profile_conflicts WHERE profile_id=:profileId').run({ profileId: profile.id })
    }
    getDatabase().prepare(`
      INSERT INTO planning_sync_profiles (id, entity, target_id, target_title, source_title, enabled, created_at, updated_at)
      VALUES (:id, :entity, :targetId, :targetTitle, :sourceTitle, :enabled, :createdAt, :updatedAt)
      ON CONFLICT(entity) DO UPDATE SET
        target_id=excluded.target_id, target_title=excluded.target_title, source_title=excluded.source_title,
        enabled=excluded.enabled, updated_at=excluded.updated_at
    `).run({ ...profile, targetId: profile.targetId, targetTitle: profile.targetTitle, sourceTitle: profile.sourceTitle, enabled: profile.enabled ? 1 : 0, createdAt: profile.createdAt, updatedAt: profile.updatedAt })
    if (profile.enabled && (!existing || targetChanged || existing.enabled !== 1)) enqueueAllPlanningItems(profile)
  })
  return profile
}

export function listDuePlanningSyncOutbox(now = Date.now(), limit = 25): PlanningSyncOutboxItem[] {
  const rows = getDatabase().prepare(`
    SELECT outbox.*, profiles.entity, COALESCE(outbox.target_id, profiles.target_id) AS execution_target_id, profiles.target_title, profiles.source_title, profiles.enabled, profiles.created_at AS profile_created_at, profiles.updated_at AS profile_updated_at,
      bindings.calendar_item_identifier
    FROM planning_sync_outbox AS outbox
    JOIN planning_sync_profiles AS profiles ON profiles.id=outbox.profile_id
    LEFT JOIN planning_sync_bindings AS bindings ON bindings.profile_id=outbox.profile_id AND bindings.proma_entity_id=outbox.proma_entity_id AND bindings.target_id=COALESCE(outbox.target_id, profiles.target_id)
    LEFT JOIN planning_sync_profile_conflicts AS conflicts ON conflicts.profile_id=outbox.profile_id AND conflicts.proma_entity_id=outbox.proma_entity_id
    WHERE profiles.enabled=1 AND outbox.next_attempt_at<=:now AND conflicts.id IS NULL
    ORDER BY outbox.created_at
    LIMIT :limit
  `).all({ now, limit }) as Array<SyncOutboxRow & SyncProfileRow & { execution_target_id: string; profile_created_at: number; profile_updated_at: number; calendar_item_identifier: string | null }>
  return rows.map((row) => ({
    id: row.id,
    profile: { id: row.profile_id, entity: row.entity, targetId: row.execution_target_id, targetTitle: row.target_title, sourceTitle: row.source_title, enabled: row.enabled === 1, createdAt: row.profile_created_at, updatedAt: row.profile_updated_at },
    operation: row.operation,
    promaEntityId: row.proma_entity_id,
    attempts: row.attempts,
    revision: row.revision,
    calendarItemIdentifier: row.calendar_item_identifier ?? undefined,
    nativeStartAt: row.native_start_at ?? undefined,
  }))
}

export function listDuePlanningSyncCleanup(now = Date.now(), limit = 25): PlanningSyncCleanupItem[] {
  const rows = getDatabase().prepare('SELECT * FROM planning_sync_cleanup WHERE next_attempt_at<=:now ORDER BY created_at LIMIT :limit').all({ now, limit }) as SyncCleanupRow[]
  return rows.map((row) => ({ id: row.id, entity: row.entity, targetId: row.target_id, promaEntityId: row.proma_entity_id, calendarItemIdentifier: row.calendar_item_identifier ?? undefined, nativeStartAt: row.native_start_at ?? undefined, attempts: row.attempts }))
}

export function completePlanningSyncCleanup(item: PlanningSyncCleanupItem): void {
  getDatabase().prepare('DELETE FROM planning_sync_cleanup WHERE id=:id').run({ id: item.id })
}

export function failPlanningSyncCleanup(item: PlanningSyncCleanupItem, error: string): void {
  const attempts = item.attempts + 1; const now = Date.now(); const nextAttemptAt = now + Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.min(attempts - 1, 10))
  getDatabase().prepare('UPDATE planning_sync_cleanup SET attempts=:attempts,next_attempt_at=:nextAttemptAt,last_error=:error,updated_at=:now WHERE id=:id').run({ id: item.id, attempts, nextAttemptAt, error: error.slice(0, 1_000), now })
}

export function completePlanningSyncOutbox(item: PlanningSyncOutboxItem, nativeIdentifiers?: { calendarItemIdentifier?: string; calendarItemExternalIdentifier?: string }, nativeHash?: string): void {
  withPlanningTransaction(() => {
    // EventKit 回调可能比随后一次本地编辑慢。旧 revision 绝不能污染新 locator / 双向基线。
    const current = getDatabase().prepare('SELECT id FROM planning_sync_outbox WHERE id=:id AND revision=:revision').get({ id: item.id, revision: item.revision })
    if (!current) return
    const now = Date.now()
    const currentProfile = getDatabase().prepare('SELECT target_id FROM planning_sync_profiles WHERE id=:profileId').get({ profileId: item.profile.id }) as { target_id: string } | undefined
    const isCurrentTarget = currentProfile?.target_id === item.profile.targetId
    if (item.operation === 'delete' && isCurrentTarget) {
      getDatabase().prepare('DELETE FROM planning_sync_bindings WHERE profile_id=:profileId AND target_id=:targetId AND proma_entity_id=:promaEntityId').run({ profileId: item.profile.id, targetId: item.profile.targetId, promaEntityId: item.promaEntityId })
    } else if (nativeIdentifiers?.calendarItemIdentifier && isCurrentTarget) {
      getDatabase().prepare(`
        INSERT INTO planning_sync_bindings (profile_id, target_id, proma_entity_id, calendar_item_identifier, calendar_item_external_identifier, last_synced_hash, last_synced_at)
        VALUES (:profileId, :targetId, :promaEntityId, :calendarItemIdentifier, :calendarItemExternalIdentifier, :nativeHash, :now)
        ON CONFLICT(profile_id, proma_entity_id) DO UPDATE SET
          target_id=excluded.target_id, calendar_item_identifier=excluded.calendar_item_identifier,
          calendar_item_external_identifier=excluded.calendar_item_external_identifier,last_synced_hash=excluded.last_synced_hash,last_synced_at=excluded.last_synced_at
      `).run({ profileId: item.profile.id, targetId: item.profile.targetId, promaEntityId: item.promaEntityId, calendarItemIdentifier: nativeIdentifiers.calendarItemIdentifier, calendarItemExternalIdentifier: nativeIdentifiers.calendarItemExternalIdentifier ?? null, nativeHash: nativeHash ?? null, now })
    } else if (nativeIdentifiers?.calendarItemIdentifier) {
      // 目标切换与 native 写入并发时，将刚创建的旧项移入独立清理队列，不能任其孤儿化。
      enqueuePlanningSyncCleanup({ entity: item.profile.entity, targetId: item.profile.targetId, promaEntityId: item.promaEntityId, calendarItemIdentifier: nativeIdentifiers.calendarItemIdentifier, nativeStartAt: item.nativeStartAt }, now)
    }
    getDatabase().prepare('DELETE FROM planning_sync_outbox WHERE id=:id AND revision=:revision').run({ id: item.id, revision: item.revision })
  })
}

export function listDuePlanningNativeOutbox(now = Date.now(), limit = 25): PlanningNativeOutboxItem[] {
  // 冲突未决时绝不能自动把 Proma 一侧覆盖到系统。
  const rows = getDatabase().prepare(`SELECT outbox.*, connections.entity,connections.target_id,connections.target_title,connections.source_title,connections.source_type,connections.can_write,connections.connected_at,connections.updated_at AS connection_updated_at,bindings.calendar_item_identifier,bindings.due_date_only,bindings.recreate_pending FROM planning_native_outbox AS outbox JOIN planning_native_connections AS connections ON connections.id=outbox.connection_id JOIN planning_native_bindings AS bindings ON bindings.connection_id=outbox.connection_id AND bindings.proma_entity_id=outbox.proma_entity_id LEFT JOIN planning_native_sync_conflicts AS conflicts ON conflicts.connection_id=outbox.connection_id AND conflicts.proma_entity_id=outbox.proma_entity_id AND conflicts.resolved_at IS NULL WHERE outbox.next_attempt_at<=:now AND conflicts.id IS NULL ORDER BY outbox.created_at LIMIT :limit`).all({ now, limit }) as Array<NativeOutboxRow & NativeConnectionRow & { connection_updated_at: number; calendar_item_identifier: string; due_date_only: number; recreate_pending: number }>
  return rows.map((row) => ({ id: row.id, connection: nativeConnectionFromRow({ ...row, updated_at: row.connection_updated_at }), operation: row.operation, promaEntityId: row.proma_entity_id, calendarItemIdentifier: row.calendar_item_identifier, dueDateOnly: row.due_date_only === 1, recreatePending: row.recreate_pending === 1, attempts: row.attempts, revision: row.revision }))
}

export function completePlanningNativeOutbox(item: PlanningNativeOutboxItem, nativeIdentifiers?: { calendarItemIdentifier?: string }): void {
  withPlanningTransaction(() => {
    if (item.operation === 'hide') {
      const table = item.connection.entity === 'reminder' ? 'todos' : 'calendar_events'
      getDatabase().prepare(`DELETE FROM ${table} WHERE id=:id AND native_connection_id=:connectionId`).run({ id: item.promaEntityId, connectionId: item.connection.id })
      getDatabase().prepare('DELETE FROM planning_native_bindings WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId: item.connection.id, promaEntityId: item.promaEntityId })
    } else if (nativeIdentifiers?.calendarItemIdentifier) {
      // EventKit locator 会因系统删除后重建等情况变化；写回成功时必须更新 binding，避免下一轮导入出重复投影。
      getDatabase().prepare('UPDATE planning_native_bindings SET calendar_item_identifier=:calendarItemIdentifier,recreate_pending=0,last_native_hash=NULL,last_synced_at=:now WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ calendarItemIdentifier: nativeIdentifiers.calendarItemIdentifier, now: Date.now(), connectionId: item.connection.id, promaEntityId: item.promaEntityId })
    }
    getDatabase().prepare('DELETE FROM planning_native_outbox WHERE id=:id AND revision=:revision').run({ id: item.id, revision: item.revision })
  })
}

export function failPlanningNativeOutbox(item: PlanningNativeOutboxItem, error: string): void {
  const attempts = item.attempts + 1; const now = Date.now(); const nextAttemptAt = now + Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.min(attempts - 1, 10))
  getDatabase().prepare('UPDATE planning_native_outbox SET attempts=:attempts,next_attempt_at=:nextAttemptAt,last_error=:error,updated_at=:now WHERE id=:id AND revision=:revision').run({ id: item.id, revision: item.revision, attempts, nextAttemptAt, error: error.slice(0, 1_000), now })
}

/** 只读取已存在 binding 的 locator，用于精确检查系统端删除；不会枚举未连接集合。 */
export function listPlanningNativeBindingIdentifiers(connectionId: string): string[] {
  return (getDatabase().prepare('SELECT calendar_item_identifier FROM planning_native_bindings WHERE connection_id=:connectionId').all({ connectionId }) as Array<{ calendar_item_identifier: string }>).map((row) => row.calendar_item_identifier)
}

/** 精确 locator 查询发现系统删除后仅隐藏对应投影；不会把有界 Calendar 查询误当成完整快照。 */
export function hideMissingPlanningNativeConnectionItems(connectionId: string, existingIdentifiers: string[]): void {
  const connection = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE id=:id').get({ id: connectionId }) as NativeConnectionRow | undefined
  if (!connection) return
  const existing = new Set(existingIdentifiers)
  withPlanningTransaction(() => {
    const table = connection.entity === 'reminder' ? 'todos' : 'calendar_events'
    const bindings = getDatabase().prepare('SELECT * FROM planning_native_bindings WHERE connection_id=:connectionId').all({ connectionId }) as NativeBindingRow[]
    for (const binding of bindings) {
      if (existing.has(binding.calendar_item_identifier) || binding.recreate_pending === 1) continue
      const pending = getDatabase().prepare('SELECT id FROM planning_native_outbox WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').get({ connectionId, promaEntityId: binding.proma_entity_id })
      if (pending) {
        getDatabase().prepare(`INSERT INTO planning_native_sync_conflicts (id,connection_id,entity,proma_entity_id,kind,native_item_json,detected_at) VALUES (:id,:connectionId,:entity,:promaEntityId,'deleted',NULL,:now) ON CONFLICT(connection_id,proma_entity_id) DO UPDATE SET kind='deleted',native_item_json=NULL,detected_at=excluded.detected_at,resolved_at=NULL`).run({ id: randomUUID(), connectionId, entity: connection.entity, promaEntityId: binding.proma_entity_id, now: Date.now() })
        continue
      }
      getDatabase().prepare(`DELETE FROM ${table} WHERE id=:id AND native_connection_id=:connectionId`).run({ id: binding.proma_entity_id, connectionId })
      getDatabase().prepare('DELETE FROM planning_native_bindings WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId, promaEntityId: binding.proma_entity_id })
    }
  })
}

/** EventKit 回流专用写入路径：绝不经由正常 update/enqueue，防止回声循环。 */
/** 当前 items 是否是该连接的完整快照。日历窗口与冲突单项都不是，不能以“缺失”推断系统删除。 */
export function applyPlanningNativeConnectionItems(connectionId: string, items: PlanningNativeExternalItem[], options: { fullSnapshot?: boolean } = {}): void {
  const connection = getDatabase().prepare('SELECT * FROM planning_native_connections WHERE id=:id').get({ id: connectionId }) as NativeConnectionRow | undefined
  if (!connection) return
  const entityType: PlanningReminderTargetType = connection.entity === 'reminder' ? 'todo' : 'calendar_event'
  withPlanningTransaction(() => {
    const now = Date.now(); const seen = new Set<string>()
    for (const item of items) {
      if (!item.calendarItemIdentifier || !item.title) continue
      seen.add(item.calendarItemIdentifier)
      const binding = getDatabase().prepare('SELECT * FROM planning_native_bindings WHERE connection_id=:connectionId AND calendar_item_identifier=:calendarItemIdentifier').get({ connectionId, calendarItemIdentifier: item.calendarItemIdentifier }) as NativeBindingRow | undefined
      // P2 不建模 recurrence master/exception。若已导入的单次项目在系统端变为循环，安全地撤销投影/待写入，不允许后续写穿破坏系列。
      if (item.isRecurring) {
        if (binding) {
          const table = connection.entity === 'reminder' ? 'todos' : 'calendar_events'
          getDatabase().prepare('DELETE FROM planning_native_outbox WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId, promaEntityId: binding.proma_entity_id })
          getDatabase().prepare(`DELETE FROM ${table} WHERE id=:id AND native_connection_id=:connectionId`).run({ id: binding.proma_entity_id, connectionId })
          getDatabase().prepare('DELETE FROM planning_native_bindings WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId, promaEntityId: binding.proma_entity_id })
        }
        continue
      }
      const hash = JSON.stringify(item)
      if (binding?.last_native_hash === hash) continue
      const localId = binding?.proma_entity_id ?? randomUUID()
      // 本地写入尚未写回时，让 outbox 优先，避免覆盖用户刚在 Proma 中完成的编辑。
      const pending = binding && getDatabase().prepare('SELECT id FROM planning_native_outbox WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').get({ connectionId, promaEntityId: localId })
      if (pending) {
        // 两侧都在基于同一 binding 修改：停止自动覆盖，留给用户明确选择。
        getDatabase().prepare(`INSERT INTO planning_native_sync_conflicts (id,connection_id,entity,proma_entity_id,kind,native_item_json,detected_at) VALUES (:id,:connectionId,:entity,:promaEntityId,'changed',:nativeItemJson,:now) ON CONFLICT(connection_id,proma_entity_id) DO UPDATE SET kind='changed',native_item_json=excluded.native_item_json,detected_at=excluded.detected_at,resolved_at=NULL`).run({ id: randomUUID(), connectionId, entity: connection.entity, promaEntityId: localId, nativeItemJson: JSON.stringify(item), now })
        continue
      }
      if (entityType === 'todo') {
        const status = item.completed ? 'completed' : 'open'; const completedAt = item.completed ? (item.completedAt ?? now) : null
        if (binding) getDatabase().prepare('UPDATE todos SET title=:title,notes=:notes,status=:status,priority=:priority,due_at=:dueAt,completed_at=:completedAt,updated_at=:updatedAt WHERE id=:id').run({ id: localId, title: item.title.slice(0, 500), notes: item.notes ?? null, status, priority: item.priority ?? 'medium', dueAt: item.dueAt ?? null, completedAt, updatedAt: Math.max(now, item.lastModifiedAt || now) })
        else getDatabase().prepare('INSERT INTO todos (id,title,notes,status,priority,due_at,workspace_id,native_connection_id,created_at,updated_at,completed_at) VALUES (:id,:title,:notes,:status,:priority,:dueAt,NULL,:connectionId,:now,:updatedAt,:completedAt)').run({ id: localId, title: item.title.slice(0, 500), notes: item.notes ?? null, status, priority: item.priority ?? 'medium', dueAt: item.dueAt ?? null, connectionId, now, updatedAt: Math.max(now, item.lastModifiedAt || now), completedAt })
      } else {
        if (!item.startAt) continue
        if (binding) getDatabase().prepare('UPDATE calendar_events SET title=:title,notes=:notes,start_at=:startAt,end_at=:endAt,all_day=:allDay,updated_at=:updatedAt WHERE id=:id').run({ id: localId, title: item.title.slice(0, 500), notes: item.notes ?? null, startAt: item.startAt, endAt: item.endAt ?? null, allDay: item.allDay ? 1 : 0, updatedAt: Math.max(now, item.lastModifiedAt || now) })
        else getDatabase().prepare('INSERT INTO calendar_events (id,title,notes,start_at,end_at,all_day,workspace_id,native_connection_id,created_at,updated_at) VALUES (:id,:title,:notes,:startAt,:endAt,:allDay,NULL,:connectionId,:now,:updatedAt)').run({ id: localId, title: item.title.slice(0, 500), notes: item.notes ?? null, startAt: item.startAt, endAt: item.endAt ?? null, allDay: item.allDay ? 1 : 0, connectionId, now, updatedAt: Math.max(now, item.lastModifiedAt || now) })
      }
      getDatabase().prepare('INSERT INTO planning_native_bindings (connection_id,proma_entity_id,calendar_item_identifier,due_date_only,last_native_hash,last_synced_at) VALUES (:connectionId,:promaEntityId,:calendarItemIdentifier,:dueDateOnly,:hash,:now) ON CONFLICT(connection_id,proma_entity_id) DO UPDATE SET calendar_item_identifier=excluded.calendar_item_identifier,due_date_only=excluded.due_date_only,last_native_hash=excluded.last_native_hash,last_synced_at=excluded.last_synced_at').run({ connectionId, promaEntityId: localId, calendarItemIdentifier: item.calendarItemIdentifier, dueDateOnly: item.dueDateOnly ? 1 : 0, hash, now })
    }
    // 只有真正的完整快照才能以缺失推断系统端删除；有界 Calendar 列表不能这样做。
    if (!options.fullSnapshot) return
    // 系统端删除后只移除 Proma 投影和 binding；绝不通过 outbox 删除 EventKit 原项。
    const bindings = getDatabase().prepare('SELECT * FROM planning_native_bindings WHERE connection_id=:connectionId').all({ connectionId }) as NativeBindingRow[]
    for (const binding of bindings) {
      if (seen.has(binding.calendar_item_identifier) || binding.recreate_pending === 1) continue
      const pending = getDatabase().prepare('SELECT id FROM planning_native_outbox WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').get({ connectionId, promaEntityId: binding.proma_entity_id })
      if (pending) {
        getDatabase().prepare(`INSERT INTO planning_native_sync_conflicts (id,connection_id,entity,proma_entity_id,kind,native_item_json,detected_at) VALUES (:id,:connectionId,:entity,:promaEntityId,'deleted',NULL,:now) ON CONFLICT(connection_id,proma_entity_id) DO UPDATE SET kind='deleted',native_item_json=NULL,detected_at=excluded.detected_at,resolved_at=NULL`).run({ id: randomUUID(), connectionId, entity: connection.entity, promaEntityId: binding.proma_entity_id, now })
        continue
      }
      const table = connection.entity === 'reminder' ? 'todos' : 'calendar_events'
      getDatabase().prepare(`DELETE FROM ${table} WHERE id=:id AND native_connection_id=:connectionId`).run({ id: binding.proma_entity_id, connectionId })
      getDatabase().prepare('DELETE FROM planning_native_bindings WHERE connection_id=:connectionId AND proma_entity_id=:promaEntityId').run({ connectionId, promaEntityId: binding.proma_entity_id })
    }
  })
}

/**
 * Proma 受管 Calendar 的回流路径。直接写 SQLite，绝不调用正常 update/enqueue，
 * 因而 EventKit 通知不会制造新的 outbox 回声。
 */
export function applyManagedCalendarProfileItems(profileId: string, items: PlanningNativeExternalItem[]): void {
  const profile = getDatabase().prepare("SELECT * FROM planning_sync_profiles WHERE id=:id AND entity='calendar' AND enabled=1").get({ id: profileId }) as SyncProfileRow | undefined
  if (!profile) return
  withPlanningTransaction(() => {
    const now = Date.now()
    for (const item of items) {
      if (!item.calendarItemIdentifier || !item.title || !item.startAt) continue
      let binding = getDatabase().prepare('SELECT * FROM planning_sync_bindings WHERE profile_id=:profileId AND target_id=:targetId AND calendar_item_identifier=:calendarItemIdentifier').get({ profileId, targetId: profile.target_id, calendarItemIdentifier: item.calendarItemIdentifier }) as SyncBindingRow | undefined
      if (!binding) {
        const candidates = new Map<string, SyncBindingRow>()
        if (item.calendarItemExternalIdentifier) {
          for (const candidate of getDatabase().prepare('SELECT * FROM planning_sync_bindings WHERE profile_id=:profileId AND target_id=:targetId AND calendar_item_external_identifier=:externalIdentifier').all({ profileId, targetId: profile.target_id, externalIdentifier: item.calendarItemExternalIdentifier }) as SyncBindingRow[]) candidates.set(candidate.proma_entity_id, candidate)
        }
        const markerCandidate = item.promaIdentity ? getDatabase().prepare('SELECT * FROM planning_sync_bindings WHERE profile_id=:profileId AND target_id=:targetId AND proma_entity_id=:promaEntityId').get({ profileId, targetId: profile.target_id, promaEntityId: item.promaIdentity }) as SyncBindingRow | undefined : undefined
        if (markerCandidate) candidates.set(markerCandidate.proma_entity_id, markerCandidate)
        // 仅“Proma marker + 与既有 binding 相同的 external identifier”可自动认回；单个 external id 或复制 UUID marker 都不足以安全认领。
        if (candidates.size === 1 && markerCandidate && item.calendarItemExternalIdentifier && markerCandidate.calendar_item_external_identifier === item.calendarItemExternalIdentifier) binding = markerCandidate
        else if (candidates.size > 0) {
          // locator recovery 需要用户选择。随后 missing-check 会识别冲突并保留旧投影，绝不误删其 tags/reminders。
          for (const candidate of candidates.values()) getDatabase().prepare(`INSERT INTO planning_sync_profile_conflicts (id,profile_id,proma_entity_id,kind,native_item_json,detected_at)
            VALUES (:id,:profileId,:promaEntityId,'changed',:nativeItemJson,:now)
            ON CONFLICT(profile_id,proma_entity_id) DO UPDATE SET kind='changed',native_item_json=excluded.native_item_json,detected_at=excluded.detected_at`).run({ id: randomUUID(), profileId, promaEntityId: candidate.proma_entity_id, nativeItemJson: JSON.stringify(item), now })
          continue
        }
      }
      if (item.isRecurring) {
        // 不把 recurrence series/exception 误降维为单次 Proma event。
        if (binding) {
          getDatabase().prepare('DELETE FROM planning_sync_outbox WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId, promaEntityId: binding.proma_entity_id })
          getDatabase().prepare("DELETE FROM planning_reminders WHERE target_type='calendar_event' AND target_id=:id").run({ id: binding.proma_entity_id })
          getDatabase().prepare('DELETE FROM calendar_events WHERE id=:id').run({ id: binding.proma_entity_id })
          getDatabase().prepare('DELETE FROM planning_sync_bindings WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId, promaEntityId: binding.proma_entity_id })
        }
        continue
      }
      if (binding && binding.calendar_item_identifier !== item.calendarItemIdentifier) {
        // 先持久化新 locator，再比较内容基线；否则内容相同的 locator 迁移会被误判为“无变化”。
        getDatabase().prepare('UPDATE planning_sync_bindings SET calendar_item_identifier=:calendarItemIdentifier,calendar_item_external_identifier=:calendarItemExternalIdentifier,last_synced_at=:now WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId, promaEntityId: binding.proma_entity_id, calendarItemIdentifier: item.calendarItemIdentifier, calendarItemExternalIdentifier: item.calendarItemExternalIdentifier ?? binding.calendar_item_external_identifier ?? null, now })
        binding = { ...binding, calendar_item_identifier: item.calendarItemIdentifier, calendar_item_external_identifier: item.calendarItemExternalIdentifier ?? binding.calendar_item_external_identifier }
      }
      const hash = planningNativeCalendarHash(item)
      if (binding?.last_synced_hash === hash) continue
      // EventKit save 成功、SQLite binding 尚未确认时若进程崩溃，marker 只能在仍有该本地 outbox 时恢复；
      // 不信任任何没有对应 pending outbox 的 marker，避免用户 URL 伪造关联本地日程。
      const recoveredPending = !binding && item.promaIdentity && getDatabase().prepare(`SELECT outbox.id FROM planning_sync_outbox AS outbox
        JOIN calendar_events AS events ON events.id=outbox.proma_entity_id
        WHERE outbox.profile_id=:profileId AND outbox.proma_entity_id=:promaEntityId AND outbox.operation='upsert'`).get({ profileId, promaEntityId: item.promaIdentity })
      const localId = binding?.proma_entity_id ?? (recoveredPending ? item.promaIdentity! : randomUUID())
      const pending = (binding || recoveredPending) && getDatabase().prepare('SELECT id FROM planning_sync_outbox WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').get({ profileId, promaEntityId: localId })
      if (pending && !recoveredPending) {
        // 双端在同一基线编辑时，宁可暂停出站，也不能静默后写覆盖系统版本。
        getDatabase().prepare(`INSERT INTO planning_sync_profile_conflicts (id,profile_id,proma_entity_id,kind,native_item_json,detected_at)
          VALUES (:id,:profileId,:promaEntityId,'changed',:nativeItemJson,:now)
          ON CONFLICT(profile_id,proma_entity_id) DO UPDATE SET kind='changed',native_item_json=excluded.native_item_json,detected_at=excluded.detected_at`).run({ id: randomUUID(), profileId, promaEntityId: localId, nativeItemJson: JSON.stringify(item), now })
        continue
      }
      const updatedAt = Math.max(now, item.lastModifiedAt || now)
      if (binding || recoveredPending) {
        getDatabase().prepare('UPDATE calendar_events SET title=:title,notes=:notes,start_at=:startAt,end_at=:endAt,all_day=:allDay,updated_at=:updatedAt WHERE id=:id').run({ id: localId, title: item.title.slice(0, 500), notes: item.notes ?? null, startAt: item.startAt, endAt: item.endAt ?? null, allDay: item.allDay ? 1 : 0, updatedAt })
      } else {
        getDatabase().prepare('INSERT INTO calendar_events (id,title,notes,start_at,end_at,all_day,workspace_id,created_at,updated_at) VALUES (:id,:title,:notes,:startAt,:endAt,:allDay,NULL,:now,:updatedAt)').run({ id: localId, title: item.title.slice(0, 500), notes: item.notes ?? null, startAt: item.startAt, endAt: item.endAt ?? null, allDay: item.allDay ? 1 : 0, now, updatedAt })
      }
      getDatabase().prepare(`INSERT INTO planning_sync_bindings (profile_id,target_id,proma_entity_id,calendar_item_identifier,calendar_item_external_identifier,last_synced_hash,last_synced_at)
        VALUES (:profileId,:targetId,:promaEntityId,:calendarItemIdentifier,:calendarItemExternalIdentifier,:hash,:now)
        ON CONFLICT(profile_id,proma_entity_id) DO UPDATE SET target_id=excluded.target_id,calendar_item_identifier=excluded.calendar_item_identifier,calendar_item_external_identifier=excluded.calendar_item_external_identifier,last_synced_hash=excluded.last_synced_hash,last_synced_at=excluded.last_synced_at`).run({ profileId, targetId: profile.target_id, promaEntityId: localId, calendarItemIdentifier: item.calendarItemIdentifier, calendarItemExternalIdentifier: item.calendarItemExternalIdentifier ?? null, hash, now })
    }
  })
}

/** 只有由 locator 精确读取确认缺失的受管 Calendar 项才能视为系统端删除。 */
export function hideMissingManagedCalendarProfileItems(profileId: string, targetId: string, existingIdentifiers: string[]): void {
  const profile = getDatabase().prepare("SELECT * FROM planning_sync_profiles WHERE id=:id AND entity='calendar' AND enabled=1 AND target_id=:targetId").get({ id: profileId, targetId }) as SyncProfileRow | undefined
  if (!profile) return
  const existing = new Set(existingIdentifiers)
  withPlanningTransaction(() => {
    const bindings = getDatabase().prepare('SELECT * FROM planning_sync_bindings WHERE profile_id=:profileId AND target_id=:targetId').all({ profileId, targetId }) as SyncBindingRow[]
    for (const binding of bindings) {
      if (!binding.calendar_item_identifier || existing.has(binding.calendar_item_identifier)) continue
      const pending = getDatabase().prepare('SELECT id FROM planning_sync_outbox WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').get({ profileId, promaEntityId: binding.proma_entity_id })
      const recoveryConflict = getDatabase().prepare('SELECT id FROM planning_sync_profile_conflicts WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').get({ profileId, promaEntityId: binding.proma_entity_id })
      if (pending && !recoveryConflict) {
        getDatabase().prepare(`INSERT INTO planning_sync_profile_conflicts (id,profile_id,proma_entity_id,kind,native_item_json,detected_at)
          VALUES (:id,:profileId,:promaEntityId,'deleted',NULL,:now)
          ON CONFLICT(profile_id,proma_entity_id) DO UPDATE SET kind='deleted',native_item_json=NULL,detected_at=excluded.detected_at`).run({ id: randomUUID(), profileId, promaEntityId: binding.proma_entity_id, now: Date.now() })
      }
      if (pending || recoveryConflict) continue
      getDatabase().prepare("DELETE FROM planning_reminders WHERE target_type='calendar_event' AND target_id=:id").run({ id: binding.proma_entity_id })
      getDatabase().prepare('DELETE FROM calendar_events WHERE id=:id').run({ id: binding.proma_entity_id })
      getDatabase().prepare('DELETE FROM planning_sync_bindings WHERE profile_id=:profileId AND proma_entity_id=:promaEntityId').run({ profileId, promaEntityId: binding.proma_entity_id })
    }
  })
}

export function failPlanningSyncOutbox(item: PlanningSyncOutboxItem, error: string): void {
  const attempts = item.attempts + 1
  const delay = Math.min(60 * 60 * 1_000, 5_000 * 2 ** Math.min(attempts - 1, 10))
  const now = Date.now()
  getDatabase().prepare('UPDATE planning_sync_outbox SET attempts=:attempts,next_attempt_at=:nextAttemptAt,last_error=:error,updated_at=:now WHERE id=:id AND revision=:revision').run({ id: item.id, revision: item.revision, attempts, nextAttemptAt: now + delay, error: error.slice(0, 1_000), now })
}

export function listTodos(query: TodoListQuery = {}): Todo[] {
  const where: string[] = []; const params: Record<string, unknown> = {}; const limit = normalizeLimit(query.limit)
  if (query.status) { where.push('status = :status'); params.status = query.status }
  if (query.dueBefore !== undefined) { where.push('due_at IS NOT NULL AND due_at <= :dueBefore'); params.dueBefore = query.dueBefore }
  if (limit) params.limit = limit
  const sql = `SELECT * FROM todos ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_at IS NULL, due_at, updated_at DESC ${limit ? 'LIMIT :limit' : ''}`
  return hydrateTodos(getDatabase().prepare(sql).all(params) as TodoRow[])
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
  assertTimestamp(input.dueAt, 'dueAt')
  if (input.reminders) assertReminderInputs(input.reminders)
  if (input.tagIds) assertTagIdsExist(input.tagIds)
  const now = Date.now()
  const todo = {
    id: randomUUID(), title: assertTitle(input.title, 'Todo'), notes: input.notes?.trim() || undefined,
    status: 'open' as const, priority: input.priority ?? 'medium', dueAt: input.dueAt, groupId: input.groupId,
    workspaceId: input.workspaceId || undefined, createdAt: now, updatedAt: now,
  }
  if (todo.groupId && !getPlanningGroup(todo.groupId, 'todo')) throw new Error('Todo 分组不存在')
  withPlanningTransaction(() => {
    getDatabase().prepare(`INSERT INTO todos (id,title,notes,status,priority,due_at,group_id,workspace_id,created_at,updated_at,completed_at) VALUES (:id,:title,:notes,:status,:priority,:dueAt,:groupId,:workspaceId,:createdAt,:updatedAt,NULL)`).run({ id: todo.id, title: todo.title, notes: todo.notes ?? null, status: todo.status, priority: todo.priority, dueAt: todo.dueAt ?? null, groupId: todo.groupId ?? null, workspaceId: todo.workspaceId ?? null, createdAt: todo.createdAt, updatedAt: todo.updatedAt })
    if (input.tagIds !== undefined) replaceTags('todo', todo.id, input.tagIds)
    // 未显式传入提醒时，完成时间即默认提醒时间；保持各入口行为一致。
    if (input.reminders) createReminders('todo', todo.id, input.reminders, 'manual')
    else if (todo.dueAt) createReminders('todo', todo.id, [{ triggerAt: todo.dueAt }], 'todo_due_at')
    if (input.sessionId) touchTodoSession(todo.id, input.sessionId)
    enqueuePlanningSync('todo', todo.id, 'upsert', now)
  })
  return getTodo(todo.id)!
}
export function updateTodo(input: UpdateTodoInput): Todo | undefined {
  const old = getTodo(input.id)
  if (!old) return undefined
  if (input.expectedUpdatedAt !== undefined && (!Number.isFinite(input.expectedUpdatedAt) || input.expectedUpdatedAt <= 0)) throw new Error('expectedUpdatedAt 必须是有效时间戳')
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== old.updatedAt) throw new Error(PLANNING_CONFLICT_ERROR)
  if (input.dueAt !== undefined && input.dueAt !== null) assertTimestamp(input.dueAt, 'dueAt')
  if (input.tagIds !== undefined) assertTagIdsExist(input.tagIds)
  const status = input.status ?? old.status
  const updated = {
    ...old,
    title: input.title === undefined ? old.title : assertTitle(input.title, 'Todo'),
    notes: input.notes === undefined ? old.notes : input.notes.trim() || undefined,
    priority: input.priority ?? old.priority,
    dueAt: input.dueAt === undefined ? old.dueAt : input.dueAt ?? undefined,
    groupId: input.groupId === undefined ? old.groupId : input.groupId ?? undefined,
    workspaceId: input.workspaceId === undefined ? old.workspaceId : input.workspaceId ?? undefined,
    status,
    completedAt: status === 'completed' ? (old.completedAt ?? Date.now()) : undefined,
    updatedAt: Math.max(Date.now(), old.updatedAt + 1),
  }
  if (updated.groupId && !getPlanningGroup(updated.groupId, 'todo')) throw new Error('Todo 分组不存在')
  withPlanningTransaction(() => {
    const params: Record<string, unknown> = { id: updated.id, title: updated.title, notes: updated.notes ?? null, status: updated.status, priority: updated.priority, dueAt: updated.dueAt ?? null, groupId: updated.groupId ?? null, workspaceId: updated.workspaceId ?? null, updatedAt: updated.updatedAt, completedAt: updated.completedAt ?? null }
    if (input.expectedUpdatedAt !== undefined) params.expectedUpdatedAt = input.expectedUpdatedAt
    const result = getDatabase().prepare(`UPDATE todos SET title=:title,notes=:notes,status=:status,priority=:priority,due_at=:dueAt,group_id=:groupId,workspace_id=:workspaceId,updated_at=:updatedAt,completed_at=:completedAt WHERE id=:id${input.expectedUpdatedAt === undefined ? '' : ' AND updated_at=:expectedUpdatedAt'}`).run(params) as { changes?: number }
    if ((result.changes ?? 0) === 0) throw new Error(PLANNING_CONFLICT_ERROR)
    if (input.tagIds !== undefined) replaceTags('todo', old.id, input.tagIds)
    if (input.dueAt !== undefined && old.dueAt !== updated.dueAt) syncTodoDueAtReminder(old.id, updated.dueAt, updated.updatedAt)
    if (status === 'completed' && old.status !== 'completed') setTodoRemindersCompleted(old.id, updated.updatedAt)
    enqueuePlanningSync('todo', old.id, 'upsert', updated.updatedAt)
  })
  return getTodo(old.id)
}
export function deleteTodo(id: string): boolean {
  if (!getTodo(id)) return false
  return withPlanningTransaction(() => {
    const db = getDatabase()
    enqueuePlanningSync('todo', id, 'delete')
    db.prepare(`DELETE FROM planning_reminders WHERE target_type='todo' AND target_id=:id`).run({ id })
    const result = db.prepare('DELETE FROM todos WHERE id=:id').run({ id }) as { changes?: number }
    return (result.changes ?? 0) > 0
  })
}

export function listCalendarEvents(query: CalendarEventListQuery = {}): CalendarEvent[] {
  const where: string[] = []; const params: Record<string, unknown> = {}; const limit = normalizeLimit(query.limit)
  if (query.from !== undefined) { where.push('COALESCE(end_at,start_at)>=:from'); params.from = query.from }
  if (query.to !== undefined) { where.push('start_at<=:to'); params.to = query.to }
  if (limit) params.limit = limit
  return hydrateCalendarEvents(getDatabase().prepare(`SELECT * FROM calendar_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY start_at ${limit ? 'LIMIT :limit' : ''}`).all(params) as CalendarEventRow[])
}
export function getCalendarEvent(id: string): CalendarEvent | undefined { const row = getDatabase().prepare('SELECT * FROM calendar_events WHERE id=:id').get({ id }) as CalendarEventRow | undefined; return row ? calendarEventFromRow(row) : undefined }
export function createCalendarEvent(input: CreateCalendarEventInput): CalendarEvent {
  assertTimestamp(input.startAt, 'startAt')
  assertTimestamp(input.endAt, 'endAt')
  if (input.endAt && input.endAt < input.startAt) throw new Error('日程 endAt 不能早于 startAt')
  if (input.reminders) assertReminderInputs(input.reminders)
  if (input.tagIds) assertTagIdsExist(input.tagIds)
  const now = Date.now()
  const event = {
    id: randomUUID(), title: assertTitle(input.title, '日程'), notes: input.notes?.trim() || undefined,
    startAt: input.startAt, endAt: input.endAt, allDay: input.allDay ?? false, groupId: input.groupId,
    workspaceId: input.workspaceId || undefined, todoId: input.todoId || undefined, createdAt: now, updatedAt: now,
  }
  if (event.groupId && !getPlanningGroup(event.groupId, 'calendar')) throw new Error('日程分组不存在')
  withPlanningTransaction(() => {
    getDatabase().prepare(`INSERT INTO calendar_events (id,title,notes,start_at,end_at,all_day,calendar_group_id,workspace_id,todo_id,created_at,updated_at) VALUES (:id,:title,:notes,:startAt,:endAt,:allDay,:groupId,:workspaceId,:todoId,:createdAt,:updatedAt)`).run({ id: event.id, title: event.title, notes: event.notes ?? null, startAt: event.startAt, endAt: event.endAt ?? null, allDay: event.allDay ? 1 : 0, groupId: event.groupId ?? null, workspaceId: event.workspaceId ?? null, todoId: event.todoId ?? null, createdAt: event.createdAt, updatedAt: event.updatedAt })
    if (input.tagIds !== undefined) replaceTags('calendar_event', event.id, input.tagIds)
    if (input.reminders) createReminders('calendar_event', event.id, input.reminders)
    enqueuePlanningSync('calendar_event', event.id, 'upsert', now)
  })
  return getCalendarEvent(event.id)!
}
export function updateCalendarEvent(input: UpdateCalendarEventInput): CalendarEvent | undefined {
  const old = getCalendarEvent(input.id)
  if (!old) return undefined
  if (input.expectedUpdatedAt !== undefined && (!Number.isFinite(input.expectedUpdatedAt) || input.expectedUpdatedAt <= 0)) throw new Error('expectedUpdatedAt 必须是有效时间戳')
  if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== old.updatedAt) throw new Error(PLANNING_CONFLICT_ERROR)
  if (input.startAt !== undefined) assertTimestamp(input.startAt, 'startAt')
  if (input.endAt !== undefined && input.endAt !== null) assertTimestamp(input.endAt, 'endAt')
  if (input.tagIds !== undefined) assertTagIdsExist(input.tagIds)
  const updated = {
    ...old,
    title: input.title === undefined ? old.title : assertTitle(input.title, '日程'),
    notes: input.notes === undefined ? old.notes : input.notes.trim() || undefined,
    startAt: input.startAt ?? old.startAt,
    endAt: input.endAt === undefined ? old.endAt : input.endAt ?? undefined,
    allDay: input.allDay ?? old.allDay,
    groupId: input.groupId === undefined ? old.groupId : input.groupId ?? undefined,
    workspaceId: input.workspaceId === undefined ? old.workspaceId : input.workspaceId ?? undefined,
    todoId: input.todoId === undefined ? old.todoId : input.todoId ?? undefined,
    updatedAt: Math.max(Date.now(), old.updatedAt + 1),
  }
  if (updated.endAt && updated.endAt < updated.startAt) throw new Error('日程 endAt 不能早于 startAt')
  if (updated.groupId && !getPlanningGroup(updated.groupId, 'calendar')) throw new Error('日程分组不存在')
  withPlanningTransaction(() => {
    const params: Record<string, unknown> = { id: updated.id, title: updated.title, notes: updated.notes ?? null, startAt: updated.startAt, endAt: updated.endAt ?? null, allDay: updated.allDay ? 1 : 0, groupId: updated.groupId ?? null, workspaceId: updated.workspaceId ?? null, todoId: updated.todoId ?? null, updatedAt: updated.updatedAt }
    if (input.expectedUpdatedAt !== undefined) params.expectedUpdatedAt = input.expectedUpdatedAt
    const result = getDatabase().prepare(`UPDATE calendar_events SET title=:title,notes=:notes,start_at=:startAt,end_at=:endAt,all_day=:allDay,calendar_group_id=:groupId,workspace_id=:workspaceId,todo_id=:todoId,updated_at=:updatedAt WHERE id=:id${input.expectedUpdatedAt === undefined ? '' : ' AND updated_at=:expectedUpdatedAt'}`).run(params) as { changes?: number }
    if ((result.changes ?? 0) === 0) throw new Error(PLANNING_CONFLICT_ERROR)
    if (input.tagIds !== undefined) replaceTags('calendar_event', old.id, input.tagIds)
    enqueuePlanningSync('calendar_event', old.id, 'upsert', updated.updatedAt)
  })
  return getCalendarEvent(old.id)
}
export function deleteCalendarEvent(id: string): boolean {
  const event = getCalendarEvent(id)
  if (!event) return false
  return withPlanningTransaction(() => {
    const db = getDatabase()
    enqueuePlanningSync('calendar_event', id, 'delete', Date.now(), event.startAt)
    db.prepare(`DELETE FROM planning_reminders WHERE target_type='calendar_event' AND target_id=:id`).run({ id })
    const result = db.prepare('DELETE FROM calendar_events WHERE id=:id').run({ id }) as { changes?: number }
    return (result.changes ?? 0) > 0
  })
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
  const result = getDatabase().prepare(`UPDATE planning_reminders SET trigger_at=:triggerAt,snoozed_until=NULL,last_notified_at=NULL,origin='manual',updated_at=:now WHERE id=:id AND status='pending'`).run({ id, triggerAt, now }) as { changes?: number }
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
  const result = getDatabase().prepare(`UPDATE planning_reminders SET snoozed_until=:snoozedUntil,last_notified_at=NULL,origin='manual',updated_at=:now WHERE id=:id AND status='pending'`).run({ id, snoozedUntil: now + minutes * 60_000, now }) as { changes?: number }
  return (result.changes ?? 0) > 0 ? getReminder(id) : undefined
}
function getReminder(id: string): PlanningReminder | undefined { const row = getDatabase().prepare('SELECT * FROM planning_reminders WHERE id=:id').get({ id }) as ReminderRow | undefined; return row ? reminderFromRow(row) : undefined }
export function listActivePlanningReminders(): ActivePlanningReminder[] {
  const rows = getDatabase().prepare(`SELECT * FROM planning_reminders WHERE status='pending' AND COALESCE(snoozed_until,trigger_at) <= :now ORDER BY COALESCE(snoozed_until,trigger_at)`).all({ now: Date.now() }) as ReminderRow[]
  return rows.flatMap((row): ActivePlanningReminder[] => { const target = row.target_type === 'todo' ? getTodo(row.target_id) : getCalendarEvent(row.target_id); if (!target) return []; return [{ ...reminderFromRow(row), targetTitle: target.title, group: target.group, tags: target.tags }] })
}
/** 返回新增到期提醒并标记已通知，避免每个 30 秒轮询周期重复播放声音。 */
export function claimDuePlanningReminders(now = Date.now()): ActivePlanningReminder[] {
  // Todo 已成功发布到受管 Reminders List 时，让系统 Reminder 成为默认截止提醒的唯一系统通知来源，避免双弹窗。
  const rows = getDatabase().prepare(`
    SELECT * FROM planning_reminders
    WHERE status='pending' AND COALESCE(snoozed_until,trigger_at) <= :now AND last_notified_at IS NULL
      AND NOT (
        origin='todo_due_at' AND target_type='todo' AND EXISTS (
          SELECT 1 FROM planning_sync_profiles AS profiles
          JOIN planning_sync_bindings AS bindings ON bindings.profile_id=profiles.id AND bindings.proma_entity_id=planning_reminders.target_id
          WHERE profiles.entity='reminder' AND profiles.enabled=1
        )
      )
    ORDER BY COALESCE(snoozed_until,trigger_at)
  `).all({ now }) as ReminderRow[]
  const result: ActivePlanningReminder[] = []
  for (const row of rows) { getDatabase().prepare('UPDATE planning_reminders SET last_notified_at=:now,updated_at=:now WHERE id=:id').run({ id: row.id, now }); const target = row.target_type === 'todo' ? getTodo(row.target_id) : getCalendarEvent(row.target_id); if (target) result.push({ ...reminderFromRow({ ...row, last_notified_at: now, updated_at: now }), targetTitle: target.title, group: target.group, tags: target.tags }) }
  return result
}
