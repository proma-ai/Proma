/**
 * Agent Island 灵动岛窗口管理
 *
 * 仿 quick-task-window：无边框 + 透明 + 置顶的独立小窗。
 * 窗口尺寸由渲染进程按内容通过 IPC 动态调整（pill 收起 / 卡片展开），
 * 位置默认吸附屏幕顶部中央，支持渲染进程拖拽移动。
 *
 * 设计参考 Cindy (makecindy/cindy) 的 Agent Island：灵动岛是 ambient UI，
 * 常驻不抢焦点；MVP 阶段为保证跨平台点击交互可靠，先允许窗口获得焦点，
 * Phase 2 再按平台做 canBecomeKey=false 语义优化。
 */

import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

/** Windows fallback 的收起态尺寸，和原生 Swift island 的紧凑状态一致。 */
export const AGENT_ISLAND_DEFAULT_WIDTH = 420
export const AGENT_ISLAND_DEFAULT_HEIGHT = 32
/** 展开态上限，与 macOS native host 保持一致。 */
export const AGENT_ISLAND_MAX_WIDTH = 620
export const AGENT_ISLAND_MAX_HEIGHT = 640
const WINDOWS_TOP_INSET = 12

let agentIslandWindow: BrowserWindow | null = null

/** 灵动岛窗口渲染就绪回调（service 注册后用于补推状态） */
let onWindowReady: (() => void) | null = null

export function onAgentIslandWindowReady(cb: () => void): void {
  onWindowReady = cb
}

function resolveWindowPosition(width: number, height: number): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { bounds, workArea } = display
  // macOS fallback 仍贴齐刘海；Windows 没有硬件缺口，保留系统工作区内的
  // 小间距和完整圆角 surface，避免覆盖顶部任务栏或看起来像半截窗口。
  const y = process.platform === 'darwin' ? bounds.y : workArea.y + WINDOWS_TOP_INSET
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y,
  }
}

export function createAgentIslandWindow(): BrowserWindow | null {
  if (agentIslandWindow && !agentIslandWindow.isDestroyed()) return agentIslandWindow

  const [width, height] = [AGENT_ISLAND_DEFAULT_WIDTH, AGENT_ISLAND_DEFAULT_HEIGHT]
  const { x, y } = resolveWindowPosition(width, height)

  agentIslandWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    // 无边框 ambient surface 不应因 Alt+F4 被永久关闭；设置页是其显式开关。
    closable: process.platform !== 'win32',
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Windows 以 screen-saver level 常驻当前桌面和全屏应用上方；macOS 保持与刘海融合的层级。
  // Electron 的 setVisibleOnAllWorkspaces 在 Windows 无效，避免把无效调用误解为跨虚拟桌面支持。
  agentIslandWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'pop-up-menu' : 'screen-saver')
  if (process.platform !== 'win32') {
    agentIslandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  const isDev = !app.isPackaged
  if (isDev) {
    void agentIslandWindow.loadURL(`http://127.0.0.1:5173?window=agent-island&platform=${process.platform}`)
  } else {
    void agentIslandWindow.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'agent-island', platform: process.platform },
    })
  }

  // 灵动岛常驻：失焦不隐藏（与 quick-task 不同）
  agentIslandWindow.on('closed', () => {
    agentIslandWindow = null
  })

  // 窗口渲染完成后通知 service 补推状态（避免初始事件在 renderer 就绪前丢失）
  agentIslandWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      onWindowReady?.()
    }, 120)
  })

  return agentIslandWindow
}

export function showAgentIslandWindow(): void {
  const win = createAgentIslandWindow()
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) win.showInactive()
}

export function hideAgentIslandWindow(): void {
  if (agentIslandWindow && !agentIslandWindow.isDestroyed()) {
    agentIslandWindow.hide()
  }
}

export function destroyAgentIslandWindow(): void {
  if (agentIslandWindow && !agentIslandWindow.isDestroyed()) {
    agentIslandWindow.destroy()
  }
  agentIslandWindow = null
}

export function getAgentIslandWindow(): BrowserWindow | null {
  return agentIslandWindow && !agentIslandWindow.isDestroyed() ? agentIslandWindow : null
}

/** 渲染进程按内容调整窗口尺寸（clamp 到合理范围） */
export function resizeAgentIslandWindow(width: number, height: number): void {
  const win = getAgentIslandWindow()
  if (!win) return
  const clampedWidth = Math.max(320, Math.min(AGENT_ISLAND_MAX_WIDTH, Math.round(width)))
  const clampedHeight = Math.max(32, Math.min(AGENT_ISLAND_MAX_HEIGHT, Math.round(height)))
  const bounds = win.getBounds()
  // 尺寸未变化时不重复 setBounds（避免高频 agent 事件导致无谓窗口操作）
  if (bounds.width === clampedWidth && bounds.height === clampedHeight) return
  // 宽度变化保持居中；Windows 维持与顶部工作区的固定呼吸空间，macOS fallback
  // 保持刘海顶部锚定。
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const top = process.platform === 'darwin' ? display.bounds.y : display.workArea.y + WINDOWS_TOP_INSET
  const newX = Math.round(display.bounds.x + (display.bounds.width - clampedWidth) / 2)
  win.setBounds({ x: newX, y: top, width: clampedWidth, height: clampedHeight }, false)
}

/** 渲染进程拖拽移动窗口位置 */
export function moveAgentIslandWindow(x: number, y: number): void {
  const win = getAgentIslandWindow()
  if (!win) return
  const bounds = win.getBounds()
  const display = screen.getDisplayNearestPoint({ x, y })
  const workArea = display.workArea
  const clampedX = Math.max(workArea.x - bounds.width / 2, Math.min(workArea.x + workArea.width - bounds.width / 2, Math.round(x)))
  const clampedY = Math.max(workArea.y, Math.min(workArea.y + workArea.height - 24, Math.round(y)))
  win.setPosition(clampedX, clampedY, false)
}
