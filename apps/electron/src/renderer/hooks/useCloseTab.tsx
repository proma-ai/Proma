/**
 * useCloseTab — 统一的标签页关闭逻辑
 *
 * 被 TabBar（×按钮/中键）和 GlobalShortcuts（Cmd+W）共用，
 * 解决原实现"关闭 Agent Tab 时不调 stopAgent 导致 claude 子进程残留"的问题。
 *
 * 关键行为：
 * - Agent Tab 关闭前先调 window.electronAPI.stopAgent(sessionId) 终止子进程
 * - 若 Agent 正在流式中，先弹 AlertDialog 让用户确认（通过 pendingCloseTabIdAtom 驱动）
 * - Chat Tab 走原有 UI 清理链路
 */

import * as React from 'react'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  closeTab,
} from '@/atoms/tab-atoms'
import {
  agentRunningSessionIdsAtom,
  agentSidePanelOpenMapAtom,
  workingDoneSessionIdsAtom,
} from '@/atoms/agent-atoms'
import {
  conversationModelsAtom,
  conversationContextLengthAtom,
  conversationThinkingEnabledAtom,
  conversationParallelModeAtom,
} from '@/atoms/chat-atoms'
import { conversationPromptIdAtom } from '@/atoms/system-prompt-atoms'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'

/** 触发"关闭确认对话框"的状态：存放待关闭的 tabId，null 表示无对话框 */
export const pendingCloseTabIdAtom = atom<string | null>(null)

interface UseCloseTabReturn {
  /** 请求关闭：若 Agent 流式中则弹确认，否则直接关 */
  requestClose: (tabId: string) => void
  /** 直接执行关闭（跳过确认，供 Dialog 的"确认"按钮使用） */
  executeClose: (tabId: string) => void
}

export function useCloseTab(): UseCloseTabReturn {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const runningSessionIds = useAtomValue(agentRunningSessionIdsAtom)
  const setPending = useSetAtom(pendingCloseTabIdAtom)
  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()

  // per-conversation / per-session Map atoms（关闭 Tab 时需要清理对应条目）
  const setConvModels = useSetAtom(conversationModelsAtom)
  const setConvContextLength = useSetAtom(conversationContextLengthAtom)
  const setConvThinking = useSetAtom(conversationThinkingEnabledAtom)
  const setConvParallel = useSetAtom(conversationParallelModeAtom)
  const setConvPromptId = useSetAtom(conversationPromptIdAtom)
  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenMapAtom)

  const cleanupMapAtoms = React.useCallback((tabId: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(tabId)) return prev
      const map = new Map(prev)
      map.delete(tabId)
      return map
    }
    setConvModels(deleteKey)
    setConvContextLength(deleteKey)
    setConvThinking(deleteKey)
    setConvParallel(deleteKey)
    setConvPromptId(deleteKey)
    setAgentSidePanelOpen(deleteKey)
  }, [setConvModels, setConvContextLength, setConvThinking, setConvParallel, setConvPromptId, setAgentSidePanelOpen])

  const executeClose = React.useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)

    // Agent 类型：先通知主进程中止 SDK 子进程，再做 UI 清理
    // 这是 Issue #357 的核心修复：断开"UI 关闭 → IPC stop → claude subprocess 退出"断链
    if (tab?.type === 'agent') {
      window.electronAPI.stopAgent(tab.sessionId).catch((err) => {
        console.error('[useCloseTab] stopAgent 失败:', err)
      })
    }

    const wasActive = activeTabId === tabId
    const result = closeTab(tabs, activeTabId, tabId)
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)

    if (wasActive) {
      const newActiveTab = result.activeTabId
        ? result.tabs.find((t) => t.id === result.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(newActiveTab)
    }

    cleanupMapAtoms(tabId)
    setWorkingDone((prev) => {
      if (!prev.has(tabId)) return prev
      const next = new Set(prev)
      next.delete(tabId)
      return next
    })
  }, [tabs, activeTabId, setTabs, setActiveTabId, cleanupMapAtoms, setWorkingDone, syncActiveTabSideEffects])

  const requestClose = React.useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    // 流式中弹确认，避免误关丢失进度
    if (tab?.type === 'agent' && runningSessionIds.has(tab.sessionId)) {
      setPending(tabId)
      return
    }
    executeClose(tabId)
  }, [tabs, runningSessionIds, setPending, executeClose])

  return { requestClose, executeClose }
}
