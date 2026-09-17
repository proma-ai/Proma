/**
 * Proma Cloud 通知 HTTP 服务（主进程）
 *
 * 通知以低频 HTTP 拉取交付：渲染进程负责启动、焦点与联网恢复时的即时检查，
 * 以及带抖动的五分钟周期检查。主进程只持有令牌并提供受限 IPC，避免 Renderer
 * 接触认证状态。
 */

import { createNotificationsApi, isApiError } from '@proma/cloud'
import type { CloudNotification, CloudNotificationClientPlatform, CloudNotificationIpcResponse } from '@proma/shared'
import { getApiClient, getAuthToken } from './cloud-auth-service'

function getNotificationPlatform(): CloudNotificationClientPlatform {
  return process.platform === 'darwin' ? 'macos' : 'windows'
}

/** 读取当前用户的未确认通知。 */
export async function getPendingCloudNotifications(): Promise<CloudNotificationIpcResponse<CloudNotification[]>> {
  if (!getAuthToken()) return { success: false, error: '未登录' }

  try {
    const notifications = await createNotificationsApi(getApiClient()).listPending(getNotificationPlatform())
    return { success: true, data: notifications }
  } catch (error) {
    return {
      success: false,
      error: isApiError(error) ? error.message : '获取通知失败，请稍后重试',
    }
  }
}

/** 确认单条通知。 */
export async function acknowledgeCloudNotification(notificationId: string): Promise<CloudNotificationIpcResponse<void>> {
  if (!notificationId) return { success: false, error: '通知 ID 无效' }
  if (!getAuthToken()) return { success: false, error: '未登录' }

  try {
    await createNotificationsApi(getApiClient()).acknowledge(notificationId, getNotificationPlatform())
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: isApiError(error) ? error.message : '确认通知失败，请稍后重试',
    }
  }
}
