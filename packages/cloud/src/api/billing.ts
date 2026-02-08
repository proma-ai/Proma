/**
 * 账单 API（纯函数，不依赖 React）
 *
 * 端点参考 proma-frontend/src/api/users.ts
 */

import type { CloudApiClient } from './client'
import type { BillingInfo, CheckBalanceResponse } from '@proma/shared'

/** 创建账单 API */
export function createBillingApi(client: CloudApiClient) {
  return {
    /** 获取账单信息 */
    getBilling: async (): Promise<BillingInfo> => {
      const response = await client.get<BillingInfo>('/user/billing')
      return response.data
    },

    /** 检查余额是否充足 */
    checkBalance: async (): Promise<CheckBalanceResponse> => {
      const response = await client.get<CheckBalanceResponse>('/user/check-balance')
      return response.data
    },
  }
}

/** Billing API 实例类型 */
export type BillingApi = ReturnType<typeof createBillingApi>
