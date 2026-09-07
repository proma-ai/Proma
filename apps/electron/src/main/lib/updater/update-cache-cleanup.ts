import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { gte, valid } from 'semver'
import { readJsonFileSafe, writeJsonFileAtomic } from '../safe-file'

/** macOS 差分更新基线的最长保留时间。 */
export const MAC_DIFFERENTIAL_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000

const CACHE_STATE_VERSION = 2
const PENDING_DIRECTORY_NAME = 'pending'
const MAC_DIFFERENTIAL_CACHE_FILES = ['update.zip', 'current.blockmap'] as const

interface PendingUpdateCacheState {
  targetVersion: string
  downloadedFile: string
  pendingDirectory: string
  cacheDirectory: string
  platform: string
  downloadedAt: number
}

interface MacDifferentialCacheState {
  cacheDirectory: string
  expiresAt: number
}

interface UpdateCacheState {
  schemaVersion: typeof CACHE_STATE_VERSION
  pendingUpdate?: PendingUpdateCacheState
  macDifferentialCache?: MacDifferentialCacheState
}

export interface UpdateCacheCleanupResult {
  status: 'not-needed' | 'retained' | 'cleaned' | 'skipped-unsafe' | 'failed'
  deletedCount: number
}

/** pending 为 electron-updater 的共享目录，下载期间必须禁止任何清理。 */
export function shouldDeferUpdateCacheCleanup(hasActiveDownload: boolean, isDownloading: boolean): boolean {
  return hasActiveDownload || isDownloading
}

export interface UpdateCacheCleanupOptions {
  /** Proma 自己拥有的状态文件，不写入 electron-updater 的私有状态。 */
  stateFilePath: string
  /** electron-updater 使用的系统级缓存根目录。 */
  baseCacheDirectory: string
  platform?: NodeJS.Platform
  now?: () => number
  log?: Pick<Console, 'info' | 'warn'>
}

/**
 * 计算 electron-updater 的默认缓存根目录。
 *
 * 应只在运行平台调用；测试可通过 UpdateCacheCleanupOptions 注入固定目录。
 */
export function getDefaultUpdaterBaseCacheDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  if (platform === 'win32') {
    return environment.LOCALAPPDATA || join(homeDirectory, 'AppData', 'Local')
  }
  if (platform === 'darwin') {
    return join(homeDirectory, 'Library', 'Caches')
  }
  return environment.XDG_CACHE_HOME || join(homeDirectory, '.cache')
}

/**
 * 为 electron-updater 缓存建立显式生命周期：
 *
 * - 待安装包只会在目标版本成功启动后删除；
 * - macOS 的差分下载基线与待安装包状态独立持久化；
 * - 所有删除都限制在 electron-updater 实际下载文件所在的 pending 目录；
 * - 缓存状态是 best-effort，绝不能影响 update-downloaded 事件或安装能力。
 */
