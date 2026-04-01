/**
 * MainContentPanel - 主内容面板
 *
 * 根据当前活跃视图显示不同内容：
 * - conversations: 根据 App 模式显示 Chat/Agent 内容
 * - settings: 显示设置面板
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import { Panel } from './Panel'
import { ChatView } from '@/components/chat'
import { AgentView } from '@/components/agent'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'

/**
 * @deprecated 已被 MainArea（TabBar + SplitContainer）替代。
 * 保留仅供参考，不再被 AppShell 使用。
 */
export function MainContentPanel(): React.ReactElement {
  const mode = useAtomValue(appModeAtom)
  const conversationId = useAtomValue(currentConversationIdAtom)
  const sessionId = useAtomValue(currentAgentSessionIdAtom)

  /** 渲染对话视图内容 */
  const renderConversations = (): React.ReactElement | null => {
    if (mode === 'chat' && conversationId) {
      return <ChatView conversationId={conversationId} />
    }
    if (mode === 'agent' && sessionId) {
      return <AgentView sessionId={sessionId} />
    }
    return null
  }

  return (
    <Panel
      variant="grow"
      className="bg-background/95 backdrop-blur-xl rounded-2xl shadow-xl"
    >
      {renderConversations()}
    </Panel>
  )
}
