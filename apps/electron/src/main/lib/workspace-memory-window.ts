import { app, BrowserWindow, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_WIDTH = 980
const DEFAULT_HEIGHT = 720
const MIN_WIDTH = 680
const MIN_HEIGHT = 480
const MEMORY_WINDOW_TITLE = 'Proma · 工作区记忆'

const windowsByWorkspace = new Map<string, BrowserWindow>()

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

function getInitialBounds(): Electron.Rectangle {
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

function isDevServerNavigation(url: string): boolean {
  try {
    return new URL(url).origin === 'http://127.0.0.1:5173'
  } catch {
    return false
  }
}

function createWorkspaceMemoryWindow(workspaceSlug: string, relativePath?: string): BrowserWindow {
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
    ...getInitialBounds(),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: MEMORY_WINDOW_TITLE,
    icon: getIconPath(),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...titleBarOptions,
  })
  windowsByWorkspace.set(workspaceSlug, win)

  const isDev = !app.isPackaged
  if (isDev) {
    void win.loadURL(`http://127.0.0.1:5173?window=workspace-memory&workspace=${encodeURIComponent(workspaceSlug)}${relativePath ? `&file=${encodeURIComponent(relativePath)}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, 'renderer', 'index.html'), {
      query: { window: 'workspace-memory', workspace: workspaceSlug, ...(relativePath ? { file: relativePath } : {}) },
    })
  }

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
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
    if (windowsByWorkspace.get(workspaceSlug) === win) windowsByWorkspace.delete(workspaceSlug)
  })
  return win
}

/** 打开当前 workspace 的单例记忆编辑窗口；可选定位到受主进程验证过的文件。 */
export function showWorkspaceMemoryWindow(workspaceSlug: string, relativePath?: string): void {
  const existing = windowsByWorkspace.get(workspaceSlug)
  if (!existing || existing.isDestroyed()) {
    createWorkspaceMemoryWindow(workspaceSlug, relativePath)
    return
  }
  if (existing.isMinimized()) existing.restore()
  existing.show()
  existing.focus()
  if (relativePath) existing.webContents.send('agent:workspace-memory-window-open-file', relativePath)
}
