import { calcTotalAvailable, PROMA_OFFICIAL_CHANNEL_ID } from '@proma/shared'
import type { AgentIslandPlanQuotaSnapshot, BillingInfo } from '@proma/shared'

/**
 * 将 Proma Cloud 账单投影为灵动岛既有的额度轮播项。
 *
 * `calcTotalAvailable` 统一汇总预充值、订阅剩余和企业分配额度；只向灵动岛
 * 暴露已格式化的可用积分，不暴露用户、账单明细或认证信息。
 */
export function buildPromaOfficialQuotaSnapshot(billing: BillingInfo): AgentIslandPlanQuotaSnapshot {
  return {
    channelId: PROMA_OFFICIAL_CHANNEL_ID,
    channelName: 'Proma 官方',
    planName: '官方额度',
    windows: [{
      windowLabel: '可用',
      // 官方积分是余额而非固定周期的百分比额度；Swift UI 优先显示 remainingLabel。
      remainingPercent: 0,
      remainingLabel: `${calcTotalAvailable(billing).toFixed(2)} 积分`,
    }],
  }
}
