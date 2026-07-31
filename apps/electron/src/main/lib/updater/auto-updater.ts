/**
 * 自动更新核心模块
 *
 * 检测新版本 → 自动后台下载 → 用户选择立即或空闲时重启安装。
 * 自动更新仅在打包后的生产环境中启用。
 */

import { autoUpdater } from 'electron-updater'
import { BrowserWindow, app } from 'electron'
import type { UpdateStatus } from './updater-types'
import { UPDATER_IPC_CHANNELS } from './updater-types'
import { createIdleInstallScheduler } from './idle-install-scheduler'

/** 当前更新状态 */
let currentStatus: UpdateStatus = { status: 'idle' }

/** 主窗口引用 */
let win: BrowserWindow | null = null

/** 定时检查定时器 */
let checkInterval: ReturnType<typeof setInterval> | null = null

/** 由 Agent 服务注入，覆盖所有窗口/后台 Agent 的运行状态。 */
let hasActiveAgents = (): boolean => false

/**
 * 用户选择「空闲时更新」后，等待所有 Agent 结束再安装。
 *
 * 状态检查留在主进程，避免渲染进程漏掉后台运行或其他窗口中的 Agent。
 */
const idleInstallScheduler = createIdleInstallScheduler({
  canInstall: () => currentStatus.status === 'downloaded' && !hasActiveAgents(),
  install: () => {
    console.log('[更新] 当前没有运行中的 Agent，开始安装已下载更新')
    quitAndInstall()
  },
})

/** 更新状态并推送给渲染进程 */
function setStatus(status: UpdateStatus): void {
  currentStatus = status
  if (status.status !== 'downloaded') {
    idleInstallScheduler.cancel()
  }
  win?.webContents?.send(UPDATER_IPC_CHANNELS.ON_STATUS_CHANGED, status)
}

/**
 * 绑定更新器所需的主窗口与 Agent 状态。
 */
export function configureUpdater(
  mainWindow: BrowserWindow,
  options?: { hasActiveAgents?: () => boolean },
): void {
  hasActiveAgents = options?.hasActiveAgents ?? hasActiveAgents
  win = mainWindow
}

/** 获取当前更新状态 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/** 手动触发检查更新 */
export async function checkForUpdates(): Promise<void> {
  // 已在下载中或已下载完成，不重复检查
  if (currentStatus.status === 'downloading' || currentStatus.status === 'downloaded') {
    console.log('[更新] 跳过检查：已在下载中或已下载完成')
    return
  }

  try {
    setStatus({ status: 'checking' })
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[更新] 检查更新失败:', err)
    setStatus({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 请求在没有运行中 Agent 时安装已下载的更新。
 *
 * @returns 是否已接受请求；仅 downloaded 状态可排队。
 */
export function installWhenIdle(): boolean {
  if (currentStatus.status !== 'downloaded') {
    console.warn('[更新] 跳过空闲安装：当前没有已下载的更新')
    return false
  }

  console.log('[更新] 已请求空闲安装，等待所有 Agent 结束')
  idleInstallScheduler.request()
  return true
}

/** 取消尚未执行的空闲安装请求。 */
export function cancelIdleInstall(): void {
  idleInstallScheduler.cancel()
  console.log('[更新] 已取消空闲安装请求')
}

/**
 * 退出并安装已下载的更新。
 *
 * 所有安装入口最终都经过这里：即使调用方绕过空闲调度器，也不会在 Agent
 * 运行时退出；在真正安装前再次检查一次，避免检查与退出之间启动新 Agent。
 */
function quitAndInstall(): void {
  if (!app.isPackaged) {
    console.warn('[更新] 开发环境不支持安装更新')
    return
  }

  if (hasActiveAgents()) {
    console.log('[更新] 检测到运行中的 Agent，改为等待空闲后安装')
    installWhenIdle()
    return
  }

  // 延迟调用确保 IPC 响应已发送回渲染进程；回调内再次检查防止竞态。
  setImmediate(() => {
    if (hasActiveAgents()) {
      console.log('[更新] 安装前出现新的运行中 Agent，继续等待空闲')
      installWhenIdle()
      return
    }

    // 移除所有窗口的 close 监听器，避免 preventDefault 阻止退出。
    for (const w of BrowserWindow.getAllWindows()) {
      w.removeAllListeners('close')
    }
    autoUpdater.quitAndInstall(true, true)
  })
}

/** 清理更新器资源（定时器等） */
export function cleanupUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
  idleInstallScheduler.dispose()
}

/**
 * 初始化自动更新
 *
 * @param mainWindow - 主窗口实例，用于推送更新状态
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  configureUpdater(mainWindow)

  autoUpdater.logger = {
    info: (...args: unknown[]) => console.log('[更新-updater]', ...args),
    warn: (...args: unknown[]) => console.warn('[更新-updater]', ...args),
    error: (...args: unknown[]) => console.error('[更新-updater]', ...args),
    debug: (...args: unknown[]) => console.log('[更新-updater:debug]', ...args),
  }

  // 自动下载，但不在用户正常退出时自动安装，避免重启应用后被动进入更新流程。
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  // 监听更新事件
  autoUpdater.on('checking-for-update', () => {
    console.log('[更新] 正在检查更新...')
    setStatus({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[更新] 发现新版本:', info.version)
    setStatus({
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      status: 'downloading',
      version: (currentStatus as { version?: string }).version || '',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[更新] 下载完成:', info.version)
    setStatus({
      status: 'downloaded',
      version: info.version,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[更新] 已是最新版本')
    setStatus({ status: 'not-available' })
  })

  autoUpdater.on('error', (err) => {
    console.error('[更新] 更新出错:', err)
    setStatus({
      status: 'error',
      error: err.message,
    })
  })

  // 启动后延迟 10 秒首次检查
  setTimeout(() => {
    console.log('[更新] 首次自动检查更新')
    checkForUpdates()
  }, 10_000)

  // 每 4 小时自动检查一次
  checkInterval = setInterval(() => {
    console.log('[更新] 定时自动检查更新')
    checkForUpdates()
  }, 4 * 60 * 60 * 1000)

  // 窗口关闭时清理定时器
  mainWindow.on('closed', () => {
    if (checkInterval) {
      clearInterval(checkInterval)
      checkInterval = null
    }
    idleInstallScheduler.dispose()
    win = null
  })

  console.log('[更新] 自动更新模块已初始化（自动下载，支持空闲时安装）')
}
