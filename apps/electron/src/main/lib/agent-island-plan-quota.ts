import type {
  AgentIslandCompactPlanQuotaSnapshot,
  AgentIslandPlanQuotaSnapshot,
} from '@proma/shared'

/**
 * 收起态只能容纳一个额度摘要：按 Island 会话的语义优先级顺序选择第一个
 * 支持查询额度的渠道，并保留其余不同渠道的数量供用户识别。
 */
export function selectAgentIslandCompactPlanQuota(
  activeChannelIds: readonly string[],
  planQuotas: readonly AgentIslandPlanQuotaSnapshot[],
): AgentIslandCompactPlanQuotaSnapshot | undefined {
  const quotasByChannelId = new Map(planQuotas.map((quota) => [quota.channelId, quota]))
  const activeQuotas: AgentIslandPlanQuotaSnapshot[] = []
  const seenChannelIds = new Set<string>()

  for (const channelId of activeChannelIds) {
    if (seenChannelIds.has(channelId)) continue
    seenChannelIds.add(channelId)
    const quota = quotasByChannelId.get(channelId)
    if (quota) activeQuotas.push(quota)
  }

  const [primary] = activeQuotas
  if (!primary) return undefined

  return {
    ...primary,
    additionalChannelCount: activeQuotas.length - 1,
  }
}
