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

import { execFileAsync } from './async-command'
import { existsSync } from 'fs'
import { app } from 'electron'
import type { ShellEnvResult } from '@proma/shared'

const PATH_SEP = ';'

export async function readRegistryValue(key: string, valueName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', valueName], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const output = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = output.match(new RegExp(`${escaped}\\s+REG_\\w+\\s+(.+)`, 'i'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

export async function getGitForWindowsInstallPath(): Promise<string | null> {
  let path = await readRegistryValue('HKLM\\SOFTWARE\\GitForWindows', 'InstallPath')
  if (path) return path
  path = await readRegistryValue('HKCU\\SOFTWARE\\GitForWindows', 'InstallPath')
  return path
}

export async function getNodeInstallPathFromRegistry(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  let path = await readRegistryValue('HKLM\\SOFTWARE\\Node.js', 'InstallPath')
  if (path) return path
  path = await readRegistryValue('HKCU\\SOFTWARE\\Node.js', 'InstallPath')
  return path
}

function expandEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, varName: string) => process.env[varName] || `%${varName}%`)
}

function normalizePathForCompare(p: string): string {
  return p.replace(/[/\\]+$/, '').toLowerCase()
}

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

  if (addedCount > 0) process.env.PATH = [...newEntries, ...currentEntries].join(PATH_SEP)
  return addedCount
}

export async function loadWindowsEnv(): Promise<ShellEnvResult> {
  if (process.platform !== 'win32') return { success: true, loadedCount: 0, error: null }
  if (!app.isPackaged) return { success: true, loadedCount: 0, error: null }

  console.log('[Windows 环境] 正在从注册表加载 PATH...')
  try {
    let totalAdded = 0
    const [systemPath, userPath] = await Promise.all([
      readRegistryValue(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
        'Path',
      ),
      readRegistryValue('HKCU\\Environment', 'Path'),
    ])
    if (systemPath) {
      const added = mergeRegistryPath(systemPath)
      totalAdded += added
      console.log(`[Windows 环境] 系统 PATH: 新增 ${added} 个路径`)
    }
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
