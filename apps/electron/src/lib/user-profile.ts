import type { CloudUserInfo } from '@proma/shared'
import { DEFAULT_USER_AVATAR, DEFAULT_USER_NAME } from '../types/user-profile'
import type { UserProfile } from '../types/user-profile'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** IPC 与旧配置可能突破类型契约；头像在参与字符串运算前必须规范化。 */
export function normalizeUserAvatar(value: unknown): string {
  return isNonEmptyString(value) ? value : DEFAULT_USER_AVATAR
}

/** 只保留完整、有效的档案字段，供读取、持久化、广播和 renderer 共用。 */
export function normalizeUserProfile(value: unknown): UserProfile {
  const profile = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    userName: isNonEmptyString(profile.userName) ? profile.userName : DEFAULT_USER_NAME,
    avatar: normalizeUserAvatar(profile.avatar),
  }
}

/** Cloud 同步是当前账号的完整快照，不得继承另一个账号的本地头像或姓名。 */
export function cloudUserToProfile(user: Pick<CloudUserInfo, 'name' | 'image' | 'avatar'>): UserProfile {
  return normalizeUserProfile({
    userName: user.name,
    avatar: isNonEmptyString(user.image) ? user.image : user.avatar,
  })
}
