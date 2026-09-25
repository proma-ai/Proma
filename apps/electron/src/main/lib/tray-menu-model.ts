import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'

export const TRAY_RECENT_LIMIT = 3
export const TRAY_MORE_LIMIT = 10

export interface TrayRecentSessionItem {
  id: string
  title: string
  subtitle: string
}

export interface TrayMenuModel {
  runningSessions: TrayRecentSessionItem[]
  recentSessions: TrayRecentSessionItem[]
  moreSessions: TrayRecentSessionItem[]
}

function getWorkspaceLabel(session: AgentSessionMeta, workspacesById: Map<string, AgentWorkspace>): string {
  if (!session.workspaceId) return '未选择项目'
  const workspace = workspacesById.get(session.workspaceId)
  return workspace?.name ?? '未知项目'
}

function toRecentSessionItem(
  session: AgentSessionMeta,
  workspacesById: Map<string, AgentWorkspace>,
): TrayRecentSessionItem {
  return {
    id: session.id,
    title: session.title.trim() || '未命名会话',
    subtitle: getWorkspaceLabel(session, workspacesById),
  }
}

export function createTrayMenuModel(
  sessions: AgentSessionMeta[],
  workspaces: AgentWorkspace[],
  runningSessionIds: Set<string> = new Set(),
): TrayMenuModel {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  const archivedWorkspaceIds = new Set(workspaces.filter((workspace) => workspace.archived).map((workspace) => workspace.id))
  const visibleSessions = sessions
    // 运行中会话保留状态提醒，但已归档项目绝不作为最近会话入口展示。
    .filter((session) => runningSessionIds.has(session.id) || (
      !session.archived && !archivedWorkspaceIds.has(session.workspaceId ?? '')
    ))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const runningSessions = visibleSessions
    .filter((session) => runningSessionIds.has(session.id))
    .map((session) => toRecentSessionItem(session, workspacesById))

  const recentSessions = visibleSessions
    .filter((session) => !runningSessionIds.has(session.id))
    .slice(0, TRAY_MORE_LIMIT)
    .map((session) => toRecentSessionItem(session, workspacesById))

  return {
    runningSessions,
    recentSessions: recentSessions.slice(0, TRAY_RECENT_LIMIT),
    moreSessions: recentSessions.slice(TRAY_RECENT_LIMIT),
  }
}
