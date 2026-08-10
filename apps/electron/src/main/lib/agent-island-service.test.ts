import { describe, expect, test } from 'bun:test'
import { buildVisibilityKey } from './agent-island-visibility'
import type { AgentIslandState } from '@proma/shared'

/**
 * 回归测试：# 刘海悬浮窗执行中关不掉
 *
 * 旧实现把 running 会话的 lastActivityAt（毫秒级）与 detail 计入 visibility key，
 * dismiss 后下一条 token/工具事件就会让 key 变化，岛立即重新弹出。
 * 修复后 running 会话只保留稳定指纹（sessionId:phase），
 * 只有状态跳变（needs-interaction / error / completed）或新会话出现时才重新唤起。
 */

function runningSession(sessionId: string, lastActivityAt = 1_000, detail = '正在使用 Bash'): AgentIslandState['sessions'][number] {
  return {
    sessionId,
    title: 'test',
    phase: 'running',
    detail,
    activityLines: [],
    attention: false,
    startedAt: 0,
    lastActivityAt,
  }
}

function completedSession(sessionId: string, lastActivityAt = 5_000, detail = '已完成'): AgentIslandState['sessions'][number] {
  return {
    sessionId,
    title: 'test',
    phase: 'completed',
    detail,
    activityLines: [],
    attention: true,
    startedAt: 0,
    lastActivityAt,
  }
}

function baseState(sessions: AgentIslandState['sessions']): AgentIslandState {
  return {
    visible: true,
    presentation: 'compact',
    hovered: false,
    expanded: false,
    pill: { priorityStatus: 'idle', sessionCount: 0, activeSessionCount: 0, pendingInteractionCount: 0, unreadCompletedCount: 0 },
    sessions,
    recentSessions: [],
    idleDashboard: false,
    totalCount: sessions.length,
    updatedAt: 0,
  }
}

describe('buildVisibilityKey', () => {
  test('running 会话的活动变化（token/工具流）不改变 key，dismiss 后不会重新弹出', () => {
    const before = buildVisibilityKey(
      baseState([runningSession('s1', 1_000, '正在使用 Bash')]),
      [],
    )
    // 模拟 200ms 后新的 token / 工具事件更新了 lastActivityAt 与 detail
    const after = buildVisibilityKey(
      baseState([runningSession('s1', 1_200, '正在使用 Grep')]),
      [],
    )
    expect(after).toBe(before)
  })

  test('running → completed 状态跳变会改变 key（新的完成结果应重新提醒）', () => {
    const running = buildVisibilityKey(
      baseState([runningSession('s1')]),
      [],
    )
    const completed = buildVisibilityKey(
      baseState([completedSession('s1')]),
      [],
    )
    expect(completed).not.toBe(running)
  })

  test('running → needs-interaction 状态跳变会改变 key（新的权限/提问阻塞应重新提醒）', () => {
    const running = buildVisibilityKey(
      baseState([runningSession('s1')]),
      [],
    )
    const blocking = buildVisibilityKey(
      baseState([{ ...runningSession('s1'), phase: 'needs-interaction', detail: '等待权限确认', attention: true }]),
      [],
    )
    expect(blocking).not.toBe(running)
  })

  test('新 running 会话出现会改变 key（新任务开始应重新唤起）', () => {
    const one = buildVisibilityKey(
      baseState([runningSession('s1')]),
      [],
    )
    const two = buildVisibilityKey(
      baseState([runningSession('s1'), runningSession('s2')]),
      [],
    )
    expect(two).not.toBe(one)
  })

  test('planning key 变化仍会重新唤起（新到期 Todo/日程提醒不受影响）', () => {
    const empty = buildVisibilityKey(
      baseState([runningSession('s1')]),
      [],
    )
    const withPlanning = buildVisibilityKey(
      baseState([runningSession('s1')]),
      ['t:todo-1'],
    )
    expect(withPlanning).not.toBe(empty)
  })
})
