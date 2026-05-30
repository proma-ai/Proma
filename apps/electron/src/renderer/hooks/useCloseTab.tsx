/**
 * useCloseTab — 统一的当前会话入口关闭逻辑
 *
 * 被 TabBar（×按钮/中键）和 GlobalShortcuts（Cmd+W）共用，
 *
 * 关键行为：
 * - 关闭当前会话入口只回到 Scratch Pad，不停止后台 Agent
 * - 运行中、阻塞中、已完成未查看会话会继续通过左侧 Working 区恢复
 * - 真正删除/归档时由侧边栏路径负责清理 per-session 状态
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import {
  tabsAtom,
  activeTabIdAtom,
  closeTab,
} from '@/atoms/tab-atoms'
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

  const executeClose = React.useCallback((tabId: string) => {
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
  }, [tabs, activeTabId, setTabs, setActiveTabId, syncActiveTabSideEffects])

  const requestClose = React.useCallback((tabId: string) => {
    executeClose(tabId)
  }, [executeClose])

  return { requestClose, executeClose }
}
