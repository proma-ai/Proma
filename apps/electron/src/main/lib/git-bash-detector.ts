/**
 * Git Bash 环境检测模块（Windows 平台）
 *
 * 负责检测 Git for Windows 安装的 Git Bash 环境：
 * - 检测 bash.exe 可执行文件路径
 * - 验证 Bash 版本
 * - 提供环境可用性状态
 *
 * 检测策略：
 * 1. 常见安装路径（Program Files）
 * 2. 系统 PATH 查找（where bash）
 * 3. 从注册表读取 Git for Windows 安装路径
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GitBashStatus } from '@proma/shared'
import { getGitForWindowsInstallPath } from './windows-env'

/**
 * 获取 Git for Windows 常见安装路径列表
 *
 * 在调用时读取 process.env，确保 loadWindowsEnv() 已执行后路径完整。
 */
function getCommonGitBashPaths(): string[] {
  const paths: string[] = []
  const scoop = process.env.SCOOP
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'

  // 包管理器安装位置（优先检测）
  if (scoop) {
    paths.push(
      join(scoop, 'apps', 'git', 'current', 'bin', 'bash.exe'),
      join(scoop, 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    )
  }
  if (localAppData) {
    paths.push(
      join(localAppData, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
      join(localAppData, 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    )
  }

  // 官方安装器默认位置
  paths.push(
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  )

  return paths
}

/**
 * 验证 bash.exe 路径并获取版本
 *
 * @param bashPath - bash.exe 可执行文件路径
 * @returns Bash 版本号，如果验证失败返回 null
 */
function verifyBashPath(bashPath: string): string | null {
  try {
    if (!existsSync(bashPath)) return null

    // 执行 bash --version 获取版本信息
    const output = execSync(`"${bashPath}" --version`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // 解析版本号（示例输出："GNU bash, version 5.2.15(1)-release (x86_64-pc-msys)"）
    const versionMatch = output.match(/version\s+(\S+)/)
    if (versionMatch?.[1]) {
      // 提取主版本号（如 "5.2.15(1)-release" → "5.2.15"）
      const cleanVersion = versionMatch[1]!.split('(')[0]!
      return cleanVersion
    }

    return null
  } catch {
    return null
  }
}

/**
 * 通过 where 命令查找 bash.exe
 *
 * @returns bash.exe 路径，失败返回 null
 */
function findBashInPath(): string | null {
  try {
    const output = execSync('where bash', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // where 命令可能返回多个路径，取第一个
    const paths = output.trim().split('\n')
    for (const path of paths) {
      const trimmedPath = path.trim()
      // 优先选择包含 "Git" 的路径
      if (trimmedPath.toLowerCase().includes('git')) {
        return trimmedPath
      }
    }

    // 没有 Git 相关路径，返回第一个
    return paths[0]?.trim() || null
  } catch {
    return null
  }
}

/**
 * 检测 Git Bash 环境
 *
 * 检测顺序：
 * 1. 尝试常见安装路径
 * 2. 从注册表读取 Git for Windows 安装路径
 * 3. 通过 where 命令在 PATH 中查找
 *
 * @returns Git Bash 状态
 */
export async function detectGitBash(): Promise<GitBashStatus> {
  // 仅在 Windows 平台执行
  if (process.platform !== 'win32') {
    return {
      available: false,
      path: null,
      version: null,
      error: '非 Windows 平台',
    }
  }

  // 策略 1：检查常见安装路径
  for (const path of getCommonGitBashPaths()) {
    const version = verifyBashPath(path)
    if (version) {
      console.log(`[Git Bash 检测] 找到 Git Bash (常见路径): ${path} (${version})`)
      return {
        available: true,
        path,
        version,
        error: null,
      }
    }
  }

  // 策略 2：从注册表读取安装路径
  const gitInstallPath = getGitForWindowsInstallPath()
  if (gitInstallPath) {
    const candidatePaths = [
      join(gitInstallPath, 'bin', 'bash.exe'),
      join(gitInstallPath, 'usr', 'bin', 'bash.exe'),
    ]

    for (const path of candidatePaths) {
      const version = verifyBashPath(path)
      if (version) {
        console.log(`[Git Bash 检测] 找到 Git Bash (注册表): ${path} (${version})`)
        return {
          available: true,
          path,
          version,
          error: null,
        }
      }
    }
  }

  // 策略 3：通过 where 命令查找
  const pathBash = findBashInPath()
  if (pathBash) {
    const version = verifyBashPath(pathBash)
    if (version) {
      console.log(`[Git Bash 检测] 找到 Git Bash (PATH): ${pathBash} (${version})`)
      return {
        available: true,
        path: pathBash,
        version,
        error: null,
      }
    }
  }

  // 所有策略失败
  console.warn('[Git Bash 检测] 未找到可用的 Git Bash 环境')
  return {
    available: false,
    path: null,
    version: null,
    error: '未找到 Git Bash 环境，请安装 Git for Windows',
  }
}
