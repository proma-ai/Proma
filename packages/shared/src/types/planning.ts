/** 本地任务与日程（Planning）类型。Todo 与日程分别持久化，Automation 保持独立。 */

export type TodoStatus = 'open' | 'completed'
export type TodoPriority = 'low' | 'medium' | 'high'
/** Todo 与日程分组独立存储；同名分组允许分别存在。 */
export type PlanningGroupScope = 'todo' | 'calendar'
export type PlanningReminderTargetType = 'todo' | 'calendar_event'
export type PlanningReminderStatus = 'pending' | 'acknowledged' | 'completed'
/** 标识提醒是否由目标计划时间自动生成，供改期时安全同步。 */
export type PlanningReminderOrigin = 'manual' | 'todo_due_at'
/** macOS EventKit 对应的两类受管目标。 */
export type PlanningNativeSyncEntity = 'calendar' | 'reminder'
export type PlanningNativeSyncPermission = 'full-access' | 'write-only' | 'denied' | 'restricted' | 'not-determined' | 'unsupported' | 'unavailable'

/** 日程编辑基于此错误文案识别并提示跨窗口并发冲突。 */
export const PLANNING_CONFLICT_ERROR = '日程已被其他窗口修改，请重新加载后再试'

/** planning:changed 的资源级失效通知，避免所有窗口重复拉取完整快照。 */
export type PlanningChangeResource = 'todos' | 'calendar_events' | 'todo_groups' | 'calendar_groups' | 'tags' | 'reminders'

export interface PlanningChange {
  resources: PlanningChangeResource[]
  /** 单项 Todo 更新可直接增量合并，避免每个窗口重新读取完整列表。 */
  todo?: Todo
}

/** macOS 中用户可选、且当前允许 Proma 写入的 Calendar / Reminders List。 */
export interface PlanningNativeSyncTarget {
  id: string
  title: string
  sourceTitle: string
  sourceType: 'caldav' | 'exchange' | 'local' | 'birthdays' | 'mobileme' | 'subscribed' | 'unknown'
  /** 当前集合是否允许修改；只读集合仍可由用户显式接入浏览。 */
  canWrite: boolean
  /** EventKit 仅能识别账户来源，不能承诺其服务端已完成同步。 */
  isCloudBacked: boolean
}

export interface PlanningNativeSyncPermissionResult {
  entity: PlanningNativeSyncEntity
  status: PlanningNativeSyncPermission
  granted?: boolean
  error?: string
}

export interface PlanningNativeSyncStatus {
  supported: boolean
  calendar: PlanningNativeSyncPermissionResult
  reminder: PlanningNativeSyncPermissionResult
}

export type PlanningNativeConnectionRole = 'managed' | 'linked'

