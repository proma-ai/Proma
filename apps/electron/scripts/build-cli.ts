#!/usr/bin/env bun
/**
 * 编译 proma CLI 为自包含二进制，打进桌面构建。
 *
 * 设计：
 * - 用 `bun build --compile` 把 apps/cli 连同其 workspace 依赖
 *   （@proma/session-core / @proma/shared）打成单个自包含可执行档，
 *   用户机器无需安装 bun/node 即可运行。
 * - 输出到 apps/electron/resources/bin/，由 electron-builder 经 extraResources
 *   打进 process.resourcesPath/bin/，运行时由主进程注入 PROMA_CLI 暴露给 skill。
 * - 本机架构编译：CI 每个 runner 即目标平台（mac arm64/x64、win x64、linux），
 *   各自产出宿主架构二进制，与 @anthropic-ai SDK native binary 的分发策略一致，
 *   无需交叉编译。
 *
 * 在 electron app 的 build 链中调用（见 package.json build:cli）。
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const color = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
}

// apps/electron/scripts → repo 根
const electronDir = resolve(import.meta.dir, '..')
const repoRoot = resolve(electronDir, '../..')
const cliEntry = join(repoRoot, 'apps/cli/src/index.ts')

const isWindows = process.platform === 'win32'
const binName = isWindows ? 'proma.exe' : 'proma'
const outDir = join(electronDir, 'resources/bin')
const outFile = join(outDir, binName)

function fail(msg: string): never {
  console.error(`${color.red}${color.bold}[build:cli] ${msg}${color.reset}`)
  process.exit(1)
}

if (!existsSync(cliEntry)) {
  fail(`找不到 CLI 入口: ${cliEntry}`)
}

mkdirSync(outDir, { recursive: true })

console.log(`${color.cyan}[build:cli]${color.reset} 编译 proma CLI → ${color.dim}${outFile}${color.reset}`)

// ── Windows 短路径 workaround ──
// bun build --compile 在 Windows 上尝试复制自身到临时目录时，
// 若 bun.exe 位于过长路径（如 ~/.bun/bin/bun.exe）会报 ENOENT。
// 解决：将 bun.exe 复制到短路径（os.tmpdir()）后通过
// --compile-executable-path 指向副本，编译后清理（try/finally 保证清理）。
let tempBunPath: string | undefined
const compileArgs = ['build', '--compile', '--outfile', outFile, cliEntry]

if (isWindows) {
  const tmpDir = tmpdir()
  const bunName = `bun-temp-${Date.now()}-${process.pid}.exe`
  tempBunPath = join(tmpDir, bunName)

  try {
    copyFileSync(process.execPath, tempBunPath)
    compileArgs.splice(2, 0, '--compile-executable-path', tempBunPath)
    console.log(`${color.dim}[build:cli] Windows 短路径 workaround: ${tempBunPath}${color.reset}`)
  } catch (err) {
    tempBunPath = undefined // copy 失败，无需清理
    console.warn(`${color.yellow}[build:cli] 无法复制 bun 到临时目录: ${err}，尝试直接编译${color.reset}`)
  }
}

const started = Date.now()
try {
  const result = spawnSync(
    'bun',
    compileArgs,
    { cwd: join(repoRoot, 'apps/cli'), stdio: 'inherit' },
  )

  if (result.status !== 0) {
    fail(`bun build --compile 失败（exit ${result.status}）`)
  }
  if (!existsSync(outFile)) {
    fail(`编译完成但未产出二进制: ${outFile}`)
  }
} finally {
  // 始终清理临时 bun 副本
  if (tempBunPath) {
    try {
      unlinkSync(tempBunPath)
    } catch {
      console.warn(`${color.yellow}[build:cli] 无法删除临时 bun 副本: ${tempBunPath}${color.reset}`)
    }
  }
}

const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(0)
const elapsed = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  `${color.green}${color.bold}[build:cli] ✓${color.reset} ${binName} (${sizeMb}MB, ${elapsed}s)`,
)
