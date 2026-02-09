import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// 商业版固定为 Cloud 模式
process.env.PROMA_MODE = 'cloud'

import { createApplicationMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, destroyTray } from './tray'
import { initializeRuntime } from './lib/runtime-init'
import { seedDefaultSkills } from './lib/config-paths'
import { stopAllAgents } from './lib/agent-service'
import { stopAllGenerations } from './lib/chat-service'
import { migrateFlowSessions } from './lib/flow-migration'
import { initAutoUpdater, cleanupUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { isCloudMode } from '@proma/cloud'
import { registerCloudIpcHandlers } from './cloud-ipc'
import { registerSyncIpcHandlers } from './sync-ipc'
import { scheduleAutoSync } from './lib/sync-service'
import { handleOAuthCallback } from './lib/cloud-auth-service'

const PROTOCOL_NAME = 'proma'

let mainWindow: BrowserWindow | null = null
// 标记是否真正要退出应用（用于区分关闭窗口和退出应用）
let isQuitting = false

/**
 * 检查窗口是否在可用显示器范围内
 * 处理外接显示器断开后窗口位于不可见区域的情况
 */
function ensureWindowOnScreen(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const displays = screen.getAllDisplays()
  // 检查窗口中心点是否在任一显示器范围内
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const isOnScreen = displays.some((display) => {
    const { x, y, width, height } = display.workArea
    return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height
  })
  if (!isOnScreen) {
    // 窗口不在任何屏幕内，移动到主显示器居中位置
    const primary = screen.getPrimaryDisplay()
    const { x, y, width, height } = primary.workArea
    win.setBounds({
      x: x + Math.round((width - bounds.width) / 2),
      y: y + Math.round((height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
    })
    console.log('[窗口] 窗口已重新定位到主显示器')
  }
}

/** 显示并聚焦主窗口，恢复 Dock 图标，确保窗口在可见区域 */
function showAndFocusMainWindow(): void {
  if (!mainWindow) return
  ensureWindowOnScreen(mainWindow)
  if (process.platform === 'darwin') {
    app.dock?.show()
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Get the appropriate app icon path for the current platform
 */
function getIconPath(): string {
  // resources 在 build:resources 阶段被复制到 dist/ 下，与 main.cjs 同级
  const resourcesDir = join(__dirname, 'resources')

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

    // 旧 Flow 数据迁移（首次检测到 flow-projects.json 时自动执行）
    migrateFlowSessions()

    // Create application menu
    const menu = createApplicationMenu()
    Menu.setApplicationMenu(menu)

    // Register IPC handlers
    registerIpcHandlers()

    // Cloud 模式：注册 Cloud IPC 处理器
    if (isCloudMode()) {
      await registerCloudIpcHandlers()
      // 同步服务依赖 Cloud 认证，在 Cloud IPC 初始化后注册
      registerSyncIpcHandlers()
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

    // Cloud 模式：窗口就绪后自动执行增量同步
    if (isCloudMode() && mainWindow) {
      mainWindow.once('ready-to-show', () => {
        scheduleAutoSync(mainWindow!)
      })
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
    // 中止所有活跃的 Agent 和 Chat 子进程
    stopAllAgents()
    stopAllGenerations()
    // 清理更新器定时器
    cleanupUpdater()
    // 停止工作区文件监听
    stopWorkspaceWatcher()
    // Clean up system tray before quitting
    destroyTray()
  })
}
