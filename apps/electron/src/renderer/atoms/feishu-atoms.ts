/**
 * 飞书集成 Jotai 状态（多 Bot 版本）
 *
 * 管理多个飞书 Bot 的 Bridge 连接状态和 per-session 通知模式。
 */

import { atom } from 'jotai'
import type {
  FeishuBridgeState,
  FeishuNotifyMode,
  FeishuChatBinding,
  FeishuBotBridgeState,
} from '@proma/shared'

/** 多 Bot Bridge 状态（botId → 状态） */
export const feishuBotStatesAtom = atom<Record<string, FeishuBotBridgeState>>({})

/** 任一 Bot 已连接（derived） */
export const feishuAnyConnectedAtom = atom((get) =>
  Object.values(get(feishuBotStatesAtom)).some((b) => b.status === 'connected'),
)

/** 飞书 Bridge 连接状态（向后兼容：取第一个 Bot 状态） */
export const feishuBridgeStateAtom = atom<FeishuBridgeState>((get) => {
  const states = get(feishuBotStatesAtom)
  const first = Object.values(states)[0]
  return first ?? { status: 'disconnected', activeBindings: 0 }
})

/** 全局默认通知模式 */
export const feishuDefaultNotifyModeAtom = atom<FeishuNotifyMode>('auto')

/** per-session 通知模式 Map<sessionId, FeishuNotifyMode> */
export const sessionFeishuNotifyModeAtom = atom<Map<string, FeishuNotifyMode>>(new Map())

/** 飞书是否已连接（向后兼容：任一 Bot 连接即为 true） */
export const feishuConnectedAtom = feishuAnyConnectedAtom

/** 飞书聊天绑定列表（含 botId） */
export const feishuBindingsAtom = atom<FeishuChatBinding[]>([])
