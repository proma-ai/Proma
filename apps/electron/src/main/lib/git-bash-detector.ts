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

/**
 * Git for Windows 常见安装路径
 */
const COMMON_GIT_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
]

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
      const cleanVersion = versionMatch[1].split('(')[0]
      return cleanVersion
    }

    return null
  } catch {
    return null
  }
}

/**
 * 从注册表读取 Git for Windows 安装路径
 *
 * @returns Git 安装根目录路径，失败返回 null
 */
function getGitInstallPathFromRegistry(): string | null {
  try {
    // 尝试从 HKLM（系统级安装）读取
    const hklmOutput = execSync(
      'reg query "HKLM\\SOFTWARE\\GitForWindows" /v InstallPath',
      {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    // 解析注册表输出（示例："InstallPath    REG_SZ    C:\Program Files\Git"）
    const pathMatch = hklmOutput.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (pathMatch?.[1]) {
      return pathMatch[1].trim()
    }
  } catch {
    // HKLM 失败，尝试 HKCU（用户级安装）
    try {
      const hkcuOutput = execSync(
        'reg query "HKCU\\SOFTWARE\\GitForWindows" /v InstallPath',
        {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )

      const pathMatch = hkcuOutput.match(/InstallPath\s+REG_SZ\s+(.+)/)
      if (pathMatch?.[1]) {
        return pathMatch[1].trim()
      }
    } catch {
      // 注册表读取失败
    }
  }

  return null
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
  for (const path of COMMON_GIT_BASH_PATHS) {
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
  const gitInstallPath = getGitInstallPathFromRegistry()
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
