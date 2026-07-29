import type { AgentSessionMeta } from '@proma/shared'
import type { AgentStreamState } from '@/atoms/agent-atoms'

export interface ExternalAgentRunTab {
  id: string
  type: 'chat' | 'agent' | 'scratch' | 'preview' | 'tutorial'
  sessionId: string
  title: string
}

export interface ExternalAgentRunActivationInput {
  tabs: ExternalAgentRunTab[]
  sessions: AgentSessionMeta[]
  sessionId: string
  title?: string
  workspaceId?: string
  modelId?: string
  startedAt: number
  currentStreamState?: AgentStreamState
}

export interface ExternalAgentRunActivation {
  tabs: ExternalAgentRunTab[]
  activeTabId: string
  title: string
  workspaceId?: string
  modelId?: string
  streamState: AgentStreamState
}

/** 迟到的启动事件不得复活已结束运行，或覆盖同一会话的更新运行。 */
export function shouldActivateExternalAgentRun(
  currentStreamState: AgentStreamState | undefined,
  startedAt: number,
): boolean {
  if (!currentStreamState || currentStreamState.startedAt == null) return true
  if (currentStreamState.startedAt > startedAt) return false
  if (currentStreamState.startedAt === startedAt) {
    return currentStreamState.running && !currentStreamState.backgroundWaiting
  }
  return true
}

export function buildExternalAgentRunActivation(
  input: ExternalAgentRunActivationInput,
): ExternalAgentRunActivation {
  const session = input.sessions.find((item) => item.id === input.sessionId)
  const title = input.title ?? session?.title ?? '新 Agent 会话'
  const tabsWithoutPreview = input.tabs.filter((tab) => tab.type !== 'preview')
  const existingTab = tabsWithoutPreview.find((tab) => tab.type === 'agent' && tab.sessionId === input.sessionId)
  const tabs = existingTab
    ? (tabsWithoutPreview.length === input.tabs.length ? input.tabs : tabsWithoutPreview)
    : [...tabsWithoutPreview, { id: input.sessionId, type: 'agent' as const, sessionId: input.sessionId, title }]
  const activeTabId = existingTab?.id ?? input.sessionId

  return {
    tabs,
    activeTabId,
    title,
    workspaceId: input.workspaceId ?? session?.workspaceId,
    modelId: input.modelId,
    streamState: {
      ...input.currentStreamState,
      running: true,
      content: input.currentStreamState?.content ?? '',
      toolActivities: input.currentStreamState?.toolActivities ?? [],
      model: input.modelId ?? input.currentStreamState?.model,
      startedAt: input.startedAt,
    },
  }
}
