/**
 * 自动更新核心模块
 *
 * 封装 electron-updater，提供后台静默检查/下载 + 状态推送。
 * 仅在打包后的生产环境中工作。
 *
 * 参考 craft-agents-oss 的 auto-update.ts 模式：
 * - 设置 electron-updater 日志
 * - installUpdate 使用 isInstalling 防重复 + setUpdating 标志
 * - 直接调用 quitAndInstall（不包裹 setImmediate）
 * - 备份定时器确保退出
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from './updater-types'
import { UPDATER_IPC_CHANNELS } from './updater-types'
import { setQuitting, setUpdating } from '../app-lifecycle'

/** 当前更新状态 */
let currentStatus: UpdateStatus = { status: 'idle' }

/** 主窗口引用 */
let win: BrowserWindow | null = null

/** 定时检查定时器 */
let checkInterval: ReturnType<typeof setInterval> | null = null

/** 是否正在执行安装（防重复点击） */
let isInstalling = false

/** 更新状态并推送给渲染进程 */
function setStatus(status: UpdateStatus): void {
  currentStatus = status
  win?.webContents?.send(UPDATER_IPC_CHANNELS.ON_STATUS_CHANGED, status)
}

/** 获取当前更新状态 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

/** 手动触发检查更新 */
export async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[更新] 检查更新失败:', err)
    setStatus({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 手动触发下载更新 */
export async function downloadUpdate(): Promise<void> {
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    console.error('[更新] 下载更新失败:', err)
    setStatus({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * 退出并安装更新
 *
 * 参考 craft-agents-oss 模式：
 * 1. 防重复点击
 * 2. 设置 installing 状态给 UI 反馈
 * 3. 设置 isUpdating 标志，让 before-quit 不做额外操作
 * 4. 设置 isQuitting 标志，确保 macOS close handler 不阻止关闭
 * 5. 直接调用 quitAndInstall（不清理子进程，由 before-quit 统一处理）
 * 6. 备份定时器确保应用退出
 */
export function installUpdate(): void {
  if (isInstalling) {
    console.log('[更新] 已在安装中，忽略重复调用')
    return
  }
  isInstalling = true

  try {
    console.log('[更新] 准备安装更新...')
    setStatus({ status: 'installing' })

    // 标记正在更新，让 before-quit 知道不要强制退出
    setUpdating(true)
    // 标记正在退出，确保 macOS close handler 不阻止关闭
    setQuitting()

    // 清理定时器
    cleanupUpdater()

    // isSilent=true: Windows NSIS 静默安装，不弹出安装向导
    // isForceRunAfter=true: 安装完成后自动重新打开应用
    console.log('[更新] 调用 autoUpdater.quitAndInstall(true, true)')
    autoUpdater.quitAndInstall(true, true)

    // 3 秒后备 app.quit()，以防 quitAndInstall 未能触发退出
    setTimeout(() => {
      console.log('[更新] 后备: 3 秒超时，调用 app.quit()')
      app.quit()
    }, 3_000)

    // 5 秒终极后备 app.exit(0)，强制退出
    setTimeout(() => {
      console.log('[更新] 终极后备: 5 秒超时，调用 app.exit(0)')
      app.exit(0)
    }, 5_000)
  } catch (err) {
    console.error('[更新] 安装更新失败:', err)
    isInstalling = false
    setUpdating(false)
    setStatus({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 清理更新器资源（定时器等） */
export function cleanupUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

/**
 * 初始化自动更新
 *
 * @param mainWindow - 主窗口实例，用于推送更新状态
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow

  // 配置 electron-updater 日志，转发到 console
  autoUpdater.logger = {
    info: (...args: unknown[]) => console.log('[更新-updater]', ...args),
    warn: (...args: unknown[]) => console.warn('[更新-updater]', ...args),
    error: (...args: unknown[]) => console.error('[更新-updater]', ...args),
    debug: (...args: unknown[]) => console.log('[更新-updater:debug]', ...args),
  }

  // 配置：后台静默下载，退出时自动安装
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

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

  autoUpdater.on('update-not-available', () => {
    console.log('[更新] 已是最新版本')
    setStatus({ status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      },
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[更新] 更新已下载完成:', info.version)
    setStatus({
      status: 'downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined,
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[更新] 更新出错:', err)
    // 安装过程中的 error 不覆盖 installing 状态，避免干扰退出流程
    if (!isInstalling) {
      setStatus({
        status: 'error',
        error: err.message,
      })
    }
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
    win = null
  })

  console.log('[更新] 自动更新模块已初始化')
}
