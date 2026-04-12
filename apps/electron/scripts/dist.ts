#!/usr/bin/env bun
/**
 * 可视化打包脚本
 *
 * 功能：
 * - 分步执行打包流程，每步带计时和状态指示
 * - 支持只构建当前架构（--current-arch）加速开发测试
 * - 支持详细输出模式（--verbose）查看 electron-builder 完整日志
 * - 支持跳过代码签名（--no-sign）
 * - 支持只构建 DMG 或 ZIP（--dmg / --zip）
 *
 * 使用：
 * bun run scripts/dist.ts                          # 完整打包（双架构 + DMG + ZIP）
 * bun run scripts/dist.ts --current-arch            # 只构建当前架构（快速）
 * bun run scripts/dist.ts --current-arch --verbose   # 当前架构 + 详细日志
 * bun run scripts/dist.ts --current-arch --dmg       # 当前架构 + 只构建 DMG
 * bun run scripts/dist.ts --no-sign                 # 跳过代码签名
 */

import { spawnSync } from 'child_process'
import { join } from 'path'

// ============================================
// 类型定义
// ============================================

interface StepResult {
  name: string
  duration: number
  success: boolean
  skipped: boolean
}

interface DistOptions {
  currentArch: boolean
  verbose: boolean
  noSign: boolean
  targetFormat: 'all' | 'dmg' | 'zip' | 'dir'
  platform: 'mac' | 'win' | 'linux'
}

// ============================================
// 工具函数
// ============================================

/** ANSI 颜色代码 */
const color = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
}

/** 格式化时间 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = ((ms % 60000) / 1000).toFixed(0)
  return `${min}m${sec}s`
}

/** 打印分隔线 */
function printSeparator(): void {
  console.log(`${color.dim}${'─'.repeat(60)}${color.reset}`)
}

/** 打印步骤开始 */
function printStepStart(step: number, total: number, name: string): void {
  console.log(
    `\n${color.bgBlue}${color.bold} 步骤 ${step}/${total} ${color.reset} ${color.cyan}${name}${color.reset}`
  )
  printSeparator()
}

/** 打印步骤结果 */
function printStepResult(result: StepResult): void {
  if (result.skipped) {
    console.log(
      `${color.bgYellow}${color.bold} 跳过 ${color.reset} ${result.name} ${color.dim}(已跳过)${color.reset}`
    )
    return
  }
  const icon = result.success
    ? `${color.bgGreen}${color.bold} 完成 ${color.reset}`
    : `${color.bgRed}${color.bold} 失败 ${color.reset}`
  const time = `${color.dim}(${formatDuration(result.duration)})${color.reset}`
  console.log(`${icon} ${result.name} ${time}`)
}

/** 执行命令并计时 */
function runStep(
  name: string,
  command: string,
  args: string[],
  options: { verbose: boolean; env?: Record<string, string>; skip?: boolean }
): StepResult {
  if (options.skip) {
    return { name, duration: 0, success: true, skipped: true }
  }

  const start = Date.now()
  const stdio = options.verbose ? 'inherit' : 'pipe'

  const result = spawnSync(command, args, {
    stdio: [stdio, stdio, 'inherit'], // 始终显示 stderr
    cwd: join(import.meta.dir, '..'),
    env: { ...process.env, ...options.env },
    shell: true,
  })

  const duration = Date.now() - start

  if (result.status !== 0 && !options.verbose && result.stdout) {
    // 非 verbose 模式失败时，打印 stdout 帮助排查
    console.log(result.stdout.toString())
  }

  return { name, duration, success: result.status === 0, skipped: false }
}

// ============================================
// 主流程
// ============================================

function parseArgs(): DistOptions {
  const args = process.argv.slice(2)
  return {
    currentArch: args.includes('--current-arch'),
    verbose: args.includes('--verbose'),
    noSign: args.includes('--no-sign'),
    targetFormat: args.includes('--dmg')
      ? 'dmg'
      : args.includes('--zip')
        ? 'zip'
        : args.includes('--dir')
          ? 'dir'
          : 'all',
    platform: args.includes('--win')
      ? 'win'
      : args.includes('--linux')
        ? 'linux'
        : 'mac',
  }
}

