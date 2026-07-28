import { app, BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MainWindowState } from '../../types'
import { getPersistableMainWindowState } from './main-window-lifecycle'
import { getSettings, updateSettings } from './settings-service'

const DEFAULT_WIDTH = 1180
const DEFAULT_HEIGHT = 820
const MIN_WIDTH = 760
const MIN_HEIGHT = 560
const PLANNING_WINDOW_TITLE = 'Proma · 规划中心'

let planningWindow: BrowserWindow | null = null

function getIconPath(): string | undefined {
  const resourcesDir = join(__dirname, 'resources')
  const filename = process.platform === 'darwin'
    ? 'icon.icns'
    : process.platform === 'win32'
      ? 'icon.ico'
      : 'icon.png'
  const iconPath = join(resourcesDir, filename)
  return existsSync(iconPath) ? iconPath : undefined
}

function getInitialBounds(savedState?: MainWindowState): Electron.Rectangle {
  if (savedState) {
    return { x: savedState.x, y: savedState.y, width: savedState.width, height: savedState.height }
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const windowWidth = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, width - 80))
  const windowHeight = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, height - 80))
  return {
    x: x + Math.round((width - windowWidth) / 2),
    y: y + Math.round((height - windowHeight) / 2),
    width: windowWidth,
    height: windowHeight,
  }
}

function ensureWindowOnScreen(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return centerX >= area.x && centerX <= area.x + area.width && centerY >= area.y && centerY <= area.y + area.height
  })
  if (visible) return

  const area = screen.getPrimaryDisplay().workArea
  win.setPosition(
    area.x + Math.round((area.width - bounds.width) / 2),
    area.y + Math.round((area.height - bounds.height) / 2),
  )
}

function isDevServerNavigation(url: string): boolean {
  try {
    return new URL(url).origin === 'http://127.0.0.1:5173'
  } catch {
    return false
  }
}

function persistPlanningWindowState(win: BrowserWindow): void {
  const state = getPersistableMainWindowState(win)
  if (!state) return
  try {
    updateSettings({ planningWindowState: state })
  } catch (error) {
    console.error('[规划窗口] 保存窗口状态失败:', error)
  }
}

function createPlanningWindow(): BrowserWindow {
  const savedState = getSettings().planningWindowState
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const titleBarOptions = isMac
    ? {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 18, y: 18 },
        vibrancy: 'under-window' as const,
        visualEffectState: 'followWindow' as const,
      }
    : isWindows
      ? { titleBarStyle: 'hidden' as const }
      : {}
  const win = new BrowserWindow({
    ...getInitialBounds(savedState),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: PLANNING_WINDOW_TITLE,
    icon: getIconPath(),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...titleBarOptions,
  })
  planningWindow = win
  ensureWindowOnScreen(win)

  const isDev = !app.isPackaged
  if (isDev) {
    void win.loadURL('http://127.0.0.1:5173?window=planning')
  } else {
    void win.loadFile(join(__dirname, 'renderer', 'index.html'), { query: { window: 'planning' } })
  }

  win.once('ready-to-show', () => {
    if (savedState?.isMaximized) win.maximize()
    win.show()
    win.focus()
  })

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const flushState = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    persistPlanningWindowState(win)
  }
  const scheduleStateSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistPlanningWindowState(win)
    }, 500)
  }
  win.on('resize', scheduleStateSave)
  win.on('move', scheduleStateSave)
  win.on('maximize', scheduleStateSave)
  win.on('unmaximize', scheduleStateSave)
  win.on('close', flushState)

  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && isDevServerNavigation(url)) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    if (planningWindow === win) planningWindow = null
  })

  return win
}

/** 打开单例规划窗口；已存在时恢复、确保可见并聚焦。 */
export function showPlanningWindow(): void {
  if (!planningWindow || planningWindow.isDestroyed()) {
    createPlanningWindow()
    return
  }
  ensureWindowOnScreen(planningWindow)
  if (planningWindow.isMinimized()) planningWindow.restore()
  planningWindow.show()
  planningWindow.focus()
}


/** 应用退出时销毁窗口，确保状态保存定时器与渲染进程一同释放。 */
export function destroyPlanningWindow(): void {
  if (!planningWindow || planningWindow.isDestroyed()) return
  persistPlanningWindowState(planningWindow)
  planningWindow.destroy()
  planningWindow = null
}
