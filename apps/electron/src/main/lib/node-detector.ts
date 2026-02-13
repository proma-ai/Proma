/**
 * Node.js 运行时检测模块
 *
 * 负责检测系统中 Node.js 的可用性和版本信息
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import type { NodeRuntimeStatus } from '@proma/shared'

/**
 * 从系统 PATH 查找 Node.js
 *
 * @returns Node.js 可执行路径，如果未找到返回 null
 */
function findNodePath(): string | null {
  try {
    const command = process.platform === 'win32' ? 'where node' : 'which node'

    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })

    const nodePath = result.trim().split('\n')[0]

    if (nodePath && existsSync(nodePath)) {
      return nodePath
    }
  } catch {
    // Node.js 未安装
  }

  // Windows 上额外检查常见安装位置
  if (process.platform === 'win32') {
    const commonPaths = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
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
 * 获取 Node.js 版本号
 *
 * @param nodePath - Node.js 可执行路径
 * @returns 版本号，如果无法获取返回 null
 */
function getNodeVersion(nodePath: string): string | null {
  try {
    const result = spawnSync(nodePath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (result.status === 0 && result.stdout) {
      // v22.13.1 -> 22.13.1
      const version = result.stdout.trim().replace(/^v/, '')
      return version
    }
  } catch {
    // 执行失败
  }

  return null
}

/**
 * 解析版本号为数字数组
 *
 * @param version - 版本号字符串（如 "22.13.1"）
 * @returns 数字数组 [22, 13, 1]
 */
function parseVersion(version: string): number[] {
  return version.split('.').map((n) => parseInt(n, 10))
}

/**
 * 比较版本号
 *
 * @param version - 当前版本
 * @param target - 目标版本
 * @returns 是否满足目标版本（>= target）
 */
function meetsVersion(version: string, target: string): boolean {
  const v = parseVersion(version)
  const t = parseVersion(target)

  for (let i = 0; i < Math.max(v.length, t.length); i++) {
    const vPart = v[i] || 0
    const tPart = t[i] || 0

    if (vPart > tPart) return true
    if (vPart < tPart) return false
  }

  return true // 版本相等
}

/**
 * 检测 Node.js 运行时状态
 *
 * @returns Node.js 运行时状态
 */
export async function detectNodeRuntime(): Promise<NodeRuntimeStatus> {
  console.log('[Node.js 检测] 开始检测 Node.js 运行时...')

  const nodePath = findNodePath()

  if (!nodePath) {
    console.warn('[Node.js 检测] 未找到 Node.js')
    return {
      available: false,
      version: null,
      path: null,
      error: '未找到 Node.js。请安装 Node.js 后重试。',
    }
  }

  const version = getNodeVersion(nodePath)

  if (!version) {
    console.warn(`[Node.js 检测] Node.js 无法执行: ${nodePath}`)
    return {
      available: false,
      version: null,
      path: nodePath,
      error: 'Node.js 已找到但无法执行',
    }
  }

  console.log(`[Node.js 检测] 找到 Node.js: ${nodePath} (${version})`)
  return {
    available: true,
    version,
    path: nodePath,
    error: null,
  }
}

/**
 * 检查 Node.js 版本是否满足要求
 *
 * @param version - Node.js 版本号
 * @param minimum - 最低版本（默认 18）
 * @param recommended - 推荐版本（默认 22）
 * @returns { meetsMinimum, meetsRecommended }
 */
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
