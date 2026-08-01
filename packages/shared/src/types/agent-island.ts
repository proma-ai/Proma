/**
 * Agent Island —— 灵动岛共享类型
 *
 * 参考 Cindy (makecindy/cindy) 的 Agent Island 设计：
 * 灵动岛 = 屏幕顶部常驻的 Agent 状态胶囊 + 展开卡片；宠物（mascot）是
 * 随会话 phase 实时变化的"岛民"，由主进程状态机驱动、渲染层绘制。
 *
 * 本模块只定义主进程 ↔ 渲染进程之间的类型契约与 IPC 通道。
 */

/** 会话阶段（驱动 mascot 动画与 pill 状态色） */
export type AgentIslandPhase = 'idle' | 'running' | 'needs-interaction' | 'completed' | 'error'

/** 需要用户交互的类型 */
export type AgentIslandInteractionKind = 'permission' | 'ask_user_question' | 'plan_review'

/** 活动行类型（终端式逐步活动预览） */
export type AgentIslandActivityLineKind = 'tool' | 'assistant' | 'status' | 'user'

/** 灵动岛活动行（显示在展开卡与 pill 的紧凑详情） */
export interface AgentIslandActivityLine {
  id: string
  kind: AgentIslandActivityLineKind
  text: string
}

/** 单个 Agent 会话的灵动岛快照 */
export interface AgentIslandSessionSnapshot {
  sessionId: string
  title: string
  phase: AgentIslandPhase
  interactionKind?: AgentIslandInteractionKind
  /** 当前动作摘要（工具名 / 等待内容 / 错误摘要等） */
  detail: string
  /** 最近活动行（最多保留 N 条） */
  activityLines: AgentIslandActivityLine[]
  /** 是否需要用户注意（权限/提问/完成未读） */
  attention: boolean
  startedAt: number
  lastActivityAt: number
}

/** 收起态 pill 的聚合快照 */
export interface AgentIslandPillSnapshot {
  /** 优先会话的 phase（没有会话时为 idle） */
  priorityStatus: AgentIslandPhase
  /** 全部会话数 */
  sessionCount: number
  /** 活跃（running / needs-interaction）会话数 */
  activeSessionCount: number
  /** 等待用户交互的会话数 */
  pendingInteractionCount: number
  /** 未读完成 / 错误会话数 */
  unreadCompletedCount: number
}

/** 灵动岛展示生命周期；主进程为唯一状态真源。 */
export type AgentIslandPresentation = 'hidden' | 'compact' | 'expanded'

/** 主进程推送给灵动岛窗口的全量状态 */
export interface AgentIslandState {
  /** 是否显示（服务未就绪或用户关闭时为 false） */
  visible: boolean
  /** 展示生命周期，避免渲染层自行推断隐藏/收起/展开。 */
  presentation: AgentIslandPresentation
  /** 指针是否位于可交互 surface 内；用于呈现即时 hover 预热反馈。 */
  hovered: boolean
  /** 是否展开卡片；为现有 Electron fallback 保留的便利字段。 */
  expanded: boolean
  pill: AgentIslandPillSnapshot
  /** 正在运行、待接手或未读的 Agent 会话。 */
  sessions: AgentIslandSessionSnapshot[]
  /** 没有活跃事项时的常驻回顾入口，最多三个最近会话。 */
  recentSessions: AgentIslandSessionSnapshot[]
  /** 空闲时展示 Plan 额度与最近会话；由主进程按临近事项统一判定。 */
  idleDashboard: boolean
  totalCount: number
  updatedAt: number
}

/** 原生 macOS 灵动岛需要的最小 Todo 投影（不泄露 notes/tags 等详情）。 */
export interface AgentIslandPlanningTodoSnapshot {
  id: string
  title: string
  dueAt?: number
  priority: 'low' | 'medium' | 'high'
  isOverdue: boolean
}

/** 原生 macOS 灵动岛需要的最小日程投影。 */
export interface AgentIslandPlanningEventSnapshot {
  id: string
  title: string
  startAt: number
  endAt?: number
  allDay: boolean
}

export interface AgentIslandPlanningSnapshot {
  dayStart: number
  dayEnd: number
  todos: AgentIslandPlanningTodoSnapshot[]
  events: AgentIslandPlanningEventSnapshot[]
  overdueTodoCount: number
}

/** 单个订阅 Plan 限额窗口的展示投影。 */
export interface AgentIslandPlanQuotaWindowSnapshot {
  windowLabel: string
  remainingPercent: number
  remainingLabel?: string
}

/** 灵动岛展示所需的最小订阅 Plan 额度投影；按渠道聚合，绝不包含凭据。 */
export interface AgentIslandPlanQuotaSnapshot {
  channelName: string
  planName: string
  windows: AgentIslandPlanQuotaWindowSnapshot[]
}

/** TypeScript 主进程 → macOS Swift helper 的 JSONL 全量状态。 */
export interface NativeAgentIslandSnapshot {
  type: 'snapshot'
  protocol: 1
  revision: number
  state: AgentIslandState
  planning: AgentIslandPlanningSnapshot
  /** 支持查询的启用渠道；Swift 仅负责本地轮播展示。 */
  planQuotas: AgentIslandPlanQuotaSnapshot[]
}

/** macOS Swift helper → TypeScript 主进程的受限交互意图。 */
export type NativeAgentIslandEvent =
  | { type: 'ready'; protocol: 1 }
  | { type: 'intent'; name: 'set-expanded'; expanded: boolean }
  /** 原生 surface 的悬停状态；主进程决定延迟展开/收起，不在 Swift 中藏产品状态。 */
  | { type: 'intent'; name: 'set-hovered'; hovered: boolean }
  | { type: 'intent'; name: 'open-main' }
  | { type: 'intent'; name: 'open-session'; sessionId: string }
  | { type: 'intent'; name: 'open-planning' }
  /** 用户主动关闭当前提醒；主进程决定何时因新的状态再次出现。 */
  | { type: 'intent'; name: 'dismiss' }
  | { type: 'fatal'; message: string }

export interface AgentIslandResizeRequest {
  width: number
  height: number
}

export interface AgentIslandMoveRequest {
  x: number
  y: number
}

export const AGENT_ISLAND_IPC_CHANNELS = {
  /** main → renderer：全量状态推送 */
  STATE: 'agent-island:state',
  /** renderer → main：同步展开/收起真值 */
  SET_EXPANDED: 'agent-island:set-expanded',
  /** renderer → main：按内容调整窗口尺寸 */
  RESIZE: 'agent-island:resize',
  /** renderer → main：移动窗口位置（拖拽） */
  MOVE: 'agent-island:move',
  /** renderer → main：请求打开/聚焦主窗口 */
  OPEN_MAIN_WINDOW: 'agent-island:open-main-window',
  /** renderer → main：请求打开指定 Agent 会话 */
  OPEN_SESSION: 'agent-island:open-session',
  /** 主应用已主动查看指定完成会话，清除灵动岛未读状态 */
  MARK_SESSION_VIEWED: 'agent-island:mark-session-viewed',
  /** renderer → main：内联响应权限请求 */
  RESPOND_PERMISSION: 'agent-island:respond-permission',
  /** main → renderer：切换展开（快捷键等外部入口） */
  TOGGLE_EXPANDED: 'agent-island:toggle-expanded',
} as const

export type AgentIslandIpcChannel = (typeof AGENT_ISLAND_IPC_CHANNELS)[keyof typeof AGENT_ISLAND_IPC_CHANNELS]
