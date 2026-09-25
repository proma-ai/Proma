/**
 * UserAvatar - 用户头像组件
 *
 * 对标 Cherry Studio 的 EmojiAvatar 设计：
 * - 支持 emoji 字符串（直接渲染文字）
 * - 支持 data:image/* URL（渲染为图片）
 * - 图片无法加载时显示本地默认图标，避免远程头像产生空白区域
 * - Windows 默认头像使用人物矢量图标，避免组合 emoji 分离显示
 * - 可配置大小
 * - 圆角 20%，柔和边框
 */

import * as React from 'react'
import { UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import { detectIsWindows } from '@/lib/platform'
import { normalizeUserAvatar } from '../../../lib/user-profile'
import { DEFAULT_USER_AVATAR } from '../../../types/user-profile'
import { resolveUserAvatarDisplay } from './user-avatar-display'

interface UserAvatarProps {
  /** 头像内容（emoji 字符串 或 data:image/* URL） */
  avatar?: string | null
  /** 尺寸（像素），默认 35 */
  size?: number
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

export function UserAvatar({
  avatar,
  size = 35,
  className,
  onClick,
}: UserAvatarProps): React.ReactElement {
  const fontSize = Math.round(size * 0.5)
  const safeAvatar = normalizeUserAvatar(avatar)
  const [failedAvatar, setFailedAvatar] = React.useState<string | null>(null)
  const display = resolveUserAvatarDisplay(safeAvatar, failedAvatar)

  if (display === 'image') {
    return (
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-[20%] border-[0.5px] border-foreground/10',
          onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
          className
        )}
        style={{ width: size, height: size }}
        onClick={onClick}
      >
        <img
          src={safeAvatar}
          alt="用户头像"
          className="size-full object-cover"
          onError={() => setFailedAvatar(safeAvatar)}
        />
      </div>
    )
  }

  // 加载失败时所有平台统一使用本地图标；Windows 的默认 emoji 也沿用图标。
  const useDefaultIcon = display === 'fallback-icon'
    || (safeAvatar === DEFAULT_USER_AVATAR && detectIsWindows())
  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-center rounded-[20%]',
        'bg-foreground/[0.04] dark:bg-foreground/[0.08] border-[0.5px] border-foreground/10',
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
        className
      )}
      style={{ width: size, height: size, fontSize }}
      onClick={onClick}
    >
      {useDefaultIcon ? (
        <UserRound
          size={Math.round(size * 0.55)}
          strokeWidth={1.75}
          className="shrink-0 text-foreground/60"
          role="img"
          aria-label="默认用户头像"
        />
      ) : safeAvatar}
    </div>
  )
}
