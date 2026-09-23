import { expect, test } from 'bun:test'
import { BoundedAsyncLookupCache } from './agent-turn-usage-cache'

interface Usage {
  found: boolean
  totalCost: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createCache() {
  return new BoundedAsyncLookupCache<Usage>({
    ttlMs: 24 * 60 * 60 * 1000,
    maxEntries: 3,
    maxConcurrent: 2,
    shouldCache: (usage) => usage.found,
  })
}

test('coalesces concurrent lookups for one turn and caches ledger hits', async () => {
  const cache = createCache()
  const gate = deferred<Usage>()
  let calls = 0
  const loader = () => {
    calls += 1
    return gate.promise
  }

  const first = cache.getOrLoad('turn-1', loader)
  const second = cache.getOrLoad('turn-1', loader)
  expect(calls).toBe(1)

  gate.resolve({ found: true, totalCost: 1.25 })
  await expect(Promise.all([first, second])).resolves.toEqual([
    { found: true, totalCost: 1.25 },
    { found: true, totalCost: 1.25 },
  ])

  await expect(cache.getOrLoad('turn-1', loader)).resolves.toEqual({ found: true, totalCost: 1.25 })
  expect(calls).toBe(1)
})

test('does not cache ledger misses or failures', async () => {
  const cache = createCache()
  let calls = 0
  const missing = () => {
    calls += 1
    return Promise.resolve({ found: false, totalCost: 0 })
  }

  await cache.getOrLoad('turn-1', missing)
  await cache.getOrLoad('turn-1', missing)
  expect(calls).toBe(2)

  const failing = () => Promise.reject(new Error('temporary failure'))
  await expect(cache.getOrLoad('turn-2', failing)).rejects.toThrow('temporary failure')
  await expect(cache.getOrLoad('turn-2', failing)).rejects.toThrow('temporary failure')
})

test('limits distinct turn lookups to two concurrent API calls', async () => {
  const cache = createCache()
  const gates = Array.from({ length: 5 }, () => deferred<Usage>())
  let active = 0
  let maxActive = 0

  const requests = gates.map((gate, index) => cache.getOrLoad(`turn-${index}`, async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    try {
      return await gate.promise
    } finally {
      active -= 1
    }
  }))

  expect(maxActive).toBe(2)
  gates.forEach((gate, index) => gate.resolve({ found: true, totalCost: index }))
  await Promise.all(requests)
  expect(maxActive).toBe(2)
})

test('clearing account state drops successful cache entries', async () => {
  const cache = createCache()
  let calls = 0
  const loader = () => Promise.resolve({ found: true, totalCost: ++calls })

  await cache.getOrLoad('turn-1', loader)
  cache.clear()
  await expect(cache.getOrLoad('turn-1', loader)).resolves.toEqual({ found: true, totalCost: 2 })
  expect(calls).toBe(2)
})

test('a new account does not wait for the old generation active lookups', async () => {
  const cache = createCache()
  const oldGates = [deferred<Usage>(), deferred<Usage>()]
  const newGate = deferred<Usage>()
  let newCalls = 0

  const oldRequests = oldGates.map((gate, index) => cache.getOrLoad(`old-${index}`, () => gate.promise))
  cache.clear()
  const newRequest = cache.getOrLoad('new-1', () => {
    newCalls += 1
    return newGate.promise
  })

  expect(newCalls).toBe(1)
  newGate.resolve({ found: true, totalCost: 3 })
  await expect(newRequest).resolves.toEqual({ found: true, totalCost: 3 })

  oldGates.forEach((gate) => gate.resolve({ found: true, totalCost: 1 }))
  await Promise.all(oldRequests)
})
