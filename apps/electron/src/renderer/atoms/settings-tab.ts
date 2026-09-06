/**
 * Settings Tab Atom - 设置标签页状态
 *
 * 管理设置面板中当前激活的标签页：
 * - general: 通用设置
 * - channels: 渠道配置
 * - proxy: 代理配置
 * - appearance: 外观设置
 * - about: 关于
 */

import { atom } from 'jotai'
import type { TabType } from './tab-atoms'

export type SettingsTab = 'general' | 'channels' | 'vision-relay' | 'proxy' | 'appearance' | 'about' | 'onboarding' | 'prompts' | 'bots' | 'shortcuts' | 'voice-input' | 'migration' | 'storage'

/** 当前设置标签页（不持久化，每次打开设置默认显示渠道） */
export const settingsTabAtom = atom<SettingsTab>('channels')

/** 设置浮窗是否打开 */
export const settingsOpenAtom = atom(false)

/** 渠道创建表单是否有未保存内容（用于拦截导航离开） */
export const channelFormDirtyAtom = atom(false)

/** 外部请求关闭设置面板（如 Cmd+W），SettingsPanel 监听后弹出确认对话框 */
export const settingsCloseRequestedAtom = atom(false)

/**
 * 从设置工作区离开时暂存的会话导航目标。
 * 渠道表单有未保存内容时，SettingsPanel 确认放弃后再执行该导航。
 */
export interface SettingsSessionNavigation {
  type: TabType
  sessionId: string
  title: string
  /** 导航经设置脏表单确认并真正执行后提交的调用方 intent。 */
  onOpened?: () => void
}
export const settingsPendingSessionNavigationAtom = atom<SettingsSessionNavigation | null>(null)
