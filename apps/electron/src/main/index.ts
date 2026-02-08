import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// 商业版固定为 Cloud 模式
process.env.PROMA_MODE = 'cloud'

import { createApplicationMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, destroyTray } from './tray'
import { initializeRuntime } from './lib/runtime-init'
import { seedDefaultSkills } from './lib/config-paths'
import { initAutoUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { isCloudMode } from '@proma/cloud'
import { registerCloudIpcHandlers } from './cloud-ipc'
import { handleOAuthCallback } from './lib/cloud-auth-service'

const PROTOCOL_NAME = 'proma'

let mainWindow: BrowserWindow | null = null
// 标记是否真正要退出应用（用于区分关闭窗口和退出应用）
let isQuitting = false

/**
 * Get the appropriate app icon path for the current platform
 */
function getIconPath(): string {
  const resourcesDir = join(__dirname, '../resources')

  if (process.platform === 'darwin') {
    return join(resourcesDir, 'icon.icns')
  } else if (process.platform === 'win32') {
    return join(resourcesDir, 'icon.ico')
  } else {
    return join(resourcesDir, 'icon.png')
  }
}

function createWindow(): void {
  const iconPath = getIconPath()
  const iconExists = existsSync(iconPath)

  if (!iconExists) {
    console.warn('App icon not found at:', iconPath)
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: iconExists ? iconPath : undefined,
    show: false, // Don't show until ready
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset', // macOS style
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window', // macOS glass effect
    visualEffectState: 'active',
  })

  // Load the renderer
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))
  }

  // Show main window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 拦截页面内导航，外部链接用系统浏览器打开，防止 Electron 窗口被覆盖
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许开发模式下的 Vite HMR 热重载
    if (isDev && url.startsWith('http://localhost:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  // 拦截 window.open / target="_blank" 链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // macOS: 点击关闭按钮时隐藏窗口而不是退出（除非正在退出应用）
  // 开发模式下直接关闭以简化调试
  if (process.platform === 'darwin' && !isDev) {
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        mainWindow?.hide()
        // 隐藏 Dock 图标，让应用完全进入后台
        app.dock?.hide()
      }
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ===== proma:// 协议注册（Google OAuth deep-link 回调） =====
// 仅打包模式注册，dev 模式下 electronmon 会干扰协议注册

if (app.isPackaged) {
  app.setAsDefaultProtocolClient(PROTOCOL_NAME)
}

/** 将主窗口拉到前台 */
function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  // macOS: 显示 Dock 图标
  if (process.platform === 'darwin') {
    app.dock?.show()
  }
}

/**
 * 处理 proma:// deep-link URL
 * 格式：proma://oauth/callback?token=xxx&refresh_token=yyy
 */
function handleDeepLink(url: string): void {
  console.log('[Deep Link] 收到:', url)

  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'oauth' || !parsed.pathname.startsWith('/callback')) return

    const token = parsed.searchParams.get('token')
    if (!token) return

    const refreshToken = parsed.searchParams.get('refresh_token') ?? undefined

    handleOAuthCallback(token, refreshToken).then((result) => {
      if (result.success) {
        console.log('[Deep Link] OAuth 登录成功')
      } else {
        console.error('[Deep Link] OAuth 登录失败:', result.error)
      }
    })

    focusMainWindow()
  } catch (error) {
    console.error('[Deep Link] 解析 URL 失败:', error)
  }
}

// macOS: open-url 事件（app 已运行时，系统会发此事件而非启动新实例）
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// ===== 单实例锁 =====
// 确保只有一个实例运行：第二个实例会退出，deep-link URL 通过 second-instance 传递

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 第二个实例：直接退出，不执行任何初始化
  app.quit()
} else {
  // Windows/Linux: 第二个实例的 deep-link URL 通过此事件传递
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL_NAME}://`))
    if (url) {
      handleDeepLink(url)
    }
    focusMainWindow()
  })

  app.whenReady().then(async () => {
    // 初始化运行时环境（Shell 环境 + Bun + Git 检测）
    // 必须在其他初始化之前执行，确保环境变量正确加载
    await initializeRuntime()

    // 同步默认 Skills 模板到 ~/.proma/default-skills/
    seedDefaultSkills()

    // Create application menu
    const menu = createApplicationMenu()
    Menu.setApplicationMenu(menu)

    // Register IPC handlers
    registerIpcHandlers()

    // Cloud 模式：注册 Cloud IPC 处理器
    if (isCloudMode()) {
      await registerCloudIpcHandlers()
    }

    // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
    if (process.platform === 'darwin' && app.dock) {
      const dockIconPath = join(__dirname, '../resources/icon.png')
      if (existsSync(dockIconPath)) {
        app.dock.setIcon(dockIconPath)
      }
    }

    // Create system tray icon
    createTray()

    // Create main window (will be shown when ready)
    createWindow()

    // 启动工作区文件监听（Agent MCP/Skills + 文件浏览器自动刷新）
    if (mainWindow) {
      startWorkspaceWatcher(mainWindow)
    }

    // 生产环境下初始化自动更新
    if (app.isPackaged && mainWindow) {
      initAutoUpdater(mainWindow)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    // 开发模式下或非 macOS：关闭所有窗口时退出应用
    // 生产模式 macOS：保持应用运行（可通过 tray 或 Dock 重新打开）
    const isDev = !app.isPackaged
    if (process.platform !== 'darwin' || isDev) {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    // 标记正在退出，让 close 事件不再阻止关闭
    isQuitting = true
    // 停止工作区文件监听
    stopWorkspaceWatcher()
    // Clean up system tray before quitting
    destroyTray()
  })
}
