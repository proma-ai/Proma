/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。Agent 模式下若预览面板打开，则在同一个 Panel 内分屏：
 * 顶部一行：左侧 TabBar + 右侧预览顶栏（含文件名、复制按钮）
 * 主体：左侧 TabContent + 右侧预览内容
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useAtom } from 'jotai'
import { tabsAtom, activeTabIdAtom, activeTabAtom } from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { SettingsDialog } from '@/components/settings'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { previewPanelOpenMapAtom, previewSplitRatioAtom } from '@/atoms/preview-atoms'
import { PreviewPanel } from '@/components/diff/PreviewPanel'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'

export function MainArea(): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const activeTab = useAtomValue(activeTabAtom)

  const previewOpenMap = useAtomValue(previewPanelOpenMapAtom)
  const [splitRatio, setSplitRatio] = useAtom(previewSplitRatioAtom)
  const previewDragging = React.useRef(false)

  const previewOpen =
    activeTab?.type === 'agent' && (previewOpenMap.get(activeTab.sessionId) ?? false)
  const previewSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null

  const handlePreviewDragStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    previewDragging.current = true
    const startX = e.clientX
    const startRatio = splitRatio
    const containerEl = (e.currentTarget as HTMLElement).closest('[data-split-container]') as HTMLElement | null
    const containerWidth = containerEl?.clientWidth ?? 1
    let rafId = 0

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = 'none' })

    const onMouseMove = (ev: MouseEvent) => {
      if (!previewDragging.current) return
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const delta = ev.clientX - startX
        const newRatio = Math.max(0.3, Math.min(0.8, startRatio + delta / containerWidth))
        setSplitRatio(newRatio)
      })
    }
    const onMouseUp = () => {
      previewDragging.current = false
      if (rafId) cancelAnimationFrame(rafId)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      document.querySelectorAll('iframe').forEach((f) => { (f as HTMLElement).style.pointerEvents = '' })
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [splitRatio, setSplitRatio])

  React.useEffect(() => {
    if (tabs.length === 0) {
      console.warn('[FLASH-DEBUG] MainArea: tabs.length === 0, showing WelcomeView!', new Error().stack)
    }
  }, [tabs.length])

  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      setActiveTabId(tabs[0]!.id)
    }
  }, [tabs, activeTabId, setActiveTabId])

  return (
    <>
      <Panel
        variant="grow"
        className="bg-content-area rounded-2xl shadow-xl"
      >
        {previewOpen && previewSessionId ? (
          <div className="flex flex-1 min-h-0" data-split-container>
            {/* 左侧：TabBar + TabContent */}
            <div
              className="flex flex-col min-w-0 h-full"
              style={{ flex: `0 0 calc(${splitRatio * 100}% - 4px)` }}
            >
              <TabBar />
              {tabs.length === 0 ? (
                <WelcomeView />
              ) : activeTabId ? (
                <div className="flex-1 min-h-0 titlebar-no-drag">
                  <TabContent tabId={activeTabId} />
                </div>
              ) : null}
            </div>

            {/* 拖拽手柄 */}
            <div
              className="w-[8px] cursor-col-resize bg-border/40 hover:bg-primary/30 active:bg-primary/50 transition-colors flex-shrink-0 self-stretch"
              onMouseDown={handlePreviewDragStart}
            />

            {/* 右侧：PreviewPanel */}
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              <PreviewPanel sessionId={previewSessionId} />
            </div>
          </div>
        ) : (
          <>
            <TabBar />
            {tabs.length === 0 ? (
              <WelcomeView />
            ) : activeTabId ? (
              <div className="flex-1 min-h-0 titlebar-no-drag">
                <TabContent tabId={activeTabId} />
              </div>
            ) : null}
          </>
        )}
      </Panel>
      <SettingsDialog />
    </>
  )
}
