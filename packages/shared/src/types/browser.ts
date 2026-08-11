// 受管浏览器对所有 Agent 会话开放；会话来源只影响 UI 标识。

export interface BrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserViewLayout {
  sessionId: string
  tabId?: string
  /** Renderer 全局单调递增代际；主进程忽略晚到的旧布局 IPC。 */
  revision: number
  visible: boolean
  bounds: BrowserViewBounds
}

export type BrowserExecutionSource = 'user' | 'automation' | 'delegation'

export type BrowserTraceAction = 'navigate' | 'observe' | 'wait' | 'click' | 'fill' | 'press' | 'dom' | 'script' | 'screenshot' | 'tab'
export type BrowserOperationStatus = 'dispatched' | 'verified' | 'failed' | 'unknown'

/** 脱敏的浏览器操作账本项；绝不含输入正文、Cookie、截图或脚本全文。 */
export interface BrowserTraceItem {
  id: string
  action: BrowserTraceAction
  summary: string
  at: number
  /** 兼容旧 UI：仅 failed/unknown 为 false。新代码应使用 status。 */
  success: boolean
  status: BrowserOperationStatus
  tabId: string
  domain: string | null
  executionSource: BrowserExecutionSource
}

export interface BrowserTabState {
  tabId: string
  url: string
  title: string
  loading: boolean
  visible: boolean
  canGoBack: boolean
  canGoForward: boolean
  trace: BrowserTraceItem[]
}

export interface BrowserTabSummary {
  tabId: string
  url: string
  title: string
  loading: boolean
}

export interface BrowserViewState {
  sessionId: string
  /** 非用户触发时，面板可显示来源并提供停止当前 Agent run 的控制。 */
  executionSource: BrowserExecutionSource
  /** 用户在浏览器面板中查看的 tab。 */
  activeTabId: string
  /** Agent 的默认工作 tab；被用户关闭后为 null，绝不回退到用户标签。 */
  agentTabId: string | null
  tabs: BrowserTabSummary[]
  /** 当前 active tab 的投影，保留扁平字段方便工具和旧 renderer 使用。 */
  url: string
  title: string
  loading: boolean
  visible: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** 脱敏的操作账本，始终代表当前会话，非单一显示标签。 */
  trace: BrowserTraceItem[]
  /** 最近一条 Agent 操作，用于用户未查看工作 tab 时的非阻断活动提示。 */
  activity: BrowserTraceItem | null
}

export interface BrowserNavigateInput {
  sessionId: string
  tabId?: string
  url: string
}

export interface BrowserTabInput {
  sessionId: string
  tabId?: string
}

export interface BrowserCreateTabInput {
  sessionId: string
  url?: string
}
