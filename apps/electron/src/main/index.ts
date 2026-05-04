import { app, BrowserWindow, Menu, nativeTheme, screen, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// Dev 与正式版使用独立的 userData 目录，避免共享 Chromium SingletonLock 导致 dev 启动被静默退出
// 必须在任何会读取 userData 路径的模块加载之前执行
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), '@proma/electron-dev'))
}

// 单实例锁：防止重复启动同一个版本（dev/prod 因 userData 已隔离，互不影响）
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

import { getSettings } from './lib/settings-service'
import { resolveOverlayColors } from './lib/titlebar-overlay'

// 商业版固定为 Cloud 模式
process.env.PROMA_MODE = 'cloud'

// 处理 EPIPE 错误：当 stdout/stderr 管道被关闭时（如 electronmon 重启），忽略写入错误
// 这在开发环境热重载时经常发生，不影响应用功能
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})

// 清理本地环境中的 ANTHROPIC_* 变量，防止干扰应用的认证流程
// Electron 桌面应用通过渠道系统管理 API Key，不应受终端环境变量影响
// 注意：此操作必须在 initializeRuntime()（loadShellEnv）之前执行
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ANTHROPIC_')) {
    delete process.env[key]
  }
}

import { createApplicationMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, destroyTray } from './tray'
import { initializeRuntime } from './lib/runtime-init'
import { seedDefaultSkills } from './lib/config-paths'
import { upgradeDefaultSkillsInWorkspaces } from './lib/agent-workspace-manager'
import { stopAllAgents, killOrphanedClaudeSubprocesses } from './lib/agent-service'
import { stopAllGenerations } from './lib/chat-service'
import { migrateFlowSessions } from './lib/flow-migration'
import { initAutoUpdater, cleanupUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { startChatToolsWatcher, stopChatToolsWatcher } from './lib/chat-tools-watcher'
import { getIsQuitting, setQuitting } from './lib/app-lifecycle'
import { isCloudMode } from '@proma/cloud'
import { registerCloudIpcHandlers } from './cloud-ipc'
import { registerSyncIpcHandlers } from './sync-ipc'
import { scheduleAutoSync } from './lib/sync-service'
import { handleOAuthCallback } from './lib/cloud-auth-service'
import { registerBridge, startAllBridges, stopAllBridges } from './lib/bridge-registry'
import { feishuBridgeManager } from './lib/feishu-bridge-manager'
import { getFeishuMultiBotConfig } from './lib/feishu-config'
import { dingtalkBridgeManager } from './lib/dingtalk-bridge-manager'
import { getDingTalkMultiBotConfig } from './lib/dingtalk-config'
import { wechatBridge } from './lib/wechat-bridge'
import { getWeChatConfig } from './lib/wechat-config'
import { createQuickTaskWindow, toggleQuickTaskWindow, destroyQuickTaskWindow } from './lib/quick-task-window'
import { registerGlobalShortcut, unregisterAllGlobalShortcuts } from './lib/global-shortcut-service'

const PROTOCOL_NAME = 'proma'

// ===== Bridge 注册（新增 Bridge 只需在此添加一个 registerBridge 调用） =====

registerBridge({
  name: '飞书 BridgeManager',
  shouldAutoStart: () => {
    const config = getFeishuMultiBotConfig()
    return config.bots.some((b) => b.enabled && b.appId && b.appSecret)
  },
  start: () => feishuBridgeManager.startAll(),
  stop: () => feishuBridgeManager.stopAll(),
})

registerBridge({
  name: '钉钉 BridgeManager',
  shouldAutoStart: () => {
    const config = getDingTalkMultiBotConfig()
    return config.bots.some((b) => b.enabled && b.clientId && b.clientSecret)
  },
  start: () => dingtalkBridgeManager.startAll(),
  stop: () => dingtalkBridgeManager.stopAll(),
})

registerBridge({
  name: '微信 Bridge',
  shouldAutoStart: () => {
    const config = getWeChatConfig()
    return !!(config.enabled && config.credentials)
  },
  start: () => wechatBridge.start(),
  stop: () => wechatBridge.stop(),
})

let mainWindow: BrowserWindow | null = null

/** 获取主窗口实例（供其他模块使用） */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

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

/** 显示并聚焦主窗口，确保窗口在可见区域；若窗口已销毁则重新创建 */
function showAndFocusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  ensureWindowOnScreen(mainWindow)
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
      ? (() => {
          const settings = getSettings()
          return {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: resolveOverlayColors(
              settings.themeMode,
              settings.themeStyle,
              nativeTheme.shouldUseDarkColors
            ),
          }
        })()
      : {}

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: iconExists ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...titleBarOptions,
  })

  // Load the renderer
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))
  }

  // 窗口就绪后最大化显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
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

  // macOS: 点击关闭按钮时隐藏窗口+应用，而不是退出
  // 同时隐藏应用（类似 Cmd+H），确保点击 Dock 图标时 macOS 能正确触发 activate 事件
  if (process.platform === 'darwin') {
    mainWindow.on('close', (event) => {
      if (!getIsQuitting()) {
        event.preventDefault()
        mainWindow?.hide()
        app.hide()
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

    showAndFocusMainWindow()
  } catch (error) {
    console.error('[Deep Link] 解析 URL 失败:', error)
  }
}

// macOS: open-url 事件（app 已运行时，系统会发此事件而非启动新实例）
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

// ===== 单实例锁的第二实例处理 =====
// 单实例锁本身已在文件顶部执行（失败时已直接退出）
// 这里只处理第一个实例中收到的 second-instance 事件

// Windows/Linux: 第二个实例的 deep-link URL 通过此事件传递
app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith(`${PROTOCOL_NAME}://`))
  if (url) {
    handleDeepLink(url)
  }
  showAndFocusMainWindow()
})

