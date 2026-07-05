/**
 * 文件系统操作重试工具模块
 *
 * 提供 Windows 上因 fs.watch 句柄延迟释放导致的 EBUSY/EPERM 等
 * 可重试文件系统错误的统一重试逻辑，供全仓复用。
 */

import { rmSync, renameSync, cpSync, existsSync, type RmOptions } from 'node:fs'

/**
 * Windows 上 fs.watch 递归监听持有的句柄释放是毫秒级延迟，
 * rmSync/renameSync 可能抛 EBUSY/EPERM/EACCES/ENOTEMPTY，这些错误可重试。
 * 注意：EPERM/EACCES 在非 Windows 平台通常是真实的权限拒绝，不应重试，故按平台区分。
 *
 * @internal — 仅在模块内部使用，通过 rmSyncWithRetry / renameWithRetry 间接暴露重试逻辑
 */
const RETRYABLE_FS_CODES = new Set(
  process.platform === 'win32'
    ? ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']
    : ['EBUSY', 'ENOTEMPTY'],
)

/**
 * 同步阻塞等待指定毫秒数。优先用 Atomics.wait（不占 CPU），
 * SharedArrayBuffer 不可用时降级为 busy-wait。
 *
 * @internal — 仅在 rmSyncWithRetry 内部使用，不导出
 */
function sleepSync(ms: number): void {
  try {
    const buf = new Int32Array(new SharedArrayBuffer(4))
    Atomics.wait(buf, 0, 0, ms)
  } catch {
    const start = Date.now()
    while (Date.now() - start < ms) { /* busy wait fallback */ }
  }
}

/**
 * 带退避重试的 rmSync。
 *
 * 在 Windows 上删除被 fs.watch 递归监听的目录时，可能因句柄尚未释放而抛出
 * EBUSY / EPERM / ENOTEMPTY。带指数退避重试以等待 watcher 释放句柄。
 *
 * 仅对 RETRYABLE_FS_CODES 中的错误进行重试，其他错误直接抛出。
 *
 * 阻塞策略：优先用 Atomics.wait 同步等待（不占 CPU）；
 * SharedArrayBuffer 不可用时降级为 busy-wait。最坏情况累计 750ms 同步阻塞，
 * 这是为保持函数同步签名所做的取舍。
 *
 * @param target    目标路径
 * @param options   rmSync 选项
 * @param maxAttempts  最大重试次数，默认 5（指数退避: 50ms → 100ms → 200ms → 400ms）
 *
 * @public — 全仓任何需要删除目录/文件的位置都应优先使用本函数替代裸 rmSync
 */
export function rmSyncWithRetry(
  target: string,
  options: RmOptions,
  maxAttempts = 5,
): void {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(target, options)
      return
    } catch (err) {
      lastErr = err
      const code = (err as NodeJS.ErrnoException)?.code
      if (!code || !RETRYABLE_FS_CODES.has(code)) throw err
      if (attempt === maxAttempts) break
      // 指数退避: 50ms, 100ms, 200ms, 400ms — 累计 750ms 内重试 5 次
      const delayMs = 50 * Math.pow(2, attempt - 1)
      sleepSync(delayMs)
    }
  }
  throw lastErr
}

/**
 * 带降级策略的 renameSync 封装。
 *
 * 优先使用 renameSync（原子、快速、无需复制）。
 * 捕获 EXDEV（跨设备）或 RETRYABLE_FS_CODES 命中（Windows fs.watch 句柄占用）
 * 时自动降级为 cpSync + rmSyncWithRetry，cpSync 成功后若 rmSync 失败则回滚目标副本。
 *
 * 降级路径会先清理已存在的 destPath 以匹配 rename 的"替换"语义
 * （原生 renameSync 在 destPath 已存在且非空时抛 ENOTEMPTY/EEXIST）。
 *
 * @param srcPath   源路径
 * @param destPath  目标路径（若已存在将被替换）
 *
 * @public — 全仓任何需要 renameSync 的位置都应优先使用本函数
 */
export function renameWithRetry(srcPath: string, destPath: string): void {
  try {
    renameSync(srcPath, destPath)
  } catch (renameErr) {
    const code = (renameErr as NodeJS.ErrnoException)?.code
    // 非跨设备且非可重试的文件占用错误 → 真实错误，直接抛出
    if (code !== 'EXDEV' && !(code && RETRYABLE_FS_CODES.has(code))) throw renameErr
    // 降级：确保目标不存在以匹配 rename 替换语义（cpSync 默认是合并）
    if (existsSync(destPath)) {
      rmSyncWithRetry(destPath, { recursive: true, force: true })
    }
    // 降级：复制后删除源目录；rmSync 仍可能因 watcher 句柄未释放抛错，带退避重试
    try {
      cpSync(srcPath, destPath, { recursive: true, force: true })
      rmSyncWithRetry(srcPath, { recursive: true, force: true })
    } catch (moveErr) {
      // cpSync 成功但 rmSync 失败：回滚 destPath 副本，保证失败语义干净
      try {
        rmSyncWithRetry(destPath, { recursive: true, force: true })
      } catch (rollbackErr) {
        console.warn(`[fs-retry] 回滚目标目录失败:`, rollbackErr)
      }
      throw moveErr
    }
  }
}
