/**
 * 环境检测服务
 *
 * 整合 Node.js 和 Git 检测，提供统一的环境检测接口
 */

import type { EnvironmentCheckResult } from '@proma/shared'
import { detectNodeRuntime, checkNodeVersion } from './node-detector'
import { detectGitRuntime } from './git-detector'

/**
 * 获取下载链接
 *
 * @param platform - 操作系统平台
 * @returns 下载链接对象
 */
function getDownloadUrls(platform: NodeJS.Platform): {
  nodejs: string
  git: string
} {
  const NODEJS_VERSION = '22.13.1'

  switch (platform) {
    case 'darwin':
      return {
        nodejs: `https://nodejs.org/dist/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}.pkg`,
        git: 'https://git-scm.com/download/mac',
      }
    case 'win32':
      return {
        nodejs: `https://nodejs.org/dist/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}-x64.msi`,
        git: 'https://github.com/git-for-windows/git/releases/latest',
      }
    case 'linux':
      return {
        nodejs: 'https://nodejs.org/en/download/',
        git: 'https://git-scm.com/download/linux',
      }
    default:
      return {
        nodejs: 'https://nodejs.org/',
        git: 'https://git-scm.com/',
      }
  }
}

/**
 * 比较版本号
 *
 * @param version - 当前版本
 * @param target - 目标版本
 * @returns 是否满足目标版本（>= target）
 */
function meetsVersion(version: string, target: string): boolean {
  const parseVersion = (v: string): number[] => {
    return v.split('.').map((n) => parseInt(n, 10))
  }

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

/**
 * 执行完整的环境检测
 *
 * @returns 环境检测结果
 */
export async function checkEnvironment(): Promise<EnvironmentCheckResult> {
  console.log('[环境检测] 开始检测运行环境...')

  const platform = process.platform as 'darwin' | 'win32' | 'linux'
  const downloadUrls = getDownloadUrls(platform)

  // 并行检测 Node.js 和 Git
  const [nodeStatus, gitStatus] = await Promise.all([
    detectNodeRuntime(),
    detectGitRuntime(),
  ])

  // Node.js 检测结果
  const nodejsResult = {
    installed: nodeStatus.available,
    version: nodeStatus.version || undefined,
    meetsMinimum: nodeStatus.version ? checkNodeVersion(nodeStatus.version, '18.0.0', '22.0.0').meetsMinimum : false,
    meetsRecommended: nodeStatus.version ? checkNodeVersion(nodeStatus.version, '18.0.0', '22.0.0').meetsRecommended : false,
    downloadUrl: downloadUrls.nodejs,
  }

  // Git 检测结果
  const gitResult = {
    installed: gitStatus.available,
    version: gitStatus.version || undefined,
    meetsRequirement: gitStatus.version ? meetsVersion(gitStatus.version, '2.0.0') : false,
    downloadUrl: downloadUrls.git,
  }

  // 判断是否有问题
  const hasIssues =
    !nodejsResult.installed ||
    !nodejsResult.meetsMinimum ||
    !gitResult.installed ||
    !gitResult.meetsRequirement

  const result: EnvironmentCheckResult = {
    nodejs: nodejsResult,
    git: gitResult,
    platform,
    hasIssues,
    checkedAt: Date.now(),
  }

  console.log('[环境检测] 检测完成:', result)

  return result
}
