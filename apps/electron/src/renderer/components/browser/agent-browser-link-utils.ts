import type { BrowserViewState } from '@proma/shared'

/** 新会话仅有空白初始标签时，复用它而非额外创建无用标签。 */
export function shouldReuseInitialBrowserTab(state: BrowserViewState): boolean {
  return state.tabs.length === 1
    && state.activeTabId === state.tabs[0]?.tabId
    && (state.url === '' || state.url === 'about:blank')
}
