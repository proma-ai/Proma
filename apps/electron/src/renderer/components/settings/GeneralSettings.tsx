/**
 * GeneralSettings - 通用设置页
 *
 * 顶部：用户档案编辑（头像 + 用户名）
 * 下方：语言等通用设置
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Camera, Check, ExternalLink, ImagePlus, Play, Volume2 } from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { UserAvatar } from '../chat/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
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
  richTextRenderingEnabledAtom,
  stickyUserMessageEnabledAtom,
  sessionHoverPreviewEnabledAtom,
  updateLongTextPasteAsAttachmentEnabled,
  updateRichTextRenderingEnabled,
  updateStickyUserMessageEnabled,
  updateSessionHoverPreviewEnabled,
} from '@/atoms/ui-preferences'
import { cn } from '@/lib/utils'
import { detectIsMac, detectIsWindows } from '@/lib/platform'
import { getEffectiveSoundPackId } from '@/lib/notification-sound-selection'
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
  const [notificationsEnabled, setNotificationsEnabled] = useAtom(notificationsEnabledAtom)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useAtom(notificationSoundEnabledAtom)
  const [notificationSounds, setNotificationSounds] = useAtom(notificationSoundsAtom)
  const [stickyUserMessageEnabled, setStickyUserMessageEnabled] = useAtom(stickyUserMessageEnabledAtom)
  const [longTextPasteAsAttachmentEnabled, setLongTextPasteAsAttachmentEnabled] = useAtom(longTextPasteAsAttachmentEnabledAtom)
  const [richTextRenderingEnabled, setRichTextRenderingEnabled] = useAtom(richTextRenderingEnabledAtom)
  const [sessionHoverPreviewEnabled, setSessionHoverPreviewEnabled] = useAtom(sessionHoverPreviewEnabledAtom)
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [nameInput, setNameInput] = React.useState(userProfile.userName)
  const [showEmojiPicker, setShowEmojiPicker] = React.useState(false)
  const [archiveAfterDays, setArchiveAfterDays] = React.useState<number>(7)
  /** Git/PR 推广标识：默认开启 */
  const [gitAttributionEnabled, setGitAttributionEnabled] = React.useState(true)
  const [agentIslandEnabled, setAgentIslandEnabled] = React.useState(true)
  const isMac = React.useMemo(() => detectIsMac(), [])
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // 加载归档天数与 Git/PR 标识设置
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      setArchiveAfterDays(settings.archiveAfterDays ?? 7)
      setGitAttributionEnabled(settings.gitAttributionEnabled ?? true)
      setAgentIslandEnabled(settings.agentIsland?.enabled ?? true)
    }).catch(console.error)
  }, [])

  /** 更新 Git/PR 推广标识开关 */
  const handleGitAttributionChange = async (checked: boolean): Promise<void> => {
    setGitAttributionEnabled(checked)
    try {
      await window.electronAPI.updateSettings({ gitAttributionEnabled: checked })
    } catch (error) {
      console.error('[通用设置] 更新 Git/PR 标识失败:', error)
      setGitAttributionEnabled(!checked)
    }
  }

  /** 更新灵动岛开关 */
  const handleAgentIslandChange = async (checked: boolean): Promise<void> => {
    setAgentIslandEnabled(checked)
    try {
      await window.electronAPI.updateSettings({ agentIsland: { enabled: checked } })
    } catch (error) {
      console.error('[通用设置] 更新 Agent 灵动岛失败:', error)
      setAgentIslandEnabled(!checked)
    }
  }

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
      const updated = await window.electronAPI.updateUserProfile({ avatar })
      setUserProfile(updated)
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
      const updated = await window.electronAPI.updateUserProfile({ userName: trimmed })
      setUserProfile(updated)
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
      setNameInput(userProfile.userName)
      setIsEditingName(false)
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
                  <UserAvatar avatar={userProfile.avatar} size={64} />
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
                    setNameInput(userProfile.userName)
                    setIsEditingName(true)
                  }}
                  className="text-lg font-semibold text-foreground hover:text-primary transition-colors text-left"
                >
                  {userProfile.userName}
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
          <SoundLibrary
            sounds={notificationSounds}
            disabled={!notificationsEnabled || !notificationSoundEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />
          <div className="mx-4 mb-3 flex items-start justify-between gap-3 rounded-lg bg-muted/35 px-3 py-2.5 text-xs text-muted-foreground">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Volume2 className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <p>音效与卡片插画来自 UI SFX，采用 CC0 公共领域许可。</p>
                <p className="mt-0.5">Proma 非常喜欢这个音效库，并特别还原了一部分 UI SFX 的设计风格，推荐大家访问和使用他们的产品。</p>
              </div>
            </div>
            <a
              href="https://uisfx.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-foreground/70 transition-colors hover:bg-background hover:text-foreground"
            >
              查看来源
              <ExternalLink className="size-3" />
            </a>
          </div>
          {isWindows && (
            <SettingsToggle
              label="Agent 状态通知"
              description="在任务栏托盘显示 Agent 运行状态，悬停查看会话详情"
              checked={agentIslandEnabled}
              disabled={!notificationsEnabled}
              onCheckedChange={(checked) => {
                void handleAgentIslandChange(checked)
              }}
            />
          )}
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
          <SettingsToggle
            label="输入框 Markdown 渲染"
            description="开启后，输入框中的 Markdown 语法（如 **粗体**、# 标题）会实时渲染为富文本；关闭后为纯文本模式，保留 @ 引用等功能"
            checked={richTextRenderingEnabled}
            onCheckedChange={(checked) => {
              setRichTextRenderingEnabled(checked)
              updateRichTextRenderingEnabled(checked)
            }}
          />
          <SettingsToggle
            label="会话悬浮预览"
            description="鼠标悬停在左侧会话列表项上时，弹出会话内容迷你地图预览"
            checked={sessionHoverPreviewEnabled}
            onCheckedChange={(checked) => {
              setSessionHoverPreviewEnabled(checked)
              updateSessionHoverPreviewEnabled(checked)
            }}
          />
          {isMac && (
            <SettingsToggle
              label="Agent 灵动岛"
              description="在 macOS 刘海屏显示需要接手的 Agent 与 1 小时内的待办/日程"
              checked={agentIslandEnabled}
              onCheckedChange={(checked) => {
                void handleAgentIslandChange(checked)
              }}
            />
          )}
          <SettingsToggle
            label="Git/PR 标识"
            description="Agent 代你提交 commit 或创建 PR 时，附加 Made-with: Proma 与官网链接，便于推广；可随时关闭"
            checked={gitAttributionEnabled}
            onCheckedChange={(checked) => {
              void handleGitAttributionChange(checked)
            }}
          />
        </SettingsCard>
      </SettingsSection>

    </div>
  )
}

