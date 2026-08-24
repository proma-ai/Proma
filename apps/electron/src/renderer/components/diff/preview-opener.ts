/**
 * useOpenPreview — 统一的预览入口 Hook
 *
 * 把分散在 SidePanel / PreviewOpenButton / AgentView 等处的「打开预览」逻辑收敛到一处。
 * 文件、Markdown 与 Diff 一律在右侧工作区的预览 Tab 打开，不再占用主内容区。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import {
  getPreviewFileId,
  previewFileMapAtom,
  previewFilesMapAtom,
  previewPanelOpenMapAtom,
  type PreviewFile,
} from '@/atoms/preview-atoms'
import {
  activeTabIdAtom,
  closeTab,
  isPreviewTab,
  sessionViewStateMapAtom,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { agentDiffPanelTabAtom, agentSidePanelOpenAtomFamily, getPreviewSidePanelTab } from '@/atoms/agent-atoms'

/** Jotai store 类型（从 useStore 推导，避免直接 import 内部 Store 类型） */
type JotaiStore = ReturnType<typeof useStore>

/** 兼容旧调用方；右侧工作区方案下不再使用 mode。 */
export interface OpenPreviewOptions {
  mode?: 'tab' | 'split'
}

export function useOpenPreview() {
  const store = useStore()

  return React.useCallback(
    (sessionId: string, file: PreviewFile, _options?: OpenPreviewOptions) => {
      const previewId = getPreviewFileId(file)
      store.set(previewFilesMapAtom, (prev) => {
        const next = new Map(prev)
        const files = next.get(sessionId) ?? []
        // 同一预览身份再次打开时保留 Tab 顺序，但采用最新权限、根目录与解析上下文。
        // 否则先以只读/Skill 上下文打开后会永久复用过期元数据。
        const existingIndex = files.findIndex((item) => getPreviewFileId(item) === previewId)
        next.set(sessionId, existingIndex === -1
          ? [...files, file]
          : files.map((item, index) => index === existingIndex ? file : item))
        return next
      })
      store.set(previewFileMapAtom, (prev) => {
        const next = new Map(prev)
        next.set(sessionId, file)
        return next
      })
      store.set(previewPanelOpenMapAtom, (prev) => {
        const next = new Map(prev)
        next.set(sessionId, true)
        return next
      })
      // 所有入口都复用同一右侧工作区，并以会话为粒度隔离预览状态。
      store.set(agentSidePanelOpenAtomFamily(sessionId), true)
      store.set(agentDiffPanelTabAtom, (prev) => {
        const next = new Map(prev)
        next.set(sessionId, getPreviewSidePanelTab(previewId))
        return next
      })
    },
    [store],
  )
}

/**
 * tearOffPreviewToSplit — 兼容旧 preview Tab：将其迁入右侧工作区预览。
 *
 * 保留此导出供旧的拖拽和预览 Tab 操作调用；新预览不会再创建主内容区 Tab。
 */
export function tearOffPreviewToSplit(store: JotaiStore, tabId: string): void {
  const tabs = store.get(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)
  if (!tab || !isPreviewTab(tab)) return

  const sessionId = tab.sessionId

  const agentTab = tabs.find((t) => t.type === 'agent' && t.sessionId === sessionId)
  if (!agentTab) return

  // 关闭旧 preview Tab，并激活对应 Agent 会话，让右侧工作区可见
  const closed = closeTab(store.get(tabsAtom), store.get(activeTabIdAtom), tabId)
  store.set(tabsAtom, closed.tabs)
  store.set(activeTabIdAtom, agentTab.id)

  // 标记会话视图为 session，避免切走再切回时重建 preview Tab
  store.set(sessionViewStateMapAtom, (prev) => {
    const m = new Map(prev)
    m.set(sessionId, { previewTabOpen: false, lastView: 'session' })
    return m
  })

  store.set(previewPanelOpenMapAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, true)
    return next
  })
  store.set(agentSidePanelOpenAtomFamily(sessionId), true)
  store.set(agentDiffPanelTabAtom, (prev) => {
    const next = new Map(prev)
    next.set(sessionId, 'preview')
    return next
  })
}
