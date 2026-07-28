/** 本地任务与日程（Planning）类型。Todo 与日程分别持久化，Automation 保持独立。 */

export type TodoStatus = 'open' | 'completed'
export type TodoPriority = 'low' | 'medium' | 'high'
/** Todo 与日程分组独立存储；同名分组允许分别存在。 */
export type PlanningGroupScope = 'todo' | 'calendar'
export type PlanningReminderTargetType = 'todo' | 'calendar_event'
export type PlanningReminderStatus = 'pending' | 'acknowledged' | 'completed'
/** 标识提醒是否由目标计划时间自动生成，供改期时安全同步。 */
export type PlanningReminderOrigin = 'manual' | 'todo_due_at' | 'event_start'

/** 草稿本关联仅保存稳定摘要，不依赖富文本 HTML 偏移。 */
export interface ScratchReference {
  excerpt: string
}

export interface PlanningGroup {
  id: string
  /** 分组归属；Todo 与日程不能互相引用。 */
  scope: PlanningGroupScope
  name: string
  color?: string
  sortOrder: number
  archivedAt?: number
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
  scratchReference?: ScratchReference
  createdAt: number
  updatedAt: number
  completedAt?: number
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
  scratchReference?: ScratchReference
  createdAt: number
  updatedAt: number
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
  scratchReference?: ScratchReference
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
  scratchReference?: ScratchReference | null
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
  scratchReference?: ScratchReference
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
  scratchReference?: ScratchReference | null
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
  archivedAt?: number | null
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

export interface UpdatePlanningReminderInput {
  id: string
  triggerAt: number
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
  CREATE_TAG: 'planning:create-tag',
  UPDATE_TAG: 'planning:update-tag',
  DELETE_TAG: 'planning:delete-tag',
  LIST_ACTIVE_REMINDERS: 'planning:list-active-reminders',
  CREATE_REMINDER: 'planning:create-reminder',
  UPDATE_REMINDER: 'planning:update-reminder',
  DELETE_REMINDER: 'planning:delete-reminder',
  ACKNOWLEDGE_REMINDER: 'planning:acknowledge-reminder',
  SNOOZE_REMINDER: 'planning:snooze-reminder',
  REMINDER_DUE: 'planning:reminder-due',
  /** 打开或聚焦单例独立规划窗口。 */
  OPEN_WINDOW: 'planning:open-window',
  CHANGED: 'planning:changed',
  AGENT_OPERATION: 'planning:agent-operation',
} as const
