/**
 * System Prompt Atoms - 系统提示词状态管理
 *
 * 管理 Chat 模式的系统提示词配置，包括：
 * - 提示词列表和配置
 * - 当前选中的提示词
 * - 解析后的最终 systemMessage
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEFAULT_PROMPT,
} from '@proma/shared'
import type { SystemPromptConfig, SystemPrompt } from '@proma/shared'
import { userProfileAtom } from './user-profile'

/** 提示词编辑侧栏是否打开 */
export const promptSidebarOpenAtom = atom<boolean>(false)

/** 完整提示词配置（从主进程加载） */
export const promptConfigAtom = atom<SystemPromptConfig>({
  prompts: [BUILTIN_DEFAULT_PROMPT],
  defaultPromptId: BUILTIN_DEFAULT_ID,
  appendDateTimeAndUserName: true,
})

/** 当前选中的提示词 ID（持久化到 localStorage） */
export const selectedPromptIdAtom = atomWithStorage<string>(
  'proma-selected-system-prompt-id',
  BUILTIN_DEFAULT_ID
)

/** 提示词列表（派生只读） */
export const promptListAtom = atom<SystemPrompt[]>(
  (get) => get(promptConfigAtom).prompts
)

/** 默认提示词 ID（派生只读） */
export const defaultPromptIdAtom = atom<string | undefined>(
  (get) => get(promptConfigAtom).defaultPromptId
)

/** 当前选中的提示词对象（派生只读） */
export const selectedPromptAtom = atom<SystemPrompt | undefined>((get) => {
  const config = get(promptConfigAtom)
  const selectedId = get(selectedPromptIdAtom)
  return config.prompts.find((p) => p.id === selectedId)
})

/** 解析最终 systemMessage（派生只读） */
export const resolvedSystemMessageAtom = atom<string | undefined>((get) => {
  const selectedPrompt = get(selectedPromptAtom)
  if (!selectedPrompt) return undefined

  let message = selectedPrompt.content

  const config = get(promptConfigAtom)
  if (config.appendDateTimeAndUserName) {
    const userProfile = get(userProfileAtom)
    const now = new Date()
    const dateTimeStr = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
    })
    const appendix = `\n\n---\n当前时间: ${dateTimeStr}\n用户名: ${userProfile.userName}`
    message += appendix
  }

  return message
})
