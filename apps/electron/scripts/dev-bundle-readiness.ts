import { existsSync, statSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEV_BUNDLE_RELATIVE_PATHS = [
  'dist/main.cjs',
  'dist/agent-runtime.cjs',
  'dist/preload.cjs',
] as const

interface WaitForDevBundlesOptions {
  root?: string
  timeoutMs?: number
  pollIntervalMs?: number
}

const electronRoot = resolve(import.meta.dir, '..')

function isReadyBundle(path: string): boolean {
  if (!existsSync(path)) return false

  try {
    const stat = statSync(path)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

/**
 * 清理上一轮构建产物，确保 readiness 只会由本轮 esbuild watcher 满足。
 */
export function prepareDevBundles(root = electronRoot): void {
  for (const relativePath of DEV_BUNDLE_RELATIVE_PATHS) {
    const bundlePath = resolve(root, relativePath)
    if (existsSync(bundlePath)) unlinkSync(bundlePath)
  }
}

/**
 * 等待三个 watcher 完成首次构建，再允许 electronmon 启动 Electron。
 */
export async function waitForDevBundles(options: WaitForDevBundlesOptions = {}): Promise<void> {
  const root = options.root ?? electronRoot
  const timeoutMs = options.timeoutMs ?? 30_000
  const pollIntervalMs = options.pollIntervalMs ?? 25
  const startedAt = Date.now()

  while (true) {
    const pendingBundles = DEV_BUNDLE_RELATIVE_PATHS.filter((relativePath) => (
      !isReadyBundle(resolve(root, relativePath))
    ))
    if (pendingBundles.length === 0) return

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`等待开发态 bundle 超时: ${pendingBundles.join(', ')}`)
    }

    await Bun.sleep(pollIntervalMs)
  }
}

if (import.meta.main) {
  const command = process.argv[2]

  if (command === '--prepare') {
    prepareDevBundles()
    console.log('[开发启动] 已清理旧 bundle，等待 watcher 首次构建')
  } else if (command === '--wait') {
    await waitForDevBundles()
    console.log('[开发启动] watcher 首次构建完成，启动 Electron')
  } else {
    throw new Error('用法: bun run scripts/dev-bundle-readiness.ts --prepare | --wait')
  }
}
