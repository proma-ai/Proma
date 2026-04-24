/**
 * Working Atoms — Working 区域的派生状态
 *
 * 独立文件以避免 agent-atoms ↔ tab-atoms 循环依赖。
 * 依赖关系：agent-atoms + tab-atoms + draft-session-atoms → working-atoms
 */

import { atom } from 'jotai'
import type { AgentSessionMeta } from '@proma/shared'
import {
  agentSessionsAtom,
  agentSessionIndicatorMapAtom,
  workingDoneSessionIdsAtom,
} from './agent-atoms'
import { tabsAtom } from './tab-atoms'
import { draftSessionIdsAtom } from './draft-session-atoms'

/** Working 区域三组会话 */
export interface WorkingSessionGroups {
  todo: AgentSessionMeta[]
  running: AgentSessionMeta[]
  done: AgentSessionMeta[]
}

/**
 * 派生 atom：计算 Working 区域的三组会话（跨工作区，不按当前工作区过滤）
 * - todo: blocked（orange，等待用户决策）
 * - running: running（blue，Agent 执行中）
 * - done: 完成且 Tab 仍打开（green / idle），包含手动标记为工作中的会话
 *
 * manualWorking 会话始终纳入工作中，按当前 indicator 分配到对应子组
 */
export const workingSessionGroupsAtom = atom<WorkingSessionGroups>((get) => {
  const sessions = get(agentSessionsAtom)
  const indicatorMap = get(agentSessionIndicatorMapAtom)
  const doneIds = get(workingDoneSessionIdsAtom)
  const tabs = get(tabsAtom)
  const draftIds = get(draftSessionIdsAtom)

  const sessionMap = new Map(sessions.map((s) => [s.id, s]))
  const openAgentTabIds = new Set(
    tabs.filter((t) => t.type === 'agent').map((t) => t.sessionId),
  )

  const todo: AgentSessionMeta[] = []
  const running: AgentSessionMeta[] = []
  const done: AgentSessionMeta[] = []
  const includedIds = new Set<string>()

  // 从 indicatorMap 提取 blocked + running
  for (const [id, status] of indicatorMap) {
    const session = sessionMap.get(id)
    if (!session || draftIds.has(id)) continue
    if (status === 'blocked') { todo.push(session); includedIds.add(id) }
    else if (status === 'running') { running.push(session); includedIds.add(id) }
  }

  // 从 workingDoneSessionIdsAtom 提取 done
  for (const id of doneIds) {
    if (includedIds.has(id)) continue
    if (!openAgentTabIds.has(id)) continue
    const session = sessionMap.get(id)
    if (!session || draftIds.has(id)) continue
    done.push(session)
    includedIds.add(id)
  }

  // manualWorking 会话：按当前 indicator 分配到对应子组
  for (const session of sessions) {
    if (!session.manualWorking || draftIds.has(session.id) || includedIds.has(session.id)) continue
    const status = indicatorMap.get(session.id)
    if (status === 'blocked') { todo.push(session); includedIds.add(session.id) }
    else if (status === 'running') { running.push(session); includedIds.add(session.id) }
    else { done.push(session); includedIds.add(session.id) }
  }

  const byDate = (a: AgentSessionMeta, b: AgentSessionMeta): number =>
    b.updatedAt - a.updatedAt
  todo.sort(byDate)
  running.sort(byDate)
  done.sort(byDate)

  return { todo, running, done }
})

/** Working 区域中所有会话 ID 的集合（用于从 Pinned 和日期分组列表中排除） */
export const workingSessionIdsSetAtom = atom<Set<string>>((get) => {
  const { todo, running, done } = get(workingSessionGroupsAtom)
  const set = new Set<string>()
  for (const s of todo) set.add(s.id)
  for (const s of running) set.add(s.id)
  for (const s of done) set.add(s.id)
  return set
})
