import { afterEach, describe, expect, mock, test } from 'bun:test'

const getEffectiveProxyUrl = mock<() => Promise<string | undefined>>()

mock.module('./proxy-settings-service', () => ({ getEffectiveProxyUrl }))

const { buildOAuthNoProxy, runWithOAuthProxyScope } = await import('./oauth-proxy-scope')
const { getPiRequestProxyDispatcher } = await import('./adapters/pi-request-proxy')

afterEach(() => {
  getEffectiveProxyUrl.mockReset()
})

describe('OAuth proxy scope', () => {
  test('Given a user NO_PROXY list When building OAuth exclusions Then preserves it and includes every loopback host', () => {
    expect(buildOAuthNoProxy('internal.example,localhost')).toBe('internal.example,localhost,127.0.0.1,[::1]')
  })

  test('Given an application proxy When running OAuth Then scopes the entire operation to that proxy', async () => {
    getEffectiveProxyUrl.mockResolvedValue('http://127.0.0.1:7890')

    await expect(runWithOAuthProxyScope(async () => {
      expect(getPiRequestProxyDispatcher()).toBeDefined()
      return 'token'
    })).resolves.toBe('token')

    expect(getPiRequestProxyDispatcher()).toBeUndefined()
  })

  test('Given no configured proxy When running OAuth Then preserves direct networking while retaining loopback exclusions', async () => {
    getEffectiveProxyUrl.mockResolvedValue(undefined)

    await expect(runWithOAuthProxyScope(async () => {
      expect(getPiRequestProxyDispatcher()).toBeUndefined()
      return 'token'
    })).resolves.toBe('token')
  })
})
