import { listAgentSessions } from './agent-session-manager'
import {
  getWorkspaceMemoryReviewLastPromptAt,
  getWorkspaceMemorySummary,
  recordWorkspaceMemoryReviewInvitation,
} from './agent-workspace-manager'

const DAY_MS = 24 * 60 * 60 * 1000
/** Internal-only cadence. Users are invited, never automatically scanned. */
export const WORKSPACE_MEMORY_REVIEW_INTERVAL_DAYS = 3

export interface WorkspaceMemoryRefreshOpportunity {
  /** The latest memory update before which new workspace sessions accumulated. */
  memoryUpdatedAt?: number
  newestSessionAt: number
  newerSessionCount: number
}

/**
 * Lazily checks a workspace during a foreground Agent run. Archived sessions are
 * deliberately included: archival is a navigation choice, not evidence deletion.
 */
export function claimWorkspaceMemoryRefreshOpportunity(
  workspaceSlug: string | undefined,
  now = Date.now(),
): WorkspaceMemoryRefreshOpportunity | undefined {
  if (!workspaceSlug) return undefined
  const lastPromptAt = getWorkspaceMemoryReviewLastPromptAt(workspaceSlug)

  const summary = getWorkspaceMemorySummary(workspaceSlug)
  const memoryUpdatedAt = summary.autoMemory.updatedAt
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspaceSlug)
  const newerSessions = sessions.filter((session) => session.updatedAt > (memoryUpdatedAt ?? 0))
  const newestSessionAt = newerSessions[0]?.updatedAt
  if (!newestSessionAt) return undefined

  // Re-prompt no more often than the fixed internal cadence, even if the user skipped it.
  const cooldownFrom = Math.max(memoryUpdatedAt ?? 0, lastPromptAt ?? 0)
  if (now - cooldownFrom < WORKSPACE_MEMORY_REVIEW_INTERVAL_DAYS * DAY_MS) return undefined

  recordWorkspaceMemoryReviewInvitation(workspaceSlug, now)
  return { memoryUpdatedAt, newestSessionAt, newerSessionCount: newerSessions.length }
}
