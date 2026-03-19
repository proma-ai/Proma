/**
 * 支付 API（纯函数，不依赖 React）
 *
 * 参考 proma-frontend/src/api/payment.ts 迁移
 */

import type { CloudApiClient } from './client'
import type {
  PaymentTiersResponse,
  CreateWechatPaymentResponse,
  CreateStripePaymentResponse,
  OrderRecord,
  VerifyVipResponse,
} from '@proma/shared'

/** 创建支付 API */
export function createPaymentApi(client: CloudApiClient) {
  return {
    /** 获取套餐列表 */
    getTiers: async (): Promise<PaymentTiersResponse> => {
      const response = await client.get<PaymentTiersResponse>('/payment/tiers')
      return response.data
    },

    /** 创建微信支付订单 */
    createWechatPayment: async (tierId: string): Promise<CreateWechatPaymentResponse> => {
      const response = await client.post<CreateWechatPaymentResponse>(
        '/payment/wechat/create',
        { tier: tierId },
      )
      return response.data
    },

    /** 创建 Stripe 支付订单 */
    createStripePayment: async (tierId: string): Promise<CreateStripePaymentResponse> => {
      const response = await client.post<CreateStripePaymentResponse>(
        '/payment/stripe/create',
        { tier: tierId },
      )
      return response.data
    },

    /** 查询订单状态 */
    getOrderStatus: async (orderNo: string): Promise<OrderRecord> => {
      const response = await client.get<OrderRecord>(`/payment/orders/${orderNo}`)
      return response.data
    },

    /** 获取订单历史 */
    getOrders: async (): Promise<OrderRecord[]> => {
      const response = await client.get<OrderRecord[]>('/payment/orders')
      return response.data
    },

    /** VIP 折扣码验证 */
    verifyVip: async (apiKey: string): Promise<VerifyVipResponse> => {
      const response = await client.post<VerifyVipResponse>('/payment/verify-vip', {
        api_key: apiKey,
      })
      return response.data
    }
  }
}

/** Payment API 实例类型 */
export type PaymentApi = ReturnType<typeof createPaymentApi>
