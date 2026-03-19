/**
 * AgentRecommendBanner — Agent 模式推荐横幅
 *
 * 当 AI 通过 suggest_agent_mode 工具推荐切换到 Agent 模式时，
 * 在 ChatInput 上方展示推荐横幅（与 AskUserBanner 同风格同位置）。
 * 用户可点击"切换到 Agent 模式"按钮迁移，或点击 × 关闭。
 *
 * 迁移流程：
 * 1. 清除推荐状态（先清再切换，避免 ChatView 副作用）
 * 2. 创建 Agent 会话（绑定默认工作区）
 * 3. 将 Chat 对话历史复制到新 Agent 会话
 * 4. 切换到默认工作区 + Agent 模式
 * 5. 在 Agent 输入区显示建议提示（prompt suggestion）
 */

import * as React from 'react'
import { useAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { Sparkles, X, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pendingAgentRecommendationAtom } from '@/atoms/chat-atoms'
import {
  agentChannelIdAtom,
  agentWorkspacesAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  agentPromptSuggestionsAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { appModeAtom } from '@/atoms/app-mode'
import { tabsAtom, splitLayoutAtom, openTab } from '@/atoms/tab-atoms'

export function AgentRecommendBanner(): React.ReactElement | null {
  const [recommendation, setRecommendation] = useAtom(pendingAgentRecommendationAtom)
  const store = useStore()
  const [migrating, setMigrating] = React.useState(false)

  if (!recommendation) return null

  const handleDismiss = (): void => {
    setRecommendation(null)
  }

  const handleMigrate = async (): Promise<void> => {
    if (migrating) return

    const agentChannelId = store.get(agentChannelIdAtom)
    if (!agentChannelId) {
      toast.error('请先在设置中配置 Agent 渠道')
      return
    }

    // 保存推荐数据后立即清除，避免模式切换时 ChatView 副作用
    const { conversationId, suggestedPrompt } = recommendation
    setRecommendation(null)

    setMigrating(true)
    try {
      const workspaces = store.get(agentWorkspacesAtom)
      const defaultWorkspaceId = workspaces[0]?.id ?? null

      // 1. 创建 Agent 会话
      const session = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId,
        defaultWorkspaceId ?? undefined,
      )

      // 2. 迁移 Chat 对话记录到新 Agent 会话
      await window.electronAPI.migrateChatToAgent(conversationId, session.id)

      // 3. 刷新会话列表
      const sessions = await window.electronAPI.listAgentSessions()
      store.set(agentSessionsAtom, sessions)

      // 4. 切换到默认工作区（确保 AgentView 能正确显示新会话）
      if (defaultWorkspaceId) {
        store.set(currentAgentWorkspaceIdAtom, defaultWorkspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: defaultWorkspaceId,
        }).catch(console.error)
      }

      // 5. 切换模式
      store.set(appModeAtom, 'agent')
      store.set(activeViewAtom, 'conversations')

      // 6. 打开 Agent 会话 Tab 并激活
      const sessionTitle = session.title ?? '新 Agent 会话'
      const tabs = store.get(tabsAtom)
      const layout = store.get(splitLayoutAtom)
      const result = openTab(tabs, layout, {
        type: 'agent',
        sessionId: session.id,
        title: sessionTitle,
      })
      store.set(tabsAtom, result.tabs)
      store.set(splitLayoutAtom, result.layout)
      store.set(currentAgentSessionIdAtom, session.id)

      // 7. 在 Agent 输入区显示建议提示（用户点击后发送，而非自动发送）
      store.set(agentPromptSuggestionsAtom, (prev) => {
        const map = new Map(prev)
        map.set(session.id, suggestedPrompt)
        return map
      })

      // 8. 通知用户
      toast.success('已切换到 Agent 模式', {
        description: '对话历史已迁移到新的 Agent 会话',
      })
    } catch (error) {
      console.error('[AgentRecommendBanner] 迁移失败:', error)
      toast.error('切换到 Agent 模式失败')
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="mx-4 mb-3 rounded-xl bg-card shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium text-foreground">推荐使用 Agent 模式</span>
          </div>
          <button
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={handleDismiss}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 推荐理由 */}
      <div className="px-4 pb-3">
        <p className="text-sm text-foreground/80 leading-relaxed">
          {recommendation.reason}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-end px-4 pb-3">
        <Button
          variant="default"
          size="sm"
          onClick={handleMigrate}
          disabled={migrating}
          className="h-7 px-3 text-xs"
        >
          {migrating ? '切换中...' : '切换到 Agent 模式'}
          {!migrating && <ArrowRight className="size-3 ml-1" />}
        </Button>
      </div>
    </div>
  )
}
