/**
 * 本地 Codex CLI ChatGPT 订阅令牌的只读探测。
 *
 * 这是给「无法在 Proma 内走浏览器/设备码 OAuth、但本机 Codex CLI 已用 ChatGPT
 * 订阅登录」的环境准备的一个 fall-through 补丁，行为对齐 pi 的
 * `apiKey: "$OPENAI_CODEX_OAUTH_TOKEN"`：那个环境变量的值同样来自本文件读取的
 * 同一个凭据，因此这里直接读凭据文件、与任何环境变量名无关。
 *
 * 唯一令牌源是 Codex CLI 维护的 `~/.codex/auth.json`（或 `$CODEX_HOME/auth.json`），
 * Proma 只读取其中的 `tokens.access_token` 当 Bearer 用：
 *  - 自己永不发起 OAuth、永不借用/轮换 refresh_token（令牌轮换完全交给 Codex CLI，
 *    两个客户端抢同一份可轮换 refresh token 会互相踢登录）；
 *  - 每次会话实时重读，天然拿到 CLI 已刷新的新令牌，无需持久化快照；
 *  - 文件缺失、结构不符、令牌过期等任何不可用情形都返回 `null`，调用方据此
 *    完全回退到 Proma 既有的凭据/登录路径，等于补丁不存在。
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CodexOAuthCredentials } from '@proma/shared'

const AUTH_FILENAME = 'auth.json'
/** 与 Pi SDK openai-codex provider 解析账号标识所用的 JWT claim 路径一致。 */
const JWT_AUTH_CLAIM_PATH = 'https://api.openai.com/auth'
/**
 * 令牌剩余有效期必须严格大于该窗口才会被采用。
 * Pi SDK 在 `expires <= now + 5min` 时触发 OAuth 刷新；要求大于同一窗口，
 * 才能保证喂给 SDK 的纯 Bearer 凭据在本次运行期间绝不触发（无 refresh token 的）刷新。
 */
const MIN_SKEW_MS = 5 * 60_000

/** Codex CLI 凭据文件路径：优先入参，其次 CODEX_HOME，最后 ~/.codex。 */
export function resolveCodexCliAuthPath(codexHome?: string): string {
  const home = codexHome?.trim() || process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  return join(home, AUTH_FILENAME)
}

/** 仅解码 JWS compact JWT 的 payload（不验签，签名由 ChatGPT 后端在请求时校验）。 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as unknown
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function readJwtExpiryMs(payload: Record<string, unknown>): number | null {
  const exp = payload.exp
  return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : null
}

function readJwtAccountId(payload: Record<string, unknown>): string | undefined {
  const authClaim = payload[JWT_AUTH_CLAIM_PATH]
  const candidate = authClaim && typeof authClaim === 'object'
    ? (authClaim as Record<string, unknown>).chatgpt_account_id
    : undefined
  return typeof candidate === 'string' && candidate ? candidate : undefined
}

interface CodexCliAuthFile {
  auth_mode?: unknown
  tokens?: {
    access_token?: unknown
    account_id?: unknown
    refresh_token?: unknown
    id_token?: unknown
  }
}

/**
 * 纯转换：auth.json 文本 → 可直接喂给 Pi SDK codex runtime 的凭据。
 * 任何不可用情形（非 chatgpt 模式、缺 access_token、JWT 非法或已过期）都返回 null。
 * `nowMs` 仅为便于单测注入，生产取 Date.now()。
 */
export function parseCodexCliToken(
  raw: string,
  nowMs: number = Date.now(),
  skewMs: number = MIN_SKEW_MS,
): CodexOAuthCredentials | null {
  let file: CodexCliAuthFile
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    file = parsed as CodexCliAuthFile
  } catch {
    return null
  }

  // 只认 ChatGPT 订阅登录；API key 模式（auth_mode 非 chatgpt）对订阅渠道无意义。
  if (file.auth_mode !== 'chatgpt') return null

  const access = typeof file.tokens?.access_token === 'string' ? file.tokens.access_token : ''
  if (!access) return null

  const payload = decodeJwtPayload(access)
  if (!payload) return null
  const expires = readJwtExpiryMs(payload)
  if (expires === null) return null
  // 剩余有效期不足安全窗：CLI 通常已刷新文件，宁可当不可用回退，也不让 SDK 触发空刷新。
  if (expires <= nowMs + skewMs) return null

  const fileAccountId = typeof file.tokens?.account_id === 'string' ? file.tokens.account_id : ''
  const accountId = fileAccountId || readJwtAccountId(payload)

  return {
    access,
    // 刻意留空：纯 Bearer 外部源。续期归 Codex CLI 独占，Proma 绝不持有/轮换 refresh token。
    refresh: '',
    expires,
    ...(accountId ? { accountId } : {}),
  }
}

/**
 * 同步读取并探测本机 Codex CLI 当前的 ChatGPT 订阅令牌。
 * 文件不存在或读取失败一律返回 null（不抛错），保证对调用方纯粹是「有则用、无则跳过」。
 */
export function readCodexCliToken(options?: { codexHome?: string }): CodexOAuthCredentials | null {
  let raw: string
  try {
    raw = readFileSync(resolveCodexCliAuthPath(options?.codexHome), 'utf8')
  } catch {
    return null
  }
  return parseCodexCliToken(raw)
}
