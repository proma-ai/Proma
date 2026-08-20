/**
 * 受管浏览器独立窗口管理（方案 A：全局唯一展示位）。
 *
 * 主窗口把受管浏览器的原生 WebContentsView 迁移到独立 BrowserWindow 的
 * contentView；窗口本身只是展示容器，不含任何页面逻辑（页面仍在主进程
 * 的受管 WebContents/CDP 中）。窗口关闭即「收起回主窗口」，不销毁任何
 * WebContents / 标签 / 会话。
 */

import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { Rectangle } from 'electron'

const detachedWindows = new Map<string, BrowserWindow>()

function defaultBounds(): Rectangle {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.max(720, Math.floor(workArea.width * 0.62))
  const height = Math.max(600, Math.floor(workArea.height * 0.78))
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  }
}

/**
 * 创建（或复用已存在并聚焦）某 Agent session 的受管浏览器独立窗口。
 * ready-to-show 后才显示，避免白屏闪烁；导航限定为本应用 renderer。
 */
export function createDetachedBrowserWindow(sessionId: string): BrowserWindow {
  const existing = detachedWindows.get(sessionId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    ...defaultBounds(),
    minWidth: 640,
    minHeight: 480,
    title: '受管浏览器',
    show: false,
    backgroundColor: '#101014',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  detachedWindows.set(sessionId, win)

  const isDev = !app.isPackaged
  const entry = isDev
    ? `http://127.0.0.1:5173?window=managed-browser&sessionId=${encodeURIComponent(sessionId)}`
    : undefined
  if (entry) {
    void win.loadURL(entry)
  } else {
    void win.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'managed-browser', sessionId },
    })
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })

  // 独立窗口只承载受管页面展示；renderer 层面的外链与新窗口一律不允许。
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    if (isDev && new URL(win.webContents.getURL()).origin === 'http://127.0.0.1:5173') return
    event.preventDefault()
  })

  win.on('closed', () => {
    detachedWindows.delete(sessionId)
  })

  return win
}

/** 查询某 session 的独立窗口（sender 域校验用）。 */
export function getDetachedBrowserWindow(sessionId: string): BrowserWindow | null {
  const win = detachedWindows.get(sessionId)
  return win && !win.isDestroyed() ? win : null
}
