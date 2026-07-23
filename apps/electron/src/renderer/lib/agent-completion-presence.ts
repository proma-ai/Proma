import type { AgentSessionMeta, AgentStreamCompletePayload } from '@proma/shared'
import type { TabItem } from '@/atoms/tab-atoms'

export interface AgentCompletionPresenceInput {
  tabs: TabItem[]
  activeTabId: string | null
  currentAgentSessionId: string | null
  sessionId: string
  /** 完成发生时应用窗口是否处于前台。窗口失焦时即使是当前 Tab 也不算"正在查看"。 */
  documentHasFocus: boolean
}

export interface AgentCompletionMarkers {
  markUnviewedCompleted: boolean
}

export interface AgentCompletionNotificationInput {
  completion: AgentStreamCompletePayload
  session?: Pick<AgentSessionMeta, 'sourceDelegationId'>
}

export interface NotifyAgentCompletionInput extends AgentCompletionNotificationInput {
  hasStreamError: boolean
  notify: () => void
}

/** 仅顶层 Agent 会话完成属于用户级任务完成提醒边界 */
export function shouldNotifyAgentCompletion({
  completion,
  session,
}: AgentCompletionNotificationInput): boolean {
  return completion.triggeredBy !== 'delegation' && !session?.sourceDelegationId
}

/** 仅在真正成功且无需等待后台任务时调用完成通知 callback */
export function notifyAgentCompletion({
  completion,
  session,
  hasStreamError,
  notify,
}: NotifyAgentCompletionInput): void {
  const isSuccessfulCompletion = !completion.stoppedByUser &&
    !hasStreamError &&
    (!completion.resultSubtype || completion.resultSubtype === 'success')

  if (!completion.backgroundTasksPending &&
    isSuccessfulCompletion &&
    shouldNotifyAgentCompletion({ completion, session })) {
    notify()
  }
}

/** 判断 Agent 完成时用户是否仍停留在该会话入口 */
export function isAgentSessionActiveForCompletion({
  tabs,
  activeTabId,
  currentAgentSessionId,
  sessionId,
  documentHasFocus,
}: AgentCompletionPresenceInput): boolean {
  // 窗口不在前台时用户不可能正在查看，一律按"未查看"处理，
  // 与角标清除端（依赖 document.hasFocus()）的语义保持对齐。
  if (!documentHasFocus) return false

  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) : null
  if (activeTab) {
    return (activeTab.type === 'agent' || activeTab.type === 'preview') && activeTab.sessionId === sessionId
  }

  return currentAgentSessionId === sessionId
}

/** 计算 Agent 完成后是否需要写入侧边栏完成提醒 */
export function getAgentCompletionMarkers(input: AgentCompletionPresenceInput): AgentCompletionMarkers {
  const isActiveSession = isAgentSessionActiveForCompletion(input)
  return {
    markUnviewedCompleted: !isActiveSession,
  }
}
