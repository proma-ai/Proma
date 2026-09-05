import type { AgentSessionMeta } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import {
  getAgentSessionTreeIndicatorStatus,
  getDelegatedChildSessionStatus,
} from '@/lib/agent-session-list'

export interface AgentSessionTreeItem {
  session: AgentSessionMeta
  childSessions: AgentSessionMeta[]
}

export interface CollapsedRailPopoverState {
  openPopoverId: string | null
  snapshotIds: string[] | null
}

/** 目标条目已不在可见集合或已没有子会话时，残留的展开状态一律失效。 */
export function getEffectiveCollapsedRailPopoverId(
  openPopoverId: string | null,
  validPopoverItemIds: readonly string[],
): string | null {
  return openPopoverId && validPopoverItemIds.includes(openPopoverId) ? openPopoverId : null
}

/**
 * 处理 Rail Popover 状态。关闭事件必须携带来源 ID，过期的延迟关闭不能影响新面板。
 */
export function reduceCollapsedRailPopoverState(
  state: CollapsedRailPopoverState,
  event:
    | { type: 'open'; id: string; snapshotIds: readonly string[] }
    | { type: 'close'; id: string },
): CollapsedRailPopoverState {
  if (event.type === 'open') {
    return { openPopoverId: event.id, snapshotIds: [...event.snapshotIds] }
  }
  if (state.openPopoverId !== event.id) return state
  return { openPopoverId: null, snapshotIds: null }
}

/**
 * 计算 Rail 的根条目。Popover 打开期间使用打开时捕获的根 id 顺序，
 * 但条目对象仍从最新 items 读取，因此标题、状态和 childSessions 会继续更新。
 */
export function getCollapsedAgentRailVisibleItems<T extends { id: string }>(
  items: readonly T[],
  openPopoverId: string | null,
  openSnapshotIds: readonly string[] | null,
  limit = 5,
): T[] {
  if (openPopoverId === null || openSnapshotIds === null) return items.slice(0, limit)

  const itemsById = new Map(items.map((item) => [item.id, item]))
  const result = openSnapshotIds
    .slice(0, limit)
    .flatMap((id) => {
      const item = itemsById.get(id)
      return item ? [item] : []
    })
  const includedIds = new Set(result.map((item) => item.id))

  // 防御性兜底：即使打开事件与一次更新交错，也不让仍然有效的 open parent
  // 因快照尚未写入而丢失锚点。
  const openItem = itemsById.get(openPopoverId)
  if (openItem && !includedIds.has(openPopoverId)) {
    if (result.length >= limit) includedIds.delete(result.pop()!.id)
    result.push(openItem)
    includedIds.add(openPopoverId)
  }

  // 快照中的其他条目被删除时，用最新动态顺序补足空位，但不移动仍存在的 Anchor。
  for (const item of items) {
    if (result.length >= limit) break
    if (includedIds.has(item.id)) continue
    result.push(item)
    includedIds.add(item.id)
  }
  return result
}

export function isDelegatedChildSession(session: AgentSessionMeta): boolean {
  return !!session.parentSessionId && !!session.sourceDelegationId
}

export function sortDelegatedChildSessions(
  sessions: readonly AgentSessionMeta[],
  agentIndicatorMap?: ReadonlyMap<string, SessionIndicatorStatus>,
): AgentSessionMeta[] {
  const priority = (session: AgentSessionMeta): number => Number(
    agentIndicatorMap && ['blocked', 'running', 'completed'].includes(getDelegatedChildSessionStatus(session, agentIndicatorMap)),
  )
  return [...sessions].sort((a, b) => priority(b) - priority(a) || b.updatedAt - a.updatedAt)
}

