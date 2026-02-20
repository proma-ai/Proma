/**
 * Settings Tab Atom - 设置标签页状态
 *
 * 管理设置面板中当前激活的标签页：
 * - general: 通用设置
 * - channels: 渠道配置
 * - proxy: 代理配置
 * - appearance: 外观设置
 * - about: 关于
 * - agent: Agent 配置（Agent 模式）
 * - billing: 账单（Cloud 模式）
 * - api: API Key 管理（Cloud 模式）
 */

import { atom } from 'jotai'

export type SettingsTab = 'general' | 'channels' | 'proxy' | 'appearance' | 'about' | 'agent' | 'prompts'
  // Cloud 模式专属标签页
  | 'billing' | 'api'

/** 当前设置标签页（不持久化，每次打开设置默认显示渠道） */
export const settingsTabAtom = atom<SettingsTab>('channels')
