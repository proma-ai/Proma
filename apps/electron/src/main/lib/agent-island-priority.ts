import type { AgentIslandPhase } from '@proma/shared'

/**
 * Ordering for the island's primary status. A live run takes precedence over
 * terminal completion notifications, while actionable interaction/errors stay
 * above both.
 */
export function getAgentIslandPhasePriority(phase: AgentIslandPhase): number {
  if (phase === 'needs-interaction') return 3
  if (phase === 'error') return 2
  if (phase === 'running') return 1
  return 0
}