export function createUpdateCacheCleanup(options: UpdateCacheCleanupOptions) {
  const platform = options.platform ?? process.platform
  const now = options.now ?? Date.now
  const log = options.log ?? console
  const stateFilePath = resolve(options.stateFilePath)
  const baseCacheDirectory = resolve(options.baseCacheDirectory)

  function recordDownloadedUpdate(targetVersion: string, downloadedFile: string): boolean {
    try {
      const downloadedFilePath = resolve(downloadedFile)
      const pendingDirectory = dirname(downloadedFilePath)
      const cacheDirectory = dirname(pendingDirectory)

      if (!isSafeManagedPendingDirectory(pendingDirectory, cacheDirectory, baseCacheDirectory) || !hasRegularFile(downloadedFilePath)) {
        log.warn(`[更新缓存] 跳过记录未验证的下载路径: ${downloadedFilePath}`)
        return false
      }

      const state = readState(stateFilePath) ?? createEmptyState()
      state.pendingUpdate = {
        targetVersion,
        downloadedFile: downloadedFilePath,
        pendingDirectory,
        cacheDirectory,
        platform,
        downloadedAt: now(),
      }
      return persistState(state)
    } catch (error) {
      // updater 安装包已可用；无法记录清理元数据不应将它变成下载失败。
      log.warn(`[更新缓存] 无法记录下载缓存状态，将跳过后续自动清理: ${String(error)}`)
      return false
    }
  }

  function cleanupForRunningVersion(runningVersion: string): UpdateCacheCleanupResult {
    const state = readState(stateFilePath)
    if (state === null) return { status: 'not-needed', deletedCount: 0 }

    let deletedCount = 0
    let didChangeState = false
    let didSkipUnsafePath = false
    let didFail = false

    // macOS 差分缓存独立于 pending 状态处理，避免被下一次待安装更新覆盖 TTL。
    if (state.macDifferentialCache) {
      const macResult = cleanupExpiredMacDifferentialCache(state.macDifferentialCache)
      deletedCount += macResult.deletedCount
      if (macResult.status === 'cleaned') {
        state.macDifferentialCache = undefined
        didChangeState = true
      } else if (macResult.status === 'skipped-unsafe') {
        state.macDifferentialCache = undefined
        didChangeState = true
        didSkipUnsafePath = true
      } else if (macResult.status === 'failed') {
        didFail = true
      }
    }

    if (state.pendingUpdate) {
      const pending = state.pendingUpdate
      if (!isSafePendingState(pending, baseCacheDirectory)) {
        log.warn('[更新缓存] 清理状态中的 pending 路径未通过安全校验，已放弃清理')
        state.pendingUpdate = undefined
        didChangeState = true
        didSkipUnsafePath = true
      } else if (!isVersionAtLeast(runningVersion, pending.targetVersion)) {
        // 尚未切换到目标版本时，待安装包仍可能用于重试，绝不能删除。
      } else {
        const removal = removePendingDirectory(pending.pendingDirectory, pending.cacheDirectory, baseCacheDirectory)
        deletedCount += removal.deletedCount

        if (removal.status === 'removed' || removal.status === 'absent') {
          log.info(`[更新缓存] 已确认运行 v${runningVersion}，清理 ${removal.deletedCount} 个已安装更新文件`)
          state.pendingUpdate = undefined
          didChangeState = true

          // update.zip 是 macOS 未来差分下载的唯一基线，保留一份且设置明确的失效期。
          if (platform === 'darwin' && pending.platform === 'darwin' && hasRegularFile(join(pending.cacheDirectory, 'update.zip'))) {
            state.macDifferentialCache = {
              cacheDirectory: pending.cacheDirectory,
              expiresAt: now() + MAC_DIFFERENTIAL_CACHE_TTL_MS,
            }
          }
        } else if (removal.status === 'unsafe') {
          didSkipUnsafePath = true
        } else {
          // 文件被 Defender / 索引器等占用时保留状态，下次启动再尝试。
          didFail = true
        }
      }
    }

    if (didChangeState) {
      if (hasStateEntries(state)) {
        if (!persistState(state)) didFail = true
      } else if (!removeStateFile(stateFilePath)) {
        didFail = true
      }
    }

    if (didSkipUnsafePath) return { status: 'skipped-unsafe', deletedCount }
    if (didFail) return { status: 'failed', deletedCount }
    if (deletedCount > 0 || didChangeState) return { status: 'cleaned', deletedCount }
    return { status: 'retained', deletedCount }
  }

  function cleanupExpiredMacDifferentialCache(state: MacDifferentialCacheState): UpdateCacheCleanupResult {
    if (platform !== 'darwin' || !isSafeManagedCacheDirectory(state.cacheDirectory, baseCacheDirectory)) {
      return { status: 'skipped-unsafe', deletedCount: 0 }
    }

    if (!Number.isFinite(state.expiresAt) || now() < state.expiresAt) {
      return { status: 'retained', deletedCount: 0 }
    }

    let deletedCount = 0
    for (const fileName of MAC_DIFFERENTIAL_CACHE_FILES) {
      const result = removeRegularFile(join(state.cacheDirectory, fileName))
      if (result === 'removed') deletedCount += 1
      if (result === 'failed') return { status: 'failed', deletedCount }
    }
    log.info(`[更新缓存] 已回收 ${deletedCount} 个过期的 macOS 差分更新缓存文件`)
    return { status: 'cleaned', deletedCount }
  }

  function persistState(state: UpdateCacheState): boolean {
    try {
      mkdirSync(dirname(stateFilePath), { recursive: true })
      writeJsonFileAtomic(stateFilePath, state)
      return true
    } catch (error) {
      log.warn(`[更新缓存] 无法持久化缓存状态: ${String(error)}`)
      return false
    }
  }

  return { recordDownloadedUpdate, cleanupForRunningVersion }
}

function createEmptyState(): UpdateCacheState {
  return { schemaVersion: CACHE_STATE_VERSION }
}

function hasStateEntries(state: UpdateCacheState): boolean {
  return state.pendingUpdate !== undefined || state.macDifferentialCache !== undefined
}

function readState(filePath: string): UpdateCacheState | null {
  const value = readJsonFileSafe<unknown>(filePath)
  if (!isRecord(value) || value.schemaVersion !== CACHE_STATE_VERSION) return null

  const state = createEmptyState()
  if (isPendingUpdateCacheState(value.pendingUpdate)) state.pendingUpdate = value.pendingUpdate
  if (isMacDifferentialCacheState(value.macDifferentialCache)) state.macDifferentialCache = value.macDifferentialCache
  return hasStateEntries(state) ? state : null
}

