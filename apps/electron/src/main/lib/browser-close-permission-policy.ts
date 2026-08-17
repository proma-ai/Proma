import type { AgentSendInput } from '@proma/shared'

export type BrowserClosePermissionDecision = 'allow' | 'require-single-approval' | 'deny-unattended'

/**
 * Closing the whole browser may discard user-created tabs and unsaved page state.
 * It must remain a user-session action with a one-time confirmation.
 */
export function resolveBrowserClosePermission(
  toolName: string,
  triggeredBy: AgentSendInput['triggeredBy'],
): BrowserClosePermissionDecision {
  if (toolName !== 'BrowserClose') return 'allow'
  if (triggeredBy === 'automation' || triggeredBy === 'delegation') return 'deny-unattended'
  return 'require-single-approval'
}
