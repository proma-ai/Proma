/**
 * GitHub Copilot 订阅 OAuth 登录服务。
 *
 * Pi SDK 使用 GitHub device-code 登录，并从 Copilot token 取得当前套餐/组织
 * 实际可用的模型。凭据由调用方以 Channel.apiKey + Electron safeStorage 加密持久化；
 * 本服务只使用内存 CredentialStore，绝不写入 ~/.pi。
 */

import { shell } from 'electron'
import type { GithubCopilotOAuthCredentials, GithubCopilotOAuthDeviceCode } from '@proma/shared'
import { runWithOAuthProxyScope } from './oauth-proxy-scope'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type OAuthCredential = GithubCopilotOAuthCredentials & { type: 'oauth'; [key: string]: unknown }

let piSdkPromise: Promise<PiSdk> | undefined
let activeLoginAbort: AbortController | undefined

function loadPiSdk(): Promise<PiSdk> {
  piSdkPromise ??= import('@earendil-works/pi-coding-agent')
  return piSdkPromise
}

function createEphemeralCredentialStore(initial?: OAuthCredential) {
  let credential = initial
  return {
    async read(providerId: string): Promise<OAuthCredential | undefined> {
      return providerId === 'github-copilot' ? credential : undefined
    },
    async list(): Promise<readonly { providerId: string; type: 'oauth' }[]> {
      return credential ? [{ providerId: 'github-copilot', type: 'oauth' }] : []
    },
    async modify(
      providerId: string,
      fn: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>,
    ): Promise<OAuthCredential | undefined> {
      if (providerId !== 'github-copilot') return undefined
      credential = await fn(credential)
      return credential
    },
    async delete(providerId: string): Promise<void> {
      if (providerId === 'github-copilot') credential = undefined
    },
  }
}

function normalizeCredentials(value: unknown): GithubCopilotOAuthCredentials {
  if (!value || typeof value !== 'object') throw new Error('Pi OAuth 未返回有效 GitHub Copilot 凭据')
  const credential = value as Partial<OAuthCredential>
  if (typeof credential.access !== 'string' || !credential.access
    || typeof credential.refresh !== 'string' || !credential.refresh
    || typeof credential.expires !== 'number'
    || !Array.isArray(credential.availableModelIds)
    || !credential.availableModelIds.every((modelId) => typeof modelId === 'string')) {
    throw new Error('Pi OAuth 返回的 GitHub Copilot 凭据不完整')
  }
  return {
    access: credential.access,
    refresh: credential.refresh,
    expires: credential.expires,
    availableModelIds: [...new Set(credential.availableModelIds)],
    ...(typeof credential.enterpriseUrl === 'string' && credential.enterpriseUrl ? { enterpriseUrl: credential.enterpriseUrl } : {}),
  }
}

export interface GithubCopilotLoginOptions {
  /** GitHub Enterprise Server 域名；空值代表 github.com。 */
  enterpriseUrl?: string
  onDeviceCode?: (deviceCode: GithubCopilotOAuthDeviceCode) => void
}

/**
 * 通过 GitHub device-code 授权 Copilot 订阅。
 * Pi 会在登录期间查询服务器端模型策略，并把当前账号实际启用的模型写入凭据。
 */
export async function loginGithubCopilotOAuth(options?: GithubCopilotLoginOptions): Promise<GithubCopilotOAuthCredentials> {
  const sdk = await loadPiSdk()
  activeLoginAbort?.abort()
  const abort = new AbortController()
  activeLoginAbort = abort

  try {
    return await runWithOAuthProxyScope(async () => {
      const runtime = await sdk.ModelRuntime.create({
        credentials: createEphemeralCredentialStore(),
        allowModelNetwork: false,
      })
      const credentials = await runtime.login('github-copilot', 'oauth', {
        signal: abort.signal,
        prompt: async (prompt) => {
          if (prompt.type === 'text') return options?.enterpriseUrl?.trim() ?? ''
          return new Promise<string>((_resolve, reject) => {
            const cancel = () => reject(new Error('登录已取消'))
            prompt.signal?.addEventListener('abort', cancel, { once: true })
            abort.signal.addEventListener('abort', cancel, { once: true })
          })
        },
        notify: (event) => {
          if (event.type === 'device_code') {
            console.log(`[GitHub Copilot OAuth] 请在浏览器中授权（设备码：${event.userCode}）`)
            options?.onDeviceCode?.({ userCode: event.userCode, verificationUri: event.verificationUri })
            shell.openExternal(event.verificationUri).catch((error) => {
              console.error('[GitHub Copilot OAuth] 打开授权页面失败:', error)
            })
          } else if (event.type === 'progress' || event.type === 'info') {
            console.log(`[GitHub Copilot OAuth] ${event.message}`)
          }
        },
      })
      return normalizeCredentials(credentials)
    })
  } finally {
    if (activeLoginAbort === abort) activeLoginAbort = undefined
  }
}

export function cancelGithubCopilotOAuthLogin(): void {
  activeLoginAbort?.abort()
  activeLoginAbort = undefined
}

/** 使用 Pi 内置 GitHub Copilot provider 续签 access token，并刷新模型策略。 */
export async function refreshGithubCopilotOAuth(
  credentials: GithubCopilotOAuthCredentials,
): Promise<GithubCopilotOAuthCredentials> {
  const sdk = await loadPiSdk()
  return runWithOAuthProxyScope(async () => {
    const store = createEphemeralCredentialStore({ type: 'oauth', ...credentials })
    const runtime = await sdk.ModelRuntime.create({ credentials: store, allowModelNetwork: false })
    await runtime.getAuth('github-copilot')
    return normalizeCredentials(await store.read('github-copilot'))
  })
}
