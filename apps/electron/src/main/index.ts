import { app, BrowserWindow, dialog, Menu, nativeTheme, protocol, screen, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// Dev 与正式版使用独立的 userData 目录，避免共享 Chromium SingletonLock 导致 dev 启动被静默退出
// 必须在任何会读取 userData 路径的模块加载之前执行
if (!app.isPackaged) {
  // 多个 worktree 可显式隔离开发实例，避免其中一个分支抢走另一分支的 Chromium SingletonLock。
  const instance = process.env.PROMA_DEV_INSTANCE?.replace(/[^a-zA-Z0-9_-]/g, '')
  if (instance) app.setName(`Proma-${instance}`)
  app.setPath('userData', join(app.getPath('appData'), instance ? `@proma/electron-dev-${instance}` : '@proma/electron-dev'))
}

// 单实例锁：防止重复启动同一个版本（dev/prod 因 userData 已隔离，互不影响）
//
// 失败的常见原因：用户升级新版本时旧版进程仍在后台运行（macOS 关闭窗口 = hide
// 不退出）。原先此处直接 process.exit(0)，没有任何用户可见反馈——如果旧进程
// 卡在启动期，second-instance 也唤不起窗口，用户表现就是"双击应用没反应"。
// 改为：留下 stderr 排查线索后正常退出，让 Electron 触发已存在实例的
// second-instance 事件，由主实例负责显示窗口。
if (!app.requestSingleInstanceLock()) {
  console.warn(
    '[启动] 已有 Proma 进程持有单实例锁，本次启动将退出。\n' +
      '  如果窗口未出现，可能旧进程已卡死。请运行 `killall Proma` 后重试。',
  )
  app.quit()
} else {
  // 主流程：正常启动（单实例锁已获取）
  registerProtocolsAndHandlers()
}

function registerProtocolsAndHandlers(): void {
  // 注册自定义协议方案为"特权"（必须在 app ready 之前）
  // 用于内联预览本地文件（renderer 用 iframe 加载 proma-file:// 资源）
  protocol.registerSchemesAsPrivileged([
    { scheme: 'proma-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ])

  // Windows: 禁用 LCD 次像素抗锯齿（ClearType），改用灰度 AA。
  // ClearType 是为浅色背景+深色文字设计的，在深色代码块背景下会产生彩色边缘，导致文字模糊。
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-lcd-text')
  }

  // macOS 文件关联：在 app ready 之前注册 open-file 事件
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    handleMigrationFileOpen(filePath)
  })

  // Windows 文件关联：当用户双击文件时，新实例的参数会通过 second-instance 传给已有实例
  app.on('second-instance', (_event, argv) => {
    if (hasOpenPlanningArgument(argv)) {
      showPlanningWindow()
      return
    }
    showAndFocusMainWindow()
    const fileArg = argv.find((arg) => arg.endsWith('.proma-backup') || arg.endsWith('.proma-share'))
    if (fileArg) {
      handleMigrationFileOpen(fileArg)
    }
  })
}



import { getSettings, updateSettings } from './lib/settings-service'
import { handlePromaFileRequest } from './lib/local-file-protocol'

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
import { createTray, destroyTray, getTray } from './tray'
import { initializeRuntime } from './lib/runtime-init'
import { seedDefaultSkills } from './lib/config-paths'
import { upgradeDefaultSkillsInWorkspaces } from './lib/agent-workspace-manager'
import { hasActiveAgentSessions, stopAllAgents, cleanupAgentRuntimeResources } from './lib/agent-service'
import { disposePiMcpConnections } from './lib/adapters/pi-mcp-tools'
import { markRunningDelegationsAsInterrupted } from './lib/agent-session-manager'
import { stopAllGenerations } from './lib/chat-service'
import { configureUpdater, initAutoUpdater, cleanupUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { startChatToolsWatcher, stopChatToolsWatcher } from './lib/chat-tools-watcher'
import { getIsQuitting, setQuitting } from './lib/app-lifecycle'
import { getMainWindow as getStoredMainWindow, setMainWindow as setStoredMainWindow } from './lib/main-window-store'
import {
  registerBridge,
  startAllBridges,
  startBridgeSelfHealing,
  stopAllBridges,
  stopBridgeSelfHealing,
} from './lib/bridge-registry'
import { startScheduler, stopScheduler } from './lib/automation-scheduler'
import { startPlanningReminderScheduler, stopPlanningReminderScheduler } from './lib/planning-reminder-scheduler'
import { startPlanningNativeSyncCoordinator, stopPlanningNativeSyncCoordinator } from './lib/planning-native-sync-coordinator'
import { feishuBridgeManager } from './lib/feishu-bridge-manager'
import { getFeishuMultiBotConfig } from './lib/feishu-config'
import { stopFeishuSyncSleepBlocker, syncFeishuSyncSleepBlocker } from './lib/feishu-sleep-blocker'
import { getPersistableMainWindowState, hideMacMainWindowAfterClose } from './lib/main-window-lifecycle'
import { dingtalkBridgeManager } from './lib/dingtalk-bridge-manager'
import { getDingTalkMultiBotConfig } from './lib/dingtalk-config'
import { wechatBridge } from './lib/wechat-bridge'
import { getWeChatConfig } from './lib/wechat-config'
import { createQuickTaskWindow, toggleQuickTaskWindow, destroyQuickTaskWindow } from './lib/quick-task-window'
import { destroyPlanningWindow, showPlanningWindow } from './lib/planning-window'
import { configurePlanningQuickEntries } from './lib/planning-quick-entry'
import { hasOpenPlanningArgument } from './lib/planning-quick-entry-model'
import { handleNativeAgentIslandEvent, initAgentIslandService, disposeAgentIslandService, publishAgentIslandNow } from './lib/agent-island-service'
import { disposeMacAgentIslandNativeHost, startMacAgentIslandNativeHost, isMacAgentIslandNativeHostReady } from './lib/mac-agent-island-native-host'
import { isAgentIslandSupported } from './lib/macos-version'
import {
  createVoiceDictationWindow,
  toggleVoiceDictationWindow,
  destroyVoiceDictationWindow,
  shouldSuppressVoiceDictationActivate,
} from './lib/voice-dictation-window'
import { registerGlobalShortcut, unregisterAllGlobalShortcuts } from './lib/global-shortcut-service'
import { setPromaVersion } from '@proma/core'
import { TRAY_IPC_CHANNELS } from '../types'

const MIGRATION_IPC_OPEN = 'migration:open-import-file'

/** macOS 26+ 使用 Swift/AppKit NSPanel；其他平台不创建 Agent Island surface。 */
function startAgentIslandSurface(): void {
  if (!isAgentIslandSupported()) {
    console.info('[agent-island] 当前平台或 macOS 版本不支持，已禁用')
    return
  }

  const startedNative = startMacAgentIslandNativeHost({
    onReady: () => {
      console.info('[agent-island] macOS 原生 NSPanel helper 已就绪')
      publishAgentIslandNow()
    },
    onEvent: handleNativeAgentIslandEvent,
    onUnavailable: (reason) => {
      console.warn(`[agent-island] macOS 原生 helper 不可用，已禁用：${reason}`)
    },
  })
  if (!startedNative) {
    console.warn('[agent-island] macOS 原生 helper 启动失败，已禁用')
  }
}

/** 检查文件路径是否为迁移文件，如果是则通知渲染进程打开导入流程 */
function handleMigrationFileOpen(filePath: string): void {
  if (filePath.endsWith('.proma-backup') || filePath.endsWith('.proma-share')) {
    sendToMainWindow(MIGRATION_IPC_OPEN, { filePath })
  }
}

// ===== Bridge 注册（新增 Bridge 只需在此添加一个 registerBridge 调用） =====

registerBridge({
  name: '飞书 BridgeManager',
  shouldAutoStart: () => {
    const config = getFeishuMultiBotConfig()
    return config.bots.some((b) => b.enabled && b.appId && b.appSecret)
  },
  needsRecovery: () => {
    const config = getFeishuMultiBotConfig()
    const states = feishuBridgeManager.getStates()
    return config.bots.some((bot) => (
      bot.enabled &&
      !!bot.appId &&
      !!bot.appSecret &&
      states.bots[bot.id]?.status === 'error'
    ))
  },
  start: () => feishuBridgeManager.startAll(),
  stop: () => feishuBridgeManager.stopAll(),
  recover: () => recoverEnabledFeishuBots(),
})

registerBridge({
  name: '钉钉 BridgeManager',
  shouldAutoStart: () => {
    const config = getDingTalkMultiBotConfig()
    return config.bots.some((b) => b.enabled && b.clientId && b.clientSecret)
  },
  needsRecovery: () => {
    const config = getDingTalkMultiBotConfig()
    const states = dingtalkBridgeManager.getStates()
    return config.bots.some((bot) => (
      bot.enabled &&
      !!bot.clientId &&
      !!bot.clientSecret &&
      states.bots[bot.id]?.status === 'error'
    ))
  },
  start: () => dingtalkBridgeManager.startAll(),
  stop: () => dingtalkBridgeManager.stopAll(),
  recover: () => recoverEnabledDingTalkBots(),
})

registerBridge({
  name: '微信 Bridge',
  shouldAutoStart: () => {
    const config = getWeChatConfig()
    return !!(config.enabled && config.credentials)
  },
  needsRecovery: () => wechatBridge.getStatus().status === 'error',
  start: () => wechatBridge.start(),
  stop: () => wechatBridge.stop(),
})

async function recoverEnabledFeishuBots(): Promise<void> {
  const config = getFeishuMultiBotConfig()
  let failedCount = 0
  for (const bot of config.bots) {
    if (!bot.enabled || !bot.appId || !bot.appSecret) continue
    try {
      await feishuBridgeManager.restartBot(bot.id)
    } catch (error) {
      failedCount++
      console.error(`[飞书 BridgeManager] Bot "${bot.name}" 自愈恢复失败:`, error)
    }
  }
  if (failedCount > 0) {
    throw new Error(`${failedCount} 个飞书 Bot 自愈恢复失败`)
  }
}

async function recoverEnabledDingTalkBots(): Promise<void> {
  const config = getDingTalkMultiBotConfig()
  let failedCount = 0
  for (const bot of config.bots) {
    if (!bot.enabled || !bot.clientId || !bot.clientSecret) continue
    try {
      await dingtalkBridgeManager.restartBot(bot.id)
    } catch (error) {
      failedCount++
      console.error(`[钉钉 BridgeManager] Bot "${bot.name}" 自愈恢复失败:`, error)
    }
  }
  if (failedCount > 0) {
    throw new Error(`${failedCount} 个钉钉 Bot 自愈恢复失败`)
  }
}

let mainWindow: BrowserWindow | null = null
let startupSplashWindow: BrowserWindow | null = null

/**
 * 原生启动页不依赖 Renderer bundle 或运行时检测，避免冷启动期间出现空白窗口。
 * dev 由 build:resources 复制到 dist/resources；打包版由 electron-builder extraResources 提供。
 */
function getStartupSplashPath(): string {
  const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, 'resources')
  return join(resourcesDir, 'startup-splash', 'index.html')
}

function dismissStartupSplash(): void {
  if (startupSplashWindow && !startupSplashWindow.isDestroyed()) {
    startupSplashWindow.destroy()
  }
  startupSplashWindow = null
}

function createStartupSplashWindow(): void {
  if (startupSplashWindow && !startupSplashWindow.isDestroyed()) return

  const savedState = getSettings().mainWindowState
  const initialBounds = savedState
    ? { width: savedState.width, height: savedState.height, x: savedState.x, y: savedState.y }
    : { width: 1400, height: 900 }

  startupSplashWindow = new BrowserWindow({
    ...initialBounds,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#1b3f2d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const splash = startupSplashWindow
  splash.setMenuBarVisibility(false)
  splash.once('ready-to-show', () => {
    if (splash.isDestroyed()) return
    // 与主窗口使用相同的默认策略，首次启动时也不会出现窗口尺寸跳变。
    if (savedState?.isMaximized ?? true) splash.maximize()
    splash.show()
  })
  splash.once('closed', () => {
    if (startupSplashWindow === splash) startupSplashWindow = null
  })
  splash.loadFile(getStartupSplashPath()).catch((error) => {
    console.warn('[启动] 原生启动页加载失败，将继续启动主窗口:', error)
    dismissStartupSplash()
  })
}

/** 获取主窗口实例（供其他模块使用） */
export function getMainWindow(): BrowserWindow | null {
  return getStoredMainWindow()
}

function installWindowsZoomInFallback(win: BrowserWindow): void {
  if (process.platform !== 'win32') return

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return

    // Windows 下主键盘的 Ctrl++ 常会以 Ctrl+= 上报；小键盘加号也需要兜底。
    const key = input.key.toLowerCase()
    if (!['=', '+', 'numadd', 'add'].includes(key)) return

    event.preventDefault()
    const currentZoomLevel = win.webContents.getZoomLevel()
    win.webContents.setZoomLevel(Math.min(currentZoomLevel + 0.5, 9))
  })
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
  if (process.platform === 'darwin') {
    if (app.dock) app.dock.show()
    app.show()
  }

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

function saveMainWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const mainWindowState = getPersistableMainWindowState(mainWindow)
  if (!mainWindowState) return
  updateSettings({
    mainWindowState,
  })
}

function isDevServerNavigation(url: string): boolean {
  try {
    return new URL(url).origin === 'http://127.0.0.1:5173'
  } catch {
    return false
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
      ? { titleBarStyle: 'hidden' as const }
      : {}

  const savedState = getSettings().mainWindowState
  const initialBounds = savedState
    ? { width: savedState.width, height: savedState.height, x: savedState.x, y: savedState.y }
    : { width: 1400, height: 900 }

  mainWindow = new BrowserWindow({
    ...initialBounds,
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
  setStoredMainWindow(mainWindow)
  installWindowsZoomInFallback(mainWindow)

  // Load the renderer
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))
  }

  // 主 Renderer 无法加载或崩溃时，不能让启动页无限停留；切换为轻量错误页告知用户。
  let hasShownRendererFailure = false
  const showRendererFailure = (reason: string): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    dismissStartupSplash()
    if (hasShownRendererFailure) {
      mainWindow.show()
      return
    }

    hasShownRendererFailure = true
    const message = encodeURIComponent(`Proma 无法加载主界面\n\n${reason}\n\n请重试；若问题持续，请检查应用安装文件。`)
    mainWindow.loadURL(`data:text/plain;charset=utf-8,${message}`).catch((error) => {
      console.error('[启动] 降级错误页加载失败:', error)
      mainWindow?.show()
    })
  }
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    console.error(`[启动] 主 Renderer 加载失败 (${errorCode}): ${errorDescription} (${validatedURL})`)
    showRendererFailure(errorDescription)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[启动] 主 Renderer 进程异常退出: ${details.reason}`)
    showRendererFailure(`Renderer 进程异常退出：${details.reason}`)
  })

  // 窗口就绪后，按保存的状态决定是否最大化
  mainWindow.once('ready-to-show', () => {
    if (savedState?.isMaximized ?? true) {
      mainWindow?.maximize()
    }
    if (process.platform === 'darwin' && app.dock) {
      app.dock.show()
    }
    // 仅在主窗口首帧已完成合成后移除原生启动页，避免冷启动时的空白与闪屏。
    dismissStartupSplash()
    mainWindow?.show()
  })

  // 持久化窗口大小和位置（防抖 500ms，避免频繁写入）
  let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleWindowStateSave = (): void => {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null
      saveMainWindowState()
    }, 500)
  }
  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('move', scheduleWindowStateSave)

  // 拦截页面内导航，外部链接用系统浏览器打开，防止 Electron 窗口被覆盖
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许开发模式下的 Vite HMR 热重载
    if (isDev && isDevServerNavigation(url)) return
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
        // 隐藏前先刷新挂起的窗口状态保存
        if (windowStateSaveTimer) {
          clearTimeout(windowStateSaveTimer)
          windowStateSaveTimer = null
        }
        saveMainWindowState()
        event.preventDefault()
        if (mainWindow && !mainWindow.isDestroyed()) {
          hideMacMainWindowAfterClose(mainWindow, app)
        }
      }
    })
  }

  // Windows: 点击关闭按钮时隐藏窗口到托盘，而不是退出
  if (process.platform === 'win32') {
    mainWindow.on('close', (event) => {
      if (!getIsQuitting() && getTray()) {
        // 隐藏前先刷新挂起的窗口状态保存
        if (windowStateSaveTimer) {
          clearTimeout(windowStateSaveTimer)
          windowStateSaveTimer = null
        }
        saveMainWindowState()
        event.preventDefault()
        mainWindow?.hide()
      }
    })
  }

  mainWindow.on('closed', () => {
    setStoredMainWindow(null)
    mainWindow = null
  })
}

function sendToMainWindow(channel: string, data?: unknown): void {
  showAndFocusMainWindow()

  const win = mainWindow
  if (!win || win.isDestroyed()) return

  const send = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

app.whenReady().then(bootstrap).catch(handleBootstrapFailure)

/**
 * 启动主流程。所有非关键步骤用 safeRun / safeAwait 隔离，
 * 单点失败不应阻止窗口和托盘的创建（用户至少要能看到界面）。
 */
async function bootstrap(): Promise<void> {
  // 初始化 Proma 版本号（供 User-Agent 等全局标识使用）
  setPromaVersion(app.getVersion())

  // 先显示不依赖 Renderer 的静态启动页；运行时检测耗时不会再变成用户可见的空白。
  createStartupSplashWindow()

  // 注册自定义协议 proma-file:// 用于内联预览本地文件。
  // 协议只接受主进程签发的 opaque token，不解析 renderer 提供的绝对路径。
  protocol.handle('proma-file', handlePromaFileRequest)

  // 初始化运行时环境（Shell 环境 + Bun + Git 检测）
  // 必须在其他初始化之前执行，确保环境变量正确加载
  await safeAwait('initializeRuntime', () => initializeRuntime())

  // 同步默认 Skills 模板到 ~/.proma/default-skills/
  safeRun('seedDefaultSkills', seedDefaultSkills)

  // 升级所有工作区中版本过旧的默认 Skills
  safeRun('upgradeDefaultSkillsInWorkspaces', upgradeDefaultSkillsInWorkspaces)

  // Create application menu
  const menu = createApplicationMenu()
  Menu.setApplicationMenu(menu)

  // Register IPC handlers
  registerIpcHandlers()

  // 收敛上次退出时遗留的运行中委派子会话（内存态丢失，无法续跑）
  safeRun('markRunningDelegationsAsInterrupted', markRunningDelegationsAsInterrupted)

  // Set dock icon on macOS
  // 确保 Dock 图标可见（dev 模式下通过 spawn 启动时可能不会自动显示）
  // 如果用户有保存的图标偏好则使用，否则用默认图标
  if (process.platform === 'darwin' && app.dock) {
    await app.dock.show()
    const { resolveAppIconPath } = require('./ipc')
    const settings = getSettings()
    const variantId = settings.appIconVariant
    const dockIconPath = resolveAppIconPath(variantId ?? 'default')
    if (dockIconPath && existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    }
  }

  // Create main window (will be shown when ready)
  createWindow()

  // 为 Dock、任务栏右键菜单与首次启动参数提供任务/日程的直接入口。
  safeRun('configurePlanningQuickEntries', () => {
    configurePlanningQuickEntries({
      showMainWindow: showAndFocusMainWindow,
      showPlanningWindow,
    })
  })
  if (hasOpenPlanningArgument(process.argv)) showPlanningWindow()

  // Create system tray icon
  createTray({
    showMainWindow: showAndFocusMainWindow,
    showPlanningWindow,
    openAgentSession: (sessionId, title) => {
      sendToMainWindow(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, { sessionId, title })
    },
    createChatSession: () => {
      sendToMainWindow(TRAY_IPC_CHANNELS.CREATE_SESSION, { mode: 'chat' })
    },
    createAgentSession: () => {
      sendToMainWindow(TRAY_IPC_CHANNELS.CREATE_SESSION, { mode: 'agent' })
    },
  })

  // 启动工作区文件监听（Agent MCP/Skills + 文件浏览器自动刷新）
  if (mainWindow) {
    safeRun('startWorkspaceWatcher', () => startWorkspaceWatcher(mainWindow!))
  }

  // 启动 Chat 工具配置文件监听（Agent 创建工具后自动通知渲染进程）
  safeRun('startChatToolsWatcher', startChatToolsWatcher)

  // 自动更新仅在生产环境启用，并由主进程统一检测 Agent 是否空闲。
  if (app.isPackaged && mainWindow) {
    configureUpdater(mainWindow, { hasActiveAgents: hasActiveAgentSessions })
    safeRun('initAutoUpdater', () => initAutoUpdater(mainWindow!))
  }

  // 预创建快速任务窗口（隐藏状态，首次唤起秒开）
  safeRun('createQuickTaskWindow', createQuickTaskWindow)
  if (getSettings().voiceDictation?.enabled === true) {
    safeRun('createVoiceDictationWindow', createVoiceDictationWindow)
  }

  // Agent Island 仅在 macOS 26+ 原生 surface 上初始化；Windows/Linux 不注册服务、窗口或事件监听。
  if (isAgentIslandSupported()) {
    safeRun('initAgentIslandService', () => {
      initAgentIslandService({
        showAndFocusMainWindow,
        openAgentSession: (sessionId, title) => {
          sendToMainWindow(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, { sessionId, title })
        },
        openPlanning: showPlanningWindow,
        enabled: () => isMacAgentIslandNativeHostReady() && getSettings().agentIsland?.enabled !== false,
      })
    })
    safeRun('startAgentIslandSurface', startAgentIslandSurface)
  }

  // 飞书实时同步开启时，默认阻止系统自动休眠，保证远程群内继续可用。
  safeRun('syncFeishuSyncSleepBlocker', () => syncFeishuSyncSleepBlocker(getSettings()))

  // 注册全局快捷键
  safeRun('registerGlobalShortcut:quick-task', () =>
    registerGlobalShortcut('quick-task', toggleQuickTaskWindow),
  )
  safeRun('registerGlobalShortcut:show-main-window', () =>
    registerGlobalShortcut('show-main-window', showAndFocusMainWindow),
  )
  safeRun('registerGlobalShortcut:open-planning', () =>
    registerGlobalShortcut('open-planning', showPlanningWindow),
  )
  safeRun('registerGlobalShortcut:voice-dictation', () =>
    registerGlobalShortcut('voice-dictation', () => {
      toggleVoiceDictationWindow({ targetIsProma: mainWindow?.isFocused() === true })
    }),
  )

  // 启动所有已注册的 Bridge（飞书/钉钉/微信等）
  await safeAwait('startAllBridges', () => startAllBridges())
  safeRun('startBridgeSelfHealing', startBridgeSelfHealing)

  // 启动定时任务调度器（恢复持久化的 active 任务）
  safeRun('startScheduler', startScheduler)
  safeRun('startPlanningReminderScheduler', startPlanningReminderScheduler)
  safeRun('startPlanningNativeSyncCoordinator', startPlanningNativeSyncCoordinator)

  app.on('activate', () => {
    if (shouldSuppressVoiceDictationActivate()) {
      return
    }

    // 直接检查 mainWindow 引用，避免 getAllWindows() 包含 DevTools 等其他窗口导致误判
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      // 窗口已存在但可能被隐藏（macOS 关闭按钮 = hide），重新显示
      showAndFocusMainWindow()
    }
  })
}

/** 同步启动钩子隔离：单点失败仅记录日志，不阻断启动链。 */
function safeRun(name: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error(`[启动] ${name} 失败（已隔离）:`, err)
  }
}

/** 异步启动钩子隔离：同 safeRun，但适用于返回 Promise 的钩子。 */
async function safeAwait(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.error(`[启动] ${name} 失败（已隔离）:`, err)
  }
}

/**
 * whenReady 顶层兜底：理论上 bootstrap 内的 safeRun/safeAwait 已经把所有可预期
 * 异常隔离掉了，能走到这里说明出了 bootstrap 本身控制流的意外（极端情况），
 * 此时仍尝试创建一个降级窗口，让用户至少能看到界面、复制日志、提交反馈。
 */
function handleBootstrapFailure(err: unknown): void {
  console.error('[启动] bootstrap 致命错误，进入降级模式:', err)

  try {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    dialog.showErrorBox(
      'Proma 启动遇到错误',
      `部分功能可能不可用：\n\n${message}\n\n` +
        `日志位置：${app.getPath('logs')}\n\n` +
        `常见原因与排查：\n` +
        `1. 旧版 Proma 进程未退出（终端运行 killall Proma 后重试）\n` +
        `2. ~/.proma/ 配置损坏（重命名 ~/.proma 后重启）\n` +
        `3. 系统 Keychain 无法解密保存的凭证（删除 ~/.proma/feishu.json 等后重新登录）\n\n` +
        `如需协助请到 GitHub Issues 反馈。`,
    )
  } catch {
    /* dialog 也失败，无能为力 */
  }

  try {
    registerIpcHandlers()
    createWindow()
  } catch (fallbackErr) {
    console.error('[启动] 降级窗口创建也失败:', fallbackErr)
  }
}

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
  // 释放 Pi runtime 资源与关联 MCP 子进程。
  cleanupAgentRuntimeResources()
  // 清理更新器定时器
  cleanupUpdater()
  // 停止工作区文件监听
  stopWorkspaceWatcher()
  // 停止 Chat 工具配置文件监听
  stopChatToolsWatcher()
  // 停止所有 Bridge
  stopBridgeSelfHealing()
  stopAllBridges()
  // 停止定时任务调度器
  stopScheduler()
  stopPlanningReminderScheduler()
  stopPlanningNativeSyncCoordinator()
  // 释放飞书同步防休眠
  stopFeishuSyncSleepBlocker()
  // 注销全局快捷键
  unregisterAllGlobalShortcuts()
  // 销毁辅助窗口
  destroyQuickTaskWindow()
  destroyPlanningWindow()
  destroyVoiceDictationWindow()
  // 销毁原生 macOS 灵动岛服务（其他平台从未创建 surface）
  disposeMacAgentIslandNativeHost()
  disposeAgentIslandService()
  // 关闭 Pi MCP 桥接连接（释放 stdio 子进程）
  disposePiMcpConnections().catch(() => {})
  // Clean up system tray before quitting
  destroyTray()
})
