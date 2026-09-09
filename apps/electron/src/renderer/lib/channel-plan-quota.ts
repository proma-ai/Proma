import type { Channel, ChannelPlanQuotaResult, ProviderType } from '@proma/shared'

const PLAN_QUOTA_PROVIDERS = new Set<ProviderType>([
  'proma',
  'deepseek',
  'kimi-coding',
  'minimax',
  'zhipu',
  'zhipu-coding',
  'zhipu-coding-team',
  'openai-codex',
  'github-copilot',
])

export function supportsChannelPlanQuota(channel: Pick<Channel, 'provider' | 'baseUrl'> | null | undefined): boolean {
  if (!channel) return false
  if (PLAN_QUOTA_PROVIDERS.has(channel.provider)) return true
  return channel.baseUrl.includes('api.kimi.com/coding')
}

const PLAN_QUOTA_CACHE_MS = 60 * 1000
const PLAN_QUOTA_ERROR_CACHE_MS = 15 * 1000

interface CachedPlanQuota {
  result: ChannelPlanQuotaResult
  /** 渠道凭据更新时递增，避免同一 channelId 换号后沿用旧账号额度。 */
  channelUpdatedAt?: number
}

const quotaCache = new Map<string, CachedPlanQuota>()
const inflightRequests = new Map<string, Promise<ChannelPlanQuotaResult>>()
const currentVersions = new Map<string, number | undefined>()

/**
 * 清除全部渠道额度缓存。
 *
 * 供账单变动事件（对话扣费 / 充值 / 订阅变化）后调用：
 * 余额类额度（如 Proma 官方渠道）若仍命中 60s 缓存会展示旧值，
 * 主动失效后下次悬浮/展开即可立即拉到最新余额。
 */
export function clearPlanQuotaCache(): void {
  quotaCache.clear()
}

function getCacheTtl(result: ChannelPlanQuotaResult): number {
  return result.supported ? PLAN_QUOTA_CACHE_MS : PLAN_QUOTA_ERROR_CACHE_MS
}

export function getCachedPlanQuota(channelId: string, channelUpdatedAt?: number): ChannelPlanQuotaResult | null {
  const cached = quotaCache.get(channelId)
  if (!cached || cached.channelUpdatedAt !== channelUpdatedAt) return null
  if (Date.now() - cached.result.updatedAt >= getCacheTtl(cached.result)) return null
  return cached.result
}

export async function fetchChannelPlanQuota(
  channelId: string,
  channelUpdatedAt?: number,
): Promise<ChannelPlanQuotaResult> {
  currentVersions.set(channelId, channelUpdatedAt)
  const cached = getCachedPlanQuota(channelId, channelUpdatedAt)
  if (cached) return cached
  quotaCache.delete(channelId)

  // 同一渠道换号后不能复用旧凭据发起的 in-flight 请求。
  const requestKey = `${channelId}:${channelUpdatedAt ?? ''}`
  const inflight = inflightRequests.get(requestKey)
  if (inflight) return inflight

  const cacheIfCurrent = (result: ChannelPlanQuotaResult): ChannelPlanQuotaResult => {
    if (currentVersions.get(channelId) === channelUpdatedAt) {
      quotaCache.set(channelId, { result, channelUpdatedAt })
    }
    return result
  }

  const request = Promise.resolve()
    .then(() => window.electronAPI.getChannelPlanQuota(channelId))
    .then(cacheIfCurrent)
    .catch(() => {
      const result: ChannelPlanQuotaResult = {
        supported: false,
        provider: 'custom',
        windows: [],
        updatedAt: Date.now(),
        message: '订阅额度查询失败，请稍后重试',
      }
      return cacheIfCurrent(result)
    })
    .finally(() => {
      inflightRequests.delete(requestKey)
    })

  inflightRequests.set(requestKey, request)
  return request
}
