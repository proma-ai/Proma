/**
 * 快速任务窗口管理
 *
 * 预创建隐藏窗口，通过全局快捷键唤起。
 * 无边框 + 透明 + 置顶，失焦自动隐藏。
 */

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { app } from 'electron'

/** 快速任务窗口单例 */
let quickTaskWindow: BrowserWindow | null = null

/** 窗口宽高 */
const WINDOW_WIDTH = 680
const WINDOW_HEIGHT = 320

/**
 * 预创建快速任务窗口（隐藏状态）
 *
 * 在 app.whenReady() 中调用，避免首次唤起时的创建延迟。
 */
export function createQuickTaskWindow(): void {
  if (quickTaskWindow && !quickTaskWindow.isDestroyed()) return

  quickTaskWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 加载渲染进程（附带 query 参数区分窗口类型）
  const isDev = !app.isPackaged
  if (isDev) {
    quickTaskWindow.loadURL('http://localhost:5173?window=quick-task')
  } else {
    quickTaskWindow.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'quick-task' },
    })
  }

  // 失焦自动隐藏
  quickTaskWindow.on('blur', () => {
    if (quickTaskWindow && !quickTaskWindow.isDestroyed()) {
      quickTaskWindow.hide()
    }
  })

  quickTaskWindow.on('closed', () => {
    quickTaskWindow = null
  })

  console.log('[快速任务窗口] 预创建完成')
}

/**
 * 切换快速任务窗口显示/隐藏
 *
 * 窗口居中于鼠标所在显示器的上方 25% 位置。
 */
export function toggleQuickTaskWindow(): void {
  if (!quickTaskWindow || quickTaskWindow.isDestroyed()) {
    createQuickTaskWindow()
    // 窗口 ready 后再显示
    quickTaskWindow?.once('ready-to-show', () => {
      positionAndShow()
    })
    return
  }

  if (quickTaskWindow.isVisible()) {
    quickTaskWindow.hide()
  } else {
    positionAndShow()
  }
}

/** 定位到鼠标所在显示器并显示 */
function positionAndShow(): void {
  if (!quickTaskWindow || quickTaskWindow.isDestroyed()) return

  // 获取鼠标所在的显示器
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = display.workArea

  // 居中水平，垂直方向位于屏幕上方 25%
  const posX = Math.round(x + (width - WINDOW_WIDTH) / 2)
  const posY = Math.round(y + height * 0.25)

  quickTaskWindow.setBounds({
    x: posX,
    y: posY,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  })

  quickTaskWindow.show()
  quickTaskWindow.focus()

  // 通知渲染进程聚焦输入框
  quickTaskWindow.webContents.send('quick-task:focus')
}

/**
 * 隐藏快速任务窗口
 */
export function hideQuickTaskWindow(): void {
  if (quickTaskWindow && !quickTaskWindow.isDestroyed() && quickTaskWindow.isVisible()) {
    quickTaskWindow.hide()
  }
}

/**
 * 获取快速任务窗口实例（用于 IPC 注册）
 */
export function getQuickTaskWindow(): BrowserWindow | null {
  return quickTaskWindow
}

/**
 * 销毁快速任务窗口（应用退出时调用）
 */
export function destroyQuickTaskWindow(): void {
  if (quickTaskWindow && !quickTaskWindow.isDestroyed()) {
    quickTaskWindow.destroy()
    quickTaskWindow = null
  }
}
