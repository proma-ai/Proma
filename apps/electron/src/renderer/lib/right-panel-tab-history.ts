import type { AgentSidePanelTab } from '@/atoms/agent-atoms'

const MAX_HISTORY_LENGTH = 50

/**
 * 记录右侧工作区 Tab 的最近访问顺序；末尾始终是当前 Tab。
 * 不持久化：历史只服务于本次渲染进程中的关闭回退，避免恢复已失效的临时 Tab。
 */
export function recordRightPanelTabVisit(
  history: AgentSidePanelTab[],
  tab: AgentSidePanelTab,
): AgentSidePanelTab[] {
  return [...history.filter((item) => item !== tab), tab].slice(-MAX_HISTORY_LENGTH)
}

/**
 * 关闭当前 Tab 时，回到最近访问且仍可用的上一个 Tab；文件 Tab 是稳定兜底。
 */
export function getPreviousRightPanelTab(
  history: AgentSidePanelTab[],
  closingTab: AgentSidePanelTab,
  availableTabs: ReadonlySet<AgentSidePanelTab>,
): AgentSidePanelTab {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const candidate = history[index]!
    if (candidate !== closingTab && availableTabs.has(candidate)) return candidate
  }
  return 'files'
}

/** 关闭后移除历史记录，防止已销毁的临时 Tab 成为后续回退目标。 */
export function removeRightPanelTabFromHistory(
  history: AgentSidePanelTab[],
  tab: AgentSidePanelTab,
): AgentSidePanelTab[] {
  return history.filter((item) => item !== tab)
}
