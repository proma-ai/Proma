/**
 * xAI（Grok/X 订阅）OAuth 登录服务。
 *
 * 复用 Pi SDK 内置 xAI device-code OAuth 的协议参数，但在本服务内自实现整个
 * device-code 流程，并用 Proma 的代理 fetch（getFetchFn + getEffectiveProxyUrl）
 * 发起网络请求。
 *
 * 为什么不自接 Pi SDK 的 `ModelRuntime.login('xai', 'oauth')`：
 * SDK 内部 fetch（undici）不读取系统/环境代理。在需要代理才能访问 auth.x.ai 的
 * 网络环境（如中国大陆）下，device-code 请求直连会超时，导致拿不到授权链接、
 * 浏览器永远不会被唤起。OpenAI Codex 的 token 交换走 auth.openai.com（直连可达），
 * 所以订阅登录不受影响。这里用与 channel-manager 一致的代理 fetch 方式解决。
 *
 * 凭据由调用方用 Channel.apiKey + Electron safeStorage 加密持久化；本服务绝不写入 ~/.pi。
 */

import { shell } from 'electron'
import type { XaiOAuthCredentials, XaiOAuthDeviceCode } from '@proma/shared'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'

/**
 * xAI OAuth 协议参数，镜像 @earendil-works/pi-ai/dist/auth/oauth/xai.js（v0.82.1）。
 * 若上游 SDK 更新端点/scope，需同步更新此处。
 */
const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access'
const XAI_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code'
const XAI_TOKEN_URL = 'https://auth.x.ai/oauth2/token'
// 提前 5 分钟刷新，避免 token 在请求中途过期。
const REFRESH_SKEW_MS = 5 * 60 * 1000
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600
// RFC 8628：服务端未返回 interval 时使用 5 秒；slow_down 后每次 +5 秒。
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const SLOW_DOWN_INTERVAL_INCREMENT_SECONDS = 5

/** 进行中的登录流程的取消控制器（同一时刻只允许一个登录流程）。 */
let activeLoginAbort: AbortController | undefined

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`)
  }
  return value
}

function positiveNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`)
  }
  return value
}

// 强制 https，避免恶意响应让 openExternal 打开非 http(s) 链接。
function validateVerificationUri(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Untrusted verification URI in xAI OAuth response')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Untrusted verification URI in xAI OAuth response')
  }
  return url.href
}

interface XaiDevice {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  intervalSeconds?: number
  expiresInSeconds: number
}

function parseDeviceCode(body: Record<string, unknown>): XaiDevice {
  // RFC 8628 允许 interval 为 0（无最小等待），非正数时回退到轮询默认值。
  const interval = body.interval
  const intervalSeconds =
    typeof interval === 'number' && Number.isFinite(interval) && interval > 0 ? interval : undefined
  const verificationUriComplete =
    typeof body.verification_uri_complete === 'string' && body.verification_uri_complete.length > 0
      ? validateVerificationUri(body.verification_uri_complete)
      : undefined
  return {
    deviceCode: requiredString(body, 'device_code'),
    userCode: requiredString(body, 'user_code'),
    verificationUri: validateVerificationUri(requiredString(body, 'verification_uri')),
    verificationUriComplete,
    intervalSeconds,
    expiresInSeconds: positiveNumber(body, 'expires_in'),
  }
}

