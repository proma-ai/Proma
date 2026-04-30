/**
 * 环境检测状态管理
 *
 * 管理环境检测结果、运行时状态、下载态以及派生的 UI 判断。
 */

import { atom } from 'jotai'
import type {
  EnvironmentCheckResult,
  RuntimeStatus,
  InstallerManifest,
} from '@proma/shared'

/**
 * 单个安装包的下载状态
 */
export interface InstallerDownloadState {
  status: 'idle' | 'downloading' | 'verifying' | 'done' | 'failed' | 'cancelled'
  /** 已下载字节数 */
  downloaded?: number
  /** 总字节数 */
  total?: number
  /** 瞬时速度（字节/秒） */
  speed?: number
  /** 下载后的本地文件路径（成功时） */
  filePath?: string
  /** 错误消息（失败时） */
  error?: string
}

/**
 * 环境检测结果 Atom
 * 存储最后一次环境检测的完整结果
 */
export const environmentCheckResultAtom = atom<EnvironmentCheckResult | null>(null)

/**
 * 运行时状态 Atom（包含 Windows Shell 检测结果）
 */
export const runtimeStatusAtom = atom<RuntimeStatus | null>(null)

/**
 * 是否正在检测环境 Atom
 */
export const isCheckingEnvironmentAtom = atom(false)

/**
 * 安装包清单 Atom（远程拉取，失败回退内置）
 */
export const installerManifestAtom = atom<InstallerManifest | null>(null)

/**
 * 下载状态 Map Atom
 * key 形如 "git-for-windows:x64"
 */
export const installerDownloadStatesAtom = atom<Record<string, InstallerDownloadState>>({})

/**
 * 是否存在环境问题 Atom（派生，仅用于 macOS / 旧逻辑）
 */
export const hasEnvironmentIssuesAtom = atom((get) => {
  const result = get(environmentCheckResultAtom)
  if (!result) return false
  return result.hasIssues
})

/**
 * Windows Shell 环境是否可用（Git Bash 或 WSL 任一可用即 true）
 * 非 Windows 平台返回 true（无此门槛）
 */
export const isShellEnvironmentOkAtom = atom((get) => {
  const runtime = get(runtimeStatusAtom)
  if (!runtime) return true
  if (!runtime.shell) return true // 非 Windows
  return !!(runtime.shell.gitBash?.available || runtime.shell.wsl?.available)
})

/**
 * Node.js 是否可用（软需求，仅影响提示不阻塞）
 */
export const isNodeJsOkAtom = atom((get) => {
  const runtime = get(runtimeStatusAtom)
  if (!runtime) return true
  return !!runtime.node?.available
})

/**
 * 全局环境检测 Dialog 开关（错误卡片的「打开环境检测」按钮会置 true）
 */
export const environmentCheckDialogOpenAtom = atom(false)
