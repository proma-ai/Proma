/**
 * GeneralSettings - 通用设置页
 *
 * 顶部：用户档案编辑（头像 + 用户名）
 * 下方：语言等通用设置
 *
 * Cloud 模式 + 已登录：从 Cloud 用户信息显示，更新时同步 Cloud API + 本地
 * Local 模式：完全本地
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Camera, ImagePlus, LogOut } from 'lucide-react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from './primitives'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog'
import { buttonVariants } from '../ui/button'
import { UserAvatar } from '../chat/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
import { cloudUserAtom, isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { isCloudMode } from '@/lib/mode'
import { cn } from '@/lib/utils'

/** emoji-mart 选择回调的 emoji 对象类型 */
interface EmojiMartEmoji {
  id: string
  name: string
  native: string
  unified: string
  keywords: string[]
  shortcodes: string
}

export function GeneralSettings(): React.ReactElement {
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const cloudUser = useAtomValue(cloudUserAtom)
  const isCloudAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  /** Cloud 模式 + 已登录 */
  const useCloudProfile = isCloudMode() && isCloudAuthenticated && cloudUser !== null

  /** 当前显示的用户名 */
  const displayName = useCloudProfile ? cloudUser.name : userProfile.userName

  /** 当前显示的头像 */
  const displayAvatar = useCloudProfile
    ? (cloudUser.image || cloudUser.avatar || userProfile.avatar)
    : userProfile.avatar

  const [nameInput, setNameInput] = React.useState(displayName)

  /** displayName 变化时同步 nameInput */
  React.useEffect(() => {
    if (!isEditingName) {
      setNameInput(displayName)
    }
  }, [displayName, isEditingName])

  /** 更新头像 */
  const handleAvatarChange = async (avatar: string): Promise<void> => {
    try {
      if (useCloudProfile) {
        // Cloud 模式：先更新远端，同时更新本地
        const [cloudResult] = await Promise.all([
          window.electronAPI.cloudAuth.updateProfile({ image: avatar }),
          window.electronAPI.updateUserProfile({ avatar }),
        ])
        if (!cloudResult.success) {
          console.error('[通用设置] Cloud 更新头像失败:', cloudResult.error)
        }
      } else {
        const updated = await window.electronAPI.updateUserProfile({ avatar })
        setUserProfile(updated)
      }
      setShowEmojiPicker(false)
    } catch (error) {
      console.error('[通用设置] 更新头像失败:', error)
    }
  }

  /** 上传图片作为头像 */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      await handleAvatarChange(dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  /** 保存用户名 */
  const handleSaveName = async (): Promise<void> => {
    const trimmed = nameInput.trim()
    if (!trimmed) return

    try {
      if (useCloudProfile) {
        // Cloud 模式：先更新远端，同时更新本地
        const [cloudResult] = await Promise.all([
          window.electronAPI.cloudAuth.updateProfile({ name: trimmed }),
          window.electronAPI.updateUserProfile({ userName: trimmed }),
        ])
        if (!cloudResult.success) {
          console.error('[通用设置] Cloud 更新用户名失败:', cloudResult.error)
        }
      } else {
        const updated = await window.electronAPI.updateUserProfile({ userName: trimmed })
        setUserProfile(updated)
      }
      setIsEditingName(false)
    } catch (error) {
      console.error('[通用设置] 更新用户名失败:', error)
    }
  }

  /** 用户名编辑键盘事件 */
  const handleNameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleSaveName()
    } else if (e.key === 'Escape') {
      setNameInput(displayName)
      setIsEditingName(false)
    }
  }

  /** 登出 Cloud 账户 */
  const handleLogout = async (): Promise<void> => {
    try {
      await window.electronAPI.cloudAuth.logout()
    } catch (error) {
      console.error('[通用设置] 登出失败:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* 用户档案区域 */}
      <SettingsSection
        title="用户档案"
        description="设置你的头像和显示名称"
      >
        <SettingsCard>
          <div className="flex items-center gap-5 px-4 py-4">
            {/* 头像 + Popover emoji 选择器 */}
            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <div className="relative group/avatar cursor-pointer">
                  <UserAvatar avatar={displayAvatar} size={64} />
                  {/* 编辑覆盖层 */}
                  <div
                    className={cn(
                      'absolute inset-0 rounded-[20%] flex items-center justify-center',
                      'bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity'
                    )}
                  >
                    <Camera className="size-5 text-white" />
                  </div>
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                sideOffset={12}
                className="w-auto p-0 border-none shadow-xl"
              >
                <Picker
                  data={data}
                  onEmojiSelect={(emoji: EmojiMartEmoji) => handleAvatarChange(emoji.native)}
                  locale="zh"
                  theme="auto"
                  previewPosition="none"
                  skinTonePosition="search"
                  perLine={8}
                />
                {/* 上传自定义图片 */}
                <div className="px-3 p-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px]',
                      'text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors'
                    )}
                  >
                    <ImagePlus className="size-4" />
                    上传自定义图片
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {/* 用户名 */}
            <div className="flex-1 min-w-0">
              {isEditingName ? (
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleSaveName}
                  onKeyDown={handleNameKeyDown}
                  maxLength={30}
                  autoFocus
                  className={cn(
                    'text-lg font-semibold text-foreground bg-transparent border-b-2 border-primary',
                    'outline-none w-full max-w-[200px] pb-0.5'
                  )}
                />
              ) : (
                <button
                  onClick={() => {
                    setNameInput(displayName)
                    setIsEditingName(true)
                  }}
                  className="text-lg font-semibold text-foreground hover:text-primary transition-colors text-left"
                >
                  {displayName}
                </button>
              )}
              <p className="text-[12px] text-foreground/40 mt-0.5">
                点击头像更换，点击名字编辑
              </p>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 通用设置 */}
      <SettingsSection
        title="通用设置"
        description="应用的基本配置"
      >
        <SettingsCard>
          <SettingsRow
            label="语言"
            description="更多语言支持即将推出"
          >
            <span className="text-[13px] text-foreground/40">简体中文</span>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {/* 账户区域 - 仅 Cloud 模式 + 已登录时显示 */}
      {useCloudProfile && (
        <SettingsSection
          title="Proma 账户"
          description="Proma 账户信息"
        >
          <SettingsCard>
            <SettingsRow
              label="邮箱"
              description="当前登录的 Proma 账户"
            >
              <span className="text-[13px] text-foreground/60">{cloudUser.email}</span>
            </SettingsRow>
            <SettingsRow
              label="登出"
              description="退出当前 Proma 账户"
            >
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px]',
                      'text-destructive hover:bg-destructive/10 transition-colors'
                    )}
                  >
                    <LogOut className="size-3.5" />
                    登出
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认登出</AlertDialogTitle>
                    <AlertDialogDescription>
                      登出后将返回登录页面，你的本地数据不会被删除。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      className={cn(buttonVariants({ variant: 'destructive' }))}
                      onClick={handleLogout}
                    >
                      确认登出
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  )
}
