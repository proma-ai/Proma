/**
 * Draft Session Atoms
 *
 * 追踪"草稿"会话 ID。草稿会话是真实的会话（拥有有效 ID），
 * 但尚未发送任何消息，因此不在侧边栏中显示。
 * 当用户发送第一条消息后，会话从 draft 集合中移除，出现在侧边栏。
 */

import { atom } from 'jotai'

/** 草稿会话 ID 集合（Chat + Agent 共用） */
export const draftSessionIdsAtom = atom<Set<string>>(new Set<string>())
