/**
 * 跨 Pi Agent query 的 xAI OAuth refresh 协调器。
 *
 * Pi 为每次 query 创建独立 CredentialStore；xAI 可能轮换 refresh token，因此
 * 必须按 Proma channelId 串行刷新，避免并行会话各自消费旧 refresh token。
 */

import type { XaiOAuthCredentials } from '@proma/shared'

const inflightCredentialRefreshes = new Map<string, Promise<XaiOAuthCredentials>>()
const latestCredentialsByChannel = new Map<string, XaiOAuthCredentials>()

/**
 * 记录最新凭据。持久化写入调用方应传 force=true；新建 query 的旧快照不会覆盖
 * 已被另一个运行中 query 刷新的凭据。
 */
export function rememberXaiOAuthCredentials(
  channelId: string,
  credentials: XaiOAuthCredentials,
  force = false,
): XaiOAuthCredentials {
  const existing = latestCredentialsByChannel.get(channelId)
  if (force || !existing || credentials.expires > existing.expires) {
    latestCredentialsByChannel.set(channelId, credentials)
    return credentials
  }
  return existing
}

/**
 * 用同一个 channelId 串行刷新 xAI OAuth，并让并发调用复用刚换出的凭据。
 * refresh 回调只会由真正发起刷新的一方执行。
 */
export async function refreshXaiOAuthCredentialsSerial(
  channelId: string,
  fallback: XaiOAuthCredentials,
  refresh: (credentials: XaiOAuthCredentials) => Promise<XaiOAuthCredentials>,
): Promise<XaiOAuthCredentials> {
  const inflight = inflightCredentialRefreshes.get(channelId)
  if (inflight) return inflight

  const latest = latestCredentialsByChannel.get(channelId)
  if (latest
    && (latest.access !== fallback.access || latest.refresh !== fallback.refresh)
    && latest.expires > Date.now()) {
    return latest
  }

  const refreshPromise = (async () => {
    const current = latestCredentialsByChannel.get(channelId) ?? fallback
    const refreshed = await refresh(current)
    return rememberXaiOAuthCredentials(channelId, refreshed, true)
  })()
  inflightCredentialRefreshes.set(channelId, refreshPromise)
  try {
    return await refreshPromise
  } finally {
    if (inflightCredentialRefreshes.get(channelId) === refreshPromise) {
      inflightCredentialRefreshes.delete(channelId)
    }
  }
}
