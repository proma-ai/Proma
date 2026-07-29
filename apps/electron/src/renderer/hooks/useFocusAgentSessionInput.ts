/**
 * 聚焦已有 Agent Tab，并把输入焦点交给该会话。
 *
 * 仅切换 activeTabId，不重建、关闭或改变预览 Tab / 分屏状态。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { activeTabIdAtom, tabsAtom } from '@/atoms/tab-atoms'

type FocusAgentSessionInput = (sessionId: string) => boolean

export function useFocusAgentSessionInput(): FocusAgentSessionInput {
  const store = useStore()
  const tabs = useAtomValue(tabsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  return React.useCallback((sessionId: string): boolean => {
    const agentTab = tabs.find((tab) => tab.type === 'agent' && tab.sessionId === sessionId)
    if (!agentTab) return false

    setActiveTabId(agentTab.id)
    setAppMode('agent')
    setCurrentConversationId(null)
    setCurrentAgentSessionId(sessionId)
    setUnviewedCompleted((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })

    const session = agentSessions.find((item) => item.id === sessionId)
    if (session?.workspaceId) {
      setCurrentAgentWorkspaceId(session.workspaceId)
      window.electronAPI.updateSettings({ agentWorkspaceId: session.workspaceId }).catch(console.error)
    }

    // 等待 AgentView 成为当前内容，再复用其既有输入框聚焦事件。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (store.get(activeTabIdAtom) !== agentTab.id) return
        window.dispatchEvent(new CustomEvent('proma:focus-input'))
      })
    })

    return true
  }, [
    agentSessions,
    setActiveTabId,
    setAppMode,
    setCurrentAgentSessionId,
    setCurrentAgentWorkspaceId,
    setCurrentConversationId,
    setUnviewedCompleted,
    store,
    tabs,
  ])
}
