/**
 * Agent Island 灵动岛服务（主进程状态机）
 *
 * 订阅 AgentEventBus，把每个 Agent 会话的流式事件折叠成灵动岛会话快照
 * （phase / detail / activityLines / attention），聚合 pill 摘要后通过
 * AGENT_ISLAND_IPC_CHANNELS.STATE 推送到灵动岛窗口。
 *
 * 设计参考 Cindy (makecindy/cindy) 的 AgentIslandService：
 * - TypeScript 主进程拥有产品状态（事件 → 状态机），渲染层只负责绘制
 * - phase: idle / running / needs-interaction / completed / error
 * - 显示策略按状态分层：日常 running 不打扰，等待交互才醒目
 *
 * Todo / 日程部分由渲染进程通过已有的 planning IPC 自行拉取与订阅，
 * 本服务只负责 Agent 会话状态，保持职责单一。
 */

import { ipcMain } from 'electron'
import {
  AGENT_ISLAND_IPC_CHANNELS,
  type AgentIslandActivityLine,
  type AgentIslandPillSnapshot,
  type AgentIslandSessionSnapshot,
  type AgentIslandState,
  type AgentIslandPlanningSnapshot,
  type NativeAgentIslandEvent,
  type NativeAgentIslandSnapshot,
} from '@proma/shared'
import type { AgentStreamPayload } from '@proma/shared'
import { agentEventBus } from './agent-service'
import { getAgentSessionMeta } from './agent-session-manager'
import { getAgentIslandWindow, hideAgentIslandWindow, moveAgentIslandWindow, onAgentIslandWindowReady, resizeAgentIslandWindow, showAgentIslandWindow } from './agent-island-window'
import { isMacAgentIslandNativeHostReady, publishMacAgentIslandSnapshot } from './mac-agent-island-native-host'
import { listCalendarEvents, listTodos } from './planning-manager'
import { onPlanningChanged } from './planning-events'

/** 会话快照保留的最大活动行数 */
const MAX_ACTIVITY_LINES = 6
/** 会话快照保留的最近活动行数（推给窗口的） */
const MAX_PUSHED_ACTIVITY_LINES = 4
/** 完成/错误后保留 attention（未读）的时间，也作为 terminal 会话在列表中的存活期 */
const UNREAD_RETAIN_MS = 10 * 60_000
/** 无 Agent 需接手时，仅在 Todo 截止/日程开始前这一窗口显示。 */
const PLANNING_ATTENTION_WINDOW_MS = 60 * 60_000
/** 推送节流间隔 */
const PUSH_THROTTLE_MS = 80
/** Hover 只是一种临时展开意图，避免 Swift 渲染层自行维护状态机。 */
const HOVER_EXPAND_DELAY_MS = 160
const HOVER_COLLAPSE_DELAY_MS = 600

interface InternalSessionSnapshot extends AgentIslandSessionSnapshot {
  /** 会话启动时间戳（首条事件到达时记录） */
  startedAt: number
  lastActivityAt: number
  /** 未读完成/错误标记（在 UNREAD_RETAIN_MS 内保留） */
  unread: boolean
  /** 完成/错误的时间戳 */
  terminalAt?: number
}

let initialized = false
/** 用户点按后保持的展开状态。 */
let manuallyExpanded = false
/** 鼠标悬停带来的临时展开状态。 */
let hoverExpanded = false
let hoverTimer: ReturnType<typeof setTimeout> | null = null
const sessions = new Map<string, InternalSessionSnapshot>()
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastPushAt = 0
let lastStateJson = ''
let nativeRevision = 0
let planningRevision = 0
let planningRolloverTimer: ReturnType<typeof setTimeout> | null = null
let planningAttentionTimer: ReturnType<typeof setTimeout> | null = null
/** 当前被用户主动关闭的提醒指纹；出现新的事项/Agent 状态时自动失效。 */
let dismissedVisibilityKey: string | null = null
let currentVisibilityKey = ''
let disposePlanningListener: (() => void) | null = null
let serviceDeps: AgentIslandServiceDeps | null = null

