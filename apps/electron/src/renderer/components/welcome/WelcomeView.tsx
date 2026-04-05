/**
 * WelcomeView — 主区域空状态启动器
 *
 * 当没有打开任何标签页时：
 * 1. 优先复用现有会话（打开最近的一个）
 * 2. 没有现有会话时，创建一个 draft 会话（不在侧边栏显示）
 *
 * 这样用户直接看到完整的 ChatView/AgentView（含全功能输入框），
 * 发送第一条消息后 draft 标记自动移除，会话出现在侧边栏。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Loader2 } from 'lucide-react'
import { appModeAtom } from '@/atoms/app-mode'
import { conversationsAtom } from '@/atoms/chat-atoms'
import { agentSessionsAtom, currentAgentWorkspaceIdAtom, agentSettingsReadyAtom } from '@/atoms/agent-atoms'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

export function WelcomeView(): React.ReactElement {
  const mode = useAtomValue(appModeAtom)
  const conversations = useAtomValue(conversationsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentSettingsReady = useAtomValue(agentSettingsReadyAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const { createChat, createAgent } = useCreateSession()
  const initRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    // 如果已经为当前模式初始化过，则跳过
    if (initRef.current === mode) return
    // Agent 模式需等待 settings 就绪（workspaceId 等异步加载完成）
    if (mode === 'agent' && !agentSettingsReady) return
    initRef.current = mode

    if (mode === 'chat') {
      // 1. 优先复用现有非归档、非 draft 会话
      const existing = conversations.find((c) => !c.archived && !draftSessionIds.has(c.id))
      if (existing) {
        const result = openTab(tabs, layout, {
          type: 'chat',
          sessionId: existing.id,
          title: existing.title,
        })
        setTabs(result.tabs)
        setLayout(result.layout)
        return
      }
      // 2. 检查是否已有 draft 会话，复用而不是创建新的
      const draftSession = conversations.find((c) => !c.archived && draftSessionIds.has(c.id))
      if (draftSession) {
        const result = openTab(tabs, layout, {
          type: 'chat',
          sessionId: draftSession.id,
          title: draftSession.title,
        })
        setTabs(result.tabs)
        setLayout(result.layout)
        return
      }
      // 3. 没有任何会话时才创建新的 draft 会话
      createChat({ draft: true })
    } else {
      // Agent 模式：按当前工作区过滤
      // 1. 优先复用现有非归档、非 draft 会话
      const existing = agentSessions.find(
        (s) => !s.archived && s.workspaceId === currentWorkspaceId && !draftSessionIds.has(s.id),
      )
      if (existing) {
        const result = openTab(tabs, layout, {
          type: 'agent',
          sessionId: existing.id,
          title: existing.title,
        })
        setTabs(result.tabs)
        setLayout(result.layout)
        return
      }
      // 2. 检查是否已有 draft 会话（当前工作区），复用而不是创建新的
      const draftSession = agentSessions.find(
        (s) => !s.archived && s.workspaceId === currentWorkspaceId && draftSessionIds.has(s.id),
      )
      if (draftSession) {
        const result = openTab(tabs, layout, {
          type: 'agent',
          sessionId: draftSession.id,
          title: draftSession.title,
        })
        setTabs(result.tabs)
        setLayout(result.layout)
        return
      }
      // 3. 没有任何会话时才创建新的 draft 会话
      createAgent({ draft: true })
    }
  }, [mode, agentSettingsReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // 短暂的过渡状态（通常几十毫秒内就会被 SplitContainer 替换）
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
    </div>
  )
}