// ===== SoundLibrary 内部组件 =====

const SOUND_SCENES: Array<{ type: NotificationSoundType; label: string; shortLabel: string }> = [
  { type: 'taskComplete', label: '任务完成', shortLabel: '完成' },
  { type: 'permissionRequest', label: '权限审批', shortLabel: '权限' },
  { type: 'exitPlanMode', label: '计划审批', shortLabel: '计划' },
  { type: 'planningReminder', label: '日程提醒', shortLabel: '提醒' },
]

interface SoundLibraryProps {
  sounds: NotificationSoundSettings
  disabled: boolean
  onSoundChange: (type: NotificationSoundType, soundId: NotificationSoundId) => void
}

/** 单一 UISFX 风格音效库：场景只切换当前配置，不重复渲染四套卡片。 */
function SoundLibrary({ sounds, disabled, onSoundChange }: SoundLibraryProps): React.ReactElement {
  const [activeType, setActiveType] = React.useState<NotificationSoundType>('taskComplete')
  const currentId = sounds[activeType] ?? DEFAULT_NOTIFICATION_SOUNDS[activeType]
  const currentPackId = currentId === 'none' ? undefined : getEffectiveSoundPackId(currentId)
  const selectedSound = NOTIFICATION_SOUNDS.find((sound) => sound.id === currentPackId) ?? NOTIFICATION_SOUNDS[0]
  if (!selectedSound) throw new Error('通知音 feel 列表不能为空')
  const selectedIndex = NOTIFICATION_SOUNDS.findIndex((sound) => sound.id === selectedSound.id)
  const activeScene = SOUND_SCENES.find((scene) => scene.type === activeType) ?? SOUND_SCENES[0]
  if (!activeScene) throw new Error('通知音场景列表不能为空')

  return (
    <div className={cn('border-t border-border/25 px-4 py-3', disabled && 'opacity-55')}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">声音库</div>
          <div className="mt-0.5 text-xs text-muted-foreground">选择一个通知场景，再为它挑选 feel</div>
        </div>
        <a
          href="https://uisfx.com/#sound-library"
          target="_blank"
          rel="noreferrer"
          className="hidden min-h-8 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
        >
          UI SFX 音效库
          <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-foreground/15 pb-1">
        {SOUND_SCENES.map((scene) => {
          const sceneId = sounds[scene.type] ?? DEFAULT_NOTIFICATION_SOUNDS[scene.type]
          const scenePack = sceneId === 'none' ? undefined : getEffectiveSoundPackId(sceneId)
          const sceneSound = NOTIFICATION_SOUNDS.find((sound) => sound.id === scenePack) ?? NOTIFICATION_SOUNDS[0]
          return (
            <button
              key={scene.type}
              type="button"
              disabled={disabled}
              aria-pressed={activeType === scene.type}
              onClick={() => setActiveType(scene.type)}
              className={cn(
                'flex min-h-9 min-w-[92px] flex-1 items-center justify-between gap-2 border-b-2 px-2 text-left transition-[border-color,background-color,color] duration-150',
                activeType === scene.type ? 'border-foreground bg-muted/55 text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground'
              )}
            >
              <span className="truncate text-xs font-medium">{scene.label}</span>
              <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[0.08em] opacity-75">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: sceneSound?.color }} />
                {sceneId === 'none' ? '关' : sceneSound?.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 overflow-hidden border-2 border-foreground/70 bg-background/45 shadow-[4px_4px_0_rgba(122,110,206,0.4)]">
        <div className="grid grid-cols-[88px_1fr_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[104px_1fr_auto]">
          <div className="relative aspect-[1.25] overflow-hidden border border-foreground/50 bg-muted">
            <img src={selectedSound.image} alt="" className="size-full object-cover" />
            <span className="absolute left-1 top-1 bg-background/90 px-1 py-0.5 text-[9px] font-semibold tabular-nums">{String(selectedIndex + 1).padStart(2, '0')}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-base font-semibold text-foreground">{activeScene.label} · {currentId === 'none' ? '已关闭' : selectedSound.label}</span>
              <span className="hidden shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:inline">{selectedSound.duration} S · ONE-SHOT</span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{selectedSound.description}</p>
            <Waveform color={selectedSound.color} />
          </div>
          <button
            type="button"
            disabled={disabled || currentId === 'none'}
            aria-label={`试听${activeScene.label}`}
            title={`试听${activeScene.label}`}
            onClick={() => { void playNotificationSound(currentId, activeType) }}
            className="inline-flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-[transform,opacity] hover:scale-105 active:scale-[0.96] disabled:opacity-35"
          >
            <Play className="size-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-3 border-t-2 border-foreground/55 sm:grid-cols-4 lg:grid-cols-6">
          {NOTIFICATION_SOUNDS.map((sound, index) => {
            const selected = currentId !== 'none' && sound.id === currentPackId
            return (
              <div key={sound.id} className="relative min-w-0 border-b border-r border-foreground/20 last:border-r-0">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => onSoundChange(activeType, sound.id)}
                  className={cn(
                    'group/card flex min-h-[152px] w-full flex-col bg-background text-left transition-[background-color,transform] duration-150 hover:bg-muted/45 active:scale-[0.98]',
                    selected && 'bg-muted/70'
                  )}
                >
                  <span className="relative block aspect-[1.5] overflow-hidden border-b border-foreground/25">
                    <img src={sound.image} alt="" className="size-full object-cover transition-transform duration-200 group-hover/card:scale-105" />
                    <span className="absolute left-1.5 top-1.5 bg-background/90 px-1 py-0.5 text-[9px] font-semibold tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    {selected && <Check className="absolute right-1.5 top-1.5 size-3.5 rounded-full bg-foreground p-0.5 text-background" />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5 pr-8">
                    <span className="flex min-w-0 items-center justify-between gap-1">
                      <span className="truncate text-xs font-medium text-foreground">{sound.label}</span>
                      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: sound.color }} />
                    </span>
                    <span className="truncate text-[10px] leading-4 text-muted-foreground">{sound.description}</span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`试听 ${sound.label}`}
                  title={`试听 ${sound.label}`}
                  onClick={() => { void playNotificationSound(sound.id, activeType) }}
                  className="absolute bottom-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-foreground/90 text-background transition-[transform,opacity] hover:scale-105 active:scale-[0.96] disabled:opacity-35"
                >
                  <Play className="size-2.5" />
                </button>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={currentId === 'none'}
          onClick={() => onSoundChange(activeType, 'none')}
          className="inline-flex min-h-8 items-center gap-1.5 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        >
          <Volume2 className="size-3.5" />
          {currentId === 'none' ? '已关闭此场景音效' : '关闭此场景音效'}
        </button>
      </div>
    </div>
  )
}

const WAVEFORM_HEIGHTS = [0.35, 0.56, 0.28, 0.72, 0.94, 0.5, 0.78, 0.42, 0.66, 0.9, 0.58, 0.3, 0.7, 0.46, 0.84, 0.62, 0.38, 0.76, 0.52, 0.88, 0.44, 0.68, 0.34, 0.56, 0.8, 0.48, 0.64, 0.3]

function Waveform({ color }: { color: string }): React.ReactElement {
  return (
    <span className="mt-2 flex h-5 w-full items-center gap-px border-b border-foreground/25 pb-1" aria-hidden="true">
      {WAVEFORM_HEIGHTS.map((height, index) => (
        <span key={index} className="w-px shrink-0 rounded-full opacity-85" style={{ height: `${Math.round(height * 14)}px`, backgroundColor: color }} />
      ))}
    </span>
  )
}
