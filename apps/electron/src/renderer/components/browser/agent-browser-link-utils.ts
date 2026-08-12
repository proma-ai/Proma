import type { BrowserViewState } from '@proma/shared'

/** 仅复用用户的空白初始标签，绝不导航 Agent 的工作标签。 */
export function shouldReuseInitialBrowserTab(state: BrowserViewState): boolean {
  const activeTab = state.tabs[0]
  return state.tabs.length === 1
    && state.activeTabId === activeTab?.tabId
    && state.agentTabId !== activeTab?.tabId
    && !activeTab?.openedByAgent
    && (state.url === '' || state.url === 'about:blank')
}
