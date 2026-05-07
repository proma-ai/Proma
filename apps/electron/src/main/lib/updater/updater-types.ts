/**
 * 自动更新相关类型定义
 *
 * 检测新版本 → 自动下载 → 用户确认后重启安装
 */

/** 更新状态 */
export type UpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string; releaseNotes?: string }
  | { status: 'downloading'; version: string; progress: DownloadProgress }
  | { status: 'downloaded'; version: string }
  | { status: 'not-available' }
  | { status: 'error'; error: string }

/** 下载进度 */
export interface DownloadProgress {
  /** 已下载百分比 0-100 */
  percent: number
  /** 已下载字节数 */
  transferred: number
  /** 总字节数 */
  total: number
  /** 下载速度（字节/秒） */
  bytesPerSecond: number
}

/** 更新 IPC 通道常量 */
export const UPDATER_IPC_CHANNELS = {
  CHECK_FOR_UPDATES: 'updater:check',
  GET_STATUS: 'updater:get-status',
  ON_STATUS_CHANGED: 'updater:status-changed',
  QUIT_AND_INSTALL: 'updater:quit-and-install',
} as const
