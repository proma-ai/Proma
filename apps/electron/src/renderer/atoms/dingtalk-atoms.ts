/**
 * 钉钉集成 Jotai 状态（多 Bot 版本）
 *
 * 管理多个钉钉 Bot 的 Bridge 连接状态。
 */

import { atom } from 'jotai'
import type { DingTalkBridgeState, DingTalkBotBridgeState } from '@proma/shared'

/** 所有 Bot 的状态（botId → 状态） */
export const dingtalkBotStatesAtom = atom<Record<string, DingTalkBotBridgeState>>({})

/** 任一 Bot 已连接 */
export const dingtalkAnyConnectedAtom = atom((get) => {
  const states = get(dingtalkBotStatesAtom)
  return Object.values(states).some((s) => s.status === 'connected')
})

/** 钉钉 Bridge 连接状态（向后兼容：取第一个 Bot 的状态） */
export const dingtalkBridgeStateAtom = atom<DingTalkBridgeState>((get) => {
  const states = get(dingtalkBotStatesAtom)
  const first = Object.values(states)[0]
  return first ?? { status: 'disconnected' }
})

/** 钉钉是否已连接（向后兼容：任一 Bot 已连接即为 true） */
export const dingtalkConnectedAtom = dingtalkAnyConnectedAtom
