/**
 * useOpenSession — 统一的"打开/聚焦会话 Tab"操作
 *
 * 封装 openTab + setTabs + setActiveTabId + setAppMode + setCurrentXxxId，
 * 确保所有打开会话的入口都能正确同步 appMode 和 currentSessionId。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  openTab,
  buildOpenTabRestore,
  sessionViewStateMapAtom,
  type TabType,
} from '@/atoms/tab-atoms'
import { previewFileMapAtom } from '@/atoms/preview-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { activeViewAtom } from '@/atoms/active-view'
import { automationFormAtom } from '@/atoms/automation-atoms'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  currentAgentSessionIdAtom,
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'

type OpenSessionFn = (type: TabType, sessionId: string, title: string) => void

export function useOpenSession(): OpenSessionFn {
  const store = useStore()
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setAutomationForm = useSetAtom(automationFormAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  return React.useCallback(
    (type: TabType, sessionId: string, title: string): void => {
      // 切回 agent 会话时，若该会话上次开着预览 Tab 则一并重建并回到上次视图
      const restore = type === 'agent'
        ? buildOpenTabRestore(
            sessionId,
            store.get(sessionViewStateMapAtom),
            store.get(previewFileMapAtom),
          )
        : undefined
      const result = openTab(tabs, { type, sessionId, title }, restore)
      setTabs(result.tabs)
      setActiveTabId(result.activeTabId)
      setAutomationForm({ open: false, draft: null })
      setActiveView('conversations')

      if (type === 'chat') {
        setAppMode('chat')
        setCurrentConversationId(sessionId)
      } else if (type === 'agent' || type === 'preview') {
        setAppMode('agent')
        setCurrentAgentSessionId(sessionId)

        // 用户打开查看后只清除未读角标；是否完成由用户通过对勾确认。
        setUnviewedCompleted((prev) => {
          if (!prev.has(sessionId)) return prev
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })

        // 同步 workspaceId，确保与 TabBar 切换行为一致
        const session = agentSessions.find((s) => s.id === sessionId)
        if (session?.workspaceId) {
          setCurrentAgentWorkspaceId(session.workspaceId)
          window.electronAPI.updateSettings({
            agentWorkspaceId: session.workspaceId,
          }).catch(console.error)
        }
      } else {
        setAppMode('scratch')
        setCurrentConversationId(null)
        setCurrentAgentSessionId(null)
      }
    },
    [tabs, setTabs, setActiveTabId, setAutomationForm, setActiveView, setAppMode, setCurrentConversationId, setCurrentAgentSessionId, agentSessions, setCurrentAgentWorkspaceId, setUnviewedCompleted],
  )
}
