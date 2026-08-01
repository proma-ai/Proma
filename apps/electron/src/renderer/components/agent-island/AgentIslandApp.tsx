import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  ListTodo,
} from 'lucide-react'
import type {
  AgentIslandCompactPlanQuotaSnapshot,
  AgentIslandPhase,
  AgentIslandPlanQuotaSnapshot,
  AgentIslandSessionSnapshot,
  AgentIslandWindowSnapshot,
} from '@proma/shared'
import './agent-island.css'

const SURFACE_TRANSITION_MS = 180
const COMPACT_SURFACE_HEIGHT = 32
const SURFACE_WIDTH = 420

type SurfaceMode = 'compact' | 'expanded' | 'collapsing'

function useAgentIslandSnapshot(): AgentIslandWindowSnapshot | null {
  const [snapshot, setSnapshot] = useState<AgentIslandWindowSnapshot | null>(null)

  useEffect(() => {
    const unsubscribeState = window.electronAPI.agentIsland.onState(setSnapshot)
    const unsubscribeToggle = window.electronAPI.agentIsland.onToggleExpanded(() => {
      setSnapshot((previous) => {
        if (!previous) return previous
        const expanded = !previous.state.expanded
        return {
          ...previous,
          state: {
            ...previous.state,
            expanded,
            presentation: expanded ? 'expanded' : 'compact',
          },
        }
      })
    })
    return () => {
      unsubscribeState()
      unsubscribeToggle()
    }
  }, [])

  return snapshot
}

const PHASE_LABEL: Record<AgentIslandPhase, string> = {
  idle: '待命',
  running: '执行中',
  'needs-interaction': '待处理',
  completed: '已完成',
  error: '需关注',
}

function formatTime(timestamp: number | undefined, allDay = false): string {
  if (timestamp === undefined) return ''
  if (allDay) return '全天'
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getHeaderCopy(phase: AgentIslandPhase | undefined): { eyebrow: string; title: string } {
  switch (phase) {
    case 'needs-interaction': return { eyebrow: 'PROMA · HANDOFF', title: '需要你接手' }
    case 'running': return { eyebrow: 'PROMA · AGENT', title: '正在执行' }
    case 'completed': return { eyebrow: 'PROMA · AGENT', title: '任务已完成' }
    case 'error': return { eyebrow: 'PROMA · AGENT', title: '执行需要关注' }
    default: return { eyebrow: 'PROMA · REMINDER', title: '即将开始' }
  }
}

function getPlanningIndicator(snapshot: AgentIslandWindowSnapshot): { icon: React.ReactNode; label: string } | null {
  const now = Date.now()
  const nextEvent = snapshot.planning.events.find((event) => event.startAt >= now)
  const nextTodo = snapshot.planning.todos.find((todo) => (todo.dueAt ?? 0) >= now)

  if (!nextEvent && !nextTodo) return null
  if (nextEvent && (!nextTodo || nextEvent.startAt <= (nextTodo.dueAt ?? Number.POSITIVE_INFINITY))) {
    return { icon: <CalendarDays size={13} />, label: '即将日程' }
  }
  return { icon: <ListTodo size={13} />, label: '即将到期' }
}

function compactQuotaWindowLabel(window: AgentIslandCompactPlanQuotaSnapshot['windows'][number]): string {
  if (window.windowType === '5h') return '5h'
  if (window.windowType === 'weekly') return '周'
  return window.windowLabel
}

function formatCompactPlanQuota(quota: AgentIslandCompactPlanQuotaSnapshot): string {
  return quota.windows
    .slice(0, 2)
    .map((window) => `${compactQuotaWindowLabel(window)} ${window.remainingLabel ?? `${Math.round(window.remainingPercent)}%`}`)
    .join(' · ')
}

function CompactPlanQuota({ quota }: { quota: AgentIslandCompactPlanQuotaSnapshot }): React.ReactElement {
  const detail = formatCompactPlanQuota(quota)
  const title = [quota.channelName, ...quota.windows.map((window) => (
    `${window.windowLabel} 剩余 ${window.remainingLabel ?? `${Math.round(window.remainingPercent)}%`}`
  ))].join(' · ')

  return (
    <span className="island-compact-quota" title={title}>
      <span className="island-compact-quota-value">{detail}</span>
      {quota.additionalChannelCount > 0 && <span className="island-compact-quota-more">+{quota.additionalChannelCount}</span>}
    </span>
  )
}

function PlanQuotaCarousel({ quotas }: { quotas: AgentIslandPlanQuotaSnapshot[] }): React.ReactElement | null {
  const [page, setPage] = useState(0)
  const pageSize = 3
  const pageCount = Math.ceil(quotas.length / pageSize)

  useEffect(() => {
    if (pageCount <= 1) return
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pageCount), 5_000)
    return () => window.clearInterval(timer)
  }, [pageCount])

  useEffect(() => {
    setPage(0)
  }, [pageCount])

  if (quotas.length === 0) return <div className="island-quota-spacer" />

  const visible = quotas.slice((page % pageCount) * pageSize, (page % pageCount) * pageSize + pageSize)
  return (
    <div className="island-quotas">
      <span className="island-quotas-title">剩余额度</span>
      {visible.map((quota) => (
        <div className="island-quota-row" key={`${quota.channelName}:${quota.planName}`}>
          <span className="island-quota-name">{quota.channelName}</span>
          {quota.planName !== quota.channelName && <span className="island-quota-plan">· {quota.planName}</span>}
          <span className="island-quota-value">
            {quota.windows.map((window) => `${window.windowLabel} ${window.remainingLabel ?? `${Math.round(window.remainingPercent)}%`}`).join(' · ')}
          </span>
        </div>
      ))}
    </div>
  )
}

