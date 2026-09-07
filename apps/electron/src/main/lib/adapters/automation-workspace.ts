import type { AgentWorkspace } from '@proma/shared'

/** 使用真实 ID 精确选择；显式无效目标不得静默回退到来源工作区。 */
export function resolveAutomationWorkspace(
  requestedId: unknown,
  currentWorkspaceId: string | undefined,
  getWorkspace: (id: string) => AgentWorkspace | undefined,
): AgentWorkspace | undefined {
  if (requestedId !== undefined && (typeof requestedId !== 'string' || !requestedId.trim())) {
    throw new Error('workspaceId 必须是非空工作区 ID；请先使用 list_workspaces 查询')
  }
  const workspaceId = typeof requestedId === 'string' ? requestedId.trim() : currentWorkspaceId
  // 兼容无工作区会话创建未启用草稿；不能将显式非法目标当作省略处理。
  if (!workspaceId) return undefined
  const workspace = getWorkspace(workspaceId)
  if (!workspace) throw new Error(`目标工作区不存在或已删除: ${workspaceId}；请重新使用 list_workspaces 查询`)
  return workspace
}

/** 仅提供工作区选择所需的元数据，不返回其他工作区的配置、文件或会话内容。 */
export function summarizeAutomationWorkspace(workspace: AgentWorkspace, currentWorkspaceId?: string) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    isCurrent: workspace.id === currentWorkspaceId,
    projectRootStatus: workspace.projectRootPath ? (workspace.projectRootStatus ?? 'unavailable') : 'managed',
  }
}
