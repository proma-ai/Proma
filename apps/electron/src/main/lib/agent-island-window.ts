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

/** 默认 pill 尺寸（收起态） */
export const AGENT_ISLAND_DEFAULT_WIDTH = 240
export const AGENT_ISLAND_DEFAULT_HEIGHT = 52
/** 展开态上限 */
export const AGENT_ISLAND_MAX_WIDTH = 640
export const AGENT_ISLAND_MAX_HEIGHT = 520

let agentIslandWindow: BrowserWindow | null = null

/** 灵动岛窗口渲染就绪回调（service 注册后用于补推状态） */
let onWindowReady: (() => void) | null = null

export function onAgentIslandWindowReady(cb: () => void): void {
  onWindowReady = cb
}

function resolveWindowPosition(width: number, height: number): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // 关键：用 display.bounds 而不是 workArea。workArea 从菜单栏下方开始，
  // 会让“灵动岛”变成普通悬浮窗；bounds.y 才是刘海/菜单栏所在的真实屏幕顶端。
  const { bounds } = display
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: bounds.y,
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

  // macOS 的 pop-up-menu 层级高于菜单栏，黑色 Surface 才能与硬件刘海连续融合。
  // 其他平台保持 floating，作为顶部状态条优雅降级。
  agentIslandWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'pop-up-menu' : 'floating')
  agentIslandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const isDev = !app.isPackaged
  if (isDev) {
    void agentIslandWindow.loadURL('http://127.0.0.1:5173?window=agent-island')
  } else {
    void agentIslandWindow.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'agent-island' },
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
  const clampedWidth = Math.max(120, Math.min(AGENT_ISLAND_MAX_WIDTH, Math.round(width)))
  const clampedHeight = Math.max(40, Math.min(AGENT_ISLAND_MAX_HEIGHT, Math.round(height)))
  const bounds = win.getBounds()
  // 尺寸未变化时不重复 setBounds（避免高频 agent 事件导致无谓窗口操作）
  if (bounds.width === clampedWidth && bounds.height === clampedHeight) return
  // 保持顶部中央锚定：宽度变化时水平居中；高度只向下延展，始终从刘海顶部开始。
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const screenBounds = display.bounds
  const newX = Math.round(bounds.x + (bounds.width - clampedWidth) / 2)
  const top = bounds.y <= display.workArea.y ? screenBounds.y : Math.max(screenBounds.y, bounds.y)
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
