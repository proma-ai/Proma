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
  // 后台预加载所有通知音到 AudioBuffer，不阻塞设置加载
  void preloadAllSounds()
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

// Web Audio API 替代 HTML5 Audio，解决 AirPods 等蓝牙设备上的破音问题：
// 1. 预解码所有通知音到 AudioBuffer，播放时零解码延迟
// 2. 每次播放创建新的 BufferSource，无需 currentTime seek，消除 seek-play 竞态
// 3. AudioContext 保持活跃，避免蓝牙管线冷启动延迟

/** 懒初始化 AudioContext */
let audioCtx: AudioContext | null = null

async function getAudioContext(): Promise<AudioContext> {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  // 浏览器自动播放策略可能导致 AudioContext 挂起，播放前必须 await resume()
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume()
  }
  return audioCtx
}

/** 预解码的 AudioBuffer 缓存（按 soundId） */
const audioBufferCache = new Map<string, AudioBuffer>()

/** 上一次播放通知音的时间戳，用于防重叠 */
let lastPlayTime = 0
const MIN_PLAY_INTERVAL_MS = 300

/**
 * 通过 XHR 加载音频文件（Electron file:// 协议下 fetch 可能受限的 fallback）
 */
function loadAudioViaXHR(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    xhr.responseType = 'arraybuffer'
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        resolve(xhr.response as ArrayBuffer)
      } else {
        reject(new Error(`XHR ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('XHR load error'))
    xhr.send()
  })
}

/**
 * 加载音频文件为 ArrayBuffer，fetch 优先，失败时降级到 XHR
 */
async function loadAudioData(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.arrayBuffer()
  } catch {
    // fetch 在 Electron file:// 协议下可能受限，降级到 XHR
    return loadAudioViaXHR(url)
  }
}

/** 预加载并解码单个通知音 */
async function preloadSound(soundId: string, url: string): Promise<void> {
  try {
    const [ctx, arrayBuffer] = await Promise.all([
      getAudioContext(),
      loadAudioData(url),
    ])
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    audioBufferCache.set(soundId, audioBuffer)
  } catch (error) {
    console.error(`[通知] 预加载音频失败 ${soundId}:`, error)
  }
}

/** 批量预加载所有通知音 */
export async function preloadAllSounds(): Promise<void> {
  await Promise.all(NOTIFICATION_SOUNDS.map((s) => preloadSound(s.id, s.url)))
}

/**
 * 即时加载并解码单个通知音（预加载未就绪时的降级路径）
 */
async function decodeSoundOnTheFly(url: string): Promise<AudioBuffer | undefined> {
  try {
    const [ctx, arrayBuffer] = await Promise.all([
      getAudioContext(),
      loadAudioData(url),
    ])
    return await ctx.decodeAudioData(arrayBuffer)
  } catch (error) {
    console.error('[通知] 即时解码音频失败:', error)
    return undefined
  }
}

/**
 * 播放指定通知音
 *
 * 使用 Web Audio API 的 createBufferSource + start(0) 替代 HTML5 Audio.play()。
 * 每次播放创建独立的 BufferSource，避免蓝牙设备上 currentTime seek 导致的破音。
 */
export async function playNotificationSound(soundId: NotificationSoundId): Promise<void> {
  try {
    if (soundId === 'none') return

    // 防重叠：短时间内多次触发时抑制后续播放
    const now = Date.now()
    if (now - lastPlayTime < MIN_PLAY_INTERVAL_MS) return
    lastPlayTime = now

    let buffer = audioBufferCache.get(soundId)

    // 预加载未就绪时，即时解码作为降级
    if (!buffer) {
      const meta = NOTIFICATION_SOUNDS.find((s) => s.id === soundId)
      if (!meta) return
      buffer = await decodeSoundOnTheFly(meta.url)
      if (!buffer) return
      // 缓存到 bufferCache 以便后续直接使用
      audioBufferCache.set(soundId, buffer)
    }

    const ctx = await getAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
  } catch (error) {
    console.warn('[通知] 播放通知音失败:', soundId, error)
  }
}

/**
 * 根据场景类型播放对应通知音
 */
export async function playNotificationSoundForType(
  type: NotificationSoundType,
  sounds: NotificationSoundSettings
): Promise<void> {
  const soundId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type]
  await playNotificationSound(soundId)
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
  // 将音频播放和系统通知推迟到下一个宏任务，避免在 React batchedUpdates
  // 同步调用栈中阻塞主线程（Notification 创建会导致掉帧）
  setTimeout(async () => {
    if (options?.playSound && options.soundType) {
      await playNotificationSoundForType(options.soundType, options.sounds ?? {})
    }

    if (!enabled) return
    if (!options?.force && document.hasFocus()) return

    const notification = new Notification(title, { body, silent: true })
    notification.onclick = () => {
      window.focus()
      options?.onNavigate?.()
    }
  }, 0)
}

// ===== AudioContext 生命周期管理 =====

/** 应用退出时释放音频硬件资源 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close()
      audioCtx = null
    }
  })
}
