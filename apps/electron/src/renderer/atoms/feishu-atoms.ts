/**
 * 飞书集成 Jotai 状态
 *
 * 管理飞书 Bridge 连接状态和 per-session 通知模式。
 */

import { atom } from 'jotai'
import type { FeishuBridgeState, FeishuNotifyMode, FeishuChatBinding } from '@proma/shared'

/** 飞书 Bridge 连接状态 */
export const feishuBridgeStateAtom = atom<FeishuBridgeState>({
  status: 'disconnected',
  activeBindings: 0,
})

/** 全局默认通知模式 */
export const feishuDefaultNotifyModeAtom = atom<FeishuNotifyMode>('auto')

/** per-session 通知模式 Map<sessionId, FeishuNotifyMode> */
export const sessionFeishuNotifyModeAtom = atom<Map<string, FeishuNotifyMode>>(new Map())

/** 飞书是否已连接（derived atom） */
export const feishuConnectedAtom = atom((get) => get(feishuBridgeStateAtom).status === 'connected')

/** 飞书聊天绑定列表 */
export const feishuBindingsAtom = atom<FeishuChatBinding[]>([])
