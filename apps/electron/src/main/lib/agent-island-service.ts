/**
 * Agent Island 灵动岛服务（主进程状态机）
 *
 * 订阅 AgentEventBus，把每个 Agent 会话的流式事件折叠成灵动岛会话快照
 * （phase / detail / activityLines / attention），聚合 pill 摘要后投影给 macOS 原生 helper。
 *
 * 设计参考 Cindy (makecindy/cindy) 的 AgentIslandService：
 * - TypeScript 主进程拥有产品状态（事件 → 状态机），渲染层只负责绘制
 * - phase: idle / running / needs-interaction / completed / error
 * - 显示策略按状态分层：日常 running 不打扰，等待交互才醒目
 *
 * Todo / 日程部分由渲染进程通过已有的 planning IPC 自行拉取与订阅，
 * 本服务只负责 Agent 会话状态，保持职责单一。
 */

import {
  type AgentIslandActivityLine,
  type AgentIslandPillSnapshot,
  type AgentIslandSessionSnapshot,
  type AgentIslandState,
  type AgentIslandPlanningSnapshot,
  type AgentIslandPlanQuotaSnapshot,
  type NativeAgentIslandEvent,
  type NativeAgentIslandSnapshot,
} from '@proma/shared'
import type { AgentStreamPayload } from '@proma/shared'
import { agentEventBus } from './agent-service'
import { getAgentSessionMeta, listAgentSessions } from './agent-session-manager'
import { isMacAgentIslandNativeHostReady, publishMacAgentIslandSnapshot } from './mac-agent-island-native-host'
import { getAgentIslandTodoAttentionKeys, selectAgentIslandTodos } from './agent-island-planning'
import { selectAgentIslandCompactPlanQuota } from './agent-island-plan-quota'
import { getAgentIslandPhasePriority } from './agent-island-priority'
import { buildVisibilityKey } from './agent-island-visibility'
import { shouldRetainAgentIslandSession } from './agent-island-session-visibility'
import { getWindowsAgentIslandSurface } from './windows-agent-island-surface'
import { listCalendarEvents, listTodos } from './planning-manager'
import { onPlanningChanged } from './planning-events'
import { getChannelPlanQuota, listChannels } from './channel-manager'

/** 会话快照保留的最大活动行数 */
const MAX_ACTIVITY_LINES = 6
/** 会话快照保留的最近活动行数（推给窗口的） */
const MAX_PUSHED_ACTIVITY_LINES = 4
/** 完成/错误后保留 attention（未读）的时间，也作为 terminal 会话在列表中的存活期 */
const UNREAD_RETAIN_MS = 10 * 60_000
/** 无 Agent 需接手时，仅在 Todo 截止/日程开始前这一窗口显示。 */
const PLANNING_ATTENTION_WINDOW_MS = 60 * 60_000
/** 交互、计划变更等需要即时反馈的推送节流间隔。 */
const PUSH_THROTTLE_MS = 80
/** 普通 Agent 流事件只需低频合并；状态页不展示 token / 工具流水。 */
const AGENT_STREAM_PUSH_THROTTLE_MS = 2_000
/** 订阅 Plan 额度的后台刷新间隔；轮播在 Swift 本地完成，无需频繁网络请求。 */
const PLAN_QUOTA_REFRESH_MS = 5 * 60_000
const PLAN_QUOTA_PROVIDERS = new Set(['openai-codex', 'deepseek', 'kimi-coding', 'minimax', 'zhipu', 'zhipu-coding', 'zhipu-coding-team'])
/** Hover 只是一种临时展开意图，避免 Swift 渲染层自行维护状态机。 */
// macOS's notch lies directly in a common pointer travel path; a longer dwell
// time prevents accidental expansion while still leaving deliberate hover quick.
const HOVER_EXPAND_DELAY_MS = process.platform === 'darwin' ? 300 : 130
const HOVER_COLLAPSE_DELAY_MS = 420

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
/** 即时 pointer 反馈，不等待展开延迟。 */
let pointerHovered = false
let hoverTimer: ReturnType<typeof setTimeout> | null = null
const sessions = new Map<string, InternalSessionSnapshot>()
let pushTimer: ReturnType<typeof setTimeout> | null = null
let scheduledPushAt = 0
let lastPushAt = 0
let lastStateJson = ''
let nativeRevision = 0
let planningRevision = 0
let planningRolloverTimer: ReturnType<typeof setTimeout> | null = null
let planningAttentionTimer: ReturnType<typeof setTimeout> | null = null
let planQuotaRefreshTimer: ReturnType<typeof setTimeout> | null = null
let planQuotas: AgentIslandPlanQuotaSnapshot[] = []
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

