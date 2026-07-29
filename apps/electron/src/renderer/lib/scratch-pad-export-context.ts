export interface ScratchPadExportSession {
  id: string
  workspaceId?: string | null
}

/**
 * Prefer the active Agent session's project whenever its metadata is available.
 * The selected project is only a fallback for non-Agent contexts.
 */
export function resolveScratchPadExportWorkspaceId(
  activeSessionId: string | null,
  sessions: ScratchPadExportSession[],
  selectedWorkspaceId: string | null,
): string | null {
  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId)
    : undefined

  return activeSession ? activeSession.workspaceId ?? null : selectedWorkspaceId
}
