/**
 * 自动更新相关类型定义
 */

/** 更新进度信息 */
export interface UpdateProgress {
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

/** 更新 IPC 通道常量 */
export const UPDATER_IPC_CHANNELS = {
  CHECK_FOR_UPDATES: 'updater:check',
  DOWNLOAD_UPDATE: 'updater:download',
  INSTALL_UPDATE: 'updater:install',
  GET_STATUS: 'updater:get-status',
  ON_STATUS_CHANGED: 'updater:status-changed',
} as const
