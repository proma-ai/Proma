/** 用户头像在当前加载状态下应呈现的内容。 */
export type UserAvatarDisplay = 'image' | 'fallback-icon' | 'emoji'

/**
 * 远程或 data URL 头像加载失败时，不再保留空白图片区域，改为本地默认图标。
 * failedAvatar 使用具体 URL 而非布尔值，头像地址更新后可立即尝试加载新图片。
 */
export function resolveUserAvatarDisplay(avatar: string, failedAvatar: string | null): UserAvatarDisplay {
  const isImage = avatar.startsWith('data:image') || avatar.startsWith('http')
  if (!isImage) return 'emoji'
  return failedAvatar === avatar ? 'fallback-icon' : 'image'
}
