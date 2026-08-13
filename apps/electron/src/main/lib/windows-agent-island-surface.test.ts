import { describe, expect, test } from 'bun:test'
import {
  detectPhaseTransitions,
  WindowsAgentIslandSurface,
  mapTransitionToSoundType,
  processNotification,
  type PhaseTransition,
  type SurfaceDeps,
} from './windows-agent-island-surface'
import type { AgentIslandPhase, AgentIslandInteractionKind, NativeAgentIslandSnapshot } from '@proma/shared'

function makeSnapshot(
  sessions: Array<{
    sessionId: string
    phase: AgentIslandPhase
    detail?: string
    title?: string
    attention?: boolean
  }>,
): NativeAgentIslandSnapshot {
  return {
    type: 'snapshot',
    protocol: 1,
    revision: 1,
    state: {
      visible: true,
      presentation: 'compact',
      hovered: false,
      expanded: false,
      pill: {
        priorityStatus: 'idle',
        sessionCount: sessions.length,
        activeSessionCount: 0,
        pendingInteractionCount: 0,
        unreadCompletedCount: 0,
      },
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title ?? s.sessionId,
        phase: s.phase,
        detail: s.detail ?? '',
        activityLines: [],
        attention: s.attention ?? false,
        startedAt: 0,
        lastActivityAt: 0,
      })),
      recentSessions: [],
      idleDashboard: false,
      totalCount: sessions.length,
      updatedAt: 0,
    },
    planning: { dayStart: 0, dayEnd: 0, todos: [], events: [], overdueTodoCount: 0 },
    planQuotas: [],
  }
}

function makePhases(entries: Record<string, AgentIslandPhase>): Map<string, AgentIslandPhase> {
  return new Map(Object.entries(entries))
}

describe('detectPhaseTransitions', () => {
  test('running → completed 产生 1 个 transition', () => {
    const prev = makePhases({ s1: 'running' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'completed' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(1)
    expect(result[0]!.from).toBe('running')
    expect(result[0]!.to).toBe('completed')
  })

  test('running → needs-interaction 产生 1 个 transition', () => {
    const prev = makePhases({ s1: 'running' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'needs-interaction' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(1)
    expect(result[0]!.to).toBe('needs-interaction')
  })

  test('running → error 产生 1 个 transition', () => {
    const prev = makePhases({ s1: 'running' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'error', attention: true }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(1)
    expect(result[0]!.to).toBe('error')
  })

  test('running → running（detail 变化）不产生 transition', () => {
    const prev = makePhases({ s1: 'running' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'running', detail: '新内容' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(0)
  })

  test('needs-interaction → running 不产生 transition', () => {
    const prev = makePhases({ s1: 'needs-interaction' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'running' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(0)
  })

  test('新会话直接 completed 产生 transition', () => {
    const prev = makePhases({})
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'completed' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(1)
    expect(result[0]!.from).toBe('idle')
    expect(result[0]!.to).toBe('completed')
  })

  test('新会话直接 running 不产生 transition', () => {
    const prev = makePhases({})
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'running' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(0)
  })

  test('多会话各自独立检测（A 完成 + B 报错 → 2 个 transition）', () => {
    const prev = makePhases({ A: 'running', B: 'running' })
    const curr = makeSnapshot([
      { sessionId: 'A', phase: 'completed' },
      { sessionId: 'B', phase: 'error', attention: true },
    ])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(2)
  })

  test('会话从 snapshot 消失不产生 transition', () => {
    const prev = makePhases({ s1: 'running', s2: 'running' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'completed' }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('s1')
  })

  test('空 snapshot → 有会话的 snapshot：running 不通知，其余通知', () => {
    const prev = makePhases({})
    const curr = makeSnapshot([
      { sessionId: 'a', phase: 'running' },
      { sessionId: 'b', phase: 'needs-interaction' },
      { sessionId: 'c', phase: 'completed' },
      { sessionId: 'd', phase: 'error', attention: true },
    ])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.sessionId).sort()).toEqual(['b', 'c', 'd'])
  })

  test('相同 snapshot 重复传入不产生 transition', () => {
    const prev = makePhases({ s1: 'running', s2: 'needs-interaction' })
    const curr = makeSnapshot([
      { sessionId: 's1', phase: 'running' },
      { sessionId: 's2', phase: 'needs-interaction' },
    ])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(0)
  })

  test('error attention=false 不产生 transition', () => {
    const prev = makePhases({ s1: 'running' })
    const curr = makeSnapshot([{ sessionId: 's1', phase: 'error', attention: false }])
    const result = detectPhaseTransitions(prev, curr)
    expect(result).toHaveLength(0)
  })
})

describe('WindowsAgentIslandSurface', () => {
  test('onSnapshot 首次传入 tracking running，完成时产生 transition', () => {
    const surface = new WindowsAgentIslandSurface(() => true)
    const notified: PhaseTransition[] = []
    surface.onNotification = (t) => notified.push(t)

    surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'running' }]))
    expect(notified).toHaveLength(0)

    surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'completed' }]))
    expect(notified).toHaveLength(1)
    expect(notified[0]!.to).toBe('completed')
  })

  test('onTrayFlash 反映是否存在 attention 会话', () => {
    const surface = new WindowsAgentIslandSurface(() => true)
    const flashes: boolean[] = []
    surface.onTrayFlash = (f) => flashes.push(f)

    surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'running' }]))
    surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'running', attention: true }]))
    surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'running' }]))
    expect(flashes).toEqual([false, true, false])
  })

  test('onHoverWindowUpdate 每次调用时收到 snapshot', () => {
    const surface = new WindowsAgentIslandSurface(() => true)
    const received: NativeAgentIslandSnapshot[] = []
    surface.onHoverWindowUpdate = (s) => received.push(s)

    const snap = makeSnapshot([{ sessionId: 's1', phase: 'running' }])
    surface.onSnapshot(snap)
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(snap)
  })

  test('回调未设置时安全执行（no-op）', () => {
    const surface = new WindowsAgentIslandSurface(() => true)
    expect(() => surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'completed' }]))).not.toThrow()
  })

  test('禁用分支调用 onTrayFlash(false) 且不产生 hover 更新', () => {
    const surface = new WindowsAgentIslandSurface(() => false)
    const flashes: boolean[] = []
    const hoverUpdates: NativeAgentIslandSnapshot[] = []
    surface.onTrayFlash = (f) => flashes.push(f)
    surface.onHoverWindowUpdate = (s) => hoverUpdates.push(s)

    surface.onSnapshot(makeSnapshot([{ sessionId: 's1', phase: 'running' }]))
    expect(flashes).toEqual([false])
    expect(hoverUpdates).toHaveLength(0)
  })
})

