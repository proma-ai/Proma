import type { ChannelPlanQuotaResult, ChannelPlanQuotaWindow } from '@proma/shared'
import { parseGithubCopilotCredentials } from '@proma/shared'
import { createManagedProxyFetch } from './proxy-fetch'
import type { ManagedProxyFetch } from './proxy-fetch'

interface JsonObject { [key: string]: unknown }

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function number(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function unavailable(message: string): ChannelPlanQuotaResult {
  return { supported: false, provider: 'github-copilot', windows: [], updatedAt: Date.now(), message }
}

/** 内部接口可能返回日期或带时区的 ISO 时间。无效/缺失日期不推测，也不采用本地时区。 */
function resetTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(raw)
  if (!match) return undefined
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)
    || (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59))) return undefined
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function nonMeteredWindow(label: string, remainingLabel: string, resetAt?: number): ChannelPlanQuotaWindow {
  // 统一契约要求百分比；非计量窗口只使用文案，不将数值当成真实剩余额度展示。
  return { type: 'custom', label, remainingLabel, remainingPercent: 0, usedPercent: 0, showProgress: false, resetAt }
}

function quotaWindow(value: unknown, label: string, resetAt?: number): ChannelPlanQuotaWindow | undefined {
  const snapshot = object(value)
  if (!snapshot) return undefined
  if (snapshot.unlimited === true) return nonMeteredWindow(label, '不限额', resetAt)
  const entitlement = number(snapshot.entitlement)
  const remaining = number(snapshot.remaining)
  // Business / 按量计费可能返回全零占位，即使 percent_remaining=100 也不是可用额度。
  if (entitlement === 0 && remaining === 0) return undefined
  const percent = number(snapshot.percent_remaining)
    ?? (entitlement !== undefined && entitlement > 0 && remaining !== undefined ? remaining / entitlement * 100 : undefined)
  if (percent === undefined || !Number.isFinite(percent)) return undefined
  const remainingPercent = Math.round(Math.max(0, Math.min(100, percent)) * 100) / 100
  return {
    type: 'custom', label, remainingPercent, usedPercent: Math.round((100 - remainingPercent) * 100) / 100,
    ...(entitlement !== undefined && entitlement > 0 && remaining !== undefined
      ? { remainingLabel: `${Math.max(0, remaining)} / ${entitlement}` } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
  }
}

function planName(value: unknown): string {
  // 不把不可信响应中的任意字段（包括可能回显的凭据）送入 renderer。
  switch (value) {
    case 'free': return 'GitHub Copilot Free'
    case 'individual': return 'GitHub Copilot 个人订阅'
    case 'pro': return 'GitHub Copilot Pro'
    case 'pro+':
    case 'pro_plus': return 'GitHub Copilot Pro+'
    case 'business': return 'GitHub Copilot Business'
    case 'enterprise': return 'GitHub Copilot Enterprise'
    default: return 'GitHub Copilot'
  }
}

/**
 * 参考 CodexBar 2cb9efda1d 的 CopilotUsageFetcher / CopilotUsageModels 语义。
 * copilot_internal/user 不是稳定公开 API；只接受已知额度键，不把未知数据误标为 Premium。
 */
export function parseGithubCopilotPlanQuotaResponse(data: unknown): ChannelPlanQuotaResult {
  const response = object(data)
  if (!response) return unavailable('GitHub Copilot 额度响应格式错误')
  const snapshots = object(response.quota_snapshots)
  const resetAt = resetTimestamp(response.quota_reset_date)
  const windows: ChannelPlanQuotaWindow[] = []
  const premium = quotaWindow(snapshots?.premium_interactions, 'Premium', resetAt)
  if (premium) windows.push(premium)

  const monthly = object(response.monthly_quotas)
  const limited = object(response.limited_user_quotas)
  for (const [key, label] of [['chat', 'Chat'], ['completions', '补全']] as const) {
    let window = quotaWindow(snapshots?.[key], label, resetAt)
    const entitlement = number(monthly?.[key])
    const remaining = number(limited?.[key])
    if ((!window || window.showProgress === false) && entitlement !== undefined && entitlement > 0 && remaining !== undefined) {
      window = quotaWindow({ entitlement, remaining }, label, resetAt)
    }
    if (window) windows.push(window)
  }
  if (response.token_based_billing === true) {
    // 按量计费是独立信息，不能被 Chat/补全的“不限额”窗口遮蔽。
    windows.unshift(nonMeteredWindow('计费方式', '按量计费', resetAt))
  }
  if (windows.length === 0) return unavailable('GitHub Copilot 未返回可用额度数据，内部接口可能已变化')
  return { supported: true, provider: 'github-copilot', planName: planName(response.copilot_plan), windows, updatedAt: Date.now() }
}

function usageUrl(enterpriseUrl?: string): string | undefined {
  if (!enterpriseUrl) return 'https://api.github.com/copilot_internal/user'
  // 只支持 GitHub 托管域；不把来自渠道配置的任意 URL 变成 OAuth 凭据发送目标。
  // 自托管 GHES 不回退 github.com，避免发送错误账号域的凭据。
  const match = /^(?:https:\/\/)?(github\.com|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ghe\.com)\/?$/i.exec(enterpriseUrl)
  if (!match?.[1]) return undefined
  const host = match[1].toLowerCase()
  if (host.length > 253 || host.split('.').some((part) => part.length > 63)) return undefined
  const apiHost = host === 'github.com' ? 'api.github.com' : host.startsWith('api.') ? host : `api.${host}`
  return `https://${apiHost}/copilot_internal/user`
}

export async function queryGithubCopilotPlanQuota(
  secret: string,
  proxyUrl?: string,
  createTransport: typeof createManagedProxyFetch = createManagedProxyFetch,
): Promise<ChannelPlanQuotaResult> {
  const credentials = parseGithubCopilotCredentials(secret)
  if (!credentials || !/^[A-Za-z0-9_.-]+$/.test(credentials.refresh)) {
    return unavailable('GitHub Copilot 登录凭据无效或缺失，请重新登录')
  }
  const url = usageUrl(credentials.enterpriseUrl)
  if (!url) return unavailable('当前企业登录域暂不支持 Copilot 额度查询')

  let transport: ManagedProxyFetch | undefined
  let response: Response | undefined
  try {
    transport = createTransport(proxyUrl)
    response = await transport.fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        // refresh 字段存放 GitHub OAuth token；access 是不能用于此接口的短期 Copilot token。
        Authorization: `token ${credentials.refresh}`,
        Accept: 'application/json',
        'Editor-Version': 'vscode/1.96.2',
        'Editor-Plugin-Version': 'copilot-chat/0.26.7',
        'User-Agent': 'GitHubCopilotChat/0.26.7',
        'X-Github-Api-Version': '2025-04-01',
      },
    })
    if (response.status === 401) return unavailable('GitHub Copilot 登录已失效，请重新登录（HTTP 401）')
    if (response.status === 403) return unavailable('GitHub Copilot 拒绝额度访问，请检查订阅或组织授权（HTTP 403）')
    if (response.status === 429) return unavailable('GitHub Copilot 额度查询过于频繁，请稍后重试（HTTP 429）')
    if (response.status !== 200) return unavailable(`GitHub Copilot 额度查询失败（HTTP ${response.status}）`)
    return parseGithubCopilotPlanQuotaResponse(await response.json())
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return unavailable('GitHub Copilot 额度查询超时，请检查网络或代理后重试')
    }
    if (error instanceof SyntaxError) return unavailable('GitHub Copilot 额度响应格式错误')
    // 不记录/返回网络异常、响应正文或代理 URL，避免凭据经日志和 IPC 泄漏。
    return unavailable('GitHub Copilot 额度查询失败，请检查网络或代理后重试')
  } finally {
    try { await response?.body?.cancel() } catch { /* 已消费或中止的正文无需再次取消。 */ }
    try { await transport?.close() } catch { /* 清理失败不能覆盖查询结果或泄露代理信息。 */ }
  }
}