function main(): void {
  const opts = parseArgs()
  const arch = process.arch // arm64 或 x64
  const results: StepResult[] = []

  // 打印配置信息
  console.log(`\n${color.bgBlue}${color.bold} Proma 打包工具 ${color.reset}\n`)
  console.log(`  ${color.bold}平台${color.reset}:     ${opts.platform}`)
  console.log(`  ${color.bold}架构${color.reset}:     ${opts.currentArch ? arch + ' (仅当前)' : 'arm64 + x64'}`)
  console.log(`  ${color.bold}格式${color.reset}:     ${opts.targetFormat}`)
  console.log(`  ${color.bold}签名${color.reset}:     ${opts.noSign ? '跳过' : '启用'}`)
  console.log(`  ${color.bold}详细日志${color.reset}: ${opts.verbose ? '开启' : '关闭'}`)
  printSeparator()

  const totalSteps = 5
  let step = 0

  // ── 步骤 1: 构建主进程 ──
  step++
  printStepStart(step, totalSteps, '构建主进程 (esbuild)')
  results.push(
    runStep('构建主进程', 'bun', ['run', 'build:main'], { verbose: opts.verbose })
  )
  printStepResult(results[results.length - 1])
  if (!results[results.length - 1].success) return printSummary(results)

  // ── 步骤 2: 构建 Preload ──
  step++
  printStepStart(step, totalSteps, '构建 Preload (esbuild)')
  results.push(
    runStep('构建 Preload', 'bun', ['run', 'build:preload'], { verbose: opts.verbose })
  )
  printStepResult(results[results.length - 1])
  if (!results[results.length - 1].success) return printSummary(results)

  // ── 步骤 3: 构建渲染进程 ──
  step++
  printStepStart(step, totalSteps, '构建渲染进程 (Vite)')
  results.push(
    runStep('构建渲染进程', 'bun', ['run', 'build:renderer'], { verbose: opts.verbose })
  )
  printStepResult(results[results.length - 1])
  if (!results[results.length - 1].success) return printSummary(results)

  // ── 步骤 4: 复制资源文件 ──
  step++
  printStepStart(step, totalSteps, '复制资源文件')
  results.push(
    runStep('复制资源文件', 'bun', ['run', 'build:resources'], { verbose: opts.verbose })
  )
  printStepResult(results[results.length - 1])

  // ── 步骤 5: electron-builder 打包 ──
  step++
  printStepStart(step, totalSteps, 'Electron Builder 打包')

  const builderArgs = ['electron-builder', `--${opts.platform}`]

  // 只构建当前架构
  if (opts.currentArch) {
    builderArgs.push(`--${arch}`)
  }

  // 指定输出格式
  if (opts.targetFormat === 'dmg') {
    builderArgs.push('--config.mac.target=dmg')
  } else if (opts.targetFormat === 'zip') {
    builderArgs.push('--config.mac.target=zip')
  } else if (opts.targetFormat === 'dir') {
    builderArgs.push('--dir')
  }

  // 签名环境变量
  const builderEnv: Record<string, string> = {}
  if (opts.noSign) {
    builderEnv['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false'
  }
  if (opts.verbose) {
    builderEnv['DEBUG'] = 'electron-builder,electron-builder:*'
  }

  results.push(
    runStep('Electron Builder', 'bunx', builderArgs, {
      verbose: true, // 打包步骤始终显示输出
      env: builderEnv,
    })
  )
  printStepResult(results[results.length - 1])

  printSummary(results)
}

/** 打印汇总报告 */
function printSummary(results: StepResult[]): void {
  console.log(`\n${color.bgBlue}${color.bold} 打包汇总 ${color.reset}\n`)

  const totalTime = results.reduce((sum, r) => sum + r.duration, 0)
  const allSuccess = results.every((r) => r.success)

  // 各步骤耗时表
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${color.dim}○${color.reset} ${r.name.padEnd(20)} ${color.dim}跳过${color.reset}`)
      continue
    }
    const icon = r.success ? `${color.green}●${color.reset}` : `${color.red}●${color.reset}`
    const bar = r.duration > 0 ? '█'.repeat(Math.min(Math.ceil(r.duration / 1000), 30)) : ''
    const barColor = r.duration > 30000 ? color.red : r.duration > 10000 ? color.yellow : color.green
    console.log(
      `  ${icon} ${r.name.padEnd(20)} ${barColor}${bar}${color.reset} ${formatDuration(r.duration)}`
    )
  }

  printSeparator()
  const statusIcon = allSuccess
    ? `${color.bgGreen}${color.bold} 成功 ${color.reset}`
    : `${color.bgRed}${color.bold} 失败 ${color.reset}`
  console.log(`  ${statusIcon}  总耗时: ${color.bold}${formatDuration(totalTime)}${color.reset}\n`)

  process.exit(allSuccess ? 0 : 1)
}

main()
