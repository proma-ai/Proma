import type { Channel, ChannelPlanQuotaResult, ProviderType } from '@proma/shared'

const PLAN_QUOTA_PROVIDERS = new Set<ProviderType>([
  'deepseek',
  'kimi-coding',
  'minimax',
  'zhipu',
  'zhipu-coding',
  'zhipu-coding-team',
])

export function supportsChannelPlanQuota(channel: Pick<Channel, 'provider' | 'baseUrl'> | null | undefined): boolean {
  if (!channel) return false
  if (PLAN_QUOTA_PROVIDERS.has(channel.provider)) return true
  return channel.baseUrl.includes('api.kimi.com/coding')
}

const PLAN_QUOTA_CACHE_MS = 60 * 1000
const PLAN_QUOTA_ERROR_CACHE_MS = 15 * 1000

const quotaCache = new Map<string, ChannelPlanQuotaResult>()
const inflightRequests = new Map<string, Promise<ChannelPlanQuotaResult>>()

function getCacheTtl(result: ChannelPlanQuotaResult): number {
  return result.supported ? PLAN_QUOTA_CACHE_MS : PLAN_QUOTA_ERROR_CACHE_MS
}

export function getCachedPlanQuota(channelId: string): ChannelPlanQuotaResult | null {
  const cached = quotaCache.get(channelId)
  if (!cached) return null
  if (Date.now() - cached.updatedAt >= getCacheTtl(cached)) return null
  return cached
}

export async function fetchChannelPlanQuota(channelId: string): Promise<ChannelPlanQuotaResult> {
  const cached = getCachedPlanQuota(channelId)
  if (cached) return cached

  const inflight = inflightRequests.get(channelId)
  if (inflight) return inflight

  const request = window.electronAPI.getChannelPlanQuota(channelId)
    .then((result) => {
      quotaCache.set(channelId, result)
      return result
    })
    .catch((error: unknown) => {
      const result: ChannelPlanQuotaResult = {
        supported: false,
        provider: 'custom',
        windows: [],
        updatedAt: Date.now(),
        message: error instanceof Error ? error.message : '订阅额度查询失败',
      }
      quotaCache.set(channelId, result)
      return result
    })
    .finally(() => {
      inflightRequests.delete(channelId)
    })

  inflightRequests.set(channelId, request)
  return request
}
