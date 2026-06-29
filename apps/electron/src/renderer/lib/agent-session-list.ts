import type { AgentSessionMeta } from '@proma/shared'

interface AgentSessionTreeLike {
  session: Pick<AgentSessionMeta, 'id'>
  childSessions: readonly Pick<AgentSessionMeta, 'id'>[]
}

/** 按最近更新时间排序 Agent 会话，保持与主进程 listAgentSessions 一致。 */
export function sortAgentSessionsByUpdatedAtDesc(
  sessions: readonly AgentSessionMeta[],
): AgentSessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
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
 * 折中策略：以 `fetched` 为基底（保留删除语义），但对本地存在、fetched
 * 缺失、且本地 updatedAt 不早于本次快照里最大 updatedAt 的条目予以保留
 * （视为「比这份快照更新、尚未被 fetch 看到」的乐观条目，而非已删除）。
 * 这样既能反映真实删除，又能抵御陈旧快照回冲。
 */
export function mergeFetchedAgentSessions(
  prev: readonly AgentSessionMeta[],
  fetched: readonly AgentSessionMeta[],
): AgentSessionMeta[] {
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

  return sortAgentSessionsByUpdatedAtDesc([...fetched, ...survivingLocalOnly])
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
