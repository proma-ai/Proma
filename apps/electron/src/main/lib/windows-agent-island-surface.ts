import type {
  AgentIslandInteractionKind,
  AgentIslandPhase,
  NativeAgentIslandSnapshot,
} from '@proma/shared'
import type { NotificationSoundType } from '../../types'
import { getSettings } from './settings-service'

export interface PhaseTransition {
  sessionId: string
  from: AgentIslandPhase
  to: AgentIslandPhase
  title: string
  detail: string
  interactionKind?: AgentIslandInteractionKind
}

function shouldNotifyTransition(
  from: AgentIslandPhase | undefined,
  to: AgentIslandPhase,
  attention: boolean,
): boolean {
  if (from === to) return false
  if (from === undefined) {
    return to === 'needs-interaction' || to === 'completed' || (to === 'error' && attention)
  }
  if (to === 'error' && attention) return true
  if (from === 'running' && (to === 'needs-interaction' || to === 'completed')) return true
  return false
}

export function detectPhaseTransitions(
  prevPhases: Map<string, AgentIslandPhase>,
  curr: NativeAgentIslandSnapshot,
): PhaseTransition[] {
  const transitions: PhaseTransition[] = []
  for (const session of curr.state.sessions) {
    const prevPhase = prevPhases.get(session.sessionId)
    if (shouldNotifyTransition(prevPhase, session.phase, session.attention)) {
      transitions.push({
        sessionId: session.sessionId,
        from: prevPhase ?? 'idle',
        to: session.phase,
        title: session.title,
        detail: session.detail,
        interactionKind: session.interactionKind,
      })
    }
  }
  return transitions
}

export class WindowsAgentIslandSurface {
  private prevPhases = new Map<string, AgentIslandPhase>()
  private isEnabled: () => boolean

  constructor(isEnabled?: () => boolean) {
    this.isEnabled = isEnabled ?? (() => getSettings().agentIsland?.enabled !== false && getSettings().notificationsEnabled !== false)
  }

  onTrayFlash?(flashing: boolean): void
  onNotification?(transition: PhaseTransition): void
  onHoverWindowUpdate?(snapshot: NativeAgentIslandSnapshot): void

  onSnapshot(snapshot: NativeAgentIslandSnapshot): void {
    if (!this.isEnabled()) {
      this.onTrayFlash?.(false)
      this.prevPhases.clear()
      return
    }

    const transitions = detectPhaseTransitions(this.prevPhases, snapshot)
    this.prevPhases = new Map(snapshot.state.sessions.map((s) => [s.sessionId, s.phase]))

    if (transitions.length > 0) {
      console.log(
        '[windows-agent-island] phase transitions:',
        transitions.map((t) => `${t.sessionId.slice(0, 8)} ${t.from}→${t.to}`).join(', '),
      )
    }

    this.onTrayFlash?.(snapshot.state.sessions.some((s) => s.attention))
    for (const t of transitions) {
      this.onNotification?.(t)
    }
    this.onHoverWindowUpdate?.(snapshot)
  }
}

let windowsSurface: WindowsAgentIslandSurface | null = null

export function getWindowsAgentIslandSurface(): WindowsAgentIslandSurface {
  if (!windowsSurface) windowsSurface = new WindowsAgentIslandSurface()
  return windowsSurface
}

// ===== 通知逻辑（纯函数 + 依赖注入） =====

export interface SurfaceDeps {
  sendPlaySound: (type: NotificationSoundType) => void
  soundEnabled: () => boolean
}

export function mapTransitionToSoundType(transition: PhaseTransition): NotificationSoundType {
  if (transition.to === 'needs-interaction') {
    if (transition.interactionKind === 'plan_review') return 'exitPlanMode'
    return 'permissionRequest'
  }
  return 'taskComplete'
}

export function processNotification(transition: PhaseTransition, deps: SurfaceDeps): void {
  if (!deps.soundEnabled()) return
  deps.sendPlaySound(mapTransitionToSoundType(transition))
}
