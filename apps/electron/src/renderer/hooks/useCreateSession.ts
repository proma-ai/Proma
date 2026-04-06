/**
 * useCreateSession — 共享的创建 Chat 对话 / Agent 会话逻辑
 *
 * 从 LeftSidebar 提取，供 WelcomeView 模式切换和侧边栏共同使用。
 */

import { useAtomValue, useSetAtom } from 'jotai'
import {
  conversationsAtom,
  selectedModelAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  agentChannelIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { promptConfigAtom, selectedPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useOpenSession } from './useOpenSession'

interface CreateSessionOptions {
  /** 标记为草稿会话（不在侧边栏显示，发送首条消息后自动取消） */
  draft?: boolean
}

interface CreateSessionActions {
  /** 创建新 Chat 对话并打开标签页 */
  createChat: (options?: CreateSessionOptions) => Promise<string | undefined>
  /** 创建新 Agent 会话并打开标签页 */
  createAgent: (options?: CreateSessionOptions) => Promise<string | undefined>
}

export function useCreateSession(): CreateSessionActions {
  const openSession = useOpenSession()
  const setActiveView = useSetAtom(activeViewAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  // Chat
  const setConversations = useSetAtom(conversationsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)

  // Agent
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)

  const createChat = async (options?: CreateSessionOptions): Promise<string | undefined> => {
    try {
      const meta = await window.electronAPI.createConversation(
        undefined,
        selectedModel?.modelId,
        selectedModel?.channelId,
      )
      setConversations((prev) => [meta, ...prev])
      openSession('chat', meta.id, meta.title)
      setActiveView('conversations')
      if (promptConfig.defaultPromptId) {
        setSelectedPromptId(promptConfig.defaultPromptId)
      }
      if (options?.draft) {
        setDraftSessionIds((prev: Set<string>) => { const next = new Set(prev); next.add(meta.id); return next })
      }
      return meta.id
    } catch (error) {
      console.error('[创建会话] 创建 Chat 对话失败:', error)
      return undefined
    }
  }

  const createAgent = async (options?: CreateSessionOptions): Promise<string | undefined> => {
    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId || undefined,
        currentWorkspaceId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])
      openSession('agent', meta.id, meta.title)
      setActiveView('conversations')
      if (options?.draft) {
        setDraftSessionIds((prev: Set<string>) => { const next = new Set(prev); next.add(meta.id); return next })
      }
      return meta.id
    } catch (error) {
      console.error('[创建会话] 创建 Agent 会话失败:', error)
      return undefined
    }
  }

  return { createChat, createAgent }
}
