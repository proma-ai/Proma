/**
 * useCloseTab — 统一的当前会话入口关闭逻辑
 *
 * 被 TabBar（×按钮/中键）和 GlobalShortcuts（Cmd+W）共用，
 *
 * 关键行为：
 * - 关闭当前会话入口只回到 Scratch Pad，不停止后台 Agent
 * - 运行中或阻塞中的会话继续通过左侧状态 indicator 恢复
 * - idle 状态的 Agent 会话在用户主动关闭 Tab 时清除完成提醒状态
 * - 真正删除/归档时由侧边栏路径负责清理 per-session 状态
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { useStore } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  closeTab,
  isPreviewTab,
  sessionViewStateMapAtom,
} from '@/atoms/tab-atoms'
import {
  agentSessionsAtom,
  agentSessionIndicatorMapAtom,
  agentStreamingStatesAtom,
  liveMessagesMapAtom,
  unviewedCompletedSessionIdsAtom,
  agentSessionStreamingStateAtomFamily,
  agentSessionViewStreamStateAtomFamily,
  agentLiveMessagesAtomFamily,
  agentSessionDraftAtomFamily,
  agentSessionDraftHtmlAtomFamily,
  agentPendingFilesAtomFamily,
  agentMessageQueueAtomFamily,
  backgroundTasksAtomFamily,
  sessionPersistedPermissionModeAtom,
  sessionExistsAtom,
} from '@/atoms/agent-atoms'
import { agentSideChatMapAtom } from '@/atoms/chat-atoms'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'

interface UseCloseTabReturn {
  /** 请求关闭当前会话入口 */
  requestClose: (tabId: string) => void
  /** 直接执行关闭 */
  executeClose: (tabId: string) => void
}

export function useCloseTab(): UseCloseTabReturn {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()
  const store = useStore()
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const setViewStateMap = useSetAtom(sessionViewStateMapAtom)
  const setSideChatMap = useSetAtom(agentSideChatMapAtom)

  const clearIdleAgentCompletionNotice = React.useCallback((sessionId: string) => {
    const indicatorMap = store.get(agentSessionIndicatorMapAtom)
    const status = indicatorMap.get(sessionId)
    // running 或 blocked 的会话仍需要侧边栏状态提示
    if (status === 'running' || status === 'blocked') return

    // 通过 IPC 清除持久化的 completedButUnconfirmed 和旧版 manualWorking 状态
    window.electronAPI.clearAgentCompletionState(sessionId)
      .then((updated) => {
        setAgentSessions((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s))
        )
      })
      .catch(console.error)

    setUnviewedCompleted((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
  }, [store, setAgentSessions, setUnviewedCompleted])

  const executeClose = React.useCallback((tabId: string) => {
    const closingTab = tabs.find((t) => t.id === tabId)
    const wasActive = activeTabId === tabId
    const result = closeTab(tabs, activeTabId, tabId)
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)

    // 同步该会话的视图状态：
    // - 关闭预览 Tab → 预览不再打开（保留 lastView，切回不再重建预览）
    // - 关闭会话 Tab（连带其预览）→ 删除整条记录
    if (closingTab) {
      if (isPreviewTab(closingTab)) {
        setViewStateMap((prev) => {
          const current = prev.get(closingTab.sessionId)
          if (!current) return prev
          const next = new Map(prev)
          next.set(closingTab.sessionId, { previewTabOpen: false, lastView: current.lastView })
          return next
        })
      } else if (closingTab.type === 'agent') {
        setViewStateMap((prev) => {
          if (!prev.has(closingTab.sessionId)) return prev
          const next = new Map(prev)
          next.delete(closingTab.sessionId)
          return next
        })
      }

      if (closingTab.type === 'agent') {
        setSideChatMap((prev) => {
          if (!prev.has(closingTab.sessionId)) return prev
          const next = new Map(prev)
          next.delete(closingTab.sessionId)
          return next
        })
        // atomFamily 按 string key 强引用缓存。关闭 Tab 不清除运行态 base map，
        // 以免后台 Agent 失去状态；但释放派生 atom 实例，避免频繁打开历史会话长期累积。
        agentSessionStreamingStateAtomFamily.remove(closingTab.sessionId)
        agentSessionViewStreamStateAtomFamily.remove(closingTab.sessionId)
        agentLiveMessagesAtomFamily.remove(closingTab.sessionId)
        agentSessionDraftAtomFamily.remove(closingTab.sessionId)
        agentSessionDraftHtmlAtomFamily.remove(closingTab.sessionId)
        agentPendingFilesAtomFamily.remove(closingTab.sessionId)
        agentMessageQueueAtomFamily.remove(closingTab.sessionId)
        backgroundTasksAtomFamily.remove(closingTab.sessionId)
        sessionPersistedPermissionModeAtom.remove(closingTab.sessionId)
        sessionExistsAtom.remove(closingTab.sessionId)

        // 已停止会话关闭后不再需要保留全局 Map 中的终态流数据。
        // 运行/阻塞会话必须保留，左侧状态和后台恢复仍依赖它们。
        const status = store.get(agentSessionIndicatorMapAtom).get(closingTab.sessionId)
        if (status !== 'running' && status !== 'blocked') {
          store.set(agentStreamingStatesAtom, (prev) => {
            if (!prev.has(closingTab.sessionId)) return prev
            const next = new Map(prev)
            next.delete(closingTab.sessionId)
            return next
          })
          store.set(liveMessagesMapAtom, (prev) => {
            if (!prev.has(closingTab.sessionId)) return prev
            const next = new Map(prev)
            next.delete(closingTab.sessionId)
            return next
          })
        }
      } else if (closingTab.type === 'chat') {
        setSideChatMap((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [ownerSessionId, conversationId] of next) {
            if (conversationId === closingTab.sessionId) {
              next.delete(ownerSessionId)
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
    }

    if (wasActive) {
      const newActiveTab = result.activeTabId
        ? result.tabs.find((t) => t.id === result.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(newActiveTab)
    }

    // 用户主动关闭 idle 的 Agent Tab 时，清除完成提醒状态
    if (closingTab && closingTab.type === 'agent') {
      clearIdleAgentCompletionNotice(closingTab.sessionId)
    }
  }, [tabs, activeTabId, setTabs, setActiveTabId, setViewStateMap, setSideChatMap, syncActiveTabSideEffects, clearIdleAgentCompletionNotice])

  const requestClose = React.useCallback((tabId: string) => {
    executeClose(tabId)
  }, [executeClose])

  return { requestClose, executeClose }
}
