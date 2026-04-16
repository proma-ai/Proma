/**
 * useSyncActiveTabSideEffects — 将"新激活标签"的副作用同步到全局原子
 *
 * 标签页切换/关闭时，需要把 appMode、currentConversationId、
 * currentAgentSessionId、currentAgentWorkspaceId、unviewedCompletedSessionIds
 * 等全局状态同步到新激活的标签。该逻辑原本在 TabBar.handleClose 和
 * GlobalShortcuts.handleCloseTab 中各写一份，此 hook 统一封装，避免
 * 两处出现细节漂移（历史上 GlobalShortcuts 曾漏掉清除 unviewedCompleted
 * 与该条分支对齐）。
 */

import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { appModeAtom } from '@/atoms/app-mode'
import { currentConversationIdAtom } from '@/atoms/chat-atoms'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import type { TabItem } from '@/atoms/tab-atoms'

export type SyncActiveTabSideEffects = (newActiveTab: TabItem | null) => void

export function useSyncActiveTabSideEffects(): SyncActiveTabSideEffects {
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentConversationId = useSetAtom(currentConversationIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)

  return useCallback<SyncActiveTabSideEffects>(
    (newActiveTab) => {
      if (!newActiveTab) {
        // 所有标签都已关闭
        setCurrentConversationId(null)
        setCurrentAgentSessionId(null)
        return
      }

      if (newActiveTab.type === 'chat') {
        setAppMode('chat')
        setCurrentConversationId(newActiveTab.sessionId)
        setCurrentAgentSessionId(null)
        return
      }

      // Agent
      setAppMode('agent')
      setCurrentAgentSessionId(newActiveTab.sessionId)
      setCurrentConversationId(null)

      // 清除该会话的"已完成未查看"标记
      setUnviewedCompleted((prev) => {
        if (!prev.has(newActiveTab.sessionId)) return prev
        const next = new Set(prev)
        next.delete(newActiveTab.sessionId)
        return next
      })

      // 同步 workspace
      const session = agentSessions.find((s) => s.id === newActiveTab.sessionId)
      if (session?.workspaceId) {
        setCurrentAgentWorkspaceId(session.workspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: session.workspaceId,
        }).catch(console.error)
      }
    },
    [
      setAppMode,
      setCurrentConversationId,
      setCurrentAgentSessionId,
      setCurrentAgentWorkspaceId,
      setUnviewedCompleted,
      agentSessions,
    ],
  )
}