/** 每类实体一个 Proma 受管目标。 */
export interface PlanningSyncProfile {
  id: string
  entity: PlanningNativeSyncEntity
  targetId: string
  targetTitle: string
  sourceTitle: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface SavePlanningSyncProfileInput {
  entity: PlanningNativeSyncEntity
  target: Pick<PlanningNativeSyncTarget, 'id' | 'title' | 'sourceTitle'>
  enabled?: boolean
}

/** 用户显式接入的既有系统集合；未连接的目标绝不读取。 */
export interface PlanningNativeConnection {
  id: string
  entity: PlanningNativeSyncEntity
  targetId: string
  targetTitle: string
  sourceTitle: string
  sourceType: PlanningNativeSyncTarget['sourceType']
  canWrite: boolean
  connectedAt: number
  updatedAt: number
}

export interface ConnectPlanningNativeConnectionInput {
  entity: PlanningNativeSyncEntity
  target: PlanningNativeSyncTarget
}

export interface PlanningNativeOrigin {
  connectionId: string
  targetTitle: string
  sourceTitle: string
  canWrite: boolean
}

/** 同一已连接系统项被 Proma 与系统并发修改时，必须由用户选择保留哪一侧。 */
export interface PlanningNativeSyncConflict {
  id: string
  /** 已连接集合冲突；受管 Proma Calendar 冲突则为 profileId。 */
  connectionId?: string
  profileId?: string
  entity: PlanningNativeSyncEntity
  promaEntityId: string
  title: string
  kind: 'changed' | 'deleted'
  detectedAt: number
}
export type ResolvePlanningNativeSyncConflictInput = { id: string; resolution: 'keep_proma' | 'keep_system' }

export interface PlanningGroup {
  id: string
  /** 分组归属；Todo 与日程不能互相引用。 */
  scope: PlanningGroupScope
  name: string
  color?: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface PlanningTag {
  id: string
  name: string
  color?: string
  createdAt: number
  updatedAt: number
}

/** 提醒本体独立持久化；未确认的提醒会作为应用内常驻通知显示。 */
/** 一个 Agent Session 与 Todo 的去重关联；不保存对话正文或字段级审计。 */
export interface TodoSessionLink {
  sessionId: string
  firstTouchedAt: number
  lastTouchedAt: number
}

export interface PlanningReminder {
  id: string
  targetType: PlanningReminderTargetType
  targetId: string
  triggerAt: number
  snoozedUntil?: number
  status: PlanningReminderStatus
  origin: PlanningReminderOrigin
  acknowledgedAt?: number
  lastNotifiedAt?: number
  createdAt: number
  updatedAt: number
}

/** 常驻提醒 UI 所需的目标摘要，避免渲染端自行拼接数据库关系。 */
export interface ActivePlanningReminder extends PlanningReminder {
  targetTitle: string
  group?: PlanningGroup
  tags: PlanningTag[]
}

export interface Todo {
  id: string
  title: string
  notes?: string
  status: TodoStatus
  priority: TodoPriority
  dueAt?: number
  groupId?: string
  group?: PlanningGroup
  tags: PlanningTag[]
  reminders: PlanningReminder[]
  /** 仅由 Agent 成功创建或更新 Todo 时写入，按 Session 去重。 */
  sessionLinks: TodoSessionLink[]
  workspaceId?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  /** 已连接系统提醒事项的来源和写入能力。 */
  nativeOrigin?: PlanningNativeOrigin
}

export interface CalendarEvent {
  id: string
  title: string
  notes?: string
  startAt: number
  endAt?: number
  allDay: boolean
  groupId?: string
  group?: PlanningGroup
  tags: PlanningTag[]
  reminders: PlanningReminder[]
  workspaceId?: string
  todoId?: string
  createdAt: number
  updatedAt: number
  /** 已连接系统日历项的来源和写入能力。 */
  nativeOrigin?: PlanningNativeOrigin
}

/** Todo 列表的可选范围；未传入时保持完整列表的既有行为。 */
export interface TodoListQuery {
  status?: TodoStatus
  dueBefore?: number
  limit?: number
}

/** 日程列表的可选时间范围；未传入时保持完整列表的既有行为。 */
export interface CalendarEventListQuery {
  from?: number
  to?: number
  limit?: number
}

export interface CreatePlanningReminderInput {
  triggerAt: number
}

export interface CreateTodoInput {
  title: string
  notes?: string
  priority?: TodoPriority
  dueAt?: number
  groupId?: string
  tagIds?: string[]
  reminders?: CreatePlanningReminderInput[]
  /** 创建来源的 Agent Session；仅应用内部创建时使用，并自动写入关联。 */
  sessionId?: string
  workspaceId?: string
}

export interface StartTodoAgentInput {
  todoId: string
  /** 用户在项目选择器中确认的执行项目。 */
  workspaceId: string
  /** 用于主进程原子校验，避免跨窗口修改后以旧项目启动。 */
  expectedUpdatedAt: number
  channelId: string
  modelId?: string
}

export interface StartTodoAgentResult {
  todo: Todo
  session: import('./agent').AgentSessionMeta
}

export interface UpdateTodoInput {
  id: string
  title?: string
  notes?: string
  priority?: TodoPriority
  dueAt?: number | null
  groupId?: string | null
  tagIds?: string[]
  workspaceId?: string | null
  /** 可选版本号，用于拒绝跨窗口的旧草稿覆盖。 */
  expectedUpdatedAt?: number
  status?: TodoStatus
}

export interface CreateCalendarEventInput {
  title: string
  notes?: string
  startAt: number
  endAt?: number
  allDay?: boolean
  groupId?: string
  tagIds?: string[]
  reminders?: CreatePlanningReminderInput[]
  workspaceId?: string
  todoId?: string
}

export interface UpdateCalendarEventInput {
  id: string
  title?: string
  notes?: string
  startAt?: number
  endAt?: number | null
  allDay?: boolean
  groupId?: string | null
  tagIds?: string[]
  workspaceId?: string | null
  todoId?: string | null
  /** 详情面板保存时携带的版本号，用于拒绝跨窗口的旧草稿覆盖。 */
  expectedUpdatedAt?: number
}

export interface CreatePlanningGroupInput {
  scope: PlanningGroupScope
  name: string
  color?: string
  sortOrder?: number
}

export interface UpdatePlanningGroupInput {
  id: string
  /** 作为要更新分组的归属选择器，不能借此移动分组。 */
  scope: PlanningGroupScope
  name?: string
  color?: string | null
  sortOrder?: number
}

export interface CreatePlanningTagInput {
  name: string
  color?: string
}

export interface UpdatePlanningTagInput {
  id: string
  name?: string
  color?: string | null
}

export interface CreatePlanningReminderRequest extends CreatePlanningReminderInput {
  targetType: PlanningReminderTargetType
  targetId: string
}


export interface SnoozePlanningReminderInput {
  id: string
  minutes: number
}

/** Pi Agent 成功修改本地规划数据后，供对应 Agent 会话展示即时反馈。 */
export interface PlanningAgentOperation {
  sessionId: string
  target: 'todo' | 'calendar_event'
  action: 'created' | 'updated' | 'deleted'
  title: string
}

export const PLANNING_IPC_CHANNELS = {
  LIST_TODOS: 'planning:list-todos',
  CREATE_TODO: 'planning:create-todo',
  /** 原子地确认 Todo 项目归属并创建对应 Agent 会话。 */
  START_TODO_AGENT: 'planning:start-todo-agent',
  UPDATE_TODO: 'planning:update-todo',
  DELETE_TODO: 'planning:delete-todo',
  LIST_CALENDAR_EVENTS: 'planning:list-calendar-events',
  CREATE_CALENDAR_EVENT: 'planning:create-calendar-event',
  UPDATE_CALENDAR_EVENT: 'planning:update-calendar-event',
  DELETE_CALENDAR_EVENT: 'planning:delete-calendar-event',
  LIST_GROUPS: 'planning:list-groups',
  CREATE_GROUP: 'planning:create-group',
  UPDATE_GROUP: 'planning:update-group',
  DELETE_GROUP: 'planning:delete-group',
  LIST_TAGS: 'planning:list-tags',
  LIST_ACTIVE_REMINDERS: 'planning:list-active-reminders',
  ACKNOWLEDGE_REMINDER: 'planning:acknowledge-reminder',
  SNOOZE_REMINDER: 'planning:snooze-reminder',
  REMINDER_DUE: 'planning:reminder-due',
  CHANGED: 'planning:changed',
  AGENT_OPERATION: 'planning:agent-operation',
  /** macOS Calendar / Reminders 连接设置（仅主进程可访问 EventKit）。 */
  GET_NATIVE_SYNC_STATUS: 'planning:get-native-sync-status',
  REQUEST_NATIVE_SYNC_ACCESS: 'planning:request-native-sync-access',
  /** 在授权被拒绝或仅写入时，跳转 macOS Calendar / Reminders 隐私设置。 */
  OPEN_NATIVE_SYNC_PRIVACY_SETTINGS: 'planning:open-native-sync-privacy-settings',
  LIST_NATIVE_SYNC_TARGETS: 'planning:list-native-sync-targets',
  LIST_NATIVE_CONNECTION_TARGETS: 'planning:list-native-connection-targets',
  LIST_NATIVE_CONNECTIONS: 'planning:list-native-connections',
  CONNECT_NATIVE_CONNECTION: 'planning:connect-native-connection',
  DISCONNECT_NATIVE_CONNECTION: 'planning:disconnect-native-connection',
  LIST_NATIVE_SYNC_CONFLICTS: 'planning:list-native-sync-conflicts',
  RESOLVE_NATIVE_SYNC_CONFLICT: 'planning:resolve-native-sync-conflict',
  LIST_SYNC_PROFILES: 'planning:list-sync-profiles',
  SAVE_SYNC_PROFILE: 'planning:save-sync-profile',
} as const
