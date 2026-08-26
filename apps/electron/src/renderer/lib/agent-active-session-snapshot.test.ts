import { describe, expect, test } from 'bun:test'
import { mergeActiveAgentSessionSnapshot } from './agent-active-session-snapshot'

describe('mergeActiveAgentSessionSnapshot', () => {
  const snapshot = { sessionId: 'session-1', startedAt: 100 }

  test('restores a missing renderer stream state from the main-process snapshot', () => {
    expect(mergeActiveAgentSessionSnapshot(undefined, snapshot)).toMatchObject({
      running: true,
      startedAt: 100,
    })
  })

  test('does not resurrect a completed stream with an equal or newer run marker', () => {
    const completedCurrent = { running: false, startedAt: 100 }
    const newerCurrent = { running: false, startedAt: 200 }

    expect(mergeActiveAgentSessionSnapshot(completedCurrent, snapshot)).toBe(completedCurrent)
    expect(mergeActiveAgentSessionSnapshot(newerCurrent, snapshot)).toBe(newerCurrent)
  })

  test('keeps the current run when it is at least as new as the snapshot', () => {
    const current = { running: true, startedAt: 100, model: 'gpt-5.6' }

    expect(mergeActiveAgentSessionSnapshot(current, snapshot)).toBe(current)
  })

  test('does not resurrect a completed run after its renderer state was reclaimed', () => {
    expect(mergeActiveAgentSessionSnapshot(undefined, snapshot, 100)).toBeUndefined()
  })
})
