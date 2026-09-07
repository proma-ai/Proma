/**
 * Chat 工具配置文件监听器
 *
 * 监听 chat-tools.json 所在目录，兼容配置首次创建、删除重建及原子替换。
 * 当 Agent 通过文件系统修改配置后自动通知渲染进程刷新工具列表。
 *
 * 过滤无关文件并使用 500ms 防抖，避免临时文件和高频写入重复通知。
 */

import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { BrowserWindow } from 'electron'
import { CHAT_TOOL_IPC_CHANNELS } from '@proma/shared'
import { getChatToolsConfigPath } from './config-paths'

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 启动 chat-tools.json 文件监听。
 * 重复启动时先关闭旧监听，防止重复广播或遗留防抖回调。
 */
export function startChatToolsWatcher(): void {
  stopChatToolsWatcher()

  try {
    // 获取配置路径时会确保父目录存在，无须等待目标文件首次写入。
    const filePath = getChatToolsConfigPath()
    const targetName = basename(filePath)
    // 监听父目录而不是文件 inode，rename 原子替换后仍能收到后续更新。
    const currentWatcher = watch(dirname(filePath), (_eventType, filename) => {
      if (watcher !== currentWatcher) return
      // 部分平台可能不提供 filename，此时保守刷新；有名称时严格过滤 .tmp/.bak 等文件。
      if (filename != null && filename.toString() !== targetName) return

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (watcher !== currentWatcher) return
        debounceTimer = null
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED)
          }
        }
        console.log('[Chat 工具监听] 配置变更，已通知渲染进程')
      }, DEBOUNCE_MS)
    })
    watcher = currentWatcher

    // 忽略已关闭实例的迟到错误，避免旧实例关闭新监听。
    currentWatcher.on('error', (err) => {
      if (watcher !== currentWatcher) return
      console.error('[Chat 工具监听] 运行时错误，关闭监听:', err)
      stopChatToolsWatcher()
    })

    console.log('[Chat 工具监听] 已启动')
  } catch (err) {
    stopChatToolsWatcher()
    console.error('[Chat 工具监听] 启动失败:', err)
  }
}

/** 停止监听并取消尚未广播的防抖回调。 */
export function stopChatToolsWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const currentWatcher = watcher
  watcher = null
  if (currentWatcher) {
    try { currentWatcher.close() } catch { /* 已关闭 */ }
    console.log('[Chat 工具监听] 已停止')
  }
}
