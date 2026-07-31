/**
 * AgentIslandApp —— 灵动岛根组件
 *
 * 当 URL 含 ?window=agent-island 时渲染（替代主 App）。
 *
 * 功能：
 * - 常驻顶部胶囊（pill）：当前优先会话状态 + 宠物动画 + 待办计数
 * - 点击展开卡片：Agent 会话列表（含活动行 / 权限响应）+ 今日 Todo + 今日日程
 * - 窗口尺寸按内容动态调整（renderer 测量 → resize IPC）
 *
 * 数据：
 * - Agent 状态：主进程 AgentIslandService 推送（onState）
 * - Todo/日程：复用 planning IPC（listTodos / listCalendarEvents / onPlanningChanged）
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentIslandActivityLine,
  AgentIslandSessionSnapshot,
  AgentIslandState,
  CalendarEvent,
  Todo,
} from '@proma/shared'
import { drawMascot, type MascotState } from './mascot'
import './agent-island.css'

// ===== hooks =====

function useAgentIslandState(): AgentIslandState | null {
  const [state, setState] = useState<AgentIslandState | null>(null)
  useEffect(() => {
    const unsub = window.electronAPI.agentIsland.onState(setState)
    const unsubToggle = window.electronAPI.agentIsland.onToggleExpanded(() => {
      setState((prev) => (prev ? { ...prev, expanded: !prev.expanded } : prev))
    })
    return () => {
      unsub()
      unsubToggle()
    }
  }, [])
  return state
}

interface PlanningBundle {
  todos: Todo[]
  events: CalendarEvent[]
}

function usePlanningData(): PlanningBundle {
  const [bundle, setBundle] = useState<PlanningBundle>({ todos: [], events: [] })

  useEffect(() => {
    let disposed = false
    const now = Date.now()
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000

    const load = (): void => {
      void window.electronAPI.listTodos({ status: 'open' }).then((todos) => {
        if (disposed) return
        // 只保留今天到期或已过期、以及今天以前到期仍未完成的
        const relevant = todos.filter((t) => {
          if (!t.dueAt) return false
          return t.dueAt < dayEnd
        })
        setBundle((prev) => ({ ...prev, todos: relevant }))
      }).catch(() => {})

      void window.electronAPI.listCalendarEvents({ from: dayStart.getTime(), to: dayEnd }).then((events) => {
        if (disposed) return
        setBundle((prev) => ({ ...prev, events }))
      }).catch(() => {})
    }

    load()
    const unsub = window.electronAPI.onPlanningChanged((change) => {
      if (change.resources.includes('todos') || change.resources.includes('calendar_events')) {
        load()
      }
    })
    return () => {
      disposed = true
      unsub()
    }
  }, [])

  return bundle
}

// ===== 宠物 Canvas =====

function MascotCanvas({ state, size }: { state: MascotState; size: number }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    let raf = 0
    const loop = (now: number): void => {
      drawMascot(ctx, size, state, now / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [state, size])

  return <canvas ref={canvasRef} className="mascot-canvas" />
}

function phaseToMascot(phase: AgentIslandSessionSnapshot['phase']): MascotState {
  switch (phase) {
    case 'running': return 'working'
    case 'needs-interaction': return 'waiting'
    case 'completed': return 'completed'
    case 'error': return 'waiting'
    case 'idle': return 'idle'
    default: return 'idle'
  }
}

const PHASE_LABEL: Record<string, string> = {
  running: '运行中',
  'needs-interaction': '待交互',
  completed: '已完成',
  error: '出错',
  idle: '空闲',
}

const INTERACTION_BTN: Record<string, { label: string; behavior: 'allow' | 'deny' }> = {
  permission: { label: '允许', behavior: 'allow' },
  ask_user_question: { label: '查看', behavior: 'allow' },
  plan_review: { label: '查看计划', behavior: 'allow' },
}

function formatDue(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth()
  const sameYear = d.getFullYear() === now.getFullYear()
  if (sameDay) {
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${h}:${m}`
  }
  if (sameYear) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

function formatEventTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function ActivityLine({ line }: { line: AgentIslandActivityLine }): React.ReactElement | null {
  return (
    <div className="island-activity">
      <span className={line.kind}>{line.text}</span>
    </div>
  )
}

// ===== 主组件 =====

export function AgentIslandApp(): React.ReactElement {
  const state = useAgentIslandState()
  const { todos, events } = usePlanningData()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)

  const visible = state?.visible !== false

  // 展开态跟随主进程状态（主进程持有 expanded 真值）
  useEffect(() => {
    if (state) setExpanded(state.expanded)
  }, [state])

  // 根据内容动态调整窗口尺寸（尺寸无变化时不重复调用 IPC）
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const w = Math.ceil(rect.width) + (expanded ? 0 : 2)
    const h = Math.ceil(rect.height) + (expanded ? 0 : 2)
    const last = lastSizeRef.current
    if (last && last.w === w && last.h === h) return
    lastSizeRef.current = { w, h }
    void window.electronAPI.agentIsland.resize(w, h)
  }, [expanded, state, todos, events])

  const handleToggleExpand = useCallback((): void => {
    setExpanded((prev) => !prev)
  }, [])

  const handleOpenSession = useCallback((sessionId: string): void => {
    void window.electronAPI.agentIsland.openSession(sessionId)
  }, [])

  const handleOpenMain = useCallback((): void => {
    void window.electronAPI.agentIsland.openMainWindow()
  }, [])

  const handleRespondPermission = useCallback((session: AgentIslandSessionSnapshot): void => {
    if (session.interactionKind === 'permission') {
      // 权限响应走主进程 permission resolver；MVP 里灵动岛先聚焦主窗口
      void window.electronAPI.agentIsland.openSession(session.sessionId)
    }
  }, [])

  // Pill 拖拽移动
  const handlePillMouseDown = useCallback((e: React.MouseEvent): void => {
    dragRef.current = { startX: e.screenX, startY: e.screenY, moved: false }
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.screenX - drag.startX
      const dy = e.screenY - drag.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true
        void window.electronAPI.agentIsland.move(e.screenX, e.screenY)
        drag.startX = e.screenX
        drag.startY = e.screenY
      }
    }
    const onUp = (): void => {
      const drag = dragRef.current
      const wasDrag = drag?.moved === true
      dragRef.current = null
      setIsDragging(false)
      // 拖拽结束时如果是"点击"（未移动），触发展开
      if (!wasDrag) {
        handleToggleExpand()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, handleToggleExpand])

  if (!visible) return <div ref={containerRef} className="island-app" />

  const prioritySession = state?.sessions[0] ?? null
  const pill = state?.pill
  const pendingCount = pill?.pendingInteractionCount ?? 0
  const unreadCount = pill?.unreadCompletedCount ?? 0
  const busyCount = pill?.activeSessionCount ?? 0

  // 今天到期/已过期的 Todo
  const todayTodos = todos
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  const overdueTodos = todayTodos.filter((t) => (t.dueAt ?? 0) < Date.now())
  const todayEvents = [...events].sort((a, b) => a.startAt - b.startAt)

  // ===== 收起态 pill =====
  if (!expanded) {
    const mascotState = prioritySession ? phaseToMascot(prioritySession.phase) : 'idle'
    const detail = prioritySession?.detail
      ?? (pill?.activeSessionCount ? `${pill.activeSessionCount} 个任务进行中` : '空闲')
    const title = prioritySession?.title ?? 'Proma Agent'

    return (
      <div className="island-app">
        <div
          ref={containerRef}
          className="island-container"
          style={{ width: 250, height: 52 }}
        >
          <div
            className="island-pill"
            onMouseDown={handlePillMouseDown}
            title={prioritySession ? `${prioritySession.title} · ${PHASE_LABEL[prioritySession.phase] ?? prioritySession.phase}` : 'Proma Agent 灵动岛'}
          >
            <div className="mascot-wrap">
              <MascotCanvas state={mascotState} size={34} />
            </div>
            <div className="island-pill-info">
              <div className="island-pill-title">{title}</div>
              <div className="island-pill-detail">{detail}</div>
            </div>
            <div className="island-pill-badges">
              <span className={`island-dot ${pill?.priorityStatus ?? 'idle'}`} />
              {pendingCount > 0 && <span className="island-badge interaction">{pendingCount}</span>}
              {unreadCount > 0 && <span className="island-badge warn">{unreadCount}</span>}
              {busyCount > 0 && <span className="island-badge">{busyCount}</span>}
            </div>
            <div className="island-pill-chevron">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ===== 展开态卡片 =====
  const hasPlanning = todayTodos.length > 0 || todayEvents.length > 0

  return (
    <div className="island-app">
      <div ref={containerRef} className="island-container expanded" style={{ width: 480 }}>
        <div className="island-topbar">
          <div className="mascot-wrap">
            <MascotCanvas state={prioritySession ? phaseToMascot(prioritySession.phase) : 'idle'} size={36} />
          </div>
          <div className="island-topbar-title">Proma · 灵动岛</div>
          <div className="island-topbar-actions">
            <button type="button" className="island-icon-btn" title="打开主窗口" onClick={handleOpenMain}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M15 3h6v6M14 10l7-7M5 3h4M3 5v14a2 2 0 002 2h14a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="island-icon-btn" title="收起" onClick={handleToggleExpand}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* 会话列表 */}
        <div className="island-sessions">
          {state?.sessions.length === 0 && (
            <div className="island-empty">
              <div className="mascot-wrap"><MascotCanvas state="idle" size={48} /></div>
              <div className="island-empty-text">暂无运行中的 Agent 任务</div>
            </div>
          )}
          {state?.sessions.map((session) => {
            const mascotState = phaseToMascot(session.phase)
            const phaseLabel = PHASE_LABEL[session.phase] ?? session.phase
            return (
              <div
                key={session.sessionId}
                className="island-session"
                onClick={() => handleOpenSession(session.sessionId)}
              >
                <div className="mascot-wrap">
                  <MascotCanvas state={mascotState} size={30} />
                </div>
                <div className="island-session-body">
                  <div className="island-session-head">
                    <span className="island-session-title">{session.title}</span>
                    <span className={`island-session-phase ${session.phase}`}>{phaseLabel}</span>
                  </div>
                  <div className="island-session-detail">{session.detail || '空闲'}</div>
                  {session.activityLines.slice(-1).map((line) => (
                    <ActivityLine key={line.id} line={line} />
                  ))}
                  {session.phase === 'needs-interaction' && (
                    <div className="island-interaction">
                      <button
                        type="button"
                        className="island-interaction-btn allow"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRespondPermission(session)
                        }}
                      >
                        {INTERACTION_BTN[session.interactionKind ?? 'permission']?.label ?? '查看'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Todo / 日程 */}
        <div className="island-planning">
          <div className="island-planning-header">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            今日待办与日程
          </div>
          {!hasPlanning && <div className="island-planning-empty">今天没有到期任务与日程 🎉</div>}
          {todayTodos.length > 0 && (
            <div>
              {todayTodos.slice(0, 3).map((todo) => {
                const overdue = (todo.dueAt ?? 0) < Date.now()
                return (
                  <div key={todo.id} className={`island-todo-row ${overdue ? 'overdue' : ''}`}>
                    <span className="check">✓</span>
                    {todo.priority && (
                      <span className={`island-priority-tag ${todo.priority}`}>
                        {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                      </span>
                    )}
                    <span className="todo-title">{todo.title}</span>
                    {todo.dueAt && <span className="todo-due">{formatDue(todo.dueAt)}</span>}
                  </div>
                )
              })}
              {todayTodos.length > 3 && (
                <div className="island-planning-empty" style={{ textAlign: 'right', padding: '2px 0 0' }}>
                  还有 {todayTodos.length - 3} 项…
                </div>
              )}
            </div>
          )}
          {todayEvents.length > 0 && (
            <div style={{ marginTop: todayTodos.length > 0 ? 4 : 0 }}>
              {todayEvents.slice(0, 3).map((event) => (
                <div key={event.id} className="island-event-row">
                  <span className="event-time">{formatEventTime(event.startAt)}</span>
                  <span className="event-title">{event.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
