/**
 * 环境检测相关类型定义
 * 用于检测 Node.js 和 Git 运行环境
 */

import type { Platform } from './runtime'

/**
 * Node.js 检测结果
 */
export interface NodeJsCheckResult {
  /** 是否已安装 */
  installed: boolean
  /** 版本号 */
  version?: string
  /** 是否满足最低要求（>= 18） */
  meetsMinimum: boolean
  /** 是否满足推荐版本（>= 22） */
  meetsRecommended: boolean
  /** 下载链接 */
  downloadUrl: string
}

/**
 * Git 检测结果
 */
export interface GitCheckResult {
  /** 是否已安装 */
  installed: boolean
  /** 版本号 */
  version?: string
  /** 是否满足要求（>= 2.0） */
  meetsRequirement: boolean
  /** 下载链接 */
  downloadUrl: string
}

/**
 * 完整环境检测结果
 */
export interface EnvironmentCheckResult {
  /** Node.js 检测结果 */
  nodejs: NodeJsCheckResult
  /** Git 检测结果 */
  git: GitCheckResult
  /** 当前平台 */
  platform: Platform
  /** 是否存在问题（未安装或版本不满足要求） */
  hasIssues: boolean
  /** 检测时间戳 */
  checkedAt: number
}

/**
 * 环境检测 IPC 通道
 */
export const ENVIRONMENT_IPC_CHANNELS = {
  /** 执行环境检测 */
  CHECK: 'environment:check',
} as const