// ===== 工具函数 =====

function makeActivity(id: string, kind: AgentIslandActivityLine['kind'], text: string): AgentIslandActivityLine {
  return { id: `${id}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, kind, text }
}

function truncate(text: string, max = 80): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function getTitle(sessionId: string): string {
  try {
    const meta = getAgentSessionMeta(sessionId)
    return meta?.title?.trim() || sessionId.slice(0, 8)
  } catch {
    return sessionId.slice(0, 8)
  }
}

function ensureSession(sessionId: string): InternalSessionSnapshot {
  let s = sessions.get(sessionId)
  if (!s) {
    s = {
      sessionId,
      title: getTitle(sessionId),
      phase: 'running',
      detail: '',
      activityLines: [],
      attention: false,
      unread: false,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    }
    sessions.set(sessionId, s)
  }
  return s
}

function pushActivity(session: InternalSessionSnapshot, kind: AgentIslandActivityLine['kind'], text: string): void {
  session.activityLines.push(makeActivity(session.sessionId, kind, text))
  if (session.activityLines.length > MAX_ACTIVITY_LINES) {
    session.activityLines.splice(0, session.activityLines.length - MAX_ACTIVITY_LINES)
  }
}

/** 把 detail 更新为最近一次工具名 */
function setToolDetail(session: InternalSessionSnapshot, toolName: string): void {
  session.detail = `正在使用 ${toolName}`
  session.phase = 'running'
  session.attention = false
  session.unread = false
  session.lastActivityAt = Date.now()
}

// ===== 事件映射（AgentStreamPayload → 灵动岛语义） =====

function handleAgentEvent(sessionId: string, payload: AgentStreamPayload): void {
  if (payload.kind === 'proma_event') {
    handlePromaEvent(sessionId, payload.event)
  } else {
    handleSdkMessage(sessionId, payload.message)
  }
}

function handlePromaEvent(sessionId: string, event: import('@proma/shared').PromaEvent): void {
  switch (event.type) {
    case 'permission_request': {
      const session = ensureSession(sessionId)
      session.phase = 'needs-interaction'
      session.interactionKind = 'permission'
      session.detail = '等待权限确认'
      session.attention = true
      session.lastActivityAt = Date.now()
      pushActivity(session, 'status', '需要权限确认')
      break
    }
    case 'ask_user_request': {
      const session = ensureSession(sessionId)
      session.phase = 'needs-interaction'
      session.interactionKind = 'ask_user_question'
      const question = event.request?.questions?.[0]?.question
        ?? event.request?.questions?.[0]?.header
        ?? '等待回答'
      session.detail = truncate(question, 50)
      session.attention = true
      session.lastActivityAt = Date.now()
      pushActivity(session, 'status', `提问：${truncate(question, 40)}`)
      break
    }
    case 'exit_plan_mode_request': {
      const session = ensureSession(sessionId)
      session.phase = 'needs-interaction'
      session.interactionKind = 'plan_review'
      session.detail = '等待计划审批'
      session.attention = true
      session.lastActivityAt = Date.now()
      pushActivity(session, 'status', '等待计划审批')
      break
    }
    case 'permission_resolved':
    case 'ask_user_resolved':
    case 'exit_plan_mode_resolved': {
      const session = sessions.get(sessionId)
      if (session && session.phase === 'needs-interaction') {
        session.phase = 'running'
        session.interactionKind = undefined
        session.attention = false
        session.lastActivityAt = Date.now()
        pushActivity(session, 'status', '已响应')
      }
      break
    }
    case 'title_updated': {
      const session = sessions.get(sessionId)
      if (session && event.title) {
        session.title = event.title
      }
      break
    }
    case 'external_run_started':
    case 'run_resumed': {
      const session = ensureSession(sessionId)
      session.phase = 'running'
      session.attention = false
      session.lastActivityAt = Date.now()
      break
    }
    case 'retry': {
      const session = sessions.get(sessionId)
      if (session) {
        session.phase = 'running'
        session.detail = event.status === 'attempt' ? `重试第 ${event.attempt ?? 1} 次` : '等待重试…'
        session.lastActivityAt = Date.now()
      }
      break
    }
    case 'enter_plan_mode':
    case 'plan_mode_changed':
    case 'model_resolved':
    case 'context_window':
    case 'permission_mode_changed':
    case 'automation_graduated': {
      const session = sessions.get(sessionId)
      if (session) session.lastActivityAt = Date.now()
      break
    }
    default:
      break
  }
}

function handleSdkMessage(sessionId: string, message: import('@proma/shared').SDKMessage): void {
  switch (message.type) {
    case 'assistant': {
      const aMsg = message as import('@proma/shared').SDKAssistantMessage
      if (aMsg.isReplay) return
      if (aMsg.error) {
        const session = ensureSession(sessionId)
        session.phase = 'error'
        session.detail = truncate(aMsg.error.message || '发生错误', 60)
        session.unread = true
        session.attention = true
        session.terminalAt = Date.now()
        session.lastActivityAt = Date.now()
        pushActivity(session, 'status', `❌ ${truncate(aMsg.error.message || '错误', 50)}`)
        return
      }
      const session = ensureSession(sessionId)
      session.phase = 'running'
      session.lastActivityAt = Date.now()
      for (const block of aMsg.message.content ?? []) {
        if (block.type === 'text' && 'text' in block) {
          const text = (block as { text: string }).text
          if (text) session.detail = truncate(text, 60)
        } else if (block.type === 'tool_use') {
          const tb = block as { name?: string; input?: Record<string, unknown> }
          const toolName = (tb.input?.['_displayName'] as string | undefined) || tb.name || '工具'
          setToolDetail(session, toolName)
          pushActivity(session, 'tool', `使用 ${toolName}`)
        }
      }
      break
    }
    case 'user': {
      const uMsg = message as import('@proma/shared').SDKUserMessage
      const session = sessions.get(sessionId)
      if (!session) break
      const content = uMsg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && 'is_error' in block) {
            const tb = block as { is_error?: boolean }
            if (tb.is_error) {
              session.detail = '工具执行出错'
              pushActivity(session, 'status', '工具执行出错')
            }
          }
        }
      }
      session.lastActivityAt = Date.now()
      break
    }
    case 'result': {
      const rMsg = message as import('@proma/shared').SDKResultMessage
      const session = ensureSession(sessionId)
      if (rMsg.subtype === 'success') {
        session.phase = 'completed'
        session.detail = '已完成'
        session.unread = true
        session.attention = true
        session.terminalAt = Date.now()
        pushActivity(session, 'status', '✅ 任务完成')
      } else {
        session.phase = 'error'
        session.detail = truncate(rMsg.errors?.[0] || rMsg.terminal_reason || '执行出错', 60)
        session.unread = true
        session.attention = true
        session.terminalAt = Date.now()
        pushActivity(session, 'status', `❌ ${truncate(rMsg.errors?.[0] || rMsg.terminal_reason || '错误', 50)}`)
      }
      session.lastActivityAt = Date.now()
      break
    }
    case 'system': {
      const sMsg = message as import('@proma/shared').SDKSystemMessage
      const session = ensureSession(sessionId)
      switch (sMsg.subtype) {
        case 'task_started': {
          session.phase = 'running'
          session.detail = `子任务：${truncate(sMsg.description || '', 40)}`
          pushActivity(session, 'tool', `启动子任务：${truncate(sMsg.description || '', 40)}`)
          break
        }
        case 'task_progress': {
          session.phase = 'running'
          session.detail = sMsg.description
            ? `子任务：${truncate(sMsg.description, 40)}`
            : (sMsg.last_tool_name ? `子任务正在 ${sMsg.last_tool_name}` : '')
          break
        }
        case 'task_notification': {
          if (sMsg.status === 'completed') {
            pushActivity(session, 'status', '子任务完成')
          } else if (sMsg.status === 'failed' || sMsg.status === 'stopped') {
            session.detail = '子任务已结束'
            pushActivity(session, 'status', `子任务${sMsg.status === 'failed' ? '失败' : '已停止'}`)
          }
          break
        }
        case 'compact_boundary': {
          session.detail = '正在压缩上下文…'
          pushActivity(session, 'status', '上下文压缩')
          break
        }
        case 'permission_denied': {
          session.phase = 'needs-interaction'
          session.interactionKind = 'permission'
          session.detail = '权限被拒绝'
          session.attention = true
          pushActivity(session, 'status', '权限被拒绝')
          break
        }
        case 'init':
        case 'thinking_tokens':
        default:
          break
      }
      session.lastActivityAt = Date.now()
      break
    }
    case 'tool_progress': {
      const session = ensureSession(sessionId)
      session.phase = 'running'
      session.lastActivityAt = Date.now()
      break
    }
    case 'prompt_suggestion':
    case 'tool_use_summary':
    default:
      break
  }
}

// ===== pill 聚合 =====

function isAttentionSession(session: InternalSessionSnapshot, now: number): boolean {
  if (now - session.lastActivityAt >= 24 * 60 * 60_000) return false
  if (session.phase === 'needs-interaction' || session.phase === 'error') return true
  return session.phase === 'completed'
    && session.unread
    && session.terminalAt !== undefined
    && now - session.terminalAt < UNREAD_RETAIN_MS
}

function attentionScore(session: InternalSessionSnapshot): number {
  if (session.phase === 'needs-interaction') return 3
  if (session.phase === 'error') return 2
  if (session.phase === 'completed') return 1
  return 0
}

function buildPill(now: number): AgentIslandPillSnapshot {
  // 普通 running 不打扰：岛只表达“请用户接手”的 Agent 信号。
  const attention = [...sessions.values()].filter((session) => isAttentionSession(session, now))
  const pendingInteraction = attention.filter((session) => session.phase === 'needs-interaction').length
  const unread = attention.filter((session) => session.phase === 'completed').length
  const prioritySession = attention
    .sort((a, b) => attentionScore(b) - attentionScore(a) || b.lastActivityAt - a.lastActivityAt)[0]

  return {
    priorityStatus: prioritySession?.phase ?? 'idle',
    sessionCount: attention.length,
    activeSessionCount: pendingInteraction,
    pendingInteractionCount: pendingInteraction,
    unreadCompletedCount: unread,
  }
}

function buildState(now: number): AgentIslandState {
  // 常规运行不占据顶部空间；只投影“阻塞、异常、尚未查阅的完成”。
  const retained = [...sessions.values()]
    .filter((session) => isAttentionSession(session, now))
    .sort((a, b) => attentionScore(b) - attentionScore(a) || b.lastActivityAt - a.lastActivityAt)

  const sessionsOut = retained.map((s) => {
    const out: AgentIslandSessionSnapshot = {
      sessionId: s.sessionId,
      title: s.title,
      phase: s.phase,
      interactionKind: s.interactionKind,
      detail: s.detail,
      activityLines: s.activityLines.slice(-MAX_PUSHED_ACTIVITY_LINES),
      attention: s.attention,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
    }
    return out
  })

  return {
    visible: true,
    presentation: isExpanded() ? 'expanded' : 'compact',
    expanded: isExpanded(),
    pill: buildPill(now),
    sessions: sessionsOut,
    totalCount: sessionsOut.length,
    // 避免 running 的高频 token 流造成隐藏岛的无效重绘。
    updatedAt: Math.max(0, ...sessionsOut.map((session) => session.lastActivityAt)),
  }
}

function buildPlanningSnapshot(now: number): AgentIslandPlanningSnapshot {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const dayStart = today.getTime()
  const dayEnd = dayStart + 24 * 60 * 60_000
  const todos = listTodos({ status: 'open' })
    .filter((todo) => todo.dueAt !== undefined && todo.dueAt < dayEnd)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  const events = listCalendarEvents({ from: dayStart, to: dayEnd })
    .sort((a, b) => a.startAt - b.startAt)

  return {
    dayStart,
    dayEnd,
    overdueTodoCount: todos.filter((todo) => (todo.dueAt ?? Number.POSITIVE_INFINITY) < now).length,
    todos: todos.slice(0, 3).map((todo) => ({
      id: todo.id,
      title: todo.title,
      dueAt: todo.dueAt,
      priority: todo.priority,
      isOverdue: (todo.dueAt ?? Number.POSITIVE_INFINITY) < now,
    })),
    events: events.slice(0, 3).map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
    })),
  }
}

function isImminent(timestamp: number | undefined, now: number): boolean {
  return timestamp !== undefined
    && timestamp >= now
    && timestamp <= now + PLANNING_ATTENTION_WINDOW_MS
}

function getImminentPlanningKeys(now: number): string[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const dayStart = today.getTime()
  const dayEnd = dayStart + 24 * 60 * 60_000
  // 不依赖 UI 的前三条投影：多条逾期 Todo 不能遮蔽稍后临近的第四条事项。
  return [
    ...listTodos({ status: 'open' })
      .filter((todo) => isImminent(todo.dueAt, now))
      .map((todo) => `t:${todo.id}:${todo.dueAt}`),
    ...listCalendarEvents({ from: dayStart, to: dayEnd })
      .filter((event) => isImminent(event.startAt, now))
      .map((event) => `e:${event.id}:${event.startAt}`),
  ]
}

function buildVisibilityKey(state: AgentIslandState, planningKeys: string[]): string {
  const agentKey = state.sessions
    .map((session) => `${session.sessionId}:${session.phase}:${session.lastActivityAt}:${session.detail}`)
    .join('|')
  return `${agentKey}#${planningKeys.join('|')}`
}

function isIslandVisible(state: AgentIslandState, planningKeys: string[]): boolean {
  const requiresAgentHandoff = state.sessions.length > 0
  if (!requiresAgentHandoff && planningKeys.length === 0) return false

  currentVisibilityKey = buildVisibilityKey(state, planningKeys)
  return currentVisibilityKey !== dismissedVisibilityKey
}

function buildNativeSnapshot(state: AgentIslandState, planning: AgentIslandPlanningSnapshot): NativeAgentIslandSnapshot {
  return {
    type: 'snapshot',
    protocol: 1,
    revision: ++nativeRevision,
    state,
    planning,
  }
}

// ===== 推送 =====

function pushState(): void {
  const now = Date.now()
  const planning = buildPlanningSnapshot(now)
  const state = buildState(now)
  const enabled = serviceDeps?.enabled?.() !== false
  state.visible = enabled && isIslandVisible(state, getImminentPlanningKeys(now))
  state.presentation = state.visible ? (isExpanded() ? 'expanded' : 'compact') : 'hidden'
  // Planning 独立 revision 解决“同一毫秒内 Todo 变更而 Agent state.updatedAt 恰好相同”的漏推边界。
  const json = JSON.stringify({ state, planning, planningRevision, dismissedVisibilityKey })
  // 状态无变化时跳过，避免无谓 IPC 与原生 helper 写入。
  if (json === lastStateJson) return
  lastStateJson = json

  // macOS 原生 helper 准备就绪后是唯一 surface；它读取由主进程投影的 Todo/日程。
  if (isMacAgentIslandNativeHostReady()) {
    publishMacAgentIslandSnapshot(buildNativeSnapshot(state, planning))
    return
  }

  // 非 macOS、helper 缺失或运行失败时，保留 Electron 版本作为降级体验。
  const win = getAgentIslandWindow()
  if (!win || win.isDestroyed()) return
  if (!win.webContents.isDestroyed()) win.webContents.send(AGENT_ISLAND_IPC_CHANNELS.STATE, state)
  if (state.visible) showAgentIslandWindow()
  else hideAgentIslandWindow()
}

function scheduleNextPlanningRollover(): void {
  if (planningRolloverTimer) clearTimeout(planningRolloverTimer)
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 150)
  planningRolloverTimer = setTimeout(() => {
    planningRolloverTimer = null
    planningRevision += 1
    dismissedVisibilityKey = null
    schedulePush()
    scheduleNextPlanningRollover()
    scheduleNextPlanningAttention()
  }, Math.max(1_000, tomorrow.getTime() - Date.now()))
}

