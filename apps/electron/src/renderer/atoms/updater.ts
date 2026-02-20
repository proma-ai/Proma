/**
 * 自动更新状态原子
 *
 * 管理应用更新状态，订阅主进程推送的更新事件。
 * 优雅降级：如果 window.electronAPI.updater 不存在（开源构建），状态保持 idle。
 */

import { atom } from 'jotai'

/** 更新进度信息 */
interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

/** 更新状态 */
export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  version?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
}

/** 更新状态 atom */
export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })

/** 是否有可用更新（available 或 downloaded 状态） */
export const hasUpdateAtom = atom((get) => {
  const { status } = get(updateStatusAtom)
  return status === 'available' || status === 'downloaded'
})

/** updater 是否可用 */
export const updaterAvailableAtom = atom<boolean>(() => {
  return !!window.electronAPI?.updater
})

/**
 * 初始化更新状态订阅
 *
 * 订阅主进程推送的更新状态变化事件。
 * 返回清理函数。
 */
export function initializeUpdater(
  setStatus: (status: UpdateStatus) => void,
): () => void {
  const updater = window.electronAPI?.updater
  if (!updater) {
    // updater 不可用（开源构建），直接返回空清理函数
    return () => {}
  }

  // 获取初始状态
  updater.getStatus().then(setStatus).catch(() => {
    // IPC 调用失败（updater 主进程端未注册），保持 idle
  })

  // 订阅状态变化
  const cleanup = updater.onStatusChanged(setStatus)
  return cleanup
}

/** 手动检查更新 */
export async function checkForUpdates(): Promise<void> {
  await window.electronAPI?.updater?.checkForUpdates()
}

/** 安装更新并重启 */
export async function installUpdate(): Promise<void> {
  await window.electronAPI?.updater?.installUpdate()
}
