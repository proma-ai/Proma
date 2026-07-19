import { describe, expect, test } from 'bun:test'
import type { Dispatcher } from 'undici'
import { buildPiRemoteConnectionSettings } from './pi-agent-adapter'
import {
  getPiRequestProxyDispatcher,
  runWithPiRequestProxy,
} from './pi-request-proxy'

describe('Pi request proxy', () => {
  test('Given Codex and an HTTP proxy When transport is unspecified Then defaults to SSE', () => {
    expect(buildPiRemoteConnectionSettings({
      provider: 'openai-codex',
      proxyUrl: 'http://127.0.0.1:7897',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7897',
      transport: 'sse',
    })
  })

  test('Given an explicit Codex transport When a proxy exists Then preserves the explicit transport', () => {
    expect(buildPiRemoteConnectionSettings({
      provider: 'openai-codex',
      proxyUrl: 'http://127.0.0.1:7897',
      transport: 'websocket',
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7897',
      transport: 'websocket',
    })
  })

  test('Given a non-Codex provider When a proxy exists Then does not alter its transport', () => {
    expect(buildPiRemoteConnectionSettings({
      provider: 'anthropic',
      proxyUrl: 'http://127.0.0.1:7897',
    })).toEqual({ httpProxy: 'http://127.0.0.1:7897' })
  })

  test('Given two concurrent Pi requests When each enters a proxy scope Then dispatchers do not cross-contaminate', async () => {
    const first = {} as Dispatcher
    const second = {} as Dispatcher

    const [firstSeen, secondSeen] = await Promise.all([
      runWithPiRequestProxy(first, async () => {
        await Bun.sleep(10)
        return getPiRequestProxyDispatcher()
      }),
      runWithPiRequestProxy(second, async () => {
        await Bun.sleep(1)
        return getPiRequestProxyDispatcher()
      }),
    ])

    expect(firstSeen).toBe(first)
    expect(secondSeen).toBe(second)
    expect(getPiRequestProxyDispatcher()).toBeUndefined()
  })

  test('Given runtime proxy environment When no explicit URL is provided Then uses it without mutating process environment', () => {
    const before = process.env.HTTPS_PROXY
    expect(buildPiRemoteConnectionSettings({
      provider: 'openai-codex',
      runtimeEnv: { env: { HTTPS_PROXY: 'http://127.0.0.1:7897' } },
    })).toEqual({
      httpProxy: 'http://127.0.0.1:7897',
      transport: 'sse',
    })
    expect(process.env.HTTPS_PROXY).toBe(before)
  })
})
