/**
 * 订阅 API（纯函数，不依赖 React）
 */

import type { CloudApiClient } from './client'
import type {
  SubscriptionTiersResponse,
  SubscriptionStatusResponse,
  SubscriptionOrderRecord,
  CreateSubscriptionWechatResponse,
} from '@proma/shared'

/** 创建订阅 API */
export function createSubscriptionApi(client: CloudApiClient) {
  return {
    /** 获取订阅档位列表 */
    getTiers: async (): Promise<SubscriptionTiersResponse> => {
      const response = await client.get<SubscriptionTiersResponse>('/subscription/tiers')
      return response.data
    },

    /** 获取当前活跃订阅汇总 */
    getCurrent: async (): Promise<SubscriptionStatusResponse> => {
      const response = await client.get<SubscriptionStatusResponse>('/subscription/current')
      return response.data
    },

    /** 创建订阅微信支付订单 */
    createWechatPayment: async (tierId: string): Promise<CreateSubscriptionWechatResponse> => {
      const response = await client.post<CreateSubscriptionWechatResponse>(
        '/subscription/wechat/create',
        { tier: tierId },
      )
      return response.data
    },

    /** 查询订阅订单状态 */
    getOrderStatus: async (orderNo: string): Promise<SubscriptionOrderRecord> => {
      const response = await client.get<SubscriptionOrderRecord>(`/subscription/orders/${orderNo}`)
      return response.data
    },

    /** 获取订阅历史 */
    getHistory: async (): Promise<SubscriptionOrderRecord[]> => {
      const response = await client.get<SubscriptionOrderRecord[]>('/subscription/history')
      return response.data
    },
  }
}

/** Subscription API 实例类型 */
export type SubscriptionApi = ReturnType<typeof createSubscriptionApi>
