/**
 * 订阅 API（纯函数，不依赖 React）
 */

import type { CloudApiClient } from './client'
import type {
  SubscriptionTiersResponse,
  SubscriptionStatusResponse,
  SubscriptionOrderHistoryResponse,
  SubscriptionOrderRecord,
  SubscriptionHistoryQuery,
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
    getHistory: async (params: SubscriptionHistoryQuery = {}): Promise<SubscriptionOrderHistoryResponse> => {
      const searchParams = new URLSearchParams()
      if (params.page !== undefined) searchParams.set('page', String(params.page))
      if (params.page_size !== undefined) searchParams.set('page_size', String(params.page_size))
      const query = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
      const response = await client.get<SubscriptionOrderHistoryResponse>(`/subscription/history${query}`)
      return response.data
    },
  }
}

/** Subscription API 实例类型 */
export type SubscriptionApi = ReturnType<typeof createSubscriptionApi>
