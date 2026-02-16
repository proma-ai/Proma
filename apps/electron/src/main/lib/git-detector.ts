/**
 * Git 运行时检测模块
 *
 * 负责检测系统中 Git 的可用性和获取 Git 仓库状态
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import type { GitRuntimeStatus, GitRepoStatus } from '@proma/shared'

/**
 * 从系统 PATH 查找 Git
 *
 * @returns Git 可执行路径，如果未找到返回 null
 */
function findGitPath(): string | null {
  try {
    const command = process.platform === 'win32' ? 'where git' : 'which git'

    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })

    const gitPath = result.trim().split('\n')[0]

    if (gitPath && existsSync(gitPath)) {
      return gitPath
    }
  } catch {
    // Git 未安装
  }

  // Windows 上额外检查常见安装位置
  if (process.platform === 'win32') {
    const commonPaths = [
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
    ]

    for (const path of commonPaths) {
      if (existsSync(path)) {
        return path
      }
    }
  }

  return null
}

/**
 * 获取 Git 版本号
 *
 * @param gitPath - Git 可执行路径
 * @returns 版本号，如果无法获取返回 null
 */
function getGitVersion(gitPath: string): string | null {
  try {
    const result = spawnSync(gitPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status === 0 && result.stdout) {
      // git version 2.39.0 -> 2.39.0
      const match = result.stdout.match(/git version (\d+\.\d+\.\d+)/)
      return match ? match[1]! : result.stdout.trim()
    }
  } catch {
    // 执行失败
  }

  return null
}

/**
 * 检测 Git 运行时状态
 *
 * @returns Git 运行时状态
 */
export async function detectGitRuntime(): Promise<GitRuntimeStatus> {
  console.log('[Git 检测] 开始检测 Git 运行时...')

  const gitPath = findGitPath()

  if (!gitPath) {
    console.warn('[Git 检测] 未找到 Git')
    return {
      available: false,
      version: null,
      path: null,
      error: '未找到 Git。请安装 Git 后重试。',
    }
  }

  const version = getGitVersion(gitPath)

  if (!version) {
    console.warn(`[Git 检测] Git 无法执行: ${gitPath}`)
    return {
      available: false,
      version: null,
      path: gitPath,
      error: 'Git 已找到但无法执行',
    }
  }

  console.log(`[Git 检测] 找到 Git: ${gitPath} (${version})`)
  return {
    available: true,
    version,
    path: gitPath,
    error: null,
  }
}

/**
 * 执行 Git 命令
 *
 * @param args - Git 命令参数
 * @param cwd - 工作目录
 * @returns 命令输出，如果失败返回 null
 */
function runGitCommand(args: string[], cwd: string): string | null {
  try {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // 禁止 Git 提示输入
        GIT_TERMINAL_PROMPT: '0',
      },
    })

    if (result.status === 0) {
      return result.stdout.trim()
    }
  } catch {
    // 命令执行失败
  }

  return null
}

/**
 * 获取指定目录的 Git 仓库状态
 *
 * @param dirPath - 目录路径
 * @returns Git 仓库状态，如果不是 Git 仓库或出错返回 null
 */
export async function getGitRepoStatus(dirPath: string): Promise<GitRepoStatus | null> {
  // 检查目录是否存在
  if (!existsSync(dirPath)) {
    return null
  }

  // 检查是否为 Git 仓库
  const isRepo = runGitCommand(['rev-parse', '--is-inside-work-tree'], dirPath)

  if (isRepo !== 'true') {
    return {
      isRepo: false,
      branch: null,
      hasChanges: false,
      remoteUrl: null,
    }
  }

  // 获取当前分支
  const branch = runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], dirPath)

  // 检查是否有未提交的更改
  const status = runGitCommand(['status', '--porcelain'], dirPath)
  const hasChanges = status !== null && status.length > 0

  // 获取远程仓库 URL
  const remoteUrl = runGitCommand(['config', '--get', 'remote.origin.url'], dirPath)

  return {
    isRepo: true,
    branch: branch || null,
    hasChanges,
    remoteUrl: remoteUrl || null,
  }
}

/**
 * Windows 上检测 Git Bash 路径
 *
 * @returns Git Bash 路径，如果未找到返回 null
 */
export function detectGitBashWindows(): string | null {
  if (process.platform !== 'win32') {
    return null
  }

  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ]

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return path
    }
  }

  // 尝试使用 where 命令
  try {
    const result = execSync('where bash', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })

    const bashPath = result.trim().split('\n')[0]

    if (bashPath && existsSync(bashPath)) {
      return bashPath
    }
  } catch {
    // 未找到
  }

  return null
}
