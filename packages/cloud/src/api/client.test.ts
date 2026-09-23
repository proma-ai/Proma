import { afterEach, expect, test } from 'bun:test'
import { createApiClient, isApiError } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('retries a GET once after a transient network failure', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) throw new TypeError('fetch failed')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as unknown as typeof fetch

  await expect(createApiClient().get<{ ok: boolean }>('/health')).resolves.toMatchObject({ data: { ok: true } })
  expect(calls).toBe(2)
})

test('does not retry a non-idempotent mutation', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch

  await expect(createApiClient().post('/profile', { name: 'test' })).rejects.toMatchObject({
    kind: 'network', retryable: true,
  })
  expect(calls).toBe(1)
})

test('returns a safe server failure without raw response detail', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ detail: 'internal database hostname' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch

  try {
    await createApiClient().get('/health')
    throw new Error('expected failure')
  } catch (error) {
    expect(isApiError(error)).toBe(true)
    if (!isApiError(error)) return
    expect(error.kind).toBe('server')
    expect(error.message).toBe('Proma Cloud 暂时不可用，请稍后重试')
    expect(error.message).not.toContain('hostname')
  }
})

test('does not retry an authentication failure', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response('{}', { status: 401 })
  }) as unknown as typeof fetch

  await expect(createApiClient().get('/auth/me')).rejects.toMatchObject({ kind: 'auth', retryable: false })
  expect(calls).toBe(1)
})
