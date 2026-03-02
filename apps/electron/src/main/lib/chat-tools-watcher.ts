/**
 * Chat 工具配置文件监听器
 *
 * 监听 ~/.proma/chat-tools.json 的变化，
 * 当 Agent 通过文件系统修改配置后自动通知渲染进程刷新工具列表。
 *
 * 使用 node:fs.watch + debounce 防抖，避免高频写入导致多次通知。
 */

import { watch, existsSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { BrowserWindow } from 'electron'
import { CHAT_TOOL_IPC_CHANNELS } from '@proma/shared'
import { getChatToolsConfigPath } from './config-paths'

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500

let watcher: FSWatcher | null = null

/**
 * 启动 chat-tools.json 文件监听
 *
 * 文件变化时向所有窗口广播 CUSTOM_TOOL_CHANGED 事件。
 */
export function startChatToolsWatcher(): void {
  const filePath = getChatToolsConfigPath()

  if (!existsSync(filePath)) {
    console.log('[Chat 工具监听] 配置文件不存在，跳过:', filePath)
    return
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  try {
    watcher = watch(filePath, (_eventType) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED)
          }
        }
        console.log('[Chat 工具监听] 配置变更，已通知渲染进程')
        debounceTimer = null
      }, DEBOUNCE_MS)
    })

    console.log('[Chat 工具监听] 已启动')
  } catch (err) {
    console.error('[Chat 工具监听] 启动失败:', err)
  }
}

/**
 * 停止 chat-tools.json 文件监听
 */
export function stopChatToolsWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    console.log('[Chat 工具监听] 已停止')
  }
}
