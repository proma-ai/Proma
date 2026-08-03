/**
 * xAI（Grok/X 订阅）OAuth 登录服务。
 *
 * 复用 Pi SDK 的内置 xAI device-code OAuth：浏览器打开带预填授权码的 xAI
 * 授权链接，用户确认后 SDK 轮询换取 access/refresh token。凭据由调用方用
 * Channel.apiKey + Electron safeStorage 加密持久化；本服务绝不写入 ~/.pi。
 */

import { shell } from 'electron'
import type { XaiOAuthCredentials, XaiOAuthDeviceCode } from '@proma/shared'
import { runWithOAuthProxyScope } from './oauth-proxy-scope'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type OAuthCredential = XaiOAuthCredentials & { type: 'oauth'; [key: string]: unknown }

let piSdkPromise: Promise<PiSdk> | undefined
let activeLoginAbort: AbortController | undefined

function loadPiSdk(): Promise<PiSdk> {
  piSdkPromise ??= import('@earendil-works/pi-coding-agent')
  return piSdkPromise
}

/** Pi ModelRuntime 所需的最小内存 CredentialStore。 */
function createEphemeralCredentialStore(initial?: OAuthCredential) {
  let credential = initial
  return {
    async read(providerId: string): Promise<OAuthCredential | undefined> {
      return providerId === 'xai' ? credential : undefined
    },
    async list(): Promise<readonly { providerId: string; type: 'oauth' }[]> {
      return credential ? [{ providerId: 'xai', type: 'oauth' }] : []
    },
    async modify(
      providerId: string,
      fn: (current: OAuthCredential | undefined) => Promise<OAuthCredential | undefined>,
    ): Promise<OAuthCredential | undefined> {
      if (providerId !== 'xai') return undefined
      credential = await fn(credential)
      return credential
    },
    async delete(providerId: string): Promise<void> {
      if (providerId === 'xai') credential = undefined
    },
  }
}

function normalizeCredentials(value: unknown): XaiOAuthCredentials {
  if (!value || typeof value !== 'object') throw new Error('Pi OAuth 未返回有效 xAI 凭据')
  const credential = value as Partial<OAuthCredential>
  if (typeof credential.access !== 'string' || typeof credential.refresh !== 'string' || typeof credential.expires !== 'number') {
    throw new Error('Pi OAuth 返回的 xAI 凭据缺少 access、refresh 或 expires')
  }
  return { access: credential.access, refresh: credential.refresh, expires: credential.expires }
}

export interface XaiLoginCallbacks {
  /** 将 device code 推送到 UI，供浏览器未预填时手动填写。 */
  onDeviceCode?: (deviceCode: XaiOAuthDeviceCode) => void
}

/**
 * 通过系统浏览器登录 SuperGrok 或 X Premium。
 *
 * Pi 产生 device_code 事件时，verificationUri 已优先使用预填链接；同时把 code
 * 回传给 UI，确保浏览器未预填时也能完成授权。流程可由 cancelXaiOAuthLogin 中止。
 */
export async function loginXaiOAuth(callbacks?: XaiLoginCallbacks): Promise<XaiOAuthCredentials> {
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
      const credentials = await runtime.login('xai', 'oauth', {
        signal: abort.signal,
        // xAI 的内置 OAuth 直接走 device code，不会向此 callback 提问；保留拒绝路径
        // 以便上游未来增加交互时不会无限挂起。
        prompt: async (prompt) => new Promise<string>((_resolve, reject) => {
          const cancel = () => reject(new Error('登录已取消'))
          prompt.signal?.addEventListener('abort', cancel, { once: true })
          abort.signal.addEventListener('abort', cancel, { once: true })
        }),
        notify: (event) => {
          if (event.type === 'device_code') {
            console.log(`[xAI OAuth] 请在浏览器中授权（设备码：${event.userCode}）`)
            callbacks?.onDeviceCode?.({ userCode: event.userCode, verificationUri: event.verificationUri })
            shell.openExternal(event.verificationUri).catch((error) => {
              console.error('[xAI OAuth] 打开授权页面失败:', error)
            })
          } else if (event.type === 'progress' || event.type === 'info') {
            console.log(`[xAI OAuth] ${event.message}`)
          }
        },
      })
      return normalizeCredentials(credentials)
    })
  } finally {
    if (activeLoginAbort === abort) activeLoginAbort = undefined
  }
}

export function cancelXaiOAuthLogin(): void {
  activeLoginAbort?.abort()
  activeLoginAbort = undefined
}

/** 通过 Pi 内置 xAI provider 刷新 token。 */
export async function refreshXaiOAuth(refreshToken: string): Promise<XaiOAuthCredentials> {
  const sdk = await loadPiSdk()
  return runWithOAuthProxyScope(async () => {
    const store = createEphemeralCredentialStore({
      type: 'oauth',
      access: '',
      refresh: refreshToken,
      expires: 0,
    })
    const runtime = await sdk.ModelRuntime.create({ credentials: store, allowModelNetwork: false })
    await runtime.getAuth('xai')
    return normalizeCredentials(await store.read('xai'))
  })
}
