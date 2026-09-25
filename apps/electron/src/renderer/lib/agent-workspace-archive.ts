import type { AgentWorkspace } from '@proma/shared'

/**
 * Finds an active project to select when archiving a project.
 * The default project remains preferred whenever it is active.
 */
export function getActiveWorkspaceArchiveFallback(
  workspaces: AgentWorkspace[],
  workspaceId: string,
): AgentWorkspace | null {
  return workspaces.find((workspace) => (
    workspace.id !== workspaceId
    && !workspace.archived
    && workspace.slug === 'default'
  )) ?? workspaces.find((workspace) => (
    workspace.id !== workspaceId && !workspace.archived
  )) ?? null
}

/** An active project can only be archived when another active project remains. */
export function canArchiveAgentWorkspace(
  workspaces: AgentWorkspace[],
  workspaceId: string,
): boolean {
  const workspace = workspaces.find((item) => item.id === workspaceId)
  return !!workspace && (workspace.archived || getActiveWorkspaceArchiveFallback(workspaces, workspaceId) !== null)
}
