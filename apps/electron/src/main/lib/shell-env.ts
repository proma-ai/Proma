/**
 * macOS Shell 环境变量加载模块
 *
 * 问题背景：
 * macOS 上通过 Finder/Dock 启动的 GUI 应用只继承最小的 launchd 环境，
 * PATH 仅包含 /usr/bin:/bin:/usr/sbin:/sbin，无法访问：
 * - Homebrew 安装的工具（/opt/homebrew/bin）
 * - 用户安装的 Git、Node.js 等
 * - 各种版本管理器（nvm、pyenv 等）
 *
 * 解决方案：
 * 应用启动时运行用户的登录 Shell，提取完整的环境变量
 */

import { execSync } from 'child_process'
import { app } from 'electron'
import type { ShellEnvResult } from '@proma/shared'
import { loadWindowsEnv } from './windows-env'

/**
 * 获取用户默认 Shell 路径
 * 优先使用 SHELL 环境变量，fallback 到 /bin/zsh
 */
export function getUserShell(): string {
  return process.env.SHELL || '/bin/zsh'
}

/**
 * 需要从导入环境中排除的变量
 * 这些变量可能会干扰 Electron 应用的正常运行
 */
const EXCLUDED_ENV_VARS = new Set([
  // Electron/Node 特定变量，不应被覆盖
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  // 开发环境特定变量
  'VITE_DEV_SERVER_URL',
  // Shell 会话特定变量
  'SHLVL',
  'PWD',
  'OLDPWD',
  '_',
  // 可能导致问题的变量
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
])

/**
 * 从 Shell 输出解析环境变量
 */
function parseEnvOutput(output: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = output.split('\n')

  for (const line of lines) {
    // 跳过空行
    if (!line.trim()) continue

    // 找到第一个等号的位置
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue

    const key = line.substring(0, eqIndex)
    const value = line.substring(eqIndex + 1)

    // 跳过被排除的变量
    if (EXCLUDED_ENV_VARS.has(key)) continue

    // 跳过以特定前缀开头的变量
    if (key.startsWith('VITE_')) continue
    if (key.startsWith('npm_')) continue
    if (key.startsWith('BUN_')) continue

    env[key] = value
  }

  return env
}

/**
 * 从用户 Shell 获取完整环境变量
 *
 * @param shell - Shell 可执行文件路径
 * @returns 环境变量键值对
 */
export async function getShellEnv(shell: string): Promise<Record<string, string>> {
  // 使用标记来定位环境变量输出的开始位置
  // 这样可以过滤掉 Shell 启动时的其他输出
  const marker = '__PROMA_ENV_START__'
  const command = `echo ${marker} && env`

  const output = execSync(`${shell} -l -i -c '${command}'`, {
    encoding: 'utf-8',
    timeout: 10000, // 10 秒超时
    env: {
      // 提供最小的初始环境
      HOME: process.env.HOME,
      USER: process.env.USER,
      SHELL: shell,
      TERM: 'xterm-256color',
      // 阻止 macOS 弹出 "安装命令行开发者工具" 对话框
      APPLE_SUPPRESS_DEVELOPER_TOOL_POPUP: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // 找到标记位置，只解析标记之后的内容
  const markerIndex = output.indexOf(marker)
  if (markerIndex === -1) {
    throw new Error('无法找到环境变量输出标记')
  }

  const envSection = output.substring(markerIndex + marker.length)
  return parseEnvOutput(envSection)
}

/**
 * 将环境变量合并到 process.env
 *
 * @param env - 要合并的环境变量
 * @returns 合并的变量数量
 */
function mergeEnvToProcess(env: Record<string, string>): number {
  let count = 0

  for (const [key, value] of Object.entries(env)) {
    // 只在 process.env 中不存在或为空时设置
    // 这样可以保留 Electron 应用自己设置的变量
    if (!process.env[key]) {
      process.env[key] = value
      count++
    }
  }

  // 特殊处理 PATH：合并而非覆盖
  if (env.PATH) {
    const currentPath = process.env.PATH || ''
    const newPaths = env.PATH.split(':')
    const currentPaths = currentPath.split(':')

    // 将新路径添加到现有路径前面（优先级更高）
    const mergedPaths = [...new Set([...newPaths, ...currentPaths])]
    process.env.PATH = mergedPaths.join(':')
  }

  return count
}

/**
 * 常见路径的 fallback 列表
 * 当 Shell 环境加载失败时使用
 */
const FALLBACK_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  `${process.env.HOME}/.local/bin`,
  `${process.env.HOME}/.bun/bin`,
  `${process.env.HOME}/.cargo/bin`,
  `${process.env.HOME}/.nvm/versions/node/*/bin`,
]

/**
 * 应用 fallback 路径
 */
function applyFallbackPaths(): void {
  const currentPath = process.env.PATH || '/usr/bin:/bin'
  const currentPaths = currentPath.split(':')

  // 过滤出实际存在的路径
  const validFallbacks = FALLBACK_PATHS.filter((p) => {
    // 处理通配符路径（如 nvm）
    if (p.includes('*')) return false
    return true
  })

  // 合并路径，去重
  const mergedPaths = [...new Set([...validFallbacks, ...currentPaths])]
  process.env.PATH = mergedPaths.join(':')
}

/**
 * 加载 Shell 环境到 process.env
 *
 * 此函数仅在以下条件下执行：
 * - 运行在 macOS 上
 * - 应用已打包（非开发模式）
 *
 * @returns Shell 环境加载结果
 */
export async function loadShellEnv(): Promise<ShellEnvResult> {
  // Windows：从注册表加载完整 PATH
  if (process.platform === 'win32') {
    return loadWindowsEnv()
  }

  // 仅在 macOS 上执行后续逻辑
  if (process.platform !== 'darwin') {
    return {
      success: true,
      loadedCount: 0,
      error: null,
    }
  }

  // 开发模式下跳过（从终端启动已有完整环境）
  if (!app.isPackaged) {
    return {
      success: true,
      loadedCount: 0,
      error: null,
    }
  }

  const shell = getUserShell()

  try {
    console.log(`[Shell 环境] 正在从 ${shell} 加载环境变量...`)

    const shellEnv = await getShellEnv(shell)
    const loadedCount = mergeEnvToProcess(shellEnv)

    console.log(`[Shell 环境] 成功加载 ${loadedCount} 个环境变量`)

    return {
      success: true,
      loadedCount,
      error: null,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn(`[Shell 环境] 加载失败: ${errorMessage}`)
    console.warn('[Shell 环境] 应用 fallback 路径...')

    // 失败时应用 fallback 路径
    applyFallbackPaths()

    return {
      success: false,
      loadedCount: 0,
      error: errorMessage,
    }
  }
}
