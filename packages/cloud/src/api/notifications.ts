/**
 * Cloud 实时通知接口
 *
 * Electron 在启动、恢复活跃和带抖动的低频周期中调用此接口拉取通知。
 */

import type { CloudApiClient } from './client'
import { isCloudNotification } from '@proma/shared'
import type { CloudNotification, CloudNotificationClientPlatform } from '@proma/shared'

/** 通知 API 所需的最小客户端能力，便于单独测试。 */
export interface NotificationsApiClient {
  get: CloudApiClient['get']
  post: CloudApiClient['post']
}

/**
 * 兼容通知列表在早期服务端版本中可能使用的数组或 notifications 包装形式。
 * 不完整项目会被丢弃，避免渲染端收到不可确认的通知。
 */
export function normalizePendingNotifications(payload: unknown): CloudNotification[] {
  const wrappedItems = typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>).notifications
    : undefined
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(wrappedItems)
      ? wrappedItems
      : []

  return items.filter(isCloudNotification)
}

/** 创建通知 API。 */
export function createNotificationsApi(client: NotificationsApiClient) {
  return {
    /** 获取当前设备尚未确认的通知。 */
    listPending: async (platform: CloudNotificationClientPlatform): Promise<CloudNotification[]> => {
      const response = await client.get<unknown>(`/notifications/pending?platform=${platform}`)
      return normalizePendingNotifications(response.data)
    },

    /** 确认通知，确认后服务端不再将其作为 pending 返回。 */
    acknowledge: async (
      notificationId: string,
      platform: CloudNotificationClientPlatform,
    ): Promise<void> => {
      await client.post<unknown>(
        `/notifications/${encodeURIComponent(notificationId)}/acknowledge?platform=${platform}`,
      )
    },
  }
}

/** 通知 API 实例类型。 */
export type NotificationsApi = ReturnType<typeof createNotificationsApi>
