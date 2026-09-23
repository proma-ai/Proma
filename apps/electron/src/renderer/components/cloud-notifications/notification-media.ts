import type { CloudNotification } from '@proma/shared'

export interface NotificationMedia {
  type: 'image' | 'video'
  url: string
}

export interface NotificationMediaLayout {
  mediaColumnWidth: number
  dialogWidth: number
}

/** 图片遵循原始比例；横图按约 300px 可见高度布局，同时给右侧文案留出空间。 */
export function getNotificationMediaLayout(
  width: number,
  height: number,
  type: NotificationMedia['type'] = 'image',
): NotificationMediaLayout {
  const validSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
  const aspect = validSize ? width / height : 1
  if (type === 'video') {
    const mediaColumnWidth = Math.min(592, Math.max(292, Math.round(aspect * 360)))
    return { mediaColumnWidth, dialogWidth: Math.min(1080, mediaColumnWidth + 496) }
  }
  const landscape = aspect > 1.2
  const targetHeight = landscape ? 300 : 400
  const naturalWidth = validSize ? Math.min(width, aspect * targetHeight) : 400
  const mediaWidth = Math.min(landscape ? 600 : 400, Math.max(168, Math.round(naturalWidth)))
  // 图片贴齐弹窗外缘，不再为独立媒体卡片预留两侧内边距。
  const mediaColumnWidth = mediaWidth
  return { mediaColumnWidth, dialogWidth: Math.min(1120, mediaColumnWidth + 496) }
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
