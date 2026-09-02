import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

interface AgentSessionTreeLike {
  session: Pick<AgentSessionMeta, 'id'>
  childSessions: readonly Pick<AgentSessionMeta, 'id'>[]
}

const DELEGATION_STATUS_ICON_CLASS: Readonly<Record<SessionIndicatorStatus, string>> = {
  idle: 'text-foreground/40',
  running: 'text-blue-500',
  blocked: 'text-orange-500',
  completed: 'text-green-500',
}

/** Keep delegated-session status colors identical wherever its GitBranch icon is rendered. */
export function getDelegationStatusIconClass(status: SessionIndicatorStatus): string {
  return DELEGATION_STATUS_ICON_CLASS[status]
}

/** 按最近更新时间排序 Agent 会话，保持与主进程 listAgentSessions 一致。 */
export function sortAgentSessionsByUpdatedAtDesc(
  sessions: readonly AgentSessionMeta[],
): AgentSessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Agent 归档会话的顶层项目分组。 */
export interface ArchivedAgentSessionProjectGroup {
  /** 稳定的虚拟列表 key；不对应真实项目的分组使用保留 ID。 */
  id: string
  label: string
  kind: 'workspace' | 'automation' | 'unassigned'
  /** 真实项目分组保留元数据，以复用活跃项目的视觉标识。 */
  workspace?: AgentWorkspace
  sessions: AgentSessionMeta[]
}

const ARCHIVED_AUTOMATION_GROUP_ID = '__archived-automations__'
const ARCHIVED_UNASSIGNED_GROUP_ID = '__archived-unassigned__'

/**
 * 将归档会话按所属项目组织，保留自动任务和遗留无归属会话的独立入口。
 *
 * 只输出非空分组：真实项目顺序跟随当前工作区顺序，自动任务与未归属项目
 * 固定置后，避免历史会话被误归入默认项目。
 */
export function groupArchivedAgentSessionsByProject({
  sessions,
  workspaces,
  excludedSessionIds = new Set<string>(),
}: {
  sessions: readonly AgentSessionMeta[]
  workspaces: readonly AgentWorkspace[]
  excludedSessionIds?: ReadonlySet<string>
}): ArchivedAgentSessionProjectGroup[] {
  const sessionsByWorkspaceId = new Map<string, AgentSessionMeta[]>(
    workspaces.map((workspace) => [workspace.id, []]),
  )
  const automationSessions: AgentSessionMeta[] = []
  const unassignedSessions: AgentSessionMeta[] = []

  for (const session of sessions) {
    if (!session.archived || session.isDraft || excludedSessionIds.has(session.id)) continue
    if (session.sourceAutomationId) {
      automationSessions.push(session)
      continue
    }

    const workspaceSessions = session.workspaceId
      ? sessionsByWorkspaceId.get(session.workspaceId)
      : undefined
    if (workspaceSessions) {
      workspaceSessions.push(session)
    } else {
      unassignedSessions.push(session)
    }
  }

  const groups: ArchivedAgentSessionProjectGroup[] = []
  for (const workspace of workspaces) {
    const workspaceSessions = sessionsByWorkspaceId.get(workspace.id) ?? []
    if (workspaceSessions.length === 0) continue
    groups.push({
      id: workspace.id,
      label: workspace.name,
      kind: 'workspace',
      workspace,
      sessions: sortAgentSessionsByUpdatedAtDesc(workspaceSessions),
    })
  }
  if (automationSessions.length > 0) {
    groups.push({
      id: ARCHIVED_AUTOMATION_GROUP_ID,
      label: '定时任务',
      kind: 'automation',
      sessions: sortAgentSessionsByUpdatedAtDesc(automationSessions),
    })
  }
  if (unassignedSessions.length > 0) {
    groups.push({
      id: ARCHIVED_UNASSIGNED_GROUP_ID,
      label: '未归属项目',
      kind: 'unassigned',
      sessions: sortAgentSessionsByUpdatedAtDesc(unassignedSessions),
    })
  }
  return groups
}

/** 用后端返回的新元数据替换本地条目，并按最近更新时间重新排序。 */
export function replaceAgentSessionInFreshnessOrder(
  sessions: readonly AgentSessionMeta[],
  updated: AgentSessionMeta,
): AgentSessionMeta[] {
  const others = sessions.filter((session) => session.id !== updated.id)
  return sortAgentSessionsByUpdatedAtDesc([updated, ...others])
}

/**
 * 仅插入或更新单个会话条目，保留其余条目原样。
 *
 * 用于 external_run_started 等「我只知道这一个会话的新状态」的场景：
 * 绝不删除其它会话。这避免了用一份可能陈旧的全量快照整体覆盖
 * agentSessionsAtom 时，把刚结束 turn 的父会话等条目意外冲掉的竞态。
 *
 * 若传入条目不携带比本地更新的 updatedAt（例如事件 payload 里没有权威
 * updatedAt），可只传 id + 部分字段，函数会以本地条目为基底浅合并。
 */
export function upsertAgentSession(
  sessions: readonly AgentSessionMeta[],
  incoming: AgentSessionMeta,
): AgentSessionMeta[] {
  const existing = sessions.find((session) => session.id === incoming.id)
  const merged: AgentSessionMeta = existing
    ? { ...existing, ...incoming }
    : incoming
  const others = sessions.filter((session) => session.id !== incoming.id)
  return sortAgentSessionsByUpdatedAtDesc([merged, ...others])
}