app.whenReady().then(async () => {
  // 初始化运行时环境（Shell 环境 + Bun + Git 检测）
  // 必须在其他初始化之前执行，确保环境变量正确加载
  await initializeRuntime()

  // 同步默认 Skills 模板到 ~/.proma/default-skills/
  seedDefaultSkills()

  // 升级所有工作区中版本过旧的默认 Skills
  upgradeDefaultSkillsInWorkspaces()

  // 旧 Flow 数据迁移（首次检测到 flow-projects.json 时自动执行）
  migrateFlowSessions()

  // Create application menu
  const menu = createApplicationMenu()
  Menu.setApplicationMenu(menu)

  // 启动 Chat 工具配置文件监听（Agent 创建工具后自动通知渲染进程）
  startChatToolsWatcher()

  // Register IPC handlers
  registerIpcHandlers()

  // Cloud 模式：注册 Cloud IPC 处理器
  if (isCloudMode()) {
    await registerCloudIpcHandlers()
    // 同步服务依赖 Cloud 认证，在 Cloud IPC 初始化后注册
    registerSyncIpcHandlers()
  }

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  // 如果用户有保存的图标偏好则使用，否则用默认图标
  if (process.platform === 'darwin' && app.dock) {
    const { resolveAppIconPath } = require('./ipc')
    const settings = getSettings()
    const variantId = settings.appIconVariant
    const dockIconPath = variantId
      ? resolveAppIconPath(variantId)
      : join(__dirname, '../resources/icon.png')
    if (dockIconPath && existsSync(dockIconPath)) {
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

  // 预创建快速任务窗口（隐藏状态，首次唤起秒开）
  createQuickTaskWindow()

  // 注册全局快捷键
  registerGlobalShortcut('quick-task', toggleQuickTaskWindow)
  registerGlobalShortcut('show-main-window', showAndFocusMainWindow)

  // Cloud 模式：窗口就绪后自动执行增量同步
  if (isCloudMode() && mainWindow) {
    mainWindow.once('ready-to-show', () => {
      scheduleAutoSync(mainWindow!)
    })
  }

  // 启动所有已注册的 Bridge（飞书/钉钉/微信等）
  await startAllBridges()

  app.on('activate', () => {
    // 直接检查 mainWindow 引用，避免 getAllWindows() 包含 DevTools 等其他窗口导致误判
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      // 窗口已存在但可能被隐藏（macOS 关闭按钮 = hide），重新显示
      showAndFocusMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 非 macOS：关闭所有窗口时退出应用
  // macOS：保持应用运行（可通过 tray 或 Dock 重新打开）
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // 标记正在退出，让 close 事件不再阻止关闭
  setQuitting()

  // 中止所有活跃的 Agent 和 Chat 子进程
  stopAllAgents()
  stopAllGenerations()
  // 最后兜底：扫描并强杀所有孤儿 claude-agent-sdk 子进程（Issue #357）
  // 针对 pidMap 未覆盖、dispose 漏杀等极端场景，确保不遗留残留进程
  killOrphanedClaudeSubprocesses()
  // 清理更新器定时器
  cleanupUpdater()
  // 停止工作区文件监听
  stopWorkspaceWatcher()
  // 停止 Chat 工具配置文件监听
  stopChatToolsWatcher()
  // 停止所有 Bridge
  stopAllBridges()
  // 注销全局快捷键
  unregisterAllGlobalShortcuts()
  // 销毁快速任务窗口
  destroyQuickTaskWindow()
  // Clean up system tray before quitting
  destroyTray()
})
