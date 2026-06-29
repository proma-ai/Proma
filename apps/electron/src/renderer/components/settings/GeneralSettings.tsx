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
import { Camera, ImagePlus, LogOut, CloudDownload, Check, CircleAlert, Volume2 } from 'lucide-react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { UserAvatar } from '../chat/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
// Cloud 模式专属
import { cloudUserAtom, isCloudAuthenticatedAtom } from '@/atoms/cloud-auth'
import { isSyncingAtom, downloadAllStatusAtom } from '@/atoms/sync-atoms'
import { isCloudMode } from '@/lib/mode'
// 通知
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  updateNotificationsEnabled,
  updateNotificationSoundEnabled,
  updateNotificationSound,
  playNotificationSound,
  NOTIFICATION_SOUNDS,
  DEFAULT_NOTIFICATION_SOUNDS,
} from '@/atoms/notifications'
import {
  longTextPasteAsAttachmentEnabledAtom,
  stickyUserMessageEnabledAtom,
  updateLongTextPasteAsAttachmentEnabled,
  updateStickyUserMessageEnabled,
} from '@/atoms/ui-preferences'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import type { NotificationSoundId, NotificationSoundType, NotificationSoundSettings } from '@/types/settings'

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
  // Cloud 模式专属
  const cloudUser = useAtomValue(cloudUserAtom)
  const isCloudAuthenticated = useAtomValue(isCloudAuthenticatedAtom)
  const isSyncing = useAtomValue(isSyncingAtom)
  const [downloadAllStatus, setDownloadAllStatus] = useAtom(downloadAllStatusAtom)
  // 通知
  const [notificationsEnabled, setNotificationsEnabled] = useAtom(notificationsEnabledAtom)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useAtom(notificationSoundEnabledAtom)
  const [notificationSounds, setNotificationSounds] = useAtom(notificationSoundsAtom)
  const [stickyUserMessageEnabled, setStickyUserMessageEnabled] = useAtom(stickyUserMessageEnabledAtom)
  const [longTextPasteAsAttachmentEnabled, setLongTextPasteAsAttachmentEnabled] = useAtom(longTextPasteAsAttachmentEnabledAtom)
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false)
  const [archiveAfterDays, setArchiveAfterDays] = React.useState<number>(7)
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

  // 加载归档天数设置
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      setArchiveAfterDays(settings.archiveAfterDays ?? 7)
    }).catch(console.error)
  }, [])

  /** 更新归档天数 */
  const handleArchiveDaysChange = async (value: string): Promise<void> => {
    const days = parseInt(value, 10)
    setArchiveAfterDays(days)
    try {
      await window.electronAPI.updateSettings({ archiveAfterDays: days })
    } catch (error) {
      console.error('[通用设置] 更新归档天数失败:', error)
    }
  }

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

  /** 从云端下载全部对话 */
  const handleDownloadAll = async (): Promise<void> => {
    try {
      setDownloadAllStatus('idle')
      const result = await window.electronAPI.sync.downloadAllConversations()
      if (result.success) {
        setDownloadAllStatus('success')
        setTimeout(() => setDownloadAllStatus('idle'), 3000)
      } else {
        setDownloadAllStatus('error')
        setTimeout(() => setDownloadAllStatus('idle'), 5000)
      }
    } catch (error) {
      console.error('[通用设置] 下载全部对话失败:', error)
      setDownloadAllStatus('error')
      setTimeout(() => setDownloadAllStatus('idle'), 5000)
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
          <SettingsToggle
            label="桌面通知"
            description="Agent 完成任务或需要操作时发送通知"
            checked={notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationsEnabled(checked)
              updateNotificationsEnabled(checked)
            }}
          />
          <SettingsToggle
            label="通知提示音"
            description="阻塞操作（权限确认、问题回答、计划审批）触发时播放提示音"
            checked={notificationSoundEnabled}
            disabled={!notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationSoundEnabled(checked)
              updateNotificationSoundEnabled(checked)
            }}
          />
          <SoundPicker
            label="任务完成音效"
            type="taskComplete"
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />
          <SoundPicker
            label="权限审批音效"
            type="permissionRequest"
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />
          <SoundPicker
            label="计划审批音效"
            type="exitPlanMode"
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />
          <SettingsRow
            label="自动归档"
            description="超过指定天数未更新的对话将自动归档（置顶对话除外）"
          >
            <Select value={String(archiveAfterDays)} onValueChange={handleArchiveDaysChange}>
              <SelectTrigger className="w-[120px] h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">禁用</SelectItem>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="14">14 天</SelectItem>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="60">60 天</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsToggle
            label="消息悬浮置顶条"
            description="滚动浏览对话时，在顶部显示最近的用户消息摘要"
            checked={stickyUserMessageEnabled}
            onCheckedChange={(checked) => {
              setStickyUserMessageEnabled(checked)
              updateStickyUserMessageEnabled(checked)
            }}
          />
          <SettingsToggle
            label="长文本粘贴转附件"
            description="开启后，输入框粘贴超过 2000 字的文本会自动生成可预览编辑的附件"
            checked={longTextPasteAsAttachmentEnabled}
            onCheckedChange={(checked) => {
              setLongTextPasteAsAttachmentEnabled(checked)
              updateLongTextPasteAsAttachmentEnabled(checked)
            }}
          />
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
              label="下载云端对话"
              description="将云端所有对话下载到本地，已存在的对话将跳过"
            >
              {downloadAllStatus === 'success' ? (
                <span className="flex items-center gap-1.5 text-[13px] text-green-600 dark:text-green-400">
                  <Check className="size-3.5" />
                  下载完成
                </span>
              ) : downloadAllStatus === 'error' ? (
                <span className="flex items-center gap-1.5 text-[13px] text-destructive">
                  <CircleAlert className="size-3.5" />
                  下载失败
                </span>
              ) : (
                <button
                  onClick={handleDownloadAll}
                  disabled={isSyncing}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors',
                    isSyncing
                      ? 'text-foreground/30 cursor-not-allowed'
                      : 'text-primary hover:bg-primary/10'
                  )}
                >
                  <CloudDownload className="size-3.5" />
                  {isSyncing ? '正在下载...' : '下载全部'}
                </button>
              )}
            </SettingsRow>
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

// ===== SoundPicker 内部组件 =====

interface SoundPickerProps {
  label: string
  type: NotificationSoundType
  sounds: NotificationSoundSettings
  disabled: boolean
  onSoundChange: (type: NotificationSoundType, soundId: NotificationSoundId) => void
}

/** 单个场景的通知音选择器（下拉 + 试听按钮） */
function SoundPicker({ label, type, sounds, disabled, onSoundChange }: SoundPickerProps): React.ReactElement {
  const currentId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type]

  return (
    <SettingsRow label={label}>
      <div className="flex items-center gap-1.5">
        <Select
          value={currentId}
          onValueChange={(value) => onSoundChange(type, value as NotificationSoundId)}
          disabled={disabled}
        >
          <SelectTrigger className="w-[130px] h-8 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_SOUNDS.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
            <SelectItem value="none">无</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled || currentId === 'none'}
          onClick={() => playNotificationSound(currentId)}
          title="试听"
        >
          <Volume2 size={14} />
        </Button>
      </div>
    </SettingsRow>
  )
}
