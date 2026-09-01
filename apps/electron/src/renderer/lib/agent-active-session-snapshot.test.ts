import { describe, expect, test } from 'bun:test'
import {
  isTerminalEventForCurrentRun,
  mergeActiveAgentSessionSnapshot,
} from './agent-active-session-snapshot'

describe('mergeActiveAgentSessionSnapshot', () => {
  const snapshot = { sessionId: 'session-1', startedAt: 100, runGeneration: 1 }

  test('restores a missing renderer stream state from the main-process snapshot', () => {
    expect(mergeActiveAgentSessionSnapshot(undefined, snapshot)).toMatchObject({
      running: true,
      startedAt: 100,
      runGeneration: 1,
    })
  })

  test('does not resurrect a completed stream with an equal or newer generation', () => {
    const completedCurrent = { running: false, startedAt: 100, runGeneration: 1 }
    const newerCurrent = { running: false, startedAt: 100, runGeneration: 2 }

    expect(mergeActiveAgentSessionSnapshot(completedCurrent, snapshot)).toBe(completedCurrent)
    expect(mergeActiveAgentSessionSnapshot(newerCurrent, snapshot)).toBe(newerCurrent)
  })

  test('uses generation rather than colliding millisecond timestamps', () => {
    const current = { running: true, startedAt: 100, runGeneration: 2 }

    expect(mergeActiveAgentSessionSnapshot(current, snapshot)).toBe(current)
    expect(mergeActiveAgentSessionSnapshot(undefined, { ...snapshot, runGeneration: 2 }, {
      startedAt: 100,
      runGeneration: 2,
    })).toBeUndefined()
  })

  test('falls back to timestamps for old protocol events without generations', () => {
    const legacySnapshot = { sessionId: 'session-1', startedAt: 100 }
    const completedCurrent = { running: false, startedAt: 100 }

    expect(mergeActiveAgentSessionSnapshot(completedCurrent, legacySnapshot)).toBe(completedCurrent)
    expect(mergeActiveAgentSessionSnapshot(undefined, legacySnapshot, { startedAt: 100 })).toBeUndefined()
  })
})

describe('isTerminalEventForCurrentRun', () => {
  test('rejects a late terminal event from an older generation despite an identical timestamp', () => {
    expect(isTerminalEventForCurrentRun(
      { running: true, startedAt: 100, runGeneration: 2 },
      { startedAt: 100, runGeneration: 1 },
    )).toBe(false)
  })
})
