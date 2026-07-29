import { describe, expect, test } from 'bun:test'
import { getHeadlessAgentRunTarget } from './agent-headless-run-target'

interface FakeWebContents {
  id: string
  destroyed: boolean
  isDestroyed(): boolean
}

function createWebContents(id: string, destroyed = false): FakeWebContents {
  return {
    id,
    destroyed,
    isDestroyed() {
      return this.destroyed
    },
  }
}

describe('headless Agent renderer routing', () => {
  test('uses the originating session renderer before the generic main-window fallback', () => {
    const origin = createWebContents('origin')
    const fallback = createWebContents('fallback')

    const target = getHeadlessAgentRunTarget(
      new Map([['parent-session', origin]]),
      'parent-session',
      () => fallback,
    )

    expect(target).toBe(origin)
  })

  test('falls back when the originating renderer has been destroyed', () => {
    const origin = createWebContents('origin', true)
    const fallback = createWebContents('fallback')

    const target = getHeadlessAgentRunTarget(
      new Map([['parent-session', origin]]),
      'parent-session',
      () => fallback,
    )

    expect(target).toBe(fallback)
  })

  test('returns null when neither renderer can receive events', () => {
    const target = getHeadlessAgentRunTarget(
      new Map<string, FakeWebContents>(),
      'parent-session',
      () => null,
    )

    expect(target).toBeNull()
  })
})
