/**
 * 钉钉集成 Jotai 状态
 *
 * 管理钉钉 Bridge 连接状态。
 */

import { atom } from 'jotai'
import type { DingTalkBridgeState } from '@proma/shared'

/** 钉钉 Bridge 连接状态 */
export const dingtalkBridgeStateAtom = atom<DingTalkBridgeState>({
  status: 'disconnected',
})

/** 钉钉是否已连接（derived atom） */
export const dingtalkConnectedAtom = atom((get) => get(dingtalkBridgeStateAtom).status === 'connected')
