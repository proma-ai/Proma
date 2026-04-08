/**
 * useOpenSession — 统一的"打开/聚焦会话 Tab"操作
 *
 * 封装 openTab + setTabs + setLayout + setAppMode + setCurrentXxxId，
 * 确保所有打开会话的入口都能正确同步 appMode 和 currentSessionId。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { tabsAtom, splitLayoutAtom, openTab, type TabType } from '@/atoms/tab-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import { currentAgentSessionIdAtom, agentSessionsAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'

type OpenSessionFn = (type: TabType, sessionId: string, title: string) => void

export function useOpenSession(): OpenSessionFn {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)

  return React.useCallback(
    (type: TabType, sessionId: string, title: string): void => {
      const result = openTab(tabs, layout, { type, sessionId, title })
      setTabs(result.tabs)
      setLayout(result.layout)
      setAppMode(type)

      if (type === 'chat') {
        setCurrentConversationId(sessionId)
      } else {
        setCurrentAgentSessionId(sessionId)

        // 同步 workspaceId，确保与 TabBar 切换行为一致
        const session = agentSessions.find((s) => s.id === sessionId)
        if (session?.workspaceId) {
          setCurrentAgentWorkspaceId(session.workspaceId)
          window.electronAPI.updateSettings({
            agentWorkspaceId: session.workspaceId,
          }).catch(console.error)
        }
      }
    },
    [tabs, layout, setTabs, setLayout, setAppMode, setCurrentConversationId, setCurrentAgentSessionId, agentSessions, setCurrentAgentWorkspaceId],
  )
}