/** 让未来事项恰好进入“1 小时内”时自动唤起，而不是等待数据库下一次变更。 */
function scheduleNextPlanningAttention(): void {
  if (planningAttentionTimer) clearTimeout(planningAttentionTimer)
  const now = Date.now()
  const thresholdCandidates = [
    ...listTodos({ status: 'open' }).map((todo) => todo.dueAt),
    ...listCalendarEvents({ from: now, to: now + 14 * 24 * 60 * 60_000 }).map((event) => event.startAt),
  ]
    .filter((timestamp): timestamp is number => timestamp !== undefined)
    .flatMap((timestamp) => [
      timestamp - PLANNING_ATTENTION_WINDOW_MS, // 进入“临近 1 小时”
      timestamp + 25, // 到点后退出该被动常驻区间
    ])
    .filter((threshold) => threshold > now)
  const next = Math.min(...thresholdCandidates)
  if (!Number.isFinite(next)) return
  planningAttentionTimer = setTimeout(() => {
    planningAttentionTimer = null
    planningRevision += 1
    schedulePush()
    scheduleNextPlanningAttention()
  }, Math.max(1_000, next - now + 25))
}

function schedulePush(): void {
  const now = Date.now()
  if (now - lastPushAt >= PUSH_THROTTLE_MS) {
    lastPushAt = now
    pushState()
    return
  }
  if (pushTimer) return
  const remaining = PUSH_THROTTLE_MS - (now - lastPushAt)
  pushTimer = setTimeout(() => {
    pushTimer = null
    lastPushAt = Date.now()
    pushState()
  }, remaining)
}

