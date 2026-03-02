/**
 * Chat Tool Atoms - Chat 工具状态管理
 *
 * 管理 Chat 模式下可用工具的列表和开关状态：
 * - chatToolsAtom: 从主进程加载的所有工具信息
 * - enabledToolIdsAtom: 用户在 ChatInput 中切换的工具开关
 * - activeToolIdsAtom: 当前实际启用的工具 ID（交集）
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { ChatToolInfo } from '@proma/shared'

/** 从主进程加载的所有工具列表 */
export const chatToolsAtom = atom<ChatToolInfo[]>([])

// 一次性迁移：为已有用户补充 agent-mode-recommend 默认开启
const MIGRATION_KEY = 'proma-tool-migration-agent-recommend'
if (typeof localStorage !== 'undefined' && !localStorage.getItem(MIGRATION_KEY)) {
  const stored = localStorage.getItem('proma-enabled-tool-ids')
  if (stored) {
    try {
      const ids = JSON.parse(stored) as string[]
      if (Array.isArray(ids) && !ids.includes('agent-mode-recommend')) {
        ids.push('agent-mode-recommend')
        localStorage.setItem('proma-enabled-tool-ids', JSON.stringify(ids))
      }
    } catch {
      // 解析失败忽略
    }
  }
  localStorage.setItem(MIGRATION_KEY, '1')
}

/**
 * 用户在 ChatInput 工具栏中切换的工具 ID 集合
 *
 * localStorage 持久化，默认包含 'memory' 和 'agent-mode-recommend'
 */
export const enabledToolIdsAtom = atomWithStorage<string[]>(
  'proma-enabled-tool-ids',
  ['memory', 'agent-mode-recommend'],
)

/**
 * 派生：当前实际启用的工具 ID 列表
 *
 * 交集条件：用户开关打开 AND 工具已配置可用
 */
export const activeToolIdsAtom = atom<string[]>((get) => {
  const allTools = get(chatToolsAtom)
  const enabledIds = get(enabledToolIdsAtom)
  return allTools
    .filter((t) => enabledIds.includes(t.meta.id) && t.available)
    .map((t) => t.meta.id)
})

/** 派生：是否有任何工具启用 */
export const hasActiveToolsAtom = atom<boolean>((get) => {
  return get(activeToolIdsAtom).length > 0
})
