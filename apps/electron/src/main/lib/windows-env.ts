/**
 * Windows 环境变量加载模块
 *
 * 问题背景：
 * Windows 上通过桌面快捷方式/开始菜单启动的 GUI 应用，
 * 可能无法继承用户在系统环境变量中配置的完整 PATH。
 * macOS 有 loadShellEnv() 解决此问题，Windows 缺少对应机制。
 *
 * 解决方案：
 * 从 Windows 注册表读取用户级和系统级 PATH，
 * 合并到 process.env.PATH，确保 scoop、chocolatey 等安装的工具可被发现。
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { app } from 'electron'
import type { ShellEnvResult } from '@proma/shared'

/**
 * Windows PATH 分隔符
 */
const PATH_SEP = ';'

/**
 * 从 Windows 注册表读取值
 *
 * @param key - 注册表键路径
 * @param valueName - 值名称
 * @returns 值内容，失败返回 null
 */
export function readRegistryValue(key: string, valueName: string): string | null {
  try {
    const output = execSync(
      `reg query "${key}" /v "${valueName}"`,
      {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = output.match(new RegExp(`${escaped}\\s+REG_\\w+\\s+(.+)`, 'i'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

/**
 * 从注册表读取 Git for Windows 安装路径
 *
 * 检测顺序：HKLM（系统级） → HKCU（用户级）
 *
 * @returns Git 安装目录路径，失败返回 null
 */
export function getGitForWindowsInstallPath(): string | null {
  // HKLM
  let path = readRegistryValue('HKLM\\SOFTWARE\\GitForWindows', 'InstallPath')
  if (path) return path

  // HKCU
  path = readRegistryValue('HKCU\\SOFTWARE\\GitForWindows', 'InstallPath')
  return path
}

/**
 * 从注册表读取 Node.js 安装路径
 *
 * 检测顺序：HKLM（系统级） → HKCU（用户级）
 *
 * @returns Node.js 安装目录路径，失败返回 null
 */
export function getNodeInstallPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null

  // HKLM
  let path = readRegistryValue('HKLM\\SOFTWARE\\Node.js', 'InstallPath')
  if (path) return path

  // HKCU
  path = readRegistryValue('HKCU\\SOFTWARE\\Node.js', 'InstallPath')
  return path
}

/**
 * 展开 Windows 环境变量中的 %VAR% 引用
 *
 * 例如 %SCOOP% → D:\Scoop
 */
function expandEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, varName: string) => {
    return process.env[varName] || `%${varName}%`
  })
}

/**
 * 规范化路径用于去重比较（忽略大小写和尾部斜杠）
 */
function normalizePathForCompare(p: string): string {
  return p.replace(/[/\\]+$/, '').toLowerCase()
}

/**
 * 合并注册表 PATH 到 process.env.PATH
 *
 * 策略：注册表中的路径优先（放在前面），与现有 PATH 合并去重
 *
 * @returns 新增的路径数量
 */
function mergeRegistryPath(registryPath: string): number {
  const currentPath = process.env.PATH || ''
  const currentEntries = currentPath.split(PATH_SEP).filter(Boolean)
  const currentSet = new Set(currentEntries.map(normalizePathForCompare))

  const registryEntries = registryPath
    .split(PATH_SEP)
    .filter(Boolean)
    .map(expandEnvVars)
    .filter((p) => existsSync(p))

  let addedCount = 0
  const newEntries: string[] = []

  for (const entry of registryEntries) {
    const normalized = normalizePathForCompare(entry)
    if (!currentSet.has(normalized)) {
      currentSet.add(normalized)
      newEntries.push(entry)
      addedCount++
    }
  }

  if (addedCount > 0) {
    // 注册表路径放在前面，优先级更高
    process.env.PATH = [...newEntries, ...currentEntries].join(PATH_SEP)
  }

  return addedCount
}

/**
 * 加载 Windows 注册表中的 PATH 到 process.env
 *
 * 从两个注册表位置读取：
 * 1. 用户级 PATH：HKCU\Environment\Path
 * 2. 系统级 PATH：HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path
 *
 * @returns 加载结果
 */
export async function loadWindowsEnv(): Promise<ShellEnvResult> {
  // 仅在 Windows 上执行
  if (process.platform !== 'win32') {
    return { success: true, loadedCount: 0, error: null }
  }

  // 开发模式下跳过（从终端启动，PATH 已完整）
  if (!app.isPackaged) {
    return { success: true, loadedCount: 0, error: null }
  }

  console.log('[Windows 环境] 正在从注册表加载 PATH...')

  try {
    let totalAdded = 0

    // 读取系统 PATH
    const systemPath = readRegistryValue(
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
      'Path',
    )
    if (systemPath) {
      const added = mergeRegistryPath(systemPath)
      totalAdded += added
      console.log(`[Windows 环境] 系统 PATH: 新增 ${added} 个路径`)
    }

    // 读取用户 PATH
    const userPath = readRegistryValue('HKCU\\Environment', 'Path')
    if (userPath) {
      const added = mergeRegistryPath(userPath)
      totalAdded += added
      console.log(`[Windows 环境] 用户 PATH: 新增 ${added} 个路径`)
    }

    console.log(`[Windows 环境] PATH 加载完成，共新增 ${totalAdded} 个路径`)
    return { success: true, loadedCount: totalAdded, error: null }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn(`[Windows 环境] PATH 加载失败: ${errorMessage}`)
    return { success: false, loadedCount: 0, error: errorMessage }
  }
}
