/**
 * 桌面通知状态管理
 *
 * 管理通知开关状态，提供发送桌面通知的工具函数。
 * 使用 Web Notification API（Electron renderer 原生支持）。
 * 支持多场景通知音选择（任务完成、权限审批、计划审批）。
 */

import { atom } from 'jotai'
import type { NotificationSoundId, NotificationSoundPackId, NotificationSoundType, NotificationSoundSettings } from '@/types/settings'
import { detectIsWindows } from '@/lib/platform'
import { getEffectiveSoundPackId } from '@/lib/notification-sound-selection'

// UI SFX 采用 CC0 音频资产；每个 feel 只打包 Proma 需要的四类语义 cue。
import sound_minimal_blocked from '@/assets/sound/uisfx/minimal/blocked.mp3'
import sound_minimal_checkpoint from '@/assets/sound/uisfx/minimal/checkpoint.mp3'
import sound_minimal_notification from '@/assets/sound/uisfx/minimal/notification.mp3'
import sound_minimal_complete from '@/assets/sound/uisfx/minimal/complete.mp3'
import sound_soft_blocked from '@/assets/sound/uisfx/soft/blocked.mp3'
import sound_soft_checkpoint from '@/assets/sound/uisfx/soft/checkpoint.mp3'
import sound_soft_notification from '@/assets/sound/uisfx/soft/notification.mp3'
import sound_soft_complete from '@/assets/sound/uisfx/soft/complete.mp3'
import sound_glass_blocked from '@/assets/sound/uisfx/glass/blocked.mp3'
import sound_glass_checkpoint from '@/assets/sound/uisfx/glass/checkpoint.mp3'
import sound_glass_notification from '@/assets/sound/uisfx/glass/notification.mp3'
import sound_glass_complete from '@/assets/sound/uisfx/glass/complete.mp3'
import sound_arcade_blocked from '@/assets/sound/uisfx/arcade/blocked.mp3'
import sound_arcade_checkpoint from '@/assets/sound/uisfx/arcade/checkpoint.mp3'
import sound_arcade_notification from '@/assets/sound/uisfx/arcade/notification.mp3'
import sound_arcade_complete from '@/assets/sound/uisfx/arcade/complete.mp3'
import sound_mechanical_blocked from '@/assets/sound/uisfx/mechanical/blocked.mp3'
import sound_mechanical_checkpoint from '@/assets/sound/uisfx/mechanical/checkpoint.mp3'
import sound_mechanical_notification from '@/assets/sound/uisfx/mechanical/notification.mp3'
import sound_mechanical_complete from '@/assets/sound/uisfx/mechanical/complete.mp3'
import sound_organic_blocked from '@/assets/sound/uisfx/organic/blocked.mp3'
import sound_organic_checkpoint from '@/assets/sound/uisfx/organic/checkpoint.mp3'
import sound_organic_notification from '@/assets/sound/uisfx/organic/notification.mp3'
import sound_organic_complete from '@/assets/sound/uisfx/organic/complete.mp3'
import sound_dreamy_blocked from '@/assets/sound/uisfx/dreamy/blocked.mp3'
import sound_dreamy_checkpoint from '@/assets/sound/uisfx/dreamy/checkpoint.mp3'
import sound_dreamy_notification from '@/assets/sound/uisfx/dreamy/notification.mp3'
import sound_dreamy_complete from '@/assets/sound/uisfx/dreamy/complete.mp3'
import sound_scifi_blocked from '@/assets/sound/uisfx/scifi/blocked.mp3'
import sound_scifi_checkpoint from '@/assets/sound/uisfx/scifi/checkpoint.mp3'
import sound_scifi_notification from '@/assets/sound/uisfx/scifi/notification.mp3'
import sound_scifi_complete from '@/assets/sound/uisfx/scifi/complete.mp3'
import sound_rubber_blocked from '@/assets/sound/uisfx/rubber/blocked.mp3'
import sound_rubber_checkpoint from '@/assets/sound/uisfx/rubber/checkpoint.mp3'
import sound_rubber_notification from '@/assets/sound/uisfx/rubber/notification.mp3'
import sound_rubber_complete from '@/assets/sound/uisfx/rubber/complete.mp3'
import sound_cinematic_blocked from '@/assets/sound/uisfx/cinematic/blocked.mp3'
import sound_cinematic_checkpoint from '@/assets/sound/uisfx/cinematic/checkpoint.mp3'
import sound_cinematic_notification from '@/assets/sound/uisfx/cinematic/notification.mp3'
import sound_cinematic_complete from '@/assets/sound/uisfx/cinematic/complete.mp3'
import sound_studio_blocked from '@/assets/sound/uisfx/studio/blocked.mp3'
import sound_studio_checkpoint from '@/assets/sound/uisfx/studio/checkpoint.mp3'
import sound_studio_notification from '@/assets/sound/uisfx/studio/notification.mp3'
import sound_studio_complete from '@/assets/sound/uisfx/studio/complete.mp3'
import sound_zen_blocked from '@/assets/sound/uisfx/zen/blocked.mp3'
import sound_zen_checkpoint from '@/assets/sound/uisfx/zen/checkpoint.mp3'
import sound_zen_notification from '@/assets/sound/uisfx/zen/notification.mp3'
import sound_zen_complete from '@/assets/sound/uisfx/zen/complete.mp3'