// ===== 事件订阅与初始化 =====

let disposeEventBus: (() => void) | null = null

export interface AgentIslandServiceDeps {
  /** 打开/聚焦主窗口（点击灵动岛卡片时） */
  showAndFocusMainWindow: () => void
  /** 打开指定 Agent 会话（转发到主窗口渲染进程） */
  openAgentSession: (sessionId: string, title: string) => void
  /** 打开独立 Planning 窗口（原生岛的日程入口）。 */
  openPlanning?: () => void
  /** 是否允许启用灵动岛（如设置开关） */
  enabled?: () => boolean
}

export function initAgentIslandService(deps: AgentIslandServiceDeps): void {
  if (initialized) return
  initialized = true
  serviceDeps = deps

  // 原生岛没有 renderer planning IPC，因此复用统一失效广播刷新投影。
  disposePlanningListener = onPlanningChanged((change) => {
    if (change.resources.includes('todos') || change.resources.includes('calendar_events')) {
      planningRevision += 1
      dismissedVisibilityKey = null
      schedulePush()
      scheduleNextPlanningAttention()
    }
  })
  scheduleNextPlanningRollover()
  scheduleNextPlanningAttention()

  // 订阅 Agent 事件流
  disposeEventBus = agentEventBus.on((sessionId, payload) => {
    if (deps.enabled?.() === false) return
    handleAgentEvent(sessionId, payload)
    schedulePush()
  })

  // 灵动岛窗口渲染就绪后补推一次状态
  onAgentIslandWindowReady(() => {
    lastStateJson = ''
    pushState()
  })

  // 灵动岛窗口 IPC
  ipcMain.handle(AGENT_ISLAND_IPC_CHANNELS.SET_EXPANDED, (_event, next: unknown) => {
    if (typeof next === 'boolean') setAgentIslandExpanded(next)
  })

  ipcMain.handle(AGENT_ISLAND_IPC_CHANNELS.RESIZE, (_event, req: { width: number; height: number }) => {
    if (typeof req?.width === 'number' && typeof req?.height === 'number') {
      resizeAgentIslandWindow(req.width, req.height)
    }
  })

  ipcMain.handle(AGENT_ISLAND_IPC_CHANNELS.MOVE, (_event, req: { x: number; y: number }) => {
    if (typeof req?.x === 'number' && typeof req?.y === 'number') {
      moveAgentIslandWindow(req.x, req.y)
    }
  })

  ipcMain.handle(AGENT_ISLAND_IPC_CHANNELS.OPEN_MAIN_WINDOW, () => {
    deps.showAndFocusMainWindow()
  })

  ipcMain.handle(AGENT_ISLAND_IPC_CHANNELS.OPEN_SESSION, (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    openAgentIslandSession(sessionId)
  })
}

