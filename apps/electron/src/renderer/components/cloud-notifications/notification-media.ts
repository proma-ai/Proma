import type { CloudNotification } from '@proma/shared'

export interface NotificationMedia {
  type: 'image' | 'video'
  url: string
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