/**
 * 把后端权威全量快照合并进本地列表。
 *
 * `fetched` 来自 listAgentSessions()，是后端的权威全量列表，因此天然
 * 携带「删除」语义——本地有、fetched 没有的会话，原则上视为已删除。
 *
 * 但在高并发场景下（一次派发多个子会话），多个 external_run_started /
 * STREAM_COMPLETE 回调会各自异步 listAgentSessions() 再整体 set，谁后
 * resolve 谁覆盖（last-write-wins）。某个回调 fetch 的时刻若早于另一个新
 * 会话落盘，它的快照里就缺这个会话；整体覆盖会把它冲掉，且后续不再有事件
 * 把它写回——这正是父会话「从列表消失且不回来」的根因。
 *
 * 折中策略：以 `fetched` 为基底（保留删除语义），但会同时保留两种本地新状态：
 * - fetched 缺失、且本地 updatedAt 不早于快照水位的条目；
 * - fetched 同 ID 但其 updatedAt 不晚于本地的条目（例如 TITLE_UPDATED 已抵达，
 *   但该 fetch 在标题落盘前已开始）。
 *
 * 这样既能反映真实删除，又能抵御陈旧快照回冲。
 */
export function mergeFetchedAgentSessions(
  prev: readonly AgentSessionMeta[],
  fetched: readonly AgentSessionMeta[],
): AgentSessionMeta[] {
  const previousById = new Map(prev.map((session) => [session.id, session]))
  const fetchedIds = new Set(fetched.map((session) => session.id))
  // 本次快照所反映的“数据新鲜度水位”：快照里最大的 updatedAt。
  // 比它更新的本地条目，说明在该快照生成之后才出现/更新，不能被它判定为删除。
  const snapshotWatermark = fetched.reduce(
    (max, session) => Math.max(max, session.updatedAt),
    0,
  )

  // 保留本地存在、fetched 缺失、且不早于水位的条目（疑似并发新建尚未被本快照看到）。
  const survivingLocalOnly = prev.filter(
    (session) =>
      !fetchedIds.has(session.id) && session.updatedAt >= snapshotWatermark,
  )

  // 同 ID 的旧快照不能覆盖已通过事件即时写入的本地状态。等值也保留本地，
  // 因为 TITLE_UPDATED 事件不携带权威 updatedAt，时间戳可能尚未来得及同步。
  const mergedFetched = fetched.map((session) => {
    const local = previousById.get(session.id)
    return local && local.updatedAt >= session.updatedAt ? local : session
  })

  return sortAgentSessionsByUpdatedAtDesc([...mergedFetched, ...survivingLocalOnly])
}

/** 收集可见会话树里的父/子会话 id，用于判断当前会话是否已显示在侧栏中。 */
export function collectAgentSessionTreeIds(
  items: readonly AgentSessionTreeLike[],
): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    ids.add(item.session.id)
    for (const child of item.childSessions) ids.add(child.id)
  }
  return ids
}

export function isAgentSessionVisibleInTrees(
  items: readonly AgentSessionTreeLike[],
  sessionId: string | null,
): boolean {
  if (!sessionId) return false
  return collectAgentSessionTreeIds(items).has(sessionId)
}

/** The stable delegation observation slot is visible in a single pane or either split pane. */
export function isDelegationObservationVisible(
  sidePanelOpen: boolean,
  activeSidePanelTab: string | undefined,
  split: { leftTab: string; rightTab: string } | null,
): boolean {
  if (!sidePanelOpen) return false
  return split
    ? split.leftTab === 'delegation' || split.rightTab === 'delegation'
    : activeSidePanelTab === 'delegation'
}

/** Replace the delegated child shown in one parent's single observation slot. */
export function selectDelegatedSession(
  selections: Map<string, string>,
  parentSessionId: string,
  childSessionId: string,
): Map<string, string> {
  if (selections.get(parentSessionId) === childSessionId) return selections
  const next = new Map(selections)
  next.set(parentSessionId, childSessionId)
  return next
}

/** Remove a deleted parent or child from the delegated-session observation slots. */
export function removeDelegatedSessionSelection(
  selections: Map<string, string>,
  sessionId: string,
): Map<string, string> {
  let changed = false
  const next = new Map(selections)
  if (next.delete(sessionId)) changed = true
  for (const [parentSessionId, childSessionId] of next) {
    if (childSessionId !== sessionId) continue
    next.delete(parentSessionId)
    changed = true
  }
  return changed ? next : selections
}

/**
 * Resolve a delegated child's current sidebar status. A live status takes
 * precedence over the persisted delegation status after the child is rerun.
 */
export function getDelegatedChildSessionStatus(
  session: AgentSessionMeta,
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>,
): SessionIndicatorStatus {
  const status = agentIndicatorMap.get(session.id)
  if (status) return status
  return session.delegationStatus === 'running' ? 'running' : 'idle'
}

/**
 * Count direct children whose current sidebar state has settled. This must use
 * the same status source as child rows so parent progress cannot disagree.
 */
export function countSettledDelegatedChildren(
  childSessions: readonly AgentSessionMeta[],
  agentIndicatorMap: ReadonlyMap<string, SessionIndicatorStatus>,
): number {
  return childSessions.filter((session) => {
    const status = getDelegatedChildSessionStatus(session, agentIndicatorMap)
    return status !== 'running' && status !== 'blocked'
  }).length
}