function isPendingUpdateCacheState(value: unknown): value is PendingUpdateCacheState {
  return (
    isRecord(value)
    && typeof value.targetVersion === 'string'
    && typeof value.downloadedFile === 'string'
    && typeof value.pendingDirectory === 'string'
    && typeof value.cacheDirectory === 'string'
    && typeof value.platform === 'string'
    && typeof value.downloadedAt === 'number'
  )
}

function isMacDifferentialCacheState(value: unknown): value is MacDifferentialCacheState {
  return isRecord(value) && typeof value.cacheDirectory === 'string' && typeof value.expiresAt === 'number'
}

function isSafePendingState(state: PendingUpdateCacheState, baseCacheDirectory: string): boolean {
  return (
    isAbsolute(state.downloadedFile)
    && isAbsolute(state.pendingDirectory)
    && isAbsolute(state.cacheDirectory)
    && resolve(dirname(state.downloadedFile)) === resolve(state.pendingDirectory)
    && isSafeManagedPendingDirectory(state.pendingDirectory, state.cacheDirectory, baseCacheDirectory)
  )
}

function isSafeManagedPendingDirectory(pendingDirectory: string, cacheDirectory: string, baseCacheDirectory: string): boolean {
  return (
    basename(pendingDirectory) === PENDING_DIRECTORY_NAME
    && resolve(dirname(pendingDirectory)) === resolve(cacheDirectory)
    && isSafeManagedCacheDirectory(cacheDirectory, baseCacheDirectory)
    && isPlainDirectory(pendingDirectory)
  )
}

/** 缓存目录必须是系统缓存根的直接普通子目录；拒绝软链接和 Windows junction。 */
function isSafeManagedCacheDirectory(cacheDirectory: string, baseCacheDirectory: string): boolean {
  if (!isAbsolute(cacheDirectory) || resolve(dirname(cacheDirectory)) !== resolve(baseCacheDirectory)) return false
  if (!isPlainDirectory(baseCacheDirectory) || !isPlainDirectory(cacheDirectory)) return false

  try {
    const realBaseCacheDirectory = resolve(realpathSync(baseCacheDirectory))
    return resolve(realpathSync(dirname(cacheDirectory))) === realBaseCacheDirectory
      && resolve(dirname(realpathSync(cacheDirectory))) === realBaseCacheDirectory
  } catch {
    return false
  }
}

function isVersionAtLeast(runningVersion: string, targetVersion: string): boolean {
  const running = valid(runningVersion)
  const target = valid(targetVersion)
  return running !== null && target !== null && gte(running, target)
}

type PendingRemovalResult = {
  status: 'removed' | 'absent' | 'failed' | 'unsafe'
  deletedCount: number
}

/**
 * 仅删除 pending 中的普通文件，目录、软链接和 junction 一律保留并下次重试。
 * electron-updater 的安装器、web-installer package、元数据和临时文件均为普通文件。
 */
function removePendingDirectory(
  pendingDirectory: string,
  cacheDirectory: string,
  baseCacheDirectory: string,
): PendingRemovalResult {
  if (!existsSync(pendingDirectory)) return { status: 'absent', deletedCount: 0 }
  if (!isSafeManagedPendingDirectory(pendingDirectory, cacheDirectory, baseCacheDirectory)) {
    return { status: 'unsafe', deletedCount: 0 }
  }

  let deletedCount = 0
  try {
    for (const entry of readdirSync(pendingDirectory)) {
      const entryPath = join(pendingDirectory, entry)
      if (!hasRegularFile(entryPath)) return { status: 'unsafe', deletedCount }
      unlinkSync(entryPath)
      deletedCount += 1
    }

    // 删除前再次验证父路径，缩小路径被替换的竞态窗口。
    if (!isSafeManagedPendingDirectory(pendingDirectory, cacheDirectory, baseCacheDirectory)) {
      return { status: 'unsafe', deletedCount }
    }
    rmdirSync(pendingDirectory)
    return { status: 'removed', deletedCount }
  } catch {
    return { status: 'failed', deletedCount }
  }
}

function isPlainDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function hasRegularFile(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

type RegularFileRemovalResult = 'removed' | 'absent' | 'failed'

function removeRegularFile(filePath: string): RegularFileRemovalResult {
  if (!existsSync(filePath)) return 'absent'
  if (!hasRegularFile(filePath)) return 'failed'
  try {
    unlinkSync(filePath)
    return 'removed'
  } catch {
    return 'failed'
  }
}

function removeStateFile(filePath: string): boolean {
  // safe-file 会保留 .bak；状态完成后必须一并清理，避免下次读取时回退并复活旧状态。
  let failed = false
  for (const candidate of [filePath, `${filePath}.tmp`, `${filePath}.bak`]) {
    try {
      unlinkSync(candidate)
    } catch (error) {
      if (!isNotFoundError(error)) failed = true
    }
  }
  return !failed
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
