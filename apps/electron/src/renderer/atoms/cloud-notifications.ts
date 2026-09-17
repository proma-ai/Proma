/**
 * Cloud 富媒体通知状态
 *
 * 通知持久化和已读状态由服务端维护。客户端会在登录、窗口恢复活跃、网络恢复时
 * 立即拉取一次，并以带随机抖动的五分钟间隔继续检查，避免客户端同步醒来时集中请求。
 */

import { atom } from 'jotai'
import type { CloudNotification } from '@proma/shared'

const POLL_INTERVAL_MS = 5 * 60 * 1_000
const POLL_JITTER_RATIO = 0.1

/** 当前待用户确认的通知队列，按发布时间从早到晚展示。 */
export const cloudNotificationsAtom = atom<CloudNotification[]>([])

type CloudNotificationsSetter = (
  update: CloudNotification[] | ((current: CloudNotification[]) => CloudNotification[]),
) => void

let fetchGeneration = 0

function notificationTime(notification: CloudNotification): number {
  const timestamp = Date.parse(notification.publishedAt)
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp
}

/** 去重并保持稳定的发布时间排序。 */
export function mergeCloudNotifications(...lists: CloudNotification[][]): CloudNotification[] {
  const byId = new Map<string, CloudNotification>()
  for (const list of lists) {
    for (const notification of list) {
      byId.set(notification.id, notification)
    }
  }

  return [...byId.values()].sort((left, right) => notificationTime(left) - notificationTime(right))
}

/** 使正在进行的拉取失效，防止确认已读后的旧响应重新展示通知。 */
export function invalidateCloudNotificationFetches(): void {
  fetchGeneration += 1
}

function nextPollDelay(): number {
  const jitter = (Math.random() * 2 - 1) * POLL_JITTER_RATIO
  return Math.round(POLL_INTERVAL_MS * (1 + jitter))
}

/**
 * 启动低频通知检查。
 *
 * 初始、窗口重新获得焦点、页面重新可见和网络恢复都立即检查；周期检查使用递归
 * setTimeout 而不是 setInterval，使每一轮都有独立抖动并避免慢请求重叠。
 */
export function initializeCloudNotifications(setNotifications: CloudNotificationsSetter): () => void {
  let disposed = false
  let pollTimer: number | undefined

  const refresh = (): void => {
    const requestGeneration = ++fetchGeneration
    void window.electronAPI.cloudNotifications.getPending()
      .then((result) => {
        if (disposed || requestGeneration !== fetchGeneration || !result.success || !result.data) return
        setNotifications(mergeCloudNotifications(result.data))
      })
      .catch((error: unknown) => {
        if (!disposed) console.error('[Cloud Notifications] 获取待确认通知失败:', error)
      })
  }

  const scheduleNextPoll = (): void => {
    pollTimer = window.setTimeout(() => {
      refresh()
      if (!disposed) scheduleNextPoll()
    }, nextPollDelay())
  }

  const refreshWhenVisible = (): void => {
    if (document.visibilityState === 'visible') refresh()
  }

  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  refresh()
  scheduleNextPoll()

  return () => {
    disposed = true
    if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
    document.removeEventListener('visibilitychange', refreshWhenVisible)
  }
}