function openAgentIslandSession(sessionId: string): void {
  if (!serviceDeps) return
  const session = sessions.get(sessionId)
  // “完成但未检查”在用户进入对应会话后即视为已检查；异常/阻塞仍保留直到状态改变。
  if (session?.phase === 'completed' && session.unread) {
    session.unread = false
    session.attention = false
  }
  serviceDeps.openAgentSession(sessionId, session?.title ?? getTitle(sessionId))
  serviceDeps.showAndFocusMainWindow()
  schedulePush()
}

function isExpanded(): boolean {
  return manuallyExpanded || hoverExpanded
}

export function setAgentIslandExpanded(next: boolean): void {
  if (manuallyExpanded === next && (next || !hoverExpanded)) return
  manuallyExpanded = next
  // An explicit collapse wins over the current hover. The next leave/re-enter
  // cycle may reopen it, but a click must never appear to have been ignored.
  if (!next) {
    hoverExpanded = false
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
  }
  schedulePush()
}

/** 受限的原生 hover intent：延迟处理并与用户点按的 pinned 状态合并。 */
export function setAgentIslandHovered(hovered: boolean): void {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    if (hoverExpanded === hovered) return
    hoverExpanded = hovered
    schedulePush()
  }, hovered ? HOVER_EXPAND_DELAY_MS : HOVER_COLLAPSE_DELAY_MS)
}

