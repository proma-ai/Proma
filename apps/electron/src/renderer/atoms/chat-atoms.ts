/**
 * Chat Atoms - 对话相关的 Jotai 状态
 *
 * 管理对话列表、当前对话、消息、流式状态、模型选择、
 * 上下文管理、并排模式、思考模式等。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { ConversationMeta, ChatMessage, FileAttachment, ChatToolActivity } from '@proma/shared'

/** 选中的模型信息 */
interface SelectedModel {
  channelId: string
  modelId: string
}

/** 上下文长度选项值 */
export type ContextLengthValue = 0 | 5 | 10 | 15 | 20 | 'infinite'

/** 上下文长度选项列表 */
export const CONTEXT_LENGTH_OPTIONS: ContextLengthValue[] = [0, 5, 10, 15, 20, 'infinite']

/** 对话列表 */
export const conversationsAtom = atom<ConversationMeta[]>([])

/** 当前对话 ID */
export const currentConversationIdAtom = atom<string | null>(null)

/** 当前对话的消息列表 */
export const currentMessagesAtom = atom<ChatMessage[]>([])

/** 单个对话的流式状态 */
export interface ConversationStreamState {
  streaming: boolean
  content: string
  reasoning: string
  model?: string
  /** 记忆工具活动列表（流式期间累积） */
  toolActivities: ChatToolActivity[]
}

/**
 * 全局流式状态 Map — 以 conversationId 为 key
 * 流式进行中：Map 中存在该 key
 * 流式结束后：从 Map 中删除该 key
 */
export const streamingStatesAtom = atom<Map<string, ConversationStreamState>>(new Map())

/**
 * 当前正在流式输出的对话 ID 集合（派生只读原子）
 * 用于侧边栏绿色呼吸点指示器
 */
export const streamingConversationIdsAtom = atom<Set<string>>((get) => {
  const states = get(streamingStatesAtom)
  const ids = new Set<string>()
  for (const [id, state] of states) {
    if (state.streaming) ids.add(id)
  }
  return ids
})

/**
 * 是否正在流式生成（派生读写原子，向后兼容）
 * 读：当前对话是否在流式中
 * 写：更新当前对话的 streaming 标志
 */
export const streamingAtom = atom<boolean>(
  (get) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return false
    return get(streamingStatesAtom).get(currentId)?.streaming ?? false
  },
)

/**
 * 流式生成中的临时累积内容（派生读写原子，向后兼容）
 * 读：当前对话的累积内容
 */
export const streamingContentAtom = atom<string>(
  (get) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return ''
    return get(streamingStatesAtom).get(currentId)?.content ?? ''
  },
)

/**
 * 流式生成中的推理内容（派生读写原子，向后兼容）
 * 读：当前对话的推理内容
 */
export const streamingReasoningAtom = atom<string>(
  (get) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return ''
    return get(streamingStatesAtom).get(currentId)?.reasoning ?? ''
  },
)

/** 当前对话流式消息绑定的模型（发送时快照） */
export const streamingModelAtom = atom<string | null>(
  (get) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return null
    return get(streamingStatesAtom).get(currentId)?.model ?? null
  },
)

/** 当前对话的工具活动列表（派生只读） */
export const streamingToolActivitiesAtom = atom<ChatToolActivity[]>(
  (get) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return []
    return get(streamingStatesAtom).get(currentId)?.toolActivities ?? []
  },
)

/** 选中的模型（持久化到 localStorage） */
export const selectedModelAtom = atomWithStorage<SelectedModel | null>(
  'proma-selected-model',
  null,
)

/** 当前对话的元数据（派生原子） */
export const currentConversationAtom = atom<ConversationMeta | null>((get) => {
  const conversations = get(conversationsAtom)
  const currentId = get(currentConversationIdAtom)

  if (!currentId) return null
  return conversations.find((c) => c.id === currentId) ?? null
})

/** 上下文长度（持久化到 localStorage，默认 20 轮） */
export const contextLengthAtom = atomWithStorage<ContextLengthValue>(
  'proma-context-length',
  20,
)

/** 并排模式 */
export const parallelModeAtom = atom<boolean>(false)

/** 思考模式（持久化到 localStorage） */
export const thinkingEnabledAtom = atomWithStorage<boolean>(
  'proma-thinking-enabled',
  false,
)

/** 当前对话的上下文分隔线 */
export const contextDividersAtom = atom<string[]>([])

/** 待发送的附件（含本地预览 URL） */
export interface PendingAttachment extends FileAttachment {
  /** 本地预览 URL（blob URL，用于渲染缩略图） */
  previewUrl?: string
}

/** 待发送附件列表 */
export const pendingAttachmentsAtom = atom<PendingAttachment[]>([])

/** 是否还有更多历史消息未加载 */
export const hasMoreMessagesAtom = atom<boolean>(false)

/** 初次加载的消息条数 */
export const INITIAL_MESSAGE_LIMIT = 10

/**
 * 流式错误消息 Map — 以 conversationId 为 key
 * 错误发生时写入，下次发送或手动关闭时清除
 */
export const chatStreamErrorsAtom = atom<Map<string, string>>(new Map())

/** 当前对话的错误消息（派生只读原子） */
export const currentChatErrorAtom = atom<string | null>((get) => {
  const currentId = get(currentConversationIdAtom)
  if (!currentId) return null
  return get(chatStreamErrorsAtom).get(currentId) ?? null
})

/**
 * 对话输入框草稿 Map — 以 conversationId 为 key
 * 用于在切换对话时保留输入框内容
 */
export const conversationDraftsAtom = atom<Map<string, string>>(new Map())

/** 当前对话的草稿内容（派生读写原子） */
export const currentConversationDraftAtom = atom(
  (get) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return ''
    return get(conversationDraftsAtom).get(currentId) ?? ''
  },
  (get, set, newDraft: string) => {
    const currentId = get(currentConversationIdAtom)
    if (!currentId) return
    set(conversationDraftsAtom, (prev) => {
      const map = new Map(prev)
      if (newDraft.trim() === '') {
        map.delete(currentId)
      } else {
        map.set(currentId, newDraft)
      }
      return map
    })
  }
)
