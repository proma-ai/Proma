/**
 * TabContent — 标签内容渲染器
 *
 * 根据标签类型渲染参数化的 ChatView 或 AgentView。
 * 直接传递 sessionId/conversationId prop，无需桥接全局 atoms。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { tabsAtom } from '@/atoms/tab-atoms'
import { markdownTocOpenAtom } from '@/atoms/markdown-toc'
import { ChatView } from '@/components/chat'
import { AgentView } from '@/components/agent'
import { PreviewTabContent } from '@/components/diff/PreviewTabContent'
import { MarkdownRichEditor } from '@/components/diff/MarkdownRichEditor'
import { MarkdownToc } from '@/components/diff/MarkdownToc'
import { ScratchPadView } from '@/components/scratch-pad/ScratchPadView'
import { TabErrorBoundary } from './TabErrorBoundary'

export interface TabContentProps {
  tabId: string
}

export function TabContent({ tabId }: TabContentProps): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)

  // [FLASH-DEBUG] 监控 tab 查找失败（说明 tabId 指向了不存在的标签）
  React.useEffect(() => {
    if (!tab) {
      console.warn(`[FLASH-DEBUG] TabContent: tab not found for tabId="${tabId}"`, { tabIds: tabs.map(t => t.id) })
    }
  }, [tab, tabId, tabs])

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        标签页不存在
      </div>
    )
  }

  if (tab.type === 'scratch') {
    return <ScratchPadView />
  }

  if (tab.type === 'tutorial') {
    return <TutorialTabContent />
  }

  if (tab.type === 'chat') {
    return (
      <TabErrorBoundary key={tab.sessionId} sessionId={tab.sessionId}>
        <ChatView conversationId={tab.sessionId} />
      </TabErrorBoundary>
    )
  }

  if (tab.type === 'preview') {
    return (
      <TabErrorBoundary key={tab.id} sessionId={tab.sessionId}>
        <PreviewTabContent sessionId={tab.sessionId} />
      </TabErrorBoundary>
    )
  }

  return (
    <TabErrorBoundary key={tab.sessionId} sessionId={tab.sessionId}>
      <AgentView sessionId={tab.sessionId} />
    </TabErrorBoundary>
  )
}

function TutorialTabContent(): React.ReactElement {
  const [content, setContent] = React.useState<string | null>(null)
  const [tocOpen] = useAtom(markdownTocOpenAtom)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    window.electronAPI.getTutorialContent().then(setContent).catch(console.error)
  }, [])

  if (content === null) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中...</div>

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <MarkdownToc containerRef={scrollRef as React.RefObject<HTMLElement>} contentKey={content.slice(0, 100)} enabled={tocOpen} />
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto p-8">
        <MarkdownRichEditor
          value={content}
          editing={false}
          onChange={() => {}}
          onSave={() => {}}
          onCancel={() => {}}
        />
      </div>
    </div>
  )
}
