/**
 * 桌面通知状态管理
 *
 * 管理通知开关状态，提供发送桌面通知的工具函数。
 * 使用 Web Notification API（Electron renderer 原生支持）。
 * 支持多场景通知音选择（任务完成、权限审批、计划审批）。
 */

import { atom } from 'jotai'
import type { NotificationSoundId, NotificationSoundType, NotificationSoundSettings } from '@/types/settings'

// ===== 音频资源导入 =====
import soundDing from '@/assets/sound/ding.mp3'
import soundDingDong from '@/assets/sound/ding-dong.mp3'
import soundDiscord from '@/assets/sound/discord.mp3'
import soundDone from '@/assets/sound/done.mp3'
import soundDownPower from '@/assets/sound/down-power.mp3'
import soundFood from '@/assets/sound/food.mp3'
import soundLite from '@/assets/sound/lite.mp3'
import soundQuiet from '@/assets/sound/quiet.mp3'

// ===== 音频资源注册表 =====

/** 通知音元数据 */
export interface NotificationSoundMeta {
  id: NotificationSoundId
  label: string
  url: string
}

/** 所有可用通知音（不含 none） */
export const NOTIFICATION_SOUNDS: NotificationSoundMeta[] = [
  { id: 'ding', label: 'Ding', url: soundDing },
  { id: 'ding-dong', label: 'Ding Dong', url: soundDingDong },
  { id: 'discord', label: 'Discord', url: soundDiscord },
  { id: 'done', label: 'Done', url: soundDone },
  { id: 'down-power', label: 'Down Power', url: soundDownPower },
  { id: 'food', label: 'Food', url: soundFood },
  { id: 'lite', label: 'Lite', url: soundLite },
  { id: 'quiet', label: 'Quiet', url: soundQuiet },
]

/** 音频 URL 映射（快速查找） */
const SOUND_URL_MAP: Record<string, string> = Object.fromEntries(
  NOTIFICATION_SOUNDS.map((s) => [s.id, s.url])
)

/** 各场景的默认通知音 */
export const DEFAULT_NOTIFICATION_SOUNDS: Required<NotificationSoundSettings> = {
  taskComplete: 'ding',
  permissionRequest: 'ding-dong',
  exitPlanMode: 'ding-dong',
}

// ===== Jotai Atoms =====

/** 通知是否启用 */
export const notificationsEnabledAtom = atom<boolean>(true)

/** 通知提示音是否启用 */
export const notificationSoundEnabledAtom = atom<boolean>(true)

/** 各场景通知音配置 */
export const notificationSoundsAtom = atom<NotificationSoundSettings>({})

// ===== 初始化 =====

/**
 * 从主进程加载通知设置
 */
export async function initializeNotifications(
  setEnabled: (enabled: boolean) => void,
  setSoundEnabled: (enabled: boolean) => void,
  setSounds: (sounds: NotificationSoundSettings) => void
): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    setEnabled(settings.notificationsEnabled ?? true)
    setSoundEnabled(settings.notificationSoundEnabled ?? true)
    setSounds(settings.notificationSounds ?? {})
  } catch (error) {
    console.error('[通知] 初始化失败:', error)
  }
}

// ===== 持久化更新 =====

/**
 * 更新通知开关并持久化
 */
export async function updateNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ notificationsEnabled: enabled })
  } catch (error) {
    console.error('[通知] 更新设置失败:', error)
  }
}

/**
 * 更新通知提示音开关并持久化
 */
export async function updateNotificationSoundEnabled(enabled: boolean): Promise<void> {
  try {
    await window.electronAPI.updateSettings({ notificationSoundEnabled: enabled })
  } catch (error) {
    console.error('[通知] 更新提示音设置失败:', error)
  }
}

/**
 * 更新某场景的通知音并持久化
 */
export async function updateNotificationSound(
  type: NotificationSoundType,
  soundId: NotificationSoundId,
  currentSounds: NotificationSoundSettings
): Promise<NotificationSoundSettings> {
  const newSounds: NotificationSoundSettings = { ...currentSounds, [type]: soundId }
  try {
    await window.electronAPI.updateSettings({ notificationSounds: newSounds })
  } catch (error) {
    console.error('[通知] 更新通知音设置失败:', error)
  }
  return newSounds
}

// ===== 音频播放 =====

/** 音频元素缓存池（按 soundId 缓存，避免重复创建） */
const audioCache = new Map<string, HTMLAudioElement>()

/**
 * 获取或创建音频元素
 */
function getAudioElement(soundId: NotificationSoundId): HTMLAudioElement | null {
  if (soundId === 'none') return null

  const url = SOUND_URL_MAP[soundId]
  if (!url) return null

  let audio = audioCache.get(soundId)
  if (!audio) {
    audio = new Audio(url)
    audioCache.set(soundId, audio)
  }
  return audio
}

/**
 * 播放指定通知音
 */
export function playNotificationSound(soundId: NotificationSoundId): void {
  try {
    const audio = getAudioElement(soundId)
    if (!audio) return
    audio.currentTime = 0
    audio.play().catch(() => {})
  } catch {
    // 静默失败
  }
}

/**
 * 根据场景类型播放对应通知音
 */
export function playNotificationSoundForType(
  type: NotificationSoundType,
  sounds: NotificationSoundSettings
): void {
  const soundId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type]
  playNotificationSound(soundId)
}

// ===== 桌面通知 =====

/** 发送桌面通知的附加选项 */
export interface DesktopNotificationOptions {
  /** 通知音场景类型（启用时按此类型播放对应音效） */
  soundType?: NotificationSoundType
  /** 是否播放提示音 */
  playSound?: boolean
  /** 当前通知音配置（playSound 为 true 时需要） */
  sounds?: NotificationSoundSettings
  /** 点击通知时的导航回调（如导航到对应会话） */
  onNavigate?: () => void
  /** 强制弹出通知，无视窗口焦点状态（用于阻塞操作） */
  force?: boolean
}

/**
 * 发送桌面通知
 *
 * 提示音：无论窗口是否聚焦都会播放（阻塞操作需要立即引起注意）。
 * 桌面通知：仅在窗口未聚焦且通知已启用时发送。
 * 点击通知会聚焦应用窗口，并可选导航到对应会话。
 */
export function sendDesktopNotification(
  title: string,
  body: string,
  enabled: boolean,
  options?: DesktopNotificationOptions
): void {
  // 提示音在 focus 判断之前播放，确保阻塞操作始终有声音提醒
  if (options?.playSound && options.soundType) {
    playNotificationSoundForType(options.soundType, options.sounds ?? {})
  }

  if (!enabled) return
  if (!options?.force && document.hasFocus()) return

  const notification = new Notification(title, { body, silent: true })
  notification.onclick = () => {
    window.focus()
    options?.onNavigate?.()
  }
}
