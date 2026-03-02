/**
 * Session Context — 为 ChatView / AgentView 提供 conversationId / sessionId
 *
 * 避免逐层 props 透传，子组件通过 useConversationId() / useAgentSessionId() 获取。
 */

import * as React from 'react'

// ===== Conversation（Chat 模式）=====

const ConversationContext = React.createContext<string | null>(null)

export function ConversationProvider({
  conversationId,
  children,
}: {
  conversationId: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <ConversationContext.Provider value={conversationId}>
      {children}
    </ConversationContext.Provider>
  )
}

export function useConversationId(): string {
  const id = React.useContext(ConversationContext)
  if (!id) throw new Error('useConversationId 必须在 ConversationProvider 内使用')
  return id
}

/** 可选版本：在 Provider 外返回 null（用于 ModelSelector 等双模式组件） */
export function useConversationIdOptional(): string | null {
  return React.useContext(ConversationContext)
}

// ===== Agent Session =====

const AgentSessionContext = React.createContext<string | null>(null)

export function AgentSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <AgentSessionContext.Provider value={sessionId}>
      {children}
    </AgentSessionContext.Provider>
  )
}

export function useAgentSessionId(): string {
  const id = React.useContext(AgentSessionContext)
  if (!id) throw new Error('useAgentSessionId 必须在 AgentSessionProvider 内使用')
  return id
}
