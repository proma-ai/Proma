/**
 * AgentIslandApp —— Proma 工作脉冲（Work Pulse）
 *
 * 将原本偏“独立玩具窗”的灵动岛收敛为 Proma 的可扫读工作状态条：
 * 收起态给出 Agent / Todo / 日程的即时脉冲；展开态是短 briefing，按
 * “需要你处理 → 正在进行 → 今天”组织信息。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  ListTodo,
  Sparkles,
} from 'lucide-react'
import type {
  AgentIslandActivityLine,
  AgentIslandSessionSnapshot,
  AgentIslandState,
  CalendarEvent,
  Todo,
} from '@proma/shared'
import './agent-island.css'

function useAgentIslandState(): AgentIslandState | null {
  const [state, setState] = useState<AgentIslandState | null>(null)
  useEffect(() => {
    const unsubscribeState = window.electronAPI.agentIsland.onState(setState)
    const unsubscribeToggle = window.electronAPI.agentIsland.onToggleExpanded(() => {
      setState((previous) => {
        if (!previous) return previous
        const expanded = !previous.expanded
        return { ...previous, expanded, presentation: expanded ? 'expanded' : 'compact' }
      })
    })
    return () => {
      unsubscribeState()
      unsubscribeToggle()
    }
  }, [])
  return state
}

interface PlanningBundle {
  todos: Todo[]
  events: CalendarEvent[]
}

/** 只订阅今天及已逾期待办，避免灵动岛变成完整 Planning 页面。 */
function usePlanningData(): PlanningBundle {
  const [bundle, setBundle] = useState<PlanningBundle>({ todos: [], events: [] })

  useEffect(() => {
    let disposed = false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayStart = today.getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000

    const load = (): void => {
      void window.electronAPI.listTodos({ status: 'open' }).then((todos) => {
        if (disposed) return
        setBundle((previous) => ({
          ...previous,
          todos: todos
            .filter((todo) => todo.dueAt !== undefined && todo.dueAt < dayEnd)
            .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)),
        }))
      }).catch(() => {})

      void window.electronAPI.listCalendarEvents({ from: dayStart, to: dayEnd }).then((events) => {
        if (!disposed) setBundle((previous) => ({ ...previous, events: events.sort((a, b) => a.startAt - b.startAt) }))
      }).catch(() => {})
    }

    load()
    const unsubscribe = window.electronAPI.onPlanningChanged((change) => {
      if (change.resources.includes('todos') || change.resources.includes('calendar_events')) load()
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return bundle
}

const PHASE_LABEL: Record<AgentIslandSessionSnapshot['phase'], string> = {
  idle: '空闲',
  running: '执行中',
  'needs-interaction': '待处理',
  completed: '已完成',
  error: '需关注',
}

function getPhaseTone(phase: AgentIslandSessionSnapshot['phase']): string {
  return phase === 'needs-interaction' ? 'attention' : phase
}

function formatDue(timestamp: number): string {
  const target = new Date(timestamp)
  const now = new Date()
  const isToday = target.getFullYear() === now.getFullYear()
    && target.getMonth() === now.getMonth()
    && target.getDate() === now.getDate()
  if (isToday) return `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`
  return `${target.getMonth() + 1}/${target.getDate()}`
}

function formatEventTime(timestamp: number): string {
  const value = new Date(timestamp)
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function getTodayLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())
}

function PulseGlyph({ phase, compact = false }: { phase: AgentIslandSessionSnapshot['phase']; compact?: boolean }): React.ReactElement {
  return (
    <span className={`pulse-glyph ${getPhaseTone(phase)} ${compact ? 'compact' : ''}`} aria-hidden="true">
      <span className="pulse-glyph-core" />
      <span className="pulse-glyph-orbit" />
    </span>
  )
}

function ActivityLine({ line }: { line: AgentIslandActivityLine }): React.ReactElement {
  return (
    <span className={`pulse-activity ${line.kind}`}>
      {line.kind === 'tool' ? '工具' : line.kind === 'status' ? '状态' : '消息'} · {line.text}
    </span>
  )
}

function Metric({ icon, value, label, tone = 'neutral' }: {
  icon: React.ReactNode
  value: number
  label: string
  tone?: 'neutral' | 'attention' | 'danger'
}): React.ReactElement | null {
  if (value <= 0) return null
  return (
    <span className={`pulse-metric ${tone}`} title={`${value} ${label}`}>
      {icon}<b>{value}</b><span>{label}</span>
    </span>
  )
}

export function AgentIslandApp(): React.ReactElement {
  const state = useAgentIslandState()
  const { todos, events } = usePlanningData()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (state) setExpanded(state.expanded)
  }, [state])

  // Content-driven window size；只在尺寸实际变化时跨进程同步。
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const width = Math.ceil(rect.width) + (expanded ? 0 : 2)
    const height = Math.ceil(rect.height) + (expanded ? 0 : 2)
    const last = lastSizeRef.current
    if (last?.width === width && last.height === height) return
    lastSizeRef.current = { width, height }
    void window.electronAPI.agentIsland.resize(width, height)
  }, [expanded, state, todos, events])

  const toggleExpanded = useCallback(() => {
    setExpanded((previous) => {
      const next = !previous
      void window.electronAPI.agentIsland.setExpanded(next)
      return next
    })
  }, [])
  const openMain = useCallback(() => { void window.electronAPI.agentIsland.openMainWindow() }, [])
  const openSession = useCallback((sessionId: string) => { void window.electronAPI.agentIsland.openSession(sessionId) }, [])

  const handlePointerDown = useCallback((event: React.MouseEvent) => {
    dragRef.current = { x: event.screenX, y: event.screenY, moved: false }
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const dx = event.screenX - drag.x
      const dy = event.screenY - drag.y
      if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return
      drag.moved = true
      void window.electronAPI.agentIsland.move(event.screenX, event.screenY)
      drag.x = event.screenX
      drag.y = event.screenY
    }
    const onUp = (): void => {
      const wasDragged = dragRef.current?.moved === true
      dragRef.current = null
      setDragging(false)
      if (!wasDragged) toggleExpanded()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, toggleExpanded])

  const priority = state?.sessions[0]
  const phase = priority?.phase ?? 'idle'
  const activeCount = state?.pill.activeSessionCount ?? 0
  const pendingCount = state?.pill.pendingInteractionCount ?? 0
  const unreadCount = state?.pill.unreadCompletedCount ?? 0
  const overdueTodos = todos.filter((todo) => (todo.dueAt ?? Number.POSITIVE_INFINITY) < Date.now())
  const attentionCount = pendingCount + unreadCount + overdueTodos.length
  const visibleTodos = todos.slice(0, 3)
  const visibleEvents = events.slice(0, 3)
  const todayLabel = getTodayLabel()

  const compactTitle = priority?.title ?? 'Proma Agent'
  const compactDetail = priority
    ? priority.detail || PHASE_LABEL[priority.phase]
    : todos.length || events.length
      ? `今天 ${todos.length} 项待办 · ${events.length} 个日程`
      : '所有事项已就绪'

  if (state?.visible === false) return <div className="pulse-root" />

  if (!expanded) {
    return (
      <div className="pulse-root">
        <div ref={containerRef} className={`pulse-shell pulse-shell-compact ${getPhaseTone(phase)}`} style={{ width: 460, height: 48 }}>
          <div className="pulse-compact" onMouseDown={handlePointerDown} title="点击展开；拖动移动">
            <PulseGlyph phase={phase} compact />
            <div className="pulse-compact-copy">
              <span className="pulse-kicker">PROMA · AGENT</span>
              <span className="pulse-compact-title">{compactTitle}</span>
              <span className="pulse-compact-detail">{compactDetail}</span>
            </div>
            <div className="pulse-compact-metrics">
              <Metric icon={<Activity size={12} />} value={activeCount} label="进行中" />
              <Metric icon={<CircleDot size={12} />} value={attentionCount} label="待处理" tone={attentionCount ? 'attention' : 'neutral'} />
              <Metric icon={<ListTodo size={12} />} value={todos.length} label="Todo" />
              <Metric icon={<CalendarDays size={12} />} value={events.length} label="日程" />
            </div>
            <ChevronDown className="pulse-chevron" size={16} strokeWidth={1.8} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pulse-root">
      <div ref={containerRef} className="pulse-shell pulse-shell-expanded" style={{ width: 500 }}>
        <header className="pulse-header">
          <div className="pulse-header-identity">
            <PulseGlyph phase={phase} />
            <div>
              <p className="pulse-kicker">PROMA · WORK PULSE</p>
              <h1>工作脉冲</h1>
            </div>
          </div>
          <div className="pulse-header-actions">
            <span className="pulse-date">{todayLabel}</span>
            <button type="button" className="pulse-icon-button" onClick={openMain} title="打开 Proma">
              <ArrowUpRight size={15} strokeWidth={1.9} />
            </button>
            <button type="button" className="pulse-icon-button" onClick={toggleExpanded} title="收起">
              <ChevronDown size={16} strokeWidth={1.9} />
            </button>
          </div>
        </header>

        {attentionCount > 0 && (
          <section className="pulse-section pulse-attention-section">
            <div className="pulse-section-heading">
              <span className="pulse-section-icon attention"><Sparkles size={14} /></span>
              <div><h2>需要你处理</h2><p>优先解决等待中的事项</p></div>
              <span className="pulse-count">{attentionCount}</span>
            </div>
            <div className="pulse-attention-list">
              {state?.sessions.filter((session) => session.phase === 'needs-interaction' || session.phase === 'error').slice(0, 2).map((session) => (
                <button type="button" className="pulse-attention-item" key={session.sessionId} onClick={() => openSession(session.sessionId)}>
                  <span className={`pulse-state-dot ${getPhaseTone(session.phase)}`} />
                  <span className="pulse-attention-copy"><b>{session.title}</b><span>{session.detail || PHASE_LABEL[session.phase]}</span></span>
                  <span className="pulse-item-action">去处理 <ArrowUpRight size={12} /></span>
                </button>
              ))}
              {overdueTodos.slice(0, 1).map((todo) => (
                <button type="button" className="pulse-attention-item" key={todo.id} onClick={openMain}>
                  <span className="pulse-state-dot error" />
                  <span className="pulse-attention-copy"><b>{todo.title}</b><span>Todo 已逾期</span></span>
                  <span className="pulse-item-action">查看 <ArrowUpRight size={12} /></span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="pulse-section">
          <div className="pulse-section-heading">
            <span className="pulse-section-icon"><Activity size={14} /></span>
            <div><h2>Agent 动态</h2><p>{activeCount > 0 ? `${activeCount} 个会话正在推进` : '暂时没有执行中的任务'}</p></div>
            {activeCount > 0 && <span className="pulse-count neutral">{activeCount}</span>}
          </div>
          <div className="pulse-session-list">
            {state?.sessions.filter((session) => session.phase === 'running').slice(0, 3).map((session) => (
              <button type="button" className="pulse-session-item" key={session.sessionId} onClick={() => openSession(session.sessionId)}>
                <PulseGlyph phase={session.phase} compact />
                <span className="pulse-session-copy">
                  <span className="pulse-session-title-row"><b>{session.title}</b><span className={`pulse-phase ${getPhaseTone(session.phase)}`}>{PHASE_LABEL[session.phase]}</span></span>
                  <span className="pulse-session-detail">{session.detail || '正在推进'}</span>
                  {session.activityLines.at(-1) && <ActivityLine line={session.activityLines.at(-1)!} />}
                </span>
                <ArrowUpRight className="pulse-session-arrow" size={14} />
              </button>
            ))}
            {!state?.sessions.some((session) => session.phase === 'running') && (
              <div className="pulse-empty-state"><CheckCircle2 size={15} /> 目前没有执行中的 Agent 任务</div>
            )}
          </div>
        </section>

        <section className="pulse-section pulse-plan-section">
          <div className="pulse-section-heading">
            <span className="pulse-section-icon"><Clock3 size={14} /></span>
            <div><h2>今天</h2><p>Todo 与日程一眼扫完</p></div>
            <button type="button" className="pulse-text-button" onClick={openMain}>打开规划中心 <ArrowUpRight size={12} /></button>
          </div>
          <div className="pulse-planning-grid">
            <div className="pulse-plan-column">
              <div className="pulse-plan-label"><ListTodo size={13} /> 待办 <span>{todos.length}</span></div>
              {visibleTodos.length > 0 ? visibleTodos.map((todo) => {
                const overdue = (todo.dueAt ?? Number.POSITIVE_INFINITY) < Date.now()
                return (
                  <button type="button" className={`pulse-plan-row todo ${overdue ? 'overdue' : ''}`} key={todo.id} onClick={openMain}>
                    <span className="pulse-checkbox" />
                    <span className="pulse-plan-title">{todo.title}</span>
                    {todo.dueAt && <span className="pulse-plan-time">{formatDue(todo.dueAt)}</span>}
                  </button>
                )
              }) : <div className="pulse-plan-empty">今天没有待办</div>}
            </div>
            <div className="pulse-plan-column">
              <div className="pulse-plan-label"><CalendarDays size={13} /> 日程 <span>{events.length}</span></div>
              {visibleEvents.length > 0 ? visibleEvents.map((event) => (
                <button type="button" className="pulse-plan-row event" key={event.id} onClick={openMain}>
                  <span className="pulse-plan-time">{formatEventTime(event.startAt)}</span>
                  <span className="pulse-plan-title">{event.title}</span>
                </button>
              )) : <div className="pulse-plan-empty">今天没有日程</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
