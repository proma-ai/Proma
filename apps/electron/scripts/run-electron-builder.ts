#!/usr/bin/env bun
/**
 * electron-builder 包装脚本。
 *
 * 打包前下载内置 cua-driver，并在 Bun workspace 的 node_modules 结构中
 * 直接定位 electron-builder CLI，避免依赖 apps/electron/node_modules/.bin。
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const scriptPath: string = import.meta.path
const electronAppDir = resolve(dirname(scriptPath), '..')
const repoRoot = resolve(electronAppDir, '../..')
const bunDir = join(repoRoot, 'node_modules', '.bun')

function findElectronBuilderCli(): string | undefined {
  if (!existsSync(bunDir)) return undefined
  for (const entry of readdirSync(bunDir)) {
    if (!entry.startsWith('electron-builder@')) continue
    const candidate = join(bunDir, entry, 'node_modules', 'electron-builder', 'cli.js')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const cliPath = findElectronBuilderCli()

if (!cliPath) {
  console.error('[electron-builder] 在 node_modules/.bun/ 中找不到 electron-builder')
  console.error('[electron-builder] 请先运行: bun install')
  process.exit(1)
}

const cliArgs = process.argv.slice(2)
const hasPublish = cliArgs.includes('--publish')
const builderArgs = hasPublish ? cliArgs : [...cliArgs, '--publish', 'never']

function builderTargetPlatform(args: string[]): NodeJS.Platform {
  if (args.includes('--win') || args.includes('-w')) return 'win32'
  if (args.includes('--mac') || args.includes('-m')) return 'darwin'
  if (args.includes('--linux') || args.includes('-l')) return 'linux'
  return process.platform
}

function builderTargetArch(args: string[], platform: NodeJS.Platform): string {
  if (args.includes('--x64')) return 'x64'
  if (args.includes('--arm64')) return 'arm64'
  if (args.includes('--ia32')) return 'ia32'
  if (platform === process.platform && args.includes('--dir')) return process.arch
  return 'all'
}

function downloadBundledCuaDriver(): void {
  if (process.env.PROMA_SKIP_CUA_DRIVER_DOWNLOAD === '1') {
    console.log('[electron-builder] 跳过 Cua Driver 下载 (PROMA_SKIP_CUA_DRIVER_DOWNLOAD=1)')
    return
  }

  const platform = builderTargetPlatform(cliArgs)
  const arch = builderTargetArch(cliArgs, platform)
  console.log(`[electron-builder] 下载 Cua Driver: platform=${platform} arch=${arch}`)
  const result = spawnSync('bun', ['run', 'scripts/download-cua-driver.ts', `--platform=${platform}`, `--arch=${arch}`], {
    stdio: 'inherit',
    cwd: electronAppDir,
    shell: true,
  })
  if (result.status !== 0) {
    console.error('[electron-builder] Cua Driver 下载失败，终止打包')
    process.exit(result.status ?? 1)
  }
}

downloadBundledCuaDriver()

console.log(`[electron-builder] cli: ${cliPath}`)
console.log(`[electron-builder] args: ${builderArgs.join(' ')}`)
console.log('------------------------------------------------------------')

const child = spawn('node', [cliPath, ...builderArgs], {
  stdio: 'inherit',
  cwd: electronAppDir,
  env: {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR:
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  },
  shell: false,
})

const forwardSignal = (sig: NodeJS.Signals): void => {
  if (!child.killed) child.kill(sig)
}
process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code, signal) => {
  console.log('\n[electron-builder] 恢复 workspace 链接 (bun install --force)...')
  spawnSync('bun', ['install', '--force'], {
    stdio: 'inherit',
    shell: true,
    cwd: repoRoot,
  })

  if (signal) {
    process.kill(process.pid, signal as NodeJS.Signals)
  } else {
    process.exit(code ?? 0)
  }
})
