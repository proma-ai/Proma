/**
 * 工作区文件监听器
 *
 * 使用 fs.watch 递归监听 ~/.proma/agent-workspaces/ 目录，
 * 根据变化的文件路径区分事件类型：
 * - mcp.json / skills/ 变化 → 推送 CAPABILITIES_CHANGED（侧边栏刷新）
 * - 其他文件变化 → 推送 WORKSPACE_FILES_CHANGED（文件浏览器刷新）
 *
 * 同时支持监听附加目录（外部路径），变化时统一推送 WORKSPACE_FILES_CHANGED。
 *
 * 所有事件均做 debounce 防抖，避免高频文件操作导致渲染进程风暴。
 */

import { watch, existsSync } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import { getAgentWorkspacesDir } from './config-paths'

/** debounce 延迟（ms） */
const DEBOUNCE_MS = 500

let watcher: FSWatcher | null = null

/** 附加目录监听器：路径 → FSWatcher */
const attachedWatchers = new Map<string, FSWatcher>()
/** 附加目录防抖定时器 */
let attachedFilesTimer: ReturnType<typeof setTimeout> | null = null
/** 主窗口引用（供附加目录监听器使用） */
let mainWin: BrowserWindow | null = null

/**
 * 启动工作区文件监听
 *
 * @param win 主窗口引用，用于向渲染进程推送事件
 */
export function startWorkspaceWatcher(win: BrowserWindow): void {
  mainWin = win
  const watchDir = getAgentWorkspacesDir()

  if (!existsSync(watchDir)) {
    console.warn('[工作区监听] 目录不存在，跳过:', watchDir)
    return
  }

  // 防抖定时器：按事件类型分别 debounce
  let capabilitiesTimer: ReturnType<typeof setTimeout> | null = null
  let filesTimer: ReturnType<typeof setTimeout> | null = null

  try {
    watcher = watch(watchDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || win.isDestroyed()) return

      // filename 格式: {slug}/mcp.json 或 {slug}/skills/xxx/SKILL.md 或 {slug}/{sessionId}/file.txt
      const isCapabilitiesChange =
        filename.endsWith('/mcp.json') ||
        filename.endsWith('\\mcp.json') ||
        filename.includes('/skills/') ||
        filename.includes('\\skills/')

      if (isCapabilitiesChange) {
        // MCP/Skills 变化 → 通知侧边栏刷新
        if (capabilitiesTimer) clearTimeout(capabilitiesTimer)
        capabilitiesTimer = setTimeout(() => {
          if (!win.isDestroyed()) {
            win.webContents.send(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
          }
          capabilitiesTimer = null
        }, DEBOUNCE_MS)
      } else {
        // 其他文件变化 → 通知文件浏览器刷新
        if (filesTimer) clearTimeout(filesTimer)
        filesTimer = setTimeout(() => {
          if (!win.isDestroyed()) {
            win.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
          }
          filesTimer = null
        }, DEBOUNCE_MS)
      }
    })

    console.log('[工作区监听] 已启动文件监听:', watchDir)
  } catch (error) {
    console.error('[工作区监听] 启动失败:', error)
  }
}

/**
 * 停止工作区文件监听
 */
export function stopWorkspaceWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    console.log('[工作区监听] 已停止')
  }
  // 同时清理所有附加目录监听器
  for (const [dirPath, w] of attachedWatchers) {
    w.close()
    console.log('[附加目录监听] 已停止:', dirPath)
  }
  attachedWatchers.clear()
  mainWin = null
}

/**
 * 开始监听附加目录
 * 当目录内文件变化时，推送 WORKSPACE_FILES_CHANGED 事件
 */
export function watchAttachedDirectory(dirPath: string): void {
  if (attachedWatchers.has(dirPath)) return
  if (!existsSync(dirPath)) {
    console.warn('[附加目录监听] 目录不存在，跳过:', dirPath)
    return
  }

  try {
    const w = watch(dirPath, { recursive: true }, () => {
      if (!mainWin || mainWin.isDestroyed()) return

      // 统一防抖：所有附加目录变化合并为一次刷新
      if (attachedFilesTimer) clearTimeout(attachedFilesTimer)
      attachedFilesTimer = setTimeout(() => {
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
        }
        attachedFilesTimer = null
      }, DEBOUNCE_MS)
    })

    attachedWatchers.set(dirPath, w)
    console.log('[附加目录监听] 已启动:', dirPath)
  } catch (error) {
    console.error('[附加目录监听] 启动失败:', dirPath, error)
  }
}

/**
 * 停止监听附加目录
 */
export function unwatchAttachedDirectory(dirPath: string): void {
  const w = attachedWatchers.get(dirPath)
  if (w) {
    w.close()
    attachedWatchers.delete(dirPath)
    console.log('[附加目录监听] 已停止:', dirPath)
  }
}
