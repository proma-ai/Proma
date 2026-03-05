/**
 * 自动更新相关类型定义
 *
 * 仅检测新版本并通知用户，不做自动下载/安装。
 * 用户通过 GitHub Releases 页面手动下载覆盖安装。
 */

/** 更新状态 */
export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
  version?: string
  releaseNotes?: string
  error?: string
}

/** 更新 IPC 通道常量 */
export const UPDATER_IPC_CHANNELS = {
  CHECK_FOR_UPDATES: 'updater:check',
  GET_STATUS: 'updater:get-status',
  ON_STATUS_CHANGED: 'updater:status-changed',
} as const
