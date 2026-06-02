/**
 * useTrackSessionView — 记录每个会话上次停留的视图（仅运行期内存态）
 *
 * 监听当前激活的 Tab：
 * - 激活预览 Tab → 记录该会话 lastView='preview' 且 previewTabOpen=true
 * - 激活会话（agent）Tab → 记录该会话 lastView='session'（不改 previewTabOpen，
 *   预览 Tab 仍属于该会话，切回时据此重建）
 *
 * 集中在一个 effect 里覆盖所有激活路径（侧边栏、Ctrl+Tab、TabBar 点击、按钮打开预览），
 * 避免在每个调用点各写一份。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeTabAtom,
  sessionViewStateMapAtom,
  type SessionView,
} from '@/atoms/tab-atoms'

export function useTrackSessionView(): void {
  const activeTab = useAtomValue(activeTabAtom)
  const setViewStateMap = useSetAtom(sessionViewStateMapAtom)

  React.useEffect(() => {
    if (!activeTab) return
    // 只追踪会话相关的 Tab（agent 会话 + 其预览），chat/scratch 不参与预览重建
    const isPreview = activeTab.type === 'preview'
    const isAgent = activeTab.type === 'agent'
    if (!isPreview && !isAgent) return

    const sessionId = activeTab.sessionId
    const lastView: SessionView = isPreview ? 'preview' : 'session'

    setViewStateMap((prev) => {
      const current = prev.get(sessionId)
      // 激活预览 Tab 一定意味着它开着；激活会话 Tab 保留已有的 previewTabOpen
      const previewTabOpen = isPreview ? true : (current?.previewTabOpen ?? false)
      if (current && current.lastView === lastView && current.previewTabOpen === previewTabOpen) {
        return prev
      }
      const next = new Map(prev)
      next.set(sessionId, { previewTabOpen, lastView })
      return next
    })
  }, [activeTab, setViewStateMap])
}