import packImageMinimal from '@/assets/sound/uisfx/packs/minimal.webp'
import packImageSoft from '@/assets/sound/uisfx/packs/soft.webp'
import packImageGlass from '@/assets/sound/uisfx/packs/glass.webp'
import packImageArcade from '@/assets/sound/uisfx/packs/arcade.webp'
import packImageMechanical from '@/assets/sound/uisfx/packs/mechanical.webp'
import packImageOrganic from '@/assets/sound/uisfx/packs/organic.webp'
import packImageDreamy from '@/assets/sound/uisfx/packs/dreamy.webp'
import packImageScifi from '@/assets/sound/uisfx/packs/scifi.webp'
import packImageRubber from '@/assets/sound/uisfx/packs/rubber.webp'
import packImageCinematic from '@/assets/sound/uisfx/packs/cinematic.webp'
import packImageStudio from '@/assets/sound/uisfx/packs/studio.webp'
import packImageZen from '@/assets/sound/uisfx/packs/zen.webp'

// ===== 音频资源注册表 =====

export interface NotificationSoundMeta {
  id: NotificationSoundPackId
  label: string
  description: string
  bestFor: string
  color: string
  image: string
  duration: string
  urls: Record<NotificationSoundType, string>
}

const SOUND_CUES: NotificationSoundType[] = ['taskComplete', 'permissionRequest', 'exitPlanMode', 'planningReminder']

const cueUrls = (
  blocked: string,
  checkpoint: string,
  notification: string,
  complete: string
): Record<NotificationSoundType, string> => ({
  taskComplete: complete,
  permissionRequest: blocked,
  exitPlanMode: checkpoint,
  planningReminder: notification,
})