/** 立即推送一次当前状态（窗口创建/重新显示后调用） */
export function publishAgentIslandNow(): void {
  lastStateJson = ''
  lastPushAt = 0
  pushState()
}

/** 设置更新后立即投影，避免等待下一条 Agent 或 Planning 事件。 */
export function refreshAgentIslandConfiguration(): void {
  lastStateJson = ''
  lastPushAt = 0
  pushState()
}

export function isAgentIslandExpanded(): boolean {
  return isExpanded()
}

/** 关闭当前这一批提醒；新的临近事项或新的 Agent 阻塞会自动重新出现。 */
export function dismissAgentIsland(): void {
  if (!currentVisibilityKey) return
  dismissedVisibilityKey = currentVisibilityKey
  manuallyExpanded = false
  hoverExpanded = false
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  lastStateJson = ''
  schedulePush()
}

/** 原生 Swift helper 的意图入口；只允许映射到既有主进程行为。 */
export function handleNativeAgentIslandEvent(event: NativeAgentIslandEvent): void {
  if (event.type !== 'intent' || !serviceDeps) return
  switch (event.name) {
    case 'set-expanded':
      setAgentIslandExpanded(event.expanded)
      break
    case 'set-hovered':
      setAgentIslandHovered(event.hovered)
      break
    case 'open-main':
      serviceDeps.showAndFocusMainWindow()
      break
    case 'open-session':
      openAgentIslandSession(event.sessionId)
      break
    case 'open-planning':
      serviceDeps.openPlanning?.()
      break
    case 'dismiss':
      dismissAgentIsland()
      break
  }
}

export function disposeAgentIslandService(): void {
  disposeEventBus?.()
  disposeEventBus = null
  disposePlanningListener?.()
  disposePlanningListener = null
  if (planningRolloverTimer) clearTimeout(planningRolloverTimer)
  planningRolloverTimer = null
  if (planningAttentionTimer) clearTimeout(planningAttentionTimer)
  planningAttentionTimer = null
  dismissedVisibilityKey = null
  currentVisibilityKey = ''
  serviceDeps = null
  initialized = false
  sessions.clear()
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  manuallyExpanded = false
  hoverExpanded = false
  lastStateJson = ''
}
