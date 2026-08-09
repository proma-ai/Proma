/**
 * 数据同步状态 Atoms
 *
 * 管理本地 ↔ 云端对话数据同步的前端状态。
 */

import { atom } from 'jotai'
import type { SyncState, SyncResult, SyncProgressEvent } from '@proma/shared'

/** 同步状态 */
export const syncStateAtom = atom<SyncState | null>(null)

/** 是否正在同步 */
export const isSyncingAtom = atom(false)

/** 同步进度 */
export const syncProgressAtom = atom<SyncProgressEvent | null>(null)

/** 最近一次同步结果 */
export const lastSyncResultAtom = atom<SyncResult | null>(null)

/** 同步错误信息 */
export const syncErrorAtom = atom<string | null>(null)

/** 是否已完成过首次同步 */
export const hasEverSyncedAtom = atom((get) => {
  const state = get(syncStateAtom)
  return state?.lastFullSyncAt !== null && state?.lastFullSyncAt !== undefined
})
