/**
 * 搜索 Dialog 状态 Atoms
 *
 * 管理全局搜索 Dialog 的开关、查询词和搜索结果。
 */

import { atom } from 'jotai'

/** 搜索 Dialog 是否打开 */
export const searchDialogOpenAtom = atom(false)
