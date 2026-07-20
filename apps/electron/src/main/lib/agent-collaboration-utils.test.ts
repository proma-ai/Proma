import { describe, expect, test } from 'bun:test'
import { createToolCallIdempotencyCache } from './agent-collaboration-utils'

describe('协作委派重放保护', () => {
  test('相同父会话和 toolCallId 只执行一次副作用', () => {
    const cache = createToolCallIdempotencyCache<{ delegationId: string }>()
    let creations = 0

    const first = cache.getOrCreate('parent-a', 'call-1', () => {
      creations += 1
      return { delegationId: 'delegation-1' }
    })
    const replay = cache.getOrCreate('parent-a', 'call-1', () => {
      creations += 1
      return { delegationId: 'delegation-2' }
    })

    expect(creations).toBe(1)
    expect(replay).toBe(first)
    expect(replay.delegationId).toBe('delegation-1')
  })

  test('不同父会话或 toolCallId 仍可创建独立委派', () => {
    const cache = createToolCallIdempotencyCache<number>()
    let creations = 0
    const create = () => ++creations

    expect(cache.getOrCreate('parent-a', 'call-1', create)).toBe(1)
    expect(cache.getOrCreate('parent-a', 'call-2', create)).toBe(2)
    expect(cache.getOrCreate('parent-b', 'call-1', create)).toBe(3)
  })

})
