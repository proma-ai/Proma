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
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
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
  }, [tabs, activeTabId, setTabs, setActiveTabId, setViewStateMap, syncActiveTabSideEffects, clearIdleAgentCompletionNotice])

  const requestClose = React.useCallback((tabId: string) => {
    executeClose(tabId)
  }, [executeClose])

  return { requestClose, executeClose }
}
