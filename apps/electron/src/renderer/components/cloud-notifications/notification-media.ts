import type { CloudNotification } from '@proma/shared'

export interface NotificationMedia {
  type: 'image' | 'video'
  url: string
}

export interface NotificationMediaLayout {
  mediaColumnWidth: number
  dialogWidth: number
}

/** 媒体最大高度约 400px：竖图收窄弹窗，横图扩展媒体列，但给文案保留约 440px。 */
export function getNotificationMediaLayout(width: number, height: number): NotificationMediaLayout {
  const validSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  const aspect = validSize ? width / height : 1
  const naturalWidth = validSize ? Math.min(width, aspect * 400) : 400
  const mediaWidth = Math.min(400, Math.max(168, Math.round(naturalWidth)))
  const mediaColumnWidth = mediaWidth + 32 // 媒体两侧各 16px 间距
  return { mediaColumnWidth, dialogWidth: Math.min(900, mediaColumnWidth + 496) }
}

/** 旧服务端没有媒体字段时保持单栏；异常媒体地址不交给浏览器加载。 */
export function resolveNotificationMedia(notification: CloudNotification): NotificationMedia | null {
  const { mediaType, mediaUrl } = notification
  if (mediaType !== 'image' && mediaType !== 'video') return null
  if (typeof mediaUrl !== 'string' || !mediaUrl || mediaUrl.length > 2048 || /\s/.test(mediaUrl)) return null
  try {
    const parsed = new URL(mediaUrl)
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null
    return { type: mediaType, url: mediaUrl }
  } catch {
    return null
  }
}