function makeTransition(
  to: AgentIslandPhase,
  opts?: { interactionKind?: AgentIslandInteractionKind; title?: string; detail?: string },
): PhaseTransition {
  return {
    sessionId: 's1',
    from: 'running',
    to,
    title: opts?.title ?? 'Test Session',
    detail: opts?.detail ?? 'some detail',
    interactionKind: opts?.interactionKind,
  }
}

function makeMockDeps(overrides?: Partial<SurfaceDeps>): SurfaceDeps & {
  calls: { sendPlaySound: string[] }
} {
  const calls = {
    sendPlaySound: [] as string[],
  }
  return {
    soundEnabled: overrides?.soundEnabled ?? (() => true),
    sendPlaySound: (type) => calls.sendPlaySound.push(type),
    calls,
  }
}

describe('mapTransitionToSoundType', () => {
  test('needs-interaction + permission → permissionRequest', () => {
    expect(mapTransitionToSoundType(makeTransition('needs-interaction', { interactionKind: 'permission' }))).toBe('permissionRequest')
  })

  test('needs-interaction + ask_user_question → permissionRequest', () => {
    expect(mapTransitionToSoundType(makeTransition('needs-interaction', { interactionKind: 'ask_user_question' }))).toBe('permissionRequest')
  })

  test('needs-interaction + plan_review → exitPlanMode', () => {
    expect(mapTransitionToSoundType(makeTransition('needs-interaction', { interactionKind: 'plan_review' }))).toBe('exitPlanMode')
  })

  test('completed → taskComplete', () => {
    expect(mapTransitionToSoundType(makeTransition('completed'))).toBe('taskComplete')
  })

  test('error → taskComplete', () => {
    expect(mapTransitionToSoundType(makeTransition('error'))).toBe('taskComplete')
  })
})

describe('processNotification', () => {
  test('soundEnabled=false 不播放提示音', () => {
    const deps = makeMockDeps({ soundEnabled: () => false })
    processNotification(makeTransition('needs-interaction', { interactionKind: 'permission' }), deps)
    expect(deps.calls.sendPlaySound).toHaveLength(0)
  })

  test('soundEnabled=true 播放 needs-interaction 对应提示音', () => {
    const deps = makeMockDeps()
    processNotification(makeTransition('needs-interaction', { interactionKind: 'permission' }), deps)
    expect(deps.calls.sendPlaySound).toEqual(['permissionRequest'])
  })

  test('soundEnabled=true 播放 completed 对应提示音', () => {
    const deps = makeMockDeps()
    processNotification(makeTransition('completed'), deps)
    expect(deps.calls.sendPlaySound).toEqual(['taskComplete'])
  })
})
