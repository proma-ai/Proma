import * as React from 'react'
import type {
  NativeAgentIslandSnapshot,
  AgentIslandSessionSnapshot,
  AgentIslandPhase,
  AgentIslandInteractionKind,
} from '@proma/shared'
import { Lock, HelpCircle, ClipboardList } from 'lucide-react'
import { cn } from '@/lib/utils'

const PHASE_DOT_CLASS: Record<AgentIslandPhase, string> = {
  idle: 'bg-transparent',
  running: 'bg-blue-500',
  'needs-interaction': 'bg-orange-500',
  error: 'bg-red-500',
  completed: 'bg-green-500',
}

const PHASE_LABEL: Record<AgentIslandPhase, string> = {
  idle: '空闲',
  running: '执行中',
  'needs-interaction': '待处理',
  error: '需关注',
  completed: '已完成',
}

const INTERACTION_ICON: Partial<Record<AgentIslandInteractionKind, React.ComponentType<{ className?: string }>>> = {
  permission: Lock,
  ask_user_question: HelpCircle,
  plan_review: ClipboardList,
}

function SessionIndicator({ session }: { session: AgentIslandSessionSnapshot }): React.ReactElement {
  if (session.phase === 'needs-interaction' && session.interactionKind) {
    const Icon = INTERACTION_ICON[session.interactionKind]
    if (Icon) return <Icon className="mt-0.5 size-3.5 shrink-0 text-orange-500" />
  }
  return <span className={cn('mt-1 size-2 shrink-0 rounded-full', PHASE_DOT_CLASS[session.phase])} />
}

export function HoverPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<NativeAgentIslandSnapshot | null>(null)

  React.useEffect(() => {
    document.body.style.background = 'transparent'
    return window.electronAPI.onWindowsAgentIslandPushSnapshot(setSnapshot)
  }, [])

  const sessions = snapshot?.state.sessions ?? []
  const pill = snapshot?.state.pill

  const handleSessionClick = (session: AgentIslandSessionSnapshot): void => {
    window.electronAPI.openAgentIslandSession(session.sessionId, session.title)
  }

  const headerLabel = pill
    ? pill.activeSessionCount > 0
      ? `${PHASE_LABEL[pill.priorityStatus]} · ${pill.activeSessionCount} 个会话`
      : pill.unreadCompletedCount > 0
        ? `${pill.unreadCompletedCount} 个已完成`
        : '空闲'
    : ''

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border border-border/80 bg-popover p-3 text-popover-foreground shadow-2xl"
      onMouseEnter={() => window.electronAPI.hoverMouseEnter()}
      onMouseLeave={() => window.electronAPI.hoverMouseLeave()}
    >
      <div className="mb-2 flex shrink-0 items-center gap-2">
        {pill && (
          <span
            className={cn('size-2.5 shrink-0 rounded-full', PHASE_DOT_CLASS[pill.priorityStatus])}
          />
        )}
        <span className="text-xs font-semibold">{headerLabel}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-6">
            <span className="text-xs text-muted-foreground">暂无活跃 Agent</span>
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              onClick={() => handleSessionClick(session)}
              className="flex items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <SessionIndicator session={session} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {PHASE_LABEL[session.phase]}
                </div>
                <p className="line-clamp-2 text-xs font-medium leading-snug">
                  {session.title || '未命名会话'}
                </p>
                {session.detail ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
                    {session.detail}
                  </p>
                ) : null}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
