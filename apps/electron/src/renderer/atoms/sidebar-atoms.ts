/**
 * 侧边栏状态 Atoms
 *
 * 管理侧边栏视图模式（活跃 / 已归档）。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

/** 侧边栏视图模式 */
export type SidebarViewMode = 'active' | 'archived'

/** 侧边栏视图模式（active = 显示活跃对话，archived = 显示已归档对话） */
export const sidebarViewModeAtom = atom<SidebarViewMode>('active')

/** 工作区列表高度（px），用户可拖拽调整，持久化到 localStorage */
export const workspaceListHeightAtom = atomWithStorage<number>(
  'proma-workspace-list-height',
  120,
)

/**
 * Agent 模式侧边栏上区（Working/置顶 Tab）的高度（px）。
 *
 * 用户可通过拖拽分割条调整，持久化到 localStorage。
 * 负值表示未初始化，运行时首次渲染按容器高度的 40% 计算初始值。
 */
export const agentSidebarTopHeightAtom = atomWithStorage<number>(
  'proma-agent-sidebar-top-height',
  -1,
)
