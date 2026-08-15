/**
 * TabContent — 标签内容渲染器
 *
 * 根据标签类型渲染参数化的 ChatView 或 AgentView。
 * 直接传递 sessionId/conversationId prop，无需桥接全局 atoms。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { tabsAtom } from '@/atoms/tab-atoms'
import { markdownTocOpenAtom } from '@/atoms/markdown-toc'
import { ChatView } from '@/components/chat'
import { AgentView } from '@/components/agent'
import { PreviewTabContent } from '@/components/diff/PreviewTabContent'
import { MarkdownRichEditor } from '@/components/diff/MarkdownRichEditor'
import { MarkdownToc } from '@/components/diff/MarkdownToc'
import { ScratchPadView } from '@/components/scratch-pad/ScratchPadView'
import { cn } from '@/lib/utils'
import { TabErrorBoundary } from './TabErrorBoundary'

const AGENT_SESSION_TRANSITION_MS = 140

/**
 * 切换时立即挂载新会话（不保留旧会话），只给新内容一段短暂进入过渡。
 * 仅合成 opacity，避免为整段对话测量高度或触发布局动画。
 */
function AgentSessionTransition({ children, animate }: { children: React.ReactNode; animate: boolean }): React.ReactElement {
  const [entered, setEntered] = React.useState(!animate)

  React.useEffect(() => {
    if (!animate) {
      setEntered(true)
      return
    }
    const frameId = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(frameId)
  }, [animate])

  return (
    <div
      className={cn(
        'h-full min-h-0 transition-opacity ease-out motion-reduce:transition-none',
        entered ? 'opacity-100' : 'opacity-0',
      )}
      style={{ transitionDuration: `${AGENT_SESSION_TRANSITION_MS}ms` }}
    >
      {children}
    </div>
  )
}

export interface TabContentProps {
  tabId: string
}

function TabContentView({ tabId }: TabContentProps): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)
  const hasShownAgentSessionRef = React.useRef(false)
  const shouldAnimateAgentSession = tab?.type === 'agent' && hasShownAgentSessionRef.current

  React.useEffect(() => {
    if (tab?.type === 'agent') hasShownAgentSessionRef.current = true
  }, [tab?.sessionId, tab?.type])

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
    <AgentSessionTransition key={tab.sessionId} animate={shouldAnimateAgentSession}>
      <TabErrorBoundary sessionId={tab.sessionId}>
        <AgentView sessionId={tab.sessionId} />
      </TabErrorBoundary>
    </AgentSessionTransition>
  )
}

export const TabContent = React.memo(TabContentView)

function TutorialTabContent(): React.ReactElement {
  const [content, setContent] = React.useState('')
  const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const tocOpen = useAtomValue(markdownTocOpenAtom)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    window.electronAPI.getTutorialContent()
      .then((result) => {
        if (result === null) {
          setLoadState('error')
          return
        }
        setContent(result)
        setLoadState('ready')
      })
      .catch((error) => {
        console.error(error)
        setLoadState('error')
      })
  }, [])

  if (loadState === 'loading') {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">加载中...</div>
  }

  if (loadState === 'error') {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">教程加载失败</div>
  }

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
