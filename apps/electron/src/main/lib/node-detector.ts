/**
 * Node.js 运行时检测模块
 *
 * 负责检测系统中 Node.js 的可用性和版本信息
 */

import { execFileAsync } from './async-command'
import { existsSync } from 'fs'
import { join } from 'path'
import type { NodeRuntimeStatus } from '@proma/shared'
import { getNodeInstallPathFromRegistry } from './windows-env'

async function findNodePath(): Promise<string | null> {
  try {
    const command = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileAsync(command, ['node'], { encoding: 'utf-8', timeout: 5000 })
    const result = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    const nodePath = result.trim().split('\n')[0]
    if (nodePath && existsSync(nodePath)) return nodePath
  } catch {
    // Node.js 未安装
  }

  if (process.platform === 'win32') {
    const commonPaths: string[] = []
    const regInstallPath = await getNodeInstallPathFromRegistry()
    if (regInstallPath) commonPaths.push(join(regInstallPath, 'node.exe'))

    const scoop = process.env.SCOOP
    const localAppData = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    if (scoop) {
      commonPaths.push(
        join(scoop, 'apps', 'nodejs', 'current', 'node.exe'),
        join(scoop, 'apps', 'nodejs-lts', 'current', 'node.exe'),
        join(scoop, 'shims', 'node.exe'),
      )
    }
    if (localAppData) {
      commonPaths.push(
        join(localAppData, 'scoop', 'apps', 'nodejs', 'current', 'node.exe'),
        join(localAppData, 'scoop', 'apps', 'nodejs-lts', 'current', 'node.exe'),
      )
    }
    commonPaths.push(
      'C:\\ProgramData\\chocolatey\\bin\\node.exe',
      join(programFiles, 'nodejs', 'node.exe'),
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    )
    for (const path of commonPaths) {
      if (existsSync(path)) return path
    }
  }
  return null
}

async function getNodeVersion(nodePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(nodePath, ['--version'], { encoding: 'utf-8', timeout: 5000 })
    const result = typeof stdout === 'string' ? stdout : stdout.toString('utf-8')
    if (result) return result.trim().replace(/^v/, '')
  } catch {
    // 执行失败
  }
  return null
}

function parseVersion(version: string): number[] {
  return version.split('.').map((n) => parseInt(n, 10))
}

function meetsVersion(version: string, target: string): boolean {
  const v = parseVersion(version)
  const t = parseVersion(target)
  for (let i = 0; i < Math.max(v.length, t.length); i++) {
    const vPart = v[i] || 0
    const tPart = t[i] || 0
    if (vPart > tPart) return true
    if (vPart < tPart) return false
  }
  return true
}

export async function detectNodeRuntime(): Promise<NodeRuntimeStatus> {
  console.log('[Node.js 检测] 开始检测 Node.js 运行时...')
  const nodePath = await findNodePath()
  if (!nodePath) {
    console.warn('[Node.js 检测] 未找到 Node.js')
    return { available: false, version: null, path: null, error: '未找到 Node.js。请安装 Node.js 后重试。' }
  }
  const version = await getNodeVersion(nodePath)
  if (!version) {
    console.warn(`[Node.js 检测] Node.js 无法执行: ${nodePath}`)
    return { available: false, version: null, path: nodePath, error: 'Node.js 已找到但无法执行' }
  }
  console.log(`[Node.js 检测] 找到 Node.js: ${nodePath} (${version})`)
  return { available: true, version, path: nodePath, error: null }
}

export function checkNodeVersion(
  version: string,
  minimum = '18.0.0',
  recommended = '22.0.0'
): { meetsMinimum: boolean; meetsRecommended: boolean } {
  return {
    meetsMinimum: meetsVersion(version, minimum),
    meetsRecommended: meetsVersion(version, recommended),
  }
}
