/**
 * useConversationSettings — per-conversation 设置读写 hooks
 *
 * 从 Map atoms 中按 conversationId 读取，缺省时返回全局默认值。
 * 通过 ConversationContext 获取 conversationId，避免 props 透传。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useConversationId, useConversationIdOptional } from '@/contexts/session-context'
import {
  selectedModelAtom,
  contextLengthAtom,
  thinkingEnabledAtom,
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
} from '@/atoms/chat-atoms'
import type { SelectedModel, ContextLengthValue } from '@/atoms/chat-atoms'
import {
  selectedPromptIdAtom,
  conversationPromptIdAtom,
} from '@/atoms/system-prompt-atoms'

// ===== 通用 Map 读写辅助 =====

type MapAtom<T> = ReturnType<typeof import('jotai').atom<Map<string, T>>>

function useMapValue<T>(mapAtom: MapAtom<T>, key: string, defaultValue: T): T {
  const map = useAtomValue(mapAtom)
  return map.get(key) ?? defaultValue
}

function useMapSetter<T>(
  mapAtom: MapAtom<T>,
  key: string,
): (value: T | ((prev: T) => T)) => void {
  const setMap = useSetAtom(mapAtom)
  return React.useCallback(
    (value: T | ((prev: T) => T)) => {
      setMap((prev) => {
        const map = new Map(prev)
        if (typeof value === 'function') {
          const current = map.get(key)
          map.set(key, (value as (prev: T) => T)(current as T))
        } else {
          map.set(key, value)
        }
        return map
      })
    },
    [key, setMap],
  )
}

// ===== Per-conversation Hooks =====

/** 每个对话独立的模型选择 */
export function useConversationModel(): [SelectedModel | null, (m: SelectedModel | null) => void] {
  const conversationId = useConversationId()
  const defaultModel = useAtomValue(selectedModelAtom)
  const value = useMapValue(conversationModelsAtom, conversationId, defaultModel)
  const setter = useMapSetter(conversationModelsAtom, conversationId)
  return [value, setter]
}

/** 可选版本：在 Provider 外返回 null（ModelSelector 双模式用） */
export function useConversationModelOptional(): [SelectedModel | null, ((m: SelectedModel | null) => void) | null] {
  const conversationId = useConversationIdOptional()
  const defaultModel = useAtomValue(selectedModelAtom)
  const map = useAtomValue(conversationModelsAtom)
  const setMap = useSetAtom(conversationModelsAtom)

  const value = conversationId ? (map.get(conversationId) ?? defaultModel) : null

  const setter = React.useCallback(
    (model: SelectedModel | null) => {
      if (!conversationId) return
      setMap((prev) => {
        const m = new Map(prev)
        m.set(conversationId, model)
        return m
      })
    },
    [conversationId, setMap],
  )

  return [value, conversationId ? setter : null]
}

/** 每个对话独立的上下文长度 */
export function useConversationContextLength(): [ContextLengthValue, (v: ContextLengthValue) => void] {
  const conversationId = useConversationId()
  const defaultLength = useAtomValue(contextLengthAtom)
  const value = useMapValue(conversationContextLengthAtom, conversationId, defaultLength)
  const setter = useMapSetter(conversationContextLengthAtom, conversationId)
  return [value, setter]
}

/** 每个对话独立的思考模式 */
export function useConversationThinkingEnabled(): [boolean, (v: boolean) => void] {
  const conversationId = useConversationId()
  const defaultEnabled = useAtomValue(thinkingEnabledAtom)
  const value = useMapValue(conversationThinkingEnabledAtom, conversationId, defaultEnabled)
  const setter = useMapSetter(conversationThinkingEnabledAtom, conversationId)
  return [value, setter]
}

/** 每个对话独立的并排模式 */
export function useConversationParallelMode(): [boolean, (v: boolean) => void] {
  const conversationId = useConversationId()
  const value = useMapValue(conversationParallelModeAtom, conversationId, false)
  const setter = useMapSetter(conversationParallelModeAtom, conversationId)
  return [value, setter]
}

/** 每个对话独立的系统提示词 ID */
export function useConversationPromptId(): [string, (v: string) => void] {
  const conversationId = useConversationId()
  const defaultPromptId = useAtomValue(selectedPromptIdAtom)
  const value = useMapValue(conversationPromptIdAtom, conversationId, defaultPromptId)
  const setter = useMapSetter(conversationPromptIdAtom, conversationId)
  return [value, setter]
}