/** 协作子会话的结果由父会话汇总，不进入用户级未读收件箱。 */
function isDelegatedChildSession(sessionId: string): boolean {
  try {
    return Boolean(getAgentSessionMeta(sessionId)?.sourceDelegationId)
  } catch {
    return false
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
  } else if (payload.kind === 'sdk_message') {
    handleSdkMessage(sessionId, payload.message)
  } else {
    // Delta 仅用于 renderer 的实时内容；灵动岛等待终态 SDK message 更新。
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
    case 'external_run_started': {
      const session = ensureSession(sessionId)
      session.startedAt = event.startedAt
      session.phase = 'running'
      session.attention = false
      session.lastActivityAt = Date.now()
      break
    }
    case 'run_started': {
      const session = ensureSession(sessionId)
      session.startedAt = event.startedAt
      session.phase = 'running'
      session.attention = false
      session.lastActivityAt = Date.now()
      break
    }
    case 'run_resumed': {
      const session = ensureSession(sessionId)
      session.phase = 'running'
      session.attention = false
      session.lastActivityAt = Date.now()
      break
    }
    case 'run_stopped': {
      const session = sessions.get(sessionId)
      // A delayed completion from an older run must never clear a newer one.
      if (!session || (event.startedAt != null && session.startedAt !== event.startedAt)) break
      // A user cancellation is terminal for the current run, but it is not an
      // error or a completed result that needs attention. Keep it out of the
      // island immediately instead of leaving the previous running snapshot.
      session.phase = 'completed'
      session.detail = '已中断'
      session.interactionKind = undefined
      session.attention = false
      session.unread = false
      session.terminalAt = Date.now()
      session.lastActivityAt = Date.now()
      pushActivity(session, 'status', '任务已中断')
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
        const isChildSession = isDelegatedChildSession(sessionId)
        session.phase = 'error'
        session.detail = truncate(aMsg.error.message || '发生错误', 60)
        session.unread = !isChildSession
        session.attention = !isChildSession
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
      const isChildSession = isDelegatedChildSession(sessionId)
      if (rMsg.subtype === 'success') {
        session.phase = 'completed'
        session.detail = '已完成'
        session.unread = !isChildSession
        session.attention = !isChildSession
        session.terminalAt = Date.now()
        pushActivity(session, 'status', '✅ 任务完成')
      } else {
        session.phase = 'error'
        session.detail = truncate(rMsg.errors?.[0] || rMsg.terminal_reason || '执行出错', 60)
        session.unread = !isChildSession
        session.attention = !isChildSession
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

function isIslandSession(session: InternalSessionSnapshot, now: number): boolean {
  if (now - session.lastActivityAt >= 24 * 60 * 60_000) return false
  // 委派子会话只在需要用户交互时露出；执行和结束均由父会话收敛。
  if (isDelegatedChildSession(session.sessionId)) return session.phase === 'needs-interaction'
  // Running is deliberately visible: the island is also a live execution pulse,
  // not only a handoff/error inbox. Viewed errors leave the Island immediately,
  // while completed sessions retain their unread window to avoid permanent history.
  return shouldRetainAgentIslandSession(session, now, UNREAD_RETAIN_MS)
}

function attentionScore(session: InternalSessionSnapshot): number {
  return getAgentIslandPhasePriority(session.phase)
}

function compareIslandSessions(a: InternalSessionSnapshot, b: InternalSessionSnapshot): number {
  // Activity timestamps change on every streamed token/tool result. Sorting by
  // them makes rows continually swap places; only semantic priority may reorder.
  return attentionScore(b) - attentionScore(a)
    || a.startedAt - b.startedAt
    || a.sessionId.localeCompare(b.sessionId)
}

function buildPill(now: number): AgentIslandPillSnapshot {
  const visibleSessions = [...sessions.values()].filter((session) => isIslandSession(session, now))
  const pendingInteraction = visibleSessions.filter((session) => session.phase === 'needs-interaction').length
  const unread = visibleSessions.filter((session) => session.phase === 'completed').length
  const active = visibleSessions.filter((session) => session.phase === 'running' || session.phase === 'needs-interaction').length
  const prioritySession = visibleSessions.sort(compareIslandSessions)[0]

  return {
    priorityStatus: prioritySession?.phase ?? 'idle',
    sessionCount: visibleSessions.length,
    activeSessionCount: active,
    pendingInteractionCount: pendingInteraction,
    unreadCompletedCount: unread,
  }
}

function buildState(now: number): AgentIslandState {
  // 投影正在运行、阻塞、异常及尚未查阅的完成会话。
  const retained = [...sessions.values()]
    .filter((session) => isIslandSession(session, now))
    .sort(compareIslandSessions)

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

  // Once no live status needs attention, provide a lightweight persistent
  // launchpad from the session index. It deliberately does not affect pill
  // counts or Agent priority semantics.
  const recentSessions = sessionsOut.length === 0
    ? listAgentSessions()
      .filter((session) => !session.archived)
      .slice(0, 3)
      .map((session): AgentIslandSessionSnapshot => ({
        sessionId: session.id,
        title: session.title.trim() || session.id.slice(0, 8),
        phase: 'completed',
        detail: '最近会话',
        activityLines: [],
        attention: false,
        startedAt: session.createdAt,
        lastActivityAt: session.updatedAt,
      }))
    : []

  return {
    visible: true,
    presentation: isExpanded() ? 'expanded' : 'compact',
    hovered: pointerHovered,
    expanded: isExpanded(),
    pill: buildPill(now),
    sessions: sessionsOut,
    recentSessions,
    idleDashboard: false,
    totalCount: sessionsOut.length,
    // 避免 running 的高频 token 流造成隐藏岛的无效重绘。
    updatedAt: Math.max(0, ...sessionsOut.map((session) => session.lastActivityAt), ...recentSessions.map((session) => session.lastActivityAt)),
  }
}

/**
 * 收起态优先给最需要处理的运行中会话展示额度；会话列表已按语义优先级稳定排序。
 * 未读完成/错误会话不是“当前渠道”，不应挤占正在运行 Agent 的额度位置。
 */
function buildCompactPlanQuota(state: AgentIslandState): AgentIslandState['compactPlanQuota'] {
  const activeChannelIds = state.sessions
    .filter((session) => session.phase === 'running' || session.phase === 'needs-interaction')
    .flatMap((session) => {
      try {
        const channelId = getAgentSessionMeta(session.sessionId)?.channelId
        return channelId ? [channelId] : []
      } catch {
        return []
      }
    })
  return selectAgentIslandCompactPlanQuota(activeChannelIds, planQuotas)
}

function buildPlanningSnapshot(now: number): AgentIslandPlanningSnapshot {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const dayStart = today.getTime()
  const dayEnd = dayStart + 24 * 60 * 60_000
  const allTodayTodos = listTodos({ status: 'open' })
    .filter((todo) => todo.dueAt !== undefined && todo.dueAt < dayEnd)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  // 逾期事项必须优先于未来事项；否则 Island 会在最需要提醒时变成空面板。
  const todos = selectAgentIslandTodos(listTodos({ status: 'open' }), now)
  const events = listCalendarEvents({ from: dayStart })
    // Keep an event visible while it is in progress, not only before its start.
    // All-day items without an explicit end remain active through their day.
    .filter((event) => (event.allDay ? dayEnd : (event.endAt ?? event.startAt)) >= now)
    .sort((a, b) => a.startAt - b.startAt)

  return {
    dayStart,
    dayEnd,
    overdueTodoCount: allTodayTodos.filter((todo) => (todo.dueAt ?? Number.POSITIVE_INFINITY) < now).length,
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
  // 逾期项也必须维持 Island 可见，直到用户明确关闭或完成它。
  return [
    ...getAgentIslandTodoAttentionKeys(listTodos({ status: 'open' }), now, PLANNING_ATTENTION_WINDOW_MS),
    ...listCalendarEvents({ from: dayStart, to: dayEnd })
      .filter((event) => isImminent(event.startAt, now))
      .map((event) => `e:${event.id}:${event.startAt}`),
  ]
}

function isIslandVisible(state: AgentIslandState, planningKeys: string[]): boolean {
  const requiresAgentHandoff = state.sessions.length > 0
  if (!requiresAgentHandoff && planningKeys.length === 0 && !state.idleDashboard) return false

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
    planQuotas,
  }
}

// ===== 推送 =====

function pushState(): void {
  const now = Date.now()
  const planning = buildPlanningSnapshot(now)
  const planningKeys = getImminentPlanningKeys(now)
  const state = buildState(now)
  state.compactPlanQuota = buildCompactPlanQuota(state)
  // The idle dashboard is a true home surface: it remains visible even for a
  // new user without any recorded Agent session. Future items do not displace
  // it; only live Agent work or imminent plans take priority.
  state.idleDashboard = state.sessions.length === 0 && planningKeys.length === 0
  const enabled = serviceDeps?.enabled?.() !== false
  state.visible = enabled && isIslandVisible(state, planningKeys)
  state.presentation = state.visible ? (isExpanded() ? 'expanded' : 'compact') : 'hidden'
  // Planning 独立 revision 解决“同一毫秒内 Todo 变更而 Agent state.updatedAt 恰好相同”的漏推边界。
  const json = JSON.stringify({ state, planning, planQuotas, planningRevision, dismissedVisibilityKey })
  // 状态无变化时跳过，避免无谓 IPC 与原生 helper 写入。
  if (json === lastStateJson) return
  lastStateJson = json

  const snapshot = buildNativeSnapshot(state, planning)

  if (isMacAgentIslandNativeHostReady()) {
    publishMacAgentIslandSnapshot(snapshot)
  }

  if (process.platform === 'win32') {
    publishWindowsAgentIslandSnapshot(snapshot)
  }
}

function publishWindowsAgentIslandSnapshot(snapshot: NativeAgentIslandSnapshot): void {
  getWindowsAgentIslandSurface().onSnapshot(snapshot)
}

/**
 * Todo/日程操作已经在数据库提交后才广播，因此不应再等待 Agent 流的 80ms
 * 合并窗口；直接把最新投影交给原生岛，避免完成/改期后的陈旧信息残留。
 */
function pushPlanningStateImmediately(): void {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  lastPushAt = Date.now()
  pushState()
}

async function refreshPlanQuotas(): Promise<void> {
  const supportedChannels = listChannels().filter((channel) => channel.enabled && PLAN_QUOTA_PROVIDERS.has(channel.provider))
  try {
    const results = await Promise.all(supportedChannels.map(async (channel) => ({ channel, quota: await getChannelPlanQuota(channel.id) })))
    const next = results.flatMap(({ channel, quota }) => {
      if (!quota.supported || quota.windows.length === 0) return []
      return [{
        channelId: channel.id,
        channelName: channel.name,
        planName: quota.planName || channel.name,
        windows: quota.windows.map((window) => ({
          windowType: window.type,
          windowLabel: window.label,
          remainingPercent: window.remainingPercent,
          remainingLabel: window.remainingLabel,
        })),
      }]
    })
    if (JSON.stringify(next) !== JSON.stringify(planQuotas)) {
      planQuotas = next
      schedulePush()
    }
  } catch {
    // Quota is supplemental island content: preserve the last known value and
    // never allow a provider/network failure to affect reminders or Agent state.
  } finally {
    if (initialized) {
      if (planQuotaRefreshTimer) clearTimeout(planQuotaRefreshTimer)
      planQuotaRefreshTimer = setTimeout(() => void refreshPlanQuotas(), PLAN_QUOTA_REFRESH_MS)
    }
  }
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

function schedulePush(throttleMs = PUSH_THROTTLE_MS): void {
  const now = Date.now()
  const dueAt = lastPushAt + throttleMs
  if (now >= dueAt) {
    if (pushTimer) {
      clearTimeout(pushTimer)
      pushTimer = null
      scheduledPushAt = 0
    }
    lastPushAt = now
    pushState()
    return
  }

  // A newly urgent change may preempt a pending low-priority stream refresh.
  if (pushTimer && scheduledPushAt <= dueAt) return
  if (pushTimer) clearTimeout(pushTimer)
  scheduledPushAt = dueAt
  pushTimer = setTimeout(() => {
    pushTimer = null
    scheduledPushAt = 0
    lastPushAt = Date.now()
    pushState()
  }, dueAt - now)
}

function requiresImmediateAgentIslandPush(payload: AgentStreamPayload): boolean {
  if (payload.kind === 'proma_event') {
    return ['permission_request', 'ask_user_request', 'exit_plan_mode_request', 'run_stopped'].includes(payload.event.type)
  }
  if (payload.kind !== 'sdk_message') return false
  const message = payload.message
  return message.type === 'result' || (message.type === 'assistant' && Boolean((message as import('@proma/shared').SDKAssistantMessage).error))
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
      pushPlanningStateImmediately()
      scheduleNextPlanningAttention()
    }
  })
  scheduleNextPlanningRollover()
  scheduleNextPlanningAttention()
  void refreshPlanQuotas()

  // 订阅 Agent 事件流
  disposeEventBus = agentEventBus.on((sessionId, payload) => {
    handleAgentEvent(sessionId, payload)
    schedulePush(requiresImmediateAgentIslandPush(payload) ? PUSH_THROTTLE_MS : AGENT_STREAM_PUSH_THROTTLE_MS)
  })
}

/**
 * 完成和异常态的未读由主进程管理；主应用确认用户已经看过后，在此统一清除。
 * 待接手会话仍保持 attention，直到用户实际完成权限确认、回答或计划审批。
 */
export function markAgentIslandSessionViewed(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session || (session.phase !== 'completed' && session.phase !== 'error')) return
  if (session.phase === 'completed' && !session.unread) return
  if (!session.attention && !session.unread) return
  session.unread = false
  session.attention = false
  schedulePush()
}

function openAgentIslandSession(sessionId: string): void {
  if (!serviceDeps) return
  const session = sessions.get(sessionId)
  markAgentIslandSessionViewed(sessionId)
  serviceDeps.openAgentSession(sessionId, session?.title ?? getTitle(sessionId))
  serviceDeps.showAndFocusMainWindow()
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
  const hoverChanged = pointerHovered !== hovered
  pointerHovered = hovered
  if (hoverTimer) clearTimeout(hoverTimer)
  // Highlight reacts on the first pointer transition; expansion follows only
  // after the intent delay so the island never feels jumpy while crossing it.
  if (hoverChanged) schedulePush()
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    if (hoverExpanded === hovered) return
    hoverExpanded = hovered
    schedulePush()
  }, hovered ? HOVER_EXPAND_DELAY_MS : HOVER_COLLAPSE_DELAY_MS)
}

/** 立即推送一次当前状态（窗口创建/重新显示后调用） */
export function publishAgentIslandNow(): void {
  if (!initialized) return
  lastStateJson = ''
  lastPushAt = 0
  pushState()
}

/** 设置更新后立即投影，避免等待下一条 Agent 或 Planning 事件。 */
export function refreshAgentIslandConfiguration(): void {
  if (!initialized) return
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
  pointerHovered = false
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
      // Native islands prefer the focused Planning window, while deployments
      // without that optional surface still retain a useful main-window route.
      if (serviceDeps.openPlanning) serviceDeps.openPlanning()
      else serviceDeps.showAndFocusMainWindow()
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
  if (planQuotaRefreshTimer) clearTimeout(planQuotaRefreshTimer)
  planQuotaRefreshTimer = null
  dismissedVisibilityKey = null
  currentVisibilityKey = ''
  serviceDeps = null
  initialized = false
  sessions.clear()
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  scheduledPushAt = 0
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  manuallyExpanded = false
  hoverExpanded = false
  pointerHovered = false
  lastStateJson = ''
}
