/**
 * Sync IPC 处理器
 *
 * 注册数据同步相关的 IPC 通道。
 * 依赖 cloud-auth-service 提供的 API Client。
 */

import { ipcMain } from 'electron'
import { SYNC_IPC_CHANNELS } from '@proma/shared'
import type { SyncState, SyncResult } from '@proma/shared'
import { getApiClient } from './lib/cloud-auth-service'
import { fullSync, incrementalSync, pullMoreConversations, getSyncState } from './lib/sync-service'

/**
 * 注册 Sync IPC 处理器
 */
export function registerSyncIpcHandlers(): void {
  console.log('[Sync IPC] 正在注册同步 IPC 处理器...')

  // 全量同步
  ipcMain.handle(
    SYNC_IPC_CHANNELS.FULL_SYNC,
    async (event): Promise<SyncResult> => {
      const client = getApiClient()
      return fullSync(client, event.sender)
    }
  )

  // 增量同步
  ipcMain.handle(
    SYNC_IPC_CHANNELS.INCREMENTAL_SYNC,
    async (event): Promise<SyncResult> => {
      const client = getApiClient()
      return incrementalSync(client, event.sender)
    }
  )

  // 获取同步状态
  ipcMain.handle(
    SYNC_IPC_CHANNELS.GET_SYNC_STATE,
    async (): Promise<SyncState> => {
      return getSyncState()
    }
  )

  // 加载更多历史对话
  ipcMain.handle(
    SYNC_IPC_CHANNELS.PULL_MORE,
    async (event): Promise<SyncResult> => {
      const client = getApiClient()
      return pullMoreConversations(client, event.sender)
    }
  )

  console.log('[Sync IPC] 同步 IPC 处理器注册完成')
}
