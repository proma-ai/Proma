import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { BrowserViewState } from '@proma/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

/** 每个 Agent 会话的受管浏览器面板开关。主进程仍是状态权威。 */
export const browserPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())
export const browserStateMapAtom = atom<Map<string, BrowserViewState>>(new Map())
/** 首次风险确认完成后自动加载的 Agent 回复链接。 */
export const browserPendingNavigationMapAtom = atom<Map<string, string>>(new Map())

/** 用户手动恢复文件面板后，该会话再次打开浏览器时不再自动收起。 */
export const browserFilePanelManualRestoreSessionIdsAtom = atomWithStorage<string[]>(
  'proma-browser-file-panel-manual-restore-session-ids',
  [],
)

export const currentSessionBrowserStateAtom = atom<BrowserViewState | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  return sessionId ? get(browserStateMapAtom).get(sessionId) ?? null : null
})