function requestFailure(
  action: string,
  response: { status: number; body: Record<string, unknown> },
): Error {
  const error = typeof response.body.error === 'string' ? response.body.error : undefined
  const description =
    typeof response.body.error_description === 'string' ? response.body.error_description : undefined
  const detail = [error, description].filter(Boolean).join(': ')
  return new Error(`xAI OAuth ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
}

async function postForm(
  fetchFn: typeof globalThis.fetch,
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  let response: Response
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('Login cancelled')
    throw error
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await response.json()
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    if (signal?.aborted) throw new Error('Login cancelled')
    throw new Error(`xAI OAuth returned invalid JSON (HTTP ${response.status})`)
  }
  return { ok: response.ok, status: response.status, body }
}

function credentialsFromTokenResponse(
  body: Record<string, unknown>,
  previousRefreshToken?: string,
): XaiOAuthCredentials {
  const access = requiredString(body, 'access_token')
  // xAI 刷新时可能不轮换 refresh_token；缺失时沿用旧值。
  const refresh =
    body.refresh_token === undefined && previousRefreshToken
      ? previousRefreshToken
      : requiredString(body, 'refresh_token')
  const expiresInSeconds =
    body.expires_in === undefined ? DEFAULT_TOKEN_LIFETIME_SECONDS : positiveNumber(body, 'expires_in')
  return {
    access,
    refresh,
    expires: Date.now() + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
  }
}

async function requestDeviceCode(
  fetchFn: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<XaiDevice> {
  const response = await postForm(
    fetchFn,
    XAI_DEVICE_CODE_URL,
    { client_id: XAI_CLIENT_ID, scope: XAI_SCOPE, referrer: 'pi' },
    signal,
  )
  if (!response.ok) throw requestFailure('device authorization', response)
  return parseDeviceCode(response.body)
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Login cancelled'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Login cancelled'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function pollForTokens(
  fetchFn: typeof globalThis.fetch,
  device: XaiDevice,
  signal?: AbortSignal,
): Promise<XaiOAuthCredentials> {
  const deadline = Date.now() + device.expiresInSeconds * 1000
  let intervalMs = Math.max(1000, Math.floor((device.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000))
  let slowDownResponses = 0

  // RFC 8628：首次轮询前等待一个 interval，给用户打开浏览器的时间。
  const firstWait = Math.min(intervalMs, Math.max(0, deadline - Date.now()))
  if (firstWait > 0) await abortableSleep(firstWait, signal)

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Login cancelled')
    const response = await postForm(
      fetchFn,
      XAI_TOKEN_URL,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: XAI_CLIENT_ID,
        device_code: device.deviceCode,
      },
      signal,
    )
    if (response.ok) {
      return credentialsFromTokenResponse(response.body)
    }

    const error = response.body.error
    if (error === 'authorization_pending') {
      // 用户尚未授权，继续轮询。
    } else if (error === 'slow_down') {
      slowDownResponses += 1
      // 使用服务端返回的 interval（RFC 8628：+5s）；仅在服务端未给时按默认递增。
      const interval = response.body.interval
      intervalMs =
        typeof interval === 'number' && Number.isFinite(interval) && interval > 0
          ? Math.max(1000, Math.floor(interval * 1000))
          : intervalMs + SLOW_DOWN_INTERVAL_INCREMENT_SECONDS * 1000
    } else if (error === 'access_denied' || error === 'authorization_denied') {
      throw new Error('xAI device authorization was denied')
    } else if (error === 'expired_token') {
      throw new Error('xAI device code expired')
    } else {
      throw requestFailure('device token polling', response)
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await abortableSleep(Math.min(intervalMs, remainingMs), signal)
  }

  throw new Error(
    slowDownResponses > 0
      ? 'Device flow timed out after one or more slow_down responses. Please sync the clock and try again.'
      : 'Device flow timed out',
  )
}

export interface XaiLoginCallbacks {
  /** 将 device code 推送到 UI，供浏览器未预填时手动填写。 */
  onDeviceCode?: (deviceCode: XaiOAuthDeviceCode) => void
}

/**
 * 通过系统浏览器登录 SuperGrok 或 X Premium。
 *
 * Pi 产生 device_code 时，verificationUri 优先使用预填链接；同时把 code 回传给 UI，
 * 确保浏览器未预填时也能完成授权。流程可由 cancelXaiOAuthLogin 中止。
 */
export async function loginXaiOAuth(callbacks?: XaiLoginCallbacks): Promise<XaiOAuthCredentials> {
  activeLoginAbort?.abort()
  const abort = new AbortController()
  activeLoginAbort = abort

  try {
    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)
    const device = await requestDeviceCode(fetchFn, abort.signal)
    const openUri = device.verificationUriComplete ?? device.verificationUri

    console.log(`[xAI OAuth] 请在浏览器中授权（设备码：${device.userCode}）`)
    callbacks?.onDeviceCode?.({ userCode: device.userCode, verificationUri: openUri })
    shell.openExternal(openUri).catch((error) => {
      console.error('[xAI OAuth] 打开授权页面失败:', error)
    })

    return await pollForTokens(fetchFn, device, abort.signal)
  } finally {
    if (activeLoginAbort === abort) activeLoginAbort = undefined
  }
}

export function cancelXaiOAuthLogin(): void {
  activeLoginAbort?.abort()
  activeLoginAbort = undefined
}

/** 通过 xAI OAuth token 端点刷新凭据（同样走 Proma 代理 fetch）。 */
export async function refreshXaiOAuth(refreshToken: string): Promise<XaiOAuthCredentials> {
  const proxyUrl = await getEffectiveProxyUrl()
  const fetchFn = getFetchFn(proxyUrl)
  const response = await postForm(
    fetchFn,
    XAI_TOKEN_URL,
    { grant_type: 'refresh_token', client_id: XAI_CLIENT_ID, refresh_token: refreshToken },
  )
  if (!response.ok) throw requestFailure('token refresh', response)
  return credentialsFromTokenResponse(response.body, refreshToken)
}