/** UI SFX 的 12 个音效 feel；每个 feel 对应四类 Proma 通知场景。 */
export const NOTIFICATION_SOUNDS: NotificationSoundMeta[] = [
  { id: 'minimal', label: 'Minimal', description: '干净、精准，几乎隐形', bestFor: '生产力与系统 UI', color: '#e84d2a', image: packImageMinimal, duration: '0.56', urls: cueUrls(sound_minimal_blocked, sound_minimal_checkpoint, sound_minimal_notification, sound_minimal_complete) },
  { id: 'soft', label: 'Soft', description: '圆润、温和，让人安心', bestFor: '友好的日常工作流', color: '#d47b83', image: packImageSoft, duration: '0.81', urls: cueUrls(sound_soft_blocked, sound_soft_checkpoint, sound_soft_notification, sound_soft_complete) },
  { id: 'glass', label: 'Glass', description: '明亮、晶莹，带一点高级感', bestFor: '清晰的状态反馈', color: '#4c8ca5', image: packImageGlass, duration: '0.88', urls: cueUrls(sound_glass_blocked, sound_glass_checkpoint, sound_glass_notification, sound_glass_complete) },
  { id: 'arcade', label: 'Arcade', description: '像素感、轻快，带一点庆祝', bestFor: '高反馈密度的任务', color: '#7257d9', image: packImageArcade, duration: '0.62', urls: cueUrls(sound_arcade_blocked, sound_arcade_checkpoint, sound_arcade_notification, sound_arcade_complete) },
  { id: 'mechanical', label: 'Mechanical', description: '开关、继电器和确定的段落感', bestFor: '开发工具与自动化', color: '#68736f', image: packImageMechanical, duration: '0.52', urls: cueUrls(sound_mechanical_blocked, sound_mechanical_checkpoint, sound_mechanical_notification, sound_mechanical_complete) },
  { id: 'organic', label: 'Organic', description: '木头、水和小石子的自然触感', bestFor: '温和而有记忆点的反馈', color: '#7b8f68', image: packImageOrganic, duration: '0.81', urls: cueUrls(sound_organic_blocked, sound_organic_checkpoint, sound_organic_notification, sound_organic_complete) },
  { id: 'dreamy', label: 'Dreamy', description: '空气感、绽放感和慢速闪烁', bestFor: '长时间专注场景', color: '#8d78b5', image: packImageDreamy, duration: '0.90', urls: cueUrls(sound_dreamy_blocked, sound_dreamy_checkpoint, sound_dreamy_notification, sound_dreamy_complete) },
  { id: 'scifi', label: 'Sci-fi', description: '克制的全息提示和数字光泽', bestFor: 'AI 与未来感界面', color: '#3d8491', image: packImageScifi, duration: '0.60', urls: cueUrls(sound_scifi_blocked, sound_scifi_checkpoint, sound_scifi_notification, sound_scifi_complete) },
  { id: 'rubber', label: 'Rubber', description: '有弹性的轻触和友好回弹', bestFor: '轻松、亲切的交互', color: '#d28a4a', image: packImageRubber, duration: '0.63', urls: cueUrls(sound_rubber_blocked, sound_rubber_checkpoint, sound_rubber_notification, sound_rubber_complete) },
  { id: 'cinematic', label: 'Cinematic', description: '深沉的冲击和精致的尾音', bestFor: '重要结果与完成状态', color: '#a85d48', image: packImageCinematic, duration: '0.93', urls: cueUrls(sound_cinematic_blocked, sound_cinematic_checkpoint, sound_cinematic_notification, sound_cinematic_complete) },
  { id: 'studio', label: 'Studio', description: '有触感的精准，温暖而克制', bestFor: '创作与 AI 工作台', color: '#b06d38', image: packImageStudio, duration: '0.59', urls: cueUrls(sound_studio_blocked, sound_studio_checkpoint, sound_studio_notification, sound_studio_complete) },
  { id: 'zen', label: 'Zen', description: '纸张、木头与安静的钟声', bestFor: '阅读、规划与专注', color: '#77866a', image: packImageZen, duration: '0.59', urls: cueUrls(sound_zen_blocked, sound_zen_checkpoint, sound_zen_notification, sound_zen_complete) },
]

/** 各场景的默认通知音 */
export const DEFAULT_NOTIFICATION_SOUNDS: Required<NotificationSoundSettings> = {
  taskComplete: 'minimal',
  permissionRequest: 'minimal',
  exitPlanMode: 'minimal',
  planningReminder: 'soft',
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
 * 正在播放的 AudioBufferSourceNode 集合。
 *
 * 必须持有 source 的 JS 引用直到播放完成，否则 GC 可能在音频播完前回收 source，
 * 导致声音被截断（Web Audio API 的常见陷阱）。
 */
const activeSources = new Set<AudioBufferSourceNode>()

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
  await Promise.all(
    NOTIFICATION_SOUNDS.flatMap((sound) => SOUND_CUES.map((type) => (
      preloadSound(`${sound.id}:${type}`, sound.urls[type])
    )))
  )
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
export async function playNotificationSound(
  soundId: NotificationSoundId,
  type: NotificationSoundType = 'taskComplete'
): Promise<void> {
  try {
    if (soundId === 'none') return

    // 防重叠：短时间内多次触发时抑制后续播放
    const now = Date.now()
    if (now - lastPlayTime < MIN_PLAY_INTERVAL_MS) return
    lastPlayTime = now

    const packId = getEffectiveSoundPackId(soundId)
    const meta = NOTIFICATION_SOUNDS.find((sound) => sound.id === packId)
    if (!meta) return
    const soundKey = `${packId}:${type}`
    let buffer = audioBufferCache.get(soundKey)

    // 预加载未就绪时，即时解码作为降级
    if (!buffer) {
      buffer = await decodeSoundOnTheFly(meta.urls[type])
      if (!buffer) return
      audioBufferCache.set(soundKey, buffer)
    }

    const ctx = await getAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    // 持有引用直到播放完成，防止 GC 中途回收导致声音截断
    activeSources.add(source)
    source.onended = () => { activeSources.delete(source) }
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
  await playNotificationSound(soundId, type)
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

    // Windows 上系统通知由主进程统一发送，渲染进程跳过 Web Notification
    if (detectIsWindows()) return

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
