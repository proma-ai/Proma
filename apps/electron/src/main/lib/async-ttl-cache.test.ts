import { describe, expect, test } from 'bun:test'
import { AsyncTtlCache } from './async-ttl-cache'

describe('AsyncTtlCache', () => {
  test('Given concurrent reads in one generation When loading Then shares one upstream request', async () => {
    const cache = new AsyncTtlCache<string>(5_000)
    let calls = 0
    let resolveLoad: ((value: string) => void) | undefined
    const loader = (): Promise<string> => {
      calls += 1
      return new Promise((resolve) => { resolveLoad = resolve })
    }

    const first = cache.getOrLoad(loader)
    const second = cache.getOrLoad(loader)
    expect(calls).toBe(1)

    resolveLoad?.('fresh')
    await expect(first).resolves.toBe('fresh')
    await expect(second).resolves.toBe('fresh')
    await expect(cache.getOrLoad(loader)).resolves.toBe('fresh')
    expect(calls).toBe(1)
  })

  test('Given a billing-change invalidation When an older request is still pending Then starts and keeps the fresh generation', async () => {
    const cache = new AsyncTtlCache<string>(5_000)
    const resolvers: Array<(value: string) => void> = []
    let calls = 0
    const loader = (): Promise<string> => {
      calls += 1
      return new Promise((resolve) => resolvers.push(resolve))
    }

    const stale = cache.getOrLoad(loader)
    cache.invalidate()
    const fresh = cache.getOrLoad(loader)
    expect(calls).toBe(2)

    resolvers[0]?.('stale')
    await expect(stale).resolves.toBe('stale')
    resolvers[1]?.('fresh')
    await expect(fresh).resolves.toBe('fresh')
    await expect(cache.getOrLoad(loader)).resolves.toBe('fresh')
    expect(calls).toBe(2)
  })
})