export function buildAgentSessionTrees(
  sessions: readonly AgentSessionMeta[],
  agentIndicatorMap?: ReadonlyMap<string, SessionIndicatorStatus>,
): AgentSessionTreeItem[] {
  const sessionIds = new Set(sessions.map((session) => session.id))
  const childrenByParentId = new Map<string, AgentSessionMeta[]>()
  const roots: AgentSessionMeta[] = []

  for (const session of sessions) {
    if (
      isDelegatedChildSession(session)
      && session.parentSessionId
      && sessionIds.has(session.parentSessionId)
    ) {
      const children = childrenByParentId.get(session.parentSessionId) ?? []
      children.push(session)
      childrenByParentId.set(session.parentSessionId, children)
      continue
    }

    // 与展开态项目分组保持一致：父会话不在当前集合中的 moved/orphan child
    // 作为该项目的根条目保留，避免因历史或迁移中间态变得不可达。
    roots.push(session)
  }

  return roots.map((session) => ({
    session,
    childSessions: sortDelegatedChildSessions(childrenByParentId.get(session.id) ?? [], agentIndicatorMap),
  }))
}

export function buildWorkspaceAgentSessionTrees(
  sessions: readonly AgentSessionMeta[],
  workspaceId: string | null,
  agentIndicatorMap?: ReadonlyMap<string, SessionIndicatorStatus>,
): AgentSessionTreeItem[] {
  const workspaceSessions = workspaceId
    ? sessions.filter((session) => session.workspaceId === workspaceId)
    : sessions
  return buildAgentSessionTrees(workspaceSessions, agentIndicatorMap)
}

/**
 * 折叠态 Rail 入口的状态：与展开态行共用会话树聚合逻辑，父会话自身空闲但子
 * 会话在运行/阻塞/刚完成时，色条与展开态保持一致；随后才回落到「已完成未查看」。
 */
export function getCollapsedAgentRailTreeStatus(
  tree: AgentSessionTreeItem,
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>,
  unviewedCompletedSessionIds: ReadonlySet<string>,
): SessionIndicatorStatus {
  const status = getAgentSessionTreeIndicatorStatus(
    tree.session,
    tree.childSessions,
    agentIndicatorMap,
  )
  if (status !== 'idle') return status
  return unviewedCompletedSessionIds.has(tree.session.id) ? 'completed' : 'idle'
}

/**
 * 折叠态 Rail 的可见会话树：排序与上游 Rail 完全一致（当前会话 > blocked >
 * running > pinned > completed > idle，再按更新时间），只是把委派子会话收纳到
 * 父条目下，并用会话树聚合状态参与排序。
 *
 * 排序只依赖传入的派生数据，不引入任何中间 state，因此点击后的置顶在同一次
 * 提交内完成，不会额外触发同步重渲染。
 */
export function getCollapsedAgentRailTrees(input: {
  sessions: readonly AgentSessionMeta[]
  workspaceId: string | null
  activeSessionId: string | null
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>
  unviewedCompletedSessionIds: ReadonlySet<string>
  limit?: number
}): AgentSessionTreeItem[] {
  const trees = buildWorkspaceAgentSessionTrees(
    input.sessions,
    input.workspaceId,
    input.agentIndicatorMap,
  )

  // 每棵树只聚合一次状态，排序比较器仅读取预计算值。
  const decoratedTrees = trees.map((tree) => ({
    tree,
    status: getCollapsedAgentRailTreeStatus(tree, input.agentIndicatorMap, input.unviewedCompletedSessionIds),
  }))
  const priority = (session: AgentSessionMeta, status: SessionIndicatorStatus): number => {
    if (session.id === input.activeSessionId) return 0
    if (status === 'blocked') return 1
    if (status === 'running') return 2
    if (session.pinned) return 3
    if (status === 'completed') return 4
    return 5
  }

  return decoratedTrees
    .sort((a, b) => {
      const priorityDelta = priority(a.tree.session, a.status) - priority(b.tree.session, b.status)
      if (priorityDelta !== 0) return priorityDelta
      return b.tree.session.updatedAt - a.tree.session.updatedAt
    })
    .slice(0, input.limit ?? 5)
    .map(({ tree }) => tree)
}
