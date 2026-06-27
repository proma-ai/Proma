import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import {
  sortAgentSessionsByUpdatedAtDesc,
  replaceAgentSessionInFreshnessOrder,
  upsertAgentSession,
  mergeFetchedAgentSessions,
} from './agent-session-list'

function makeSession(
  id: string,
  updatedAt: number,
  extra: Partial<AgentSessionMeta> = {},
): AgentSessionMeta {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  }
}

describe('sortAgentSessionsByUpdatedAtDesc', () => {
  test('Given 乱序会话 When 排序 Then 按 updatedAt 降序', () => {
    const result = sortAgentSessionsByUpdatedAtDesc([
      makeSession('a', 1),
      makeSession('b', 3),
      makeSession('c', 2),
    ])
    expect(result.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('replaceAgentSessionInFreshnessOrder', () => {
  test('Given 列表中已有同 id When 用新元数据替换 Then 替换并重排', () => {
    const result = replaceAgentSessionInFreshnessOrder(
      [makeSession('a', 1), makeSession('b', 2)],
      makeSession('a', 5, { title: '新标题' }),
    )
    expect(result.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result.find((s) => s.id === 'a')?.title).toBe('新标题')
  })
})

describe('upsertAgentSession', () => {
  test('Given 列表无该会话 When upsert Then 追加并重排', () => {
    const result = upsertAgentSession(
      [makeSession('a', 1)],
      makeSession('b', 3),
    )
    expect(result.map((s) => s.id)).toEqual(['b', 'a'])
  })

  test('Given 列表已有该会话 When upsert Then 浅合并字段，保留未覆盖字段', () => {
    const result = upsertAgentSession(
      [makeSession('a', 1, { channelId: 'ch-1', workspaceId: 'ws-1' })],
      makeSession('a', 9, { title: '改名' }),
    )
    const a = result.find((s) => s.id === 'a')!
    expect(a.title).toBe('改名')
    expect(a.updatedAt).toBe(9)
    // 未在 incoming 中提供的字段从既有条目保留
    expect(a.channelId).toBe('ch-1')
    expect(a.workspaceId).toBe('ws-1')
  })

  test('核心回归：upsert 子会话时绝不删除其它会话（含刚结束 turn 的父会话）', () => {
    const parent = makeSession('parent', 10)
    const childA = makeSession('child-a', 11, {
      parentSessionId: 'parent',
      sourceDelegationId: 'del-a',
    })
    // 模拟：列表里已有父会话 + 子会话 a，现在子会话 b 启动
    const childB = makeSession('child-b', 12, {
      parentSessionId: 'parent',
      sourceDelegationId: 'del-b',
    })
    const result = upsertAgentSession([parent, childA], childB)
    // 父会话与子会话 a 都必须仍然在列表中
    expect(result.map((s) => s.id).sort()).toEqual(['child-a', 'child-b', 'parent'])
  })
})

describe('mergeFetchedAgentSessions', () => {
  test('Given 后端快照含全部会话 When 合并 Then 以快照为准并重排', () => {
    const prev = [makeSession('a', 1)]
    const fetched = [makeSession('a', 5), makeSession('b', 6)]
    const result = mergeFetchedAgentSessions(prev, fetched)
    expect(result.map((s) => s.id)).toEqual(['b', 'a'])
    expect(result.find((s) => s.id === 'a')?.updatedAt).toBe(5)
  })

  test('核心回归：陈旧快照缺失刚结束 turn 的父会话 When 合并 Then 父会话被保留不被冲掉', () => {
    // 父会话刚结束 turn，updatedAt 较新；但某个并发回调的 fetch 早于它落盘，快照里没有它
    const parent = makeSession('parent', 100)
    const childA = makeSession('child-a', 90, {
      parentSessionId: 'parent',
      sourceDelegationId: 'del-a',
    })
    const prev = [parent, childA]
    // 陈旧快照：只有 child-a，没有 parent（且没有比 parent 更新的条目）
    const staleFetched = [makeSession('child-a', 90)]
    const result = mergeFetchedAgentSessions(prev, staleFetched)
    // parent.updatedAt(100) >= 快照水位(90)，应被判定为「快照尚未看到的新条目」而保留
    expect(result.some((s) => s.id === 'parent')).toBe(true)
  })

  test('删除语义：后端确实删除的旧会话（updatedAt 早于快照水位）不被保留', () => {
    // old 会话已被后端删除，且它的 updatedAt 早于快照里的最新条目
    const old = makeSession('old', 1)
    const prev = [old, makeSession('keep', 5)]
    // 权威快照里没有 old，且快照水位(8) > old.updatedAt(1) → old 视为已删除
    const fetched = [makeSession('keep', 8)]
    const result = mergeFetchedAgentSessions(prev, fetched)
    expect(result.some((s) => s.id === 'old')).toBe(false)
    expect(result.some((s) => s.id === 'keep')).toBe(true)
  })

  test('幂等：prev 与 fetched 完全一致 When 合并 Then 内容不变', () => {
    const sessions = [makeSession('a', 5), makeSession('b', 3)]
    const result = mergeFetchedAgentSessions(sessions, sessions)
    expect(result.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result).toHaveLength(2)
  })
})
