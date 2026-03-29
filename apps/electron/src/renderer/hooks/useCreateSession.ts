/**
 * useCreateSession — 共享的创建 Chat 对话 / Agent 会话逻辑
 *
 * 从 LeftSidebar 提取，供 WelcomeView 模式切换和侧边栏共同使用。
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  conversationsAtom,
  currentConversationIdAtom,
  selectedModelAtom,
} from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentChannelIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import {
  tabsAtom,
  splitLayoutAtom,
  openTab,
} from '@/atoms/tab-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { promptConfigAtom, selectedPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'

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
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  // Chat
  const setConversations = useSetAtom(conversationsAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const promptConfig = useAtomValue(promptConfigAtom)
  const setSelectedPromptId = useSetAtom(selectedPromptIdAtom)

  // Agent
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
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
      const result = openTab(tabs, layout, { type: 'chat', sessionId: meta.id, title: meta.title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentConversationId(meta.id)
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
      const result = openTab(tabs, layout, { type: 'agent', sessionId: meta.id, title: meta.title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setCurrentAgentSessionId(meta.id)
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
