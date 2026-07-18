import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CodexOAuthCredentials } from '@proma/shared'

const proxyFetch = (() => Promise.resolve(new Response())) as unknown as typeof globalThis.fetch
const getEffectiveProxyUrl = mock(async (): Promise<string | undefined> => 'http://127.0.0.1:7890')
const getFetchFn = mock((_proxyUrl?: string): typeof globalThis.fetch => proxyFetch)
const loginOpenAICodex = mock(async (_options: unknown): Promise<CodexOAuthCredentials> => ({
  access: 'access-token',
  refresh: 'refresh-token',
  expires: 1,
  accountId: 'account-id',
}))
const refreshOpenAICodexToken = mock(async (_refreshToken: string, _options: unknown): Promise<CodexOAuthCredentials> => ({
  access: 'refreshed-access-token',
  refresh: 'refreshed-refresh-token',
  expires: 2,
  accountId: 'account-id',
}))

mock.module('electron', () => ({
  shell: {
    openExternal: async () => undefined,
  },
}))

mock.module('@earendil-works/pi-ai/oauth', () => ({
  loginOpenAICodex,
  refreshOpenAICodexToken,
}))

mock.module('./proxy-fetch', () => ({ getFetchFn }))
mock.module('./proxy-settings-service', () => ({ getEffectiveProxyUrl }))

const oauthService = await import('./codex-oauth-service')

beforeEach(() => {
  getEffectiveProxyUrl.mockClear()
  getFetchFn.mockClear()
  loginOpenAICodex.mockClear()
  refreshOpenAICodexToken.mockClear()
})

describe('Codex OAuth 代理', () => {
  test('Given 已配置 Proma 代理 When 发起 OAuth 登录 Then token 交换使用代理 fetch', async () => {
    await oauthService.loginCodexOAuth()

    expect(getEffectiveProxyUrl).toHaveBeenCalledTimes(1)
    expect(getFetchFn).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(loginOpenAICodex).toHaveBeenCalledTimes(1)
    expect(loginOpenAICodex.mock.calls[0]?.[0]).toMatchObject({ fetch: proxyFetch })
  })

  test('Given 已配置 Proma 代理 When 刷新 OAuth token Then refresh 请求使用代理 fetch', async () => {
    await oauthService.refreshCodexOAuth('old-refresh-token')

    expect(getEffectiveProxyUrl).toHaveBeenCalledTimes(1)
    expect(getFetchFn).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(refreshOpenAICodexToken).toHaveBeenCalledWith('old-refresh-token', { fetch: proxyFetch })
  })

  test('Given 未启用 Proma 代理 When 刷新 OAuth token Then 保持直连 fetch 回退', async () => {
    getEffectiveProxyUrl.mockResolvedValueOnce(undefined)

    await oauthService.refreshCodexOAuth('old-refresh-token')

    expect(getFetchFn).toHaveBeenCalledWith(undefined)
    expect(refreshOpenAICodexToken).toHaveBeenCalledWith('old-refresh-token', { fetch: proxyFetch })
  })
})
