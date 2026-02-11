/**
 * 环境检测状态管理
 *
 * 管理环境检测结果、检测状态和问题标记
 */

import { atom } from 'jotai'
import type { EnvironmentCheckResult } from '@proma/shared'

/**
 * 环境检测结果 Atom
 * 存储最后一次环境检测的完整结果
 */
export const environmentCheckResultAtom = atom<EnvironmentCheckResult | null>(null)

/**
 * 是否正在检测环境 Atom
 * 用于显示加载状态
 */
export const isCheckingEnvironmentAtom = atom(false)

/**
 * 是否存在环境问题 Atom（派生）
 * 根据检测结果判断是否显示红点标记
 */
export const hasEnvironmentIssuesAtom = atom((get) => {
  const result = get(environmentCheckResultAtom)
  if (!result) return false
  return result.hasIssues
})
