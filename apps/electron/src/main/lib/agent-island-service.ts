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
} from '@proma/shared'
import type { AgentStreamPayload } from '@proma/shared'
import { agentEventBus } from './agent-service'
import { getAgentSessionMeta } from './agent-session-manager'
import { getAgentIslandWindow, onAgentIslandWindowReady, resizeAgentIslandWindow, moveAgentIslandWindow } from './agent-island-window'

/** 会话快照保留的最大活动行数 */
const MAX_ACTIVITY_LINES = 6
/** 会话快照保留的最近活动行数（推给窗口的） */
const MAX_PUSHED_ACTIVITY_LINES = 4
/** 完成/错误后保留 attention（未读）的时间，也作为 terminal 会话在列表中的存活期 */
const UNREAD_RETAIN_MS = 10 * 60_000
/** 推送节流间隔 */
const PUSH_THROTTLE_MS = 80

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
let expanded = false
const sessions = new Map<string, InternalSessionSnapshot>()
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastPushAt = 0
let lastStateJson = ''

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

function buildPill(now: number): AgentIslandPillSnapshot {
  const active = [...sessions.values()].filter((s) => now - s.lastActivityAt < 24 * 60 * 60_000)
  const pendingInteraction = active.filter((s) => s.phase === 'needs-interaction').length
  const unread = active.filter((s) => s.unread && s.terminalAt && now - s.terminalAt < UNREAD_RETAIN_MS).length
  const running = active.filter((s) => s.phase === 'running' || s.phase === 'needs-interaction')

  // 优先会话：等待交互 > 错误 > 完成未读 > 运行中 > 最近活动
  const prioritySession = active
    .filter((s) => now - (s.terminalAt ?? s.lastActivityAt) < UNREAD_RETAIN_MS)
    .sort((a, b) => {
      const score = (s: InternalSessionSnapshot): number => {
        if (s.phase === 'needs-interaction') return 4
        if (s.phase === 'error') return 3
        if (s.phase === 'completed' && s.unread) return 2
        if (s.phase === 'running') return 1
        return 0
      }
      return score(b) - score(a) || b.lastActivityAt - a.lastActivityAt
    })[0]

  return {
    priorityStatus: prioritySession?.phase ?? 'idle',
    sessionCount: active.length,
    activeSessionCount: running.length,
    pendingInteractionCount: pendingInteraction,
    unreadCompletedCount: unread,
  }
}

function buildState(): AgentIslandState {
  const now = Date.now()
  const retained = [...sessions.values()]
    .filter((s) => {
      if (s.terminalAt) {
        // completed/error 会话最多保留 UNREAD_RETAIN_MS（含未读展示期）
        if (now - s.terminalAt > UNREAD_RETAIN_MS) return false
      }
      return now - s.lastActivityAt < 24 * 60 * 60_000
    })
    .sort((a, b) => {
      // 等待交互 > 错误 > 运行中 > 最近活动
      const score = (s: InternalSessionSnapshot): number => {
        if (s.phase === 'needs-interaction') return 4
        if (s.phase === 'error') return 3
        if (s.phase === 'running') return 2
        if (s.phase === 'completed') return 1
        return 0
      }
      return score(b) - score(a) || b.lastActivityAt - a.lastActivityAt
    })

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
    expanded,
    pill: buildPill(now),
    sessions: sessionsOut,
    totalCount: sessionsOut.length,
    updatedAt: now,
  }
}

// ===== 推送 =====

function pushState(): void {
  const win = getAgentIslandWindow()
  if (!win || win.isDestroyed()) return
  const state = buildState()
  const json = JSON.stringify(state)
  // 状态无变化时跳过，避免无谓 IPC 与渲染
  if (json === lastStateJson) return
  lastStateJson = json
  if (!win.webContents.isDestroyed()) {
    win.webContents.send(AGENT_ISLAND_IPC_CHANNELS.STATE, state)
  }
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
  /** 是否允许启用灵动岛（如设置开关） */
  enabled?: () => boolean
}

export function initAgentIslandService(deps: AgentIslandServiceDeps): void {
  if (initialized) return
  initialized = true

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
    const session = sessions.get(sessionId)
    deps.openAgentSession(sessionId, session?.title ?? getTitle(sessionId))
    deps.showAndFocusMainWindow()
  })
}

export function setAgentIslandExpanded(next: boolean): void {
  if (expanded === next) return
  expanded = next
  schedulePush()
}

/** 立即推送一次当前状态（窗口创建/重新显示后调用） */
export function publishAgentIslandNow(): void {
  lastStateJson = ''
  lastPushAt = 0
  pushState()
}

export function isAgentIslandExpanded(): boolean {
  return expanded
}

export function disposeAgentIslandService(): void {
  disposeEventBus?.()
  disposeEventBus = null
  initialized = false
  sessions.clear()
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  lastStateJson = ''
}