function SessionList({ sessions, openSession, recent }: {
  sessions: AgentIslandSessionSnapshot[]
  openSession: (sessionId: string) => void
  recent: boolean
}): React.ReactElement | null {
  if (sessions.length === 0) return null

  return (
    <section className="island-session-section">
      {recent && <h2 className="island-section-label">最近 Agent</h2>}
      <div className="island-session-list">
        {sessions.slice(0, 3).map((session) => (
          <button className="island-session-row" key={session.sessionId} type="button" onClick={() => openSession(session.sessionId)}>
            <span className="island-session-copy">
              <b>{session.title}</b>
              <span>{PHASE_LABEL[session.phase]}</span>
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}

export function AgentIslandApp(): React.ReactElement {
  const snapshot = useAgentIslandSnapshot()
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const expandedContentRef = useRef<HTMLDivElement | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('compact')
  const [expandedHeight, setExpandedHeight] = useState(COMPACT_SURFACE_HEIGHT)
  const platform = new URLSearchParams(window.location.search).get('platform')
  const state = snapshot?.state
  const planning = snapshot?.planning
  const requestedExpanded = state?.expanded ?? false

  useLayoutEffect(() => {
    const height = Math.ceil(expandedContentRef.current?.getBoundingClientRect().height ?? COMPACT_SURFACE_HEIGHT)
    setExpandedHeight((previous) => previous === height ? previous : height)
  }, [snapshot])

  useEffect(() => {
    if (requestedExpanded) {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = null
      }
      setSurfaceMode('expanded')
      return
    }
    if (surfaceMode !== 'expanded') return
    setSurfaceMode('collapsing')
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      setSurfaceMode('compact')
    }, SURFACE_TRANSITION_MS)
  }, [requestedExpanded, surfaceMode])

  useEffect(() => () => {
    if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current)
    void window.electronAPI.agentIsland.setHovered(false)
  }, [])

  useEffect(() => {
    const height = surfaceMode === 'compact' ? COMPACT_SURFACE_HEIGHT : expandedHeight
    void window.electronAPI.agentIsland.resize(SURFACE_WIDTH, height)
  }, [expandedHeight, surfaceMode])

  const setExpanded = useCallback((next: boolean) => {
    void window.electronAPI.agentIsland.setExpanded(next)
  }, [])
  const setHovered = useCallback((next: boolean) => {
    void window.electronAPI.agentIsland.setHovered(next)
  }, [])
  const openMain = useCallback(() => { void window.electronAPI.agentIsland.openMainWindow() }, [])
  const openPlanning = useCallback(() => { void window.electronAPI.agentIsland.openPlanning() }, [])
  const openSession = useCallback((sessionId: string) => { void window.electronAPI.agentIsland.openSession(sessionId) }, [])

  if (!snapshot || !state || !planning || !state.visible) return <div className="island-root" />

  const primarySession = state.sessions[0]
  const planningIndicator = getPlanningIndicator(snapshot)
  const compactLabel = primarySession
    ? `Proma · ${PHASE_LABEL[primarySession.phase]}`
    : state.idleDashboard
      ? state.recentSessions.length === 0 ? 'Proma · 额度概览' : 'Proma · 最近会话'
      : planningIndicator?.label ?? '工作提醒'
  const displayedSessions = state.idleDashboard ? state.recentSessions : state.sessions
  const header = getHeaderCopy(primarySession?.phase)
  const showPlanning = !state.idleDashboard && (planning.todos.length > 0 || planning.events.length > 0)
  const rootClassName = `island-root${platform !== 'darwin' ? ' island-root-floating' : ''}`
  const surfaceStyle = { '--island-expanded-height': `${expandedHeight}px` } as React.CSSProperties

  return (
    <div
      className={rootClassName}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div ref={surfaceRef} className={`island-surface island-transition-surface ${surfaceMode}`} style={surfaceStyle}>
        <div ref={expandedContentRef} className="island-expanded-content">
          {state.sessions.length > 0 ? (
            <header className="island-header">
              <button className="island-header-copy" type="button" onClick={() => setExpanded(false)} title="收起">
                <span>{header.eyebrow}</span>
                <strong>{header.title}</strong>
              </button>
              <button className="island-open-button" type="button" onClick={openMain}>
                打开 Proma <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </header>
          ) : (
            <PlanQuotaCarousel quotas={snapshot.planQuotas} />
          )}

          <SessionList sessions={displayedSessions} openSession={openSession} recent={state.idleDashboard} />

          {showPlanning && (
            <section className="island-planning-grid">
              {planning.todos.length > 0 && (
                <button className="island-planning-column" type="button" onClick={openPlanning}>
                  <span className="island-planning-title"><ListTodo size={13} /> 接下来待办 <b>{planning.todos.length}</b></span>
                  {planning.todos.map((todo) => (
                    <span className={`island-planning-row${todo.isOverdue ? ' overdue' : ''}`} key={todo.id}>
                      <span className="island-checkbox" />
                      <span>{todo.title}</span>
                      <time>{formatTime(todo.dueAt)}</time>
                    </span>
                  ))}
                </button>
              )}
              {planning.events.length > 0 && (
                <button className="island-planning-column" type="button" onClick={openPlanning}>
                  <span className="island-planning-title"><CalendarDays size={13} /> 接下来日程 <b>{planning.events.length}</b></span>
                  {planning.events.map((event) => (
                    <span className="island-planning-row event" key={event.id}>
                      <time>{formatTime(event.startAt, event.allDay)}</time>
                      <span>{event.title}</span>
                    </span>
                  ))}
                </button>
              )}
            </section>
          )}
        </div>

        <button className="island-compact-layer" type="button" onClick={() => setExpanded(true)} title="展开">
          {!primarySession && (
            <span className="island-compact-icon" aria-hidden="true">
              {planningIndicator?.icon ?? <Bell size={12} />}
            </span>
          )}
          <span className="island-compact-label">{compactLabel}</span>
          {state.compactPlanQuota && <CompactPlanQuota quota={state.compactPlanQuota} />}
          <ChevronDown className="island-compact-chevron" size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
