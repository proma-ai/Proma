import { app, BrowserWindow, WebContentsView, session as electronSession, type DownloadItem, type Session, type WebContents } from 'electron'
import path from 'node:path'
import type { BrowserExecutionSource, BrowserOperationStatus, BrowserSessionClosed, BrowserTraceAction, BrowserTraceItem, BrowserViewLayout, BrowserViewState, BrowserTabState } from '@proma/shared'
import { AGENT_IPC_CHANNELS } from '@proma/shared'
import { assertSafeBrowserDestination, assertSafeBrowserDownloadUrl, assertSafeBrowserUrl, isSupportedBrowserPopupUrl, isTransientBrowserPopupUrl, USER_NEW_TAB_URL } from './browser-policy'
import { createAuthorizedPreviewUrl, isAuthorizedPreviewProtocol } from './browser-preview-service'
import { handlePromaFileRequest } from './local-file-protocol'
import { BrowserCdpTimeoutError, BrowserOperationAbortedError, BROWSER_OBSERVE_TIMEOUT_MS, resolveBrowserObserveAxDepth, throwIfBrowserOperationAborted, withBrowserCdpTimeout } from './browser-cdp'
import { parseBrowserPressAction } from './browser-key-policy'
import { browserObservationNameLimit, prioritizeBrowserObservationCandidates, resolveBrowserObserveMaxElements } from './browser-observation-policy'
import { buildPersistentBrowserPartition, resolveBrowserProfileKey } from './browser-profile-policy'
import { hasAcknowledgedBrowserRiskDisclaimer } from './browser-risk-disclaimer'
import { buildPromaBrowserUserAgent } from './browser-identity'
import { assertBrowserScript, buildBrowserDomActionExpression, type BrowserDomActionInput } from './browser-script-policy'
import { getSettings } from './settings-service'
import { isValidImageBytes } from './image-content-validation'

const MAX_TRACE_ITEMS = 30
/** 总数超限时只回收 Agent 创建且未在使用的标签，绝不自动关闭用户标签。 */
const MAX_BROWSER_TABS = 20
/** 最小化或不在前台展示的浏览器 session 最多保留 8 个，防止长期会话累积 WebContents。 */
const MAX_BACKGROUND_BROWSER_SESSIONS = 8
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024
const ACTION_HIGHLIGHT_DURATION_MS = 900
const MAX_BROWSER_SCRIPT_RESULT_CHARS = 64_000

/** 下载文件名脱敏：去掉控制字符与路径穿越，替换 Windows 非法字符，兜底默认名，避免写入 Downloads 之外的路径。 */
function sanitizeDownloadFilename(raw: string): string {
  const cleaned = (raw ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().split(/[\\/]/).pop() ?? ''
  const safe = cleaned.replace(/[<>:"|?*]/g, '_').slice(0, 180)
  return safe || `download-${Date.now()}`
}

type CdpResponse = Record<string, unknown>
type RefEntry = { backendNodeId: number; generation: number; label: string; editable: boolean }
type BrowserTabRecord = {
  tabId: string
  view: WebContentsView
  state: BrowserTabState
  refs: Map<string, RefEntry>
  /** 页面文档/观察代际；导航、关闭、调试器恢复后即失效。 */
  generation: number
  /** 防止 UI 与 Agent 在同一 Tab 上交错下发命令。 */
  commandTail: Promise<void>
  isLocalPreview: boolean
  /** 仅表示来源：由 Agent 创建的标签始终保留标识，不随当前工作标签切换而丢失。 */
  openedByAgent: boolean
  /** 此标签是页面 window.open / target=_blank 创建的真实 child window。 */
  openedByPopup: boolean
  /** popup 的 opener tab，用于父标签关闭时递归回收子窗口。 */
  openerTabId: string | null
  /** about:blank/blob/data 仅允许作为 popup 首次导航，不可被后续导航复用。 */
  popupInitialUrl: string | null
  popupInitialNavigationPending: boolean
  /** 用于在超限时优先回收最久未使用的 Agent 标签。 */
  lastActivityAt: number
  highlightTimer?: ReturnType<typeof setTimeout>
  lastBounds?: BrowserViewLayout['bounds']
  /** 仅记录当前实际挂载的 owner；隐藏时 detach，但保留 WebContents 及页面状态。 */
  attachedOwner: BrowserWindow | null
}
type BrowserTabOptions = {
  isLocalPreview?: boolean
  claimAsAgent?: boolean
  openedByPopup?: boolean
  openerTabId?: string
  popupInitialUrl?: string
  /** Electron setWindowOpenHandler 交给 createWindow 的完整 child 构造选项，必须原样使用。 */
  viewOptions?: Electron.WebContentsViewConstructorOptions
}

export interface BrowserUserContextSnapshot {
  activeTabId: string
  url: string
  title: string
  openedAt: number
}

type BrowserSessionRecord = {
  sessionId: string
  partition: string
  browserSession: Session
  tabs: Map<string, BrowserTabRecord>
  /** 用户当前在面板中查看的标签。 */
  activeTabId: string
  /** Agent 未显式传 tabId 时继续操作的工作标签；被关闭后必须显式新建/选择。 */
  agentTabId: string | null
  /** 当前 Agent run 的取消源；UI 操作不接入此 signal。 */
  agentAbortController: AbortController
  /** 当前已入队或正在执行的 Agent 浏览器操作数量；非零时 session 不参与后台回收。 */
  activeAgentOperationCount: number
  /** 应用 overlay 临时遮挡 BrowserSlot 时保持回收保护。 */
  preserveSessionOnHide: boolean
  allowedRoots: string[]
  executionSource: BrowserExecutionSource
  /** 全会话的脱敏账本，避免仅显示 Agent 当前 tab 的最后 30 条。 */
  ledger: BrowserTraceItem[]
  /** 用户在面板中主动打开/操作过浏览器；用于下一条消息的实时上下文。 */
  userOpenedAt: number | null
  lastLayoutRevision: number
}

type BrowserSessionConfiguration = {
  profileKey: string
  allowedRoots: string[]
  executionSource: BrowserExecutionSource
}

/**
 * 主窗口只有一个原生浏览器展示槽。布局 revision 由 renderer 全局递增，
 * 因此可跨 Agent session 拒绝晚到的 show IPC。
 */
type BrowserPresentation = {
  sessionId: string
  tabId: string
  revision: number
}

export interface ConfigureBrowserSessionInput {
  profileKey: string
  allowedRoots?: string[]
  executionSource?: BrowserExecutionSource
}

export interface BrowserObservation {
  tabId: string
  url: string
  title: string
  generation: number
  elements: Array<{ ref: string; role: string; name: string; editable: boolean }>
}

function emptyTabState(tabId: string): BrowserTabState {
  return { tabId, url: '', title: '新建标签页', loading: false, visible: false, canGoBack: false, canGoForward: false, trace: [] }
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') return value.value.trim()
  return ''
}

function booleanValue(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'value' in value && value.value === true)
}

function axPropertyBoolean(ax: Record<string, unknown>, propertyName: string): boolean {
  const properties = Array.isArray(ax.properties) ? ax.properties : []
  return properties.some((property) => (
    property
    && typeof property === 'object'
    && (property as Record<string, unknown>).name === propertyName
    && booleanValue((property as Record<string, unknown>).value)
  ))
}

/** Chromium 把 contenteditable 表示为 editable=true，也可能是 token: richtext/plaintext。 */
function axPropertyEditable(ax: Record<string, unknown>): boolean {
  const properties = Array.isArray(ax.properties) ? ax.properties : []
  return properties.some((property) => {
    if (!property || typeof property !== 'object') return false
    const record = property as Record<string, unknown>
    if (record.name !== 'editable' || !record.value || typeof record.value !== 'object') return false
    const value = (record.value as Record<string, unknown>).value
    return value === true || (typeof value === 'string' && value !== '' && value !== 'false')
  })
}

function isEditableAxNode(ax: Record<string, unknown>): boolean {
  const role = textValue(ax.role).toLowerCase()
  return role === 'textbox' || role === 'searchbox' || axPropertyEditable(ax)
}

function normalizeBrowserScriptResult(value: unknown): unknown {
  if (value === undefined) return null
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    if (serialized.length > MAX_BROWSER_SCRIPT_RESULT_CHARS) {
      return {
        truncated: true,
        preview: serialized.slice(0, MAX_BROWSER_SCRIPT_RESULT_CHARS),
        totalChars: serialized.length,
      }
    }
    return JSON.parse(serialized) as unknown
  } catch {
    return String(value).slice(0, MAX_BROWSER_SCRIPT_RESULT_CHARS)
  }
}

function describeBrowserScriptException(response: CdpResponse): string {
  const details = response.exceptionDetails
  if (!details || typeof details !== 'object') return '页面 JavaScript 执行失败。'
  const record = details as Record<string, unknown>
  return textValue(record.exception) || textValue(record.text) || '页面 JavaScript 执行失败。'
}

export class BrowserController {
  private owner: BrowserWindow | null = null
  private readonly sessions = new Map<string, BrowserSessionRecord>()
  private readonly configurations = new Map<string, BrowserSessionConfiguration>()
  /** Electron persistent partition 生命周期长于 Agent session；同一 Session 只安装一次网络 guard。 */
  private readonly guardedSessions = new WeakSet<Session>()
  /** 下载事件属于 Electron Session，不能随 Proma 会话重复注册或闭包捕获已关闭的会话。 */
  private readonly downloadGuardedSessions = new WeakSet<Session>()
  /** 自定义 partition 不继承 default session 的协议处理器，必须单独注册本地预览协议。 */
  private readonly previewProtocolSessions = new WeakSet<Session>()
  /** 跨 Session 的唯一原生 WebContentsView 前台所有权。 */
  private presentation: BrowserPresentation | null = null
  /** 即使当前没有 Slot，也保留最新 show 代际以拒绝晚到的旧 show IPC。 */
  private latestPresentationRevision = 0

  configureSession(sessionId: string, input: ConfigureBrowserSessionInput): void {
    const previous = this.configurations.get(sessionId)
    const allowedRoots = input.allowedRoots ?? previous?.allowedRoots ?? []
    const executionSource = input.executionSource ?? previous?.executionSource ?? 'user'
    this.configurations.set(sessionId, {
      profileKey: input.profileKey,
      allowedRoots: [...new Set(allowedRoots.filter(Boolean))],
      executionSource,
    })
    const browserSession = this.sessions.get(sessionId)
    if (browserSession) {
      browserSession.allowedRoots = [...new Set(allowedRoots.filter(Boolean))]
      browserSession.executionSource = executionSource
    }
  }

  setAllowedRoots(sessionId: string, allowedRoots: string[]): void {
    const previous = this.configurations.get(sessionId)
    this.configureSession(sessionId, {
      profileKey: previous?.profileKey ?? resolveBrowserProfileKey(undefined, sessionId),
      allowedRoots,
      executionSource: previous?.executionSource,
    })
  }

  setOwnerWindow(window: BrowserWindow): void {
    this.owner = window
  }

  private emit(browserSession: BrowserSessionRecord): void {
    if (!this.owner || this.owner.isDestroyed()) return
    // WebContents 的关闭/导航事件可能晚于 disposeTab 到达；已移除的 session
    // 不再发布状态，避免把正常的生命周期竞态升级为主进程未捕获异常。
    if (this.sessions.get(browserSession.sessionId) !== browserSession) return
    if (browserSession.tabs.size === 0 || !browserSession.tabs.has(browserSession.activeTabId)) return
    this.owner.webContents.send(AGENT_IPC_CHANNELS.BROWSER_STATE_CHANGED, this.buildState(browserSession))
  }

  private emitClosed(sessionId: string): void {
    if (!this.owner || this.owner.isDestroyed()) return
    const change: BrowserSessionClosed = { sessionId, closed: true }
    this.owner.webContents.send(AGENT_IPC_CHANNELS.BROWSER_STATE_CHANGED, change)
  }

  private buildState(browserSession: BrowserSessionRecord): BrowserViewState {
    const active = browserSession.tabs.get(browserSession.activeTabId)
    if (!active) throw new Error('受管浏览器没有有效标签。')
    const trace = browserSession.ledger.slice(-MAX_TRACE_ITEMS)
    return {
      sessionId: browserSession.sessionId,
      executionSource: browserSession.executionSource,
      activeTabId: active.tabId,
      agentTabId: browserSession.agentTabId,
      tabs: [...browserSession.tabs.values()].map((tab) => ({
        tabId: tab.tabId,
        url: tab.state.url,
        title: tab.state.title,
        loading: tab.state.loading,
        openedByAgent: tab.openedByAgent,
        openedByPopup: tab.openedByPopup,
      })),
      url: active.state.url,
      title: active.state.title,
      loading: active.state.loading,
      visible: active.state.visible,
      canGoBack: active.state.canGoBack,
      canGoForward: active.state.canGoForward,
      trace,
      activity: trace.at(-1) ?? null,
    }
  }

  private getSession(sessionId: string): BrowserSessionRecord {
    const browserSession = this.sessions.get(sessionId)
    if (!browserSession) throw new Error('受管浏览器会话不存在。')
    return browserSession
  }

  /**
   * 用户打开浏览器、切换标签或从地址栏导航都视为明确的页面上下文信号。
   * 不记录页面正文，下一条消息仅带入当前标签的标题和 URL，Agent 如有必要再主动 Observe。
   */
  private markUserBrowserContext(browserSession: BrowserSessionRecord): void {
    browserSession.userOpenedAt ??= Date.now()
    const active = browserSession.tabs.get(browserSession.activeTabId)
    if (active) active.lastActivityAt = Date.now()
  }

  getUserContext(sessionId: string): BrowserUserContextSnapshot | null {
    const browserSession = this.sessions.get(sessionId)
    if (!browserSession?.userOpenedAt) return null
    const active = browserSession.tabs.get(browserSession.activeTabId)
    if (!active?.state.url) return null
    return {
      activeTabId: active.tabId,
      url: active.state.url,
      title: active.state.title,
      openedAt: browserSession.userOpenedAt,
    }
  }

  /** 用户面板的当前标签；仅 renderer 操作及原生 View layout 使用。 */
  private getDisplayTab(browserSession: BrowserSessionRecord, tabId?: string): BrowserTabRecord {
    const resolvedTabId = tabId ?? browserSession.activeTabId
    const tab = browserSession.tabs.get(resolvedTabId)
    if (!tab) throw new Error(`浏览器标签不存在: ${resolvedTabId}`)
    return tab
  }

  /** Agent 的当前工作标签；用户在 UI 切换标签不会影响这里。 */
  private getAgentTab(browserSession: BrowserSessionRecord, tabId?: string): BrowserTabRecord {
    const resolvedTabId = tabId ?? browserSession.agentTabId
    if (!resolvedTabId) throw new Error('Agent 工作标签已被关闭。请先使用 BrowserNewTab 新建工作标签，或用 BrowserSelectTab 显式选择已有标签。')
    const tab = browserSession.tabs.get(resolvedTabId)
    if (!tab) throw new Error(`浏览器标签不存在: ${resolvedTabId}`)
    return tab
  }

  /**
   * 在首次确认前，仍先创建并发布浏览器状态，以便渲染进程展示风险告知；
   * 但不允许实际读取、导航或操作第三方网页。
   */
  private assertRiskDisclaimerAcknowledged(): void {
    if (hasAcknowledgedBrowserRiskDisclaimer(getSettings())) return
    throw new Error('首次使用受管浏览器前，请在浏览器面板阅读并确认平台账号风险告知后重试。')
  }

  private updateNavigationState(browserSession: BrowserSessionRecord, tab: BrowserTabRecord): void {
    // Navigation callbacks can arrive after the tab was closed or its session removed.
    if (this.sessions.get(browserSession.sessionId) !== browserSession) return
    if (browserSession.tabs.get(tab.tabId) !== tab || tab.view.webContents.isDestroyed()) return

    const contents = tab.view.webContents
    try {
      tab.state.url = contents.getURL()
      tab.state.title = contents.getTitle() || '未命名页面'
      tab.state.loading = contents.isLoading()
      tab.state.canGoBack = contents.canGoBack()
      tab.state.canGoForward = contents.canGoForward()
    } catch {
      // The WebContents may be destroyed between the lifecycle check and the read.
      return
    }
    this.emit(browserSession)
  }

  private trace(browserSession: BrowserSessionRecord, tab: BrowserTabRecord, action: BrowserTraceAction, summary: string, status: BrowserOperationStatus = 'verified'): void {
    tab.lastActivityAt = Date.now()
    let domain: string | null = null
    try { domain = new URL(tab.state.url).host || null } catch { /* 新建标签页或本地预览 */ }
    const item: BrowserTraceItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      summary,
      at: Date.now(),
      success: status === 'dispatched' || status === 'verified',
      status,
      tabId: tab.tabId,
      domain,
      executionSource: browserSession.executionSource,
    }
    tab.state.trace = [...tab.state.trace, item].slice(-MAX_TRACE_ITEMS)
    browserSession.ledger = [...browserSession.ledger, item].slice(-100)
    this.emit(browserSession)
  }

  private invalidateTabDocument(tab: BrowserTabRecord): void {
    tab.refs.clear()
    tab.generation++
  }

  /** 将同一 tab 的 UI/Agent 指令顺序化；一个失败不会卡死后续命令。 */
  private enqueueTab<T>(tab: BrowserTabRecord, task: () => Promise<T>): Promise<T> {
    const next = tab.commandTail.then(task, task)
    tab.commandTail = next.then(() => undefined, () => undefined)
    return next
  }

  private agentSignal(browserSession: BrowserSessionRecord, signal?: AbortSignal): AbortSignal {
    if (browserSession.agentAbortController.signal.aborted) browserSession.agentAbortController = new AbortController()
    if (!signal) return browserSession.agentAbortController.signal
    if (signal.aborted) return signal
    const merged = new AbortController()
    const abort = () => merged.abort()
    signal.addEventListener('abort', abort, { once: true })
    browserSession.agentAbortController.signal.addEventListener('abort', abort, { once: true })
    return merged.signal
  }

  private runTabOperation<T>(browserSession: BrowserSessionRecord, tab: BrowserTabRecord, signal: AbortSignal | undefined, task: (operationSignal: AbortSignal | undefined) => Promise<T>, operationLease?: () => void): Promise<T> {
    // 只有 Agent 工具传入 signal；renderer 操作只排队，不会被 Stop Agent 取消。
    const operationSignal = signal ? this.agentSignal(browserSession, signal) : undefined
    const protectsFromEviction = !!signal
    const releaseLease = operationLease ?? (protectsFromEviction ? this.acquireAgentOperation(browserSession) : undefined)
    const operation = this.enqueueTab(tab, async () => {
      throwIfBrowserOperationAborted(operationSignal)
      return task(operationSignal)
    })
    if (!releaseLease) return operation
    return operation.finally(releaseLease)
  }

  private acquireAgentOperation(browserSession: BrowserSessionRecord): () => void {
    browserSession.activeAgentOperationCount += 1
    let released = false
    return () => {
      if (released) return
      released = true
      browserSession.activeAgentOperationCount = Math.max(0, browserSession.activeAgentOperationCount - 1)
      this.pruneBackgroundSessions()
    }
  }

  private assertCurrentDocument(tab: BrowserTabRecord, generation: number, signal?: AbortSignal): void {
    throwIfBrowserOperationAborted(signal)
    if (tab.generation !== generation || tab.view.webContents.isDestroyed()) {
      throw new Error('页面已变化或标签已关闭，请先重新调用 BrowserObserve。')
    }
  }

  /** Stop Agent 时调用：停止等待，并阻断尚未下发的页面命令。 */
  cancelSession(sessionId: string): void {
    const browserSession = this.sessions.get(sessionId)
    if (!browserSession) return
    browserSession.agentAbortController.abort()
    browserSession.agentAbortController = new AbortController()
    const agentTabId = browserSession.agentTabId
    if (agentTabId) {
      const tab = browserSession.tabs.get(agentTabId)
      if (tab) {
        this.invalidateTabDocument(tab)
        try { tab.view.webContents.stop() } catch { /* WebContents 已销毁 */ }
        this.trace(browserSession, tab, 'tab', 'Agent 已停止浏览器操作；已发送指令的结果未知，请重新观察页面。', 'unknown')
      }
    }
  }

  private installSessionGuards(browserSession: Session): void {
    if (this.guardedSessions.has(browserSession)) return
    this.guardedSessions.add(browserSession)
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      let protocol = ''
      try { protocol = new URL(details.url).protocol } catch { callback({ cancel: true }); return }
      if (protocol !== 'http:' && protocol !== 'https:') {
        callback({ cancel: false })
        return
      }
      void assertSafeBrowserDestination(details.url)
        .then(() => callback({ cancel: false }))
        .catch(() => callback({ cancel: true }))
    })
  }

  /**
   * 下载事件属于 Electron Session，而 workspace profile 会被多个 Proma 会话复用。
   * 因而监听器只注册一次；每次触发时再用 WebContents 找到仍存活的来源 tab，避免
   * 关闭会话遗留的 handler 重复 pause/resume/cancel 同一个 DownloadItem。
   */
  private installDownloadGuard(electronBrowserSession: Session): void {
    if (this.downloadGuardedSessions.has(electronBrowserSession)) return
    this.downloadGuardedSessions.add(electronBrowserSession)
    electronBrowserSession.on('will-download', (_event, item, webContents) => {
      const origin = this.findManagedDownloadOrigin(electronBrowserSession, webContents)
      // 同 partition 中若存在非受管来源，默认拒绝，不能绕过受管浏览器的下载边界。
      if (!origin) {
        item.cancel()
        return
      }
      this.handleDownload(origin.browserSession, origin.tab, item)
    })
  }

  /**
   * 将受管浏览器里的下载固定保存到系统「下载」目录。
   * Electron 会在 will-download 回调返回后立即决定是否显示 Save As，因此必须同步
   * setSavePath；随后暂停下载进行异步 DNS 校验，安全后才 resume，失败则 cancel。
   */
  private handleDownload(browserSession: BrowserSessionRecord, tab: BrowserTabRecord, item: DownloadItem): void {
    const url = item.getURL()
    const filename = sanitizeDownloadFilename(item.getFilename())
    item.setSavePath(path.join(app.getPath('downloads'), filename))
    item.pause()
    item.once('done', (_event, state) => {
      if (!this.isManagedTabCurrent(browserSession, tab)) return
      if (state === 'completed') this.trace(browserSession, tab, 'download', `已下载 ${filename}`, 'verified')
      else this.trace(browserSession, tab, 'download', `下载 ${filename} 未完成（${state}）`, 'failed')
    })
    void assertSafeBrowserDownloadUrl(url)
      .then(() => {
        if (this.isManagedTabCurrent(browserSession, tab)) this.trace(browserSession, tab, 'download', `下载 ${filename} 到「下载」目录`, 'dispatched')
        // 已通过校验的下载在来源 tab 被关闭后仍可继续，符合浏览器的常规下载行为。
        item.resume()
      })
      .catch(() => {
        item.cancel()
        if (this.isManagedTabCurrent(browserSession, tab)) this.trace(browserSession, tab, 'download', '已阻止不安全或不受支持的下载', 'failed')
      })
  }

  /** 从共享 Electron Session 的所有当前 Proma 会话中定位下载来源，绝不保留过期会话引用。 */
  private findManagedDownloadOrigin(electronBrowserSession: Session, webContents: WebContents): { browserSession: BrowserSessionRecord; tab: BrowserTabRecord } | null {
    for (const browserSession of this.sessions.values()) {
      if (browserSession.browserSession !== electronBrowserSession) continue
      for (const tab of browserSession.tabs.values()) {
        if (!tab.view.webContents.isDestroyed() && tab.view.webContents === webContents) return { browserSession, tab }
      }
    }
    return null
  }

  private isManagedTabCurrent(browserSession: BrowserSessionRecord, tab: BrowserTabRecord): boolean {
    return this.sessions.get(browserSession.sessionId) === browserSession && browserSession.tabs.get(tab.tabId) === tab
  }

  private installPreviewProtocol(browserSession: Session): void {
    if (this.previewProtocolSessions.has(browserSession)) return
    browserSession.protocol.handle('proma-file', handlePromaFileRequest)
    this.previewProtocolSessions.add(browserSession)
  }

  private createSession(sessionId: string, allowedRoots: string[] = []): BrowserSessionRecord {
    if (!this.owner || this.owner.isDestroyed()) throw new Error('主窗口尚未就绪，无法创建内置浏览器。')
    const configuration = this.configurations.get(sessionId)
    const profileKey = configuration?.profileKey ?? resolveBrowserProfileKey(undefined, sessionId)
    const partition = buildPersistentBrowserPartition(profileKey)
    const browserSession = electronSession.fromPartition(partition)
    // 默认 UA 会暴露 Electron；受管网页改为诚实的 Proma 标识，并保留 Chromium token 保证站点兼容。
    browserSession.setUserAgent(buildPromaBrowserUserAgent(browserSession.getUserAgent(), app.getVersion()))
    const record: BrowserSessionRecord = {
      sessionId,
      partition,
      browserSession,
      tabs: new Map(),
      activeTabId: '',
      agentTabId: null,
      agentAbortController: new AbortController(),
      activeAgentOperationCount: 0,
      preserveSessionOnHide: false,
      allowedRoots: [...new Set((allowedRoots.length > 0 ? allowedRoots : configuration?.allowedRoots ?? []).filter(Boolean))],
      executionSource: configuration?.executionSource ?? 'user',
      ledger: [],
      userOpenedAt: null,
      lastLayoutRevision: 0,
    }
    this.installSessionGuards(browserSession)
    this.installPreviewProtocol(browserSession)
    this.sessions.set(sessionId, record)
    this.installDownloadGuard(browserSession)
    return record
  }

  private createTab(browserSession: BrowserSessionRecord, isLocalPreview = false, claimAsAgent = false, popupOptions?: Pick<BrowserTabOptions, 'openedByPopup' | 'openerTabId' | 'popupInitialUrl' | 'viewOptions'>): BrowserTabRecord {
    if (!this.owner || this.owner.isDestroyed()) throw new Error('主窗口尚未就绪，无法创建浏览器标签。')
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const view = new WebContentsView(popupOptions?.viewOptions ?? {
      webPreferences: {
        partition: browserSession.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    const popupInitialUrl = popupOptions?.popupInitialUrl ?? null
    const tab: BrowserTabRecord = {
      tabId,
      view,
      state: emptyTabState(tabId),
      refs: new Map(),
      generation: 0,
      commandTail: Promise.resolve(),
      isLocalPreview,
      openedByAgent: claimAsAgent,
      openedByPopup: popupOptions?.openedByPopup ?? false,
      openerTabId: popupOptions?.openerTabId ?? null,
      popupInitialUrl,
      popupInitialNavigationPending: popupInitialUrl !== null && isTransientBrowserPopupUrl(popupInitialUrl),
      lastActivityAt: Date.now(),
      attachedOwner: null,
    }
    view.setVisible(false)
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!isSupportedBrowserPopupUrl(url)) {
        this.trace(browserSession, tab, 'popup', '已阻止不安全或不受支持的新窗口链接', 'failed')
        return { action: 'deny' }
      }
      // createWindow 必须同步返回；同时确认 opener 仍是当前受管会话的一部分，防止关闭后遗留 view。
      if (this.sessions.get(browserSession.sessionId) !== browserSession || !browserSession.tabs.has(tab.tabId)) return { action: 'deny' }
      // Electron 必须在此同步 callback 中用它交给的 options 构造 child WebContents；
      // 提前创建独立 WebContents 会触发 "Invalid webContents" 并终止应用。
      let popup: BrowserTabRecord | null = null
      return {
        action: 'allow',
        outlivesOpener: false,
        createWindow: (options) => {
          popup = this.createTab(browserSession, false, false, {
            openedByPopup: true,
            openerTabId: tab.tabId,
            popupInitialUrl: url,
            // 必须原样传入 Electron 给 createWindow 的完整 options，不能只抽取 webPreferences。
            viewOptions: options,
          })
          this.activateDisplayTab(browserSession, popup)
          this.trace(browserSession, popup, 'popup', isTransientBrowserPopupUrl(url) ? '已打开临时新窗口' : '已打开新窗口', 'dispatched')
          return popup.view.webContents
        },
      }
    })
    view.webContents.on('will-navigate', (event, url) => {
      // 在校验及真正导航前失效，避免 Observe 后在新页面按旧坐标操作。
      this.invalidateTabDocument(tab)
      try {
        const isInitialTransientPopupNavigation = tab.popupInitialNavigationPending && tab.popupInitialUrl === url && isTransientBrowserPopupUrl(url)
        if (isInitialTransientPopupNavigation) {
          tab.popupInitialNavigationPending = false
          return
        }
        if (isAuthorizedPreviewProtocol(url) && tab.isLocalPreview) return
        assertSafeBrowserUrl(url)
      } catch {
        event.preventDefault()
        this.trace(browserSession, tab, 'navigate', '已阻止不安全的页面跳转', 'failed')
      }
    })
    view.webContents.on('did-start-loading', () => { this.invalidateTabDocument(tab); this.updateNavigationState(browserSession, tab) })
    view.webContents.on('did-stop-loading', () => this.updateNavigationState(browserSession, tab))
    view.webContents.on('page-title-updated', () => this.updateNavigationState(browserSession, tab))
    view.webContents.on('did-navigate', () => { tab.popupInitialNavigationPending = false; this.invalidateTabDocument(tab); this.updateNavigationState(browserSession, tab) })
    view.webContents.on('did-navigate-in-page', () => { tab.popupInitialNavigationPending = false; this.invalidateTabDocument(tab); this.updateNavigationState(browserSession, tab) })
    view.webContents.on('destroyed', () => {
      if (!browserSession.tabs.has(tab.tabId)) return
      this.disposePopupChildren(browserSession, tab.tabId)
      browserSession.tabs.delete(tab.tabId)
      this.clearAgentTargetHighlight(tab)
      this.detachTabView(tab)
      this.repairTabSelection(browserSession, tab.tabId)
      if (browserSession.tabs.size === 0) {
        this.sessions.delete(browserSession.sessionId)
        return
      }
      this.emit(browserSession)
    })
    try { view.webContents.debugger.attach('1.3') } catch (error) { console.warn('[受管浏览器] CDP attach 失败:', error) }
    browserSession.tabs.set(tabId, tab)
    if (!browserSession.activeTabId) browserSession.activeTabId = tabId
    if (claimAsAgent) browserSession.agentTabId = tabId
    return tab
  }

  private getOrCreateSession(sessionId: string, allowedRoots: string[] = [], createAgentTab = true): BrowserSessionRecord {
    const browserSession = this.sessions.get(sessionId) ?? this.createSession(sessionId, allowedRoots)
    if (allowedRoots.length > 0) this.setAllowedRoots(sessionId, allowedRoots)
    if (browserSession.tabs.size === 0) this.createTab(browserSession, false, createAgentTab)
    // 每个 Browser* 调用都先发布可渲染状态：即使后续操作失败，当前激活会话也能立即展示浏览器。
    this.emit(browserSession)
    return browserSession
  }

  /**
   * CDP 在页面进程卡死时可能永久不返回。超时后重连 debugger，避免一个 Observe
   * 卡住整个 Agent turn，也让下一次 Browser* 调用能使用新的通道继续工作。
   */
  private async cdp(tab: BrowserTabRecord, method: string, params?: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal): Promise<CdpResponse> {
    throwIfBrowserOperationAborted(signal)
    const debuggerClient = tab.view.webContents.debugger
    if (!debuggerClient.isAttached()) throw new Error('浏览器调试通道不可用。')
    try {
      return await withBrowserCdpTimeout(
        () => debuggerClient.sendCommand(method, params) as Promise<CdpResponse>,
        method,
        timeoutMs,
        signal,
      )
    } catch (error) {
      if (error instanceof BrowserCdpTimeoutError) this.recoverDebugger(tab, method)
      throw error
    }
  }

  private recoverDebugger(tab: BrowserTabRecord, timedOutMethod: string): void {
    // 重连会使所有 backend node/ref 的有效性不可判定。
    this.invalidateTabDocument(tab)
    const debuggerClient = tab.view.webContents.debugger
    try {
      if (debuggerClient.isAttached()) debuggerClient.detach()
      debuggerClient.attach('1.3')
      console.warn(`[受管浏览器] CDP ${timedOutMethod} 超时，已重连调试通道。`)
    } catch (error) {
      console.warn(`[受管浏览器] CDP ${timedOutMethod} 超时后无法重连调试通道:`, error)
    }
  }

  /** 通过 CDP Overlay 渲染临时高亮，不向第三方页面注入脚本或修改 DOM。 */
  private async highlightAgentTarget(tab: BrowserTabRecord, backendNodeId: number): Promise<void> {
    if (tab.highlightTimer) clearTimeout(tab.highlightTimer)
    try {
      await this.cdp(tab, 'Overlay.enable')
      await this.cdp(tab, 'Overlay.highlightNode', {
        backendNodeId,
        highlightConfig: {
          showInfo: false,
          contentColor: { r: 59, g: 130, b: 246, a: 0.16 },
          borderColor: { r: 59, g: 130, b: 246, a: 0.95 },
        },
      })
      tab.highlightTimer = setTimeout(() => {
        tab.highlightTimer = undefined
        void this.cdp(tab, 'Overlay.hideHighlight').catch(() => undefined)
      }, ACTION_HIGHLIGHT_DURATION_MS)
    } catch (error) {
      console.warn('[受管浏览器] 无法渲染 Agent 操作高亮:', error)
    }
  }

  private clearAgentTargetHighlight(tab: BrowserTabRecord): void {
    if (tab.highlightTimer) clearTimeout(tab.highlightTimer)
    tab.highlightTimer = undefined
  }

  async open(sessionId: string): Promise<BrowserViewState> {
    // 用户从界面手动打开浏览器时，初始标签不应伪装成 Agent 标签。
    const browserSession = this.getOrCreateSession(sessionId, [], false)
    this.markUserBrowserContext(browserSession)
    const activeTab = this.getDisplayTab(browserSession)
    // 首次风险告知前不能加载第三方页面；告知已确认后才将用户空白页导航到 Google。
    if (hasAcknowledgedBrowserRiskDisclaimer(getSettings())
      && browserSession.agentTabId !== activeTab.tabId
      && !activeTab.openedByAgent
      && (activeTab.state.url === '' || activeTab.state.url === 'about:blank')) {
      return this.navigateDisplay(sessionId, USER_NEW_TAB_URL, activeTab.tabId)
    }
    this.emit(browserSession)
    return structuredClone(this.buildState(browserSession))
  }

  getState(sessionId: string): BrowserViewState | null {
    const browserSession = this.sessions.get(sessionId)
    return browserSession ? structuredClone(this.buildState(browserSession)) : null
  }

  listTabs(sessionId: string): BrowserViewState {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    return structuredClone(this.buildState(browserSession))
  }

  /**
   * 所有受管标签都挂在同一个 BrowserWindow.contentView，必须在 controller
   * 层保证跨 Session 只有一个原生 View 可见，不能依赖 renderer 卸载顺序。
   */
  private hideAllViewsExcept(targetSessionId: string, targetTabId: string): Set<BrowserSessionRecord> {
    const changedSessions = new Set<BrowserSessionRecord>()
    for (const browserSession of this.sessions.values()) {
      for (const tab of browserSession.tabs.values()) {
        if (browserSession.sessionId === targetSessionId && tab.tabId === targetTabId) continue
        if (this.hideTabView(tab)) changedSessions.add(browserSession)
      }
    }
    return changedSessions
  }

  private emitChangedSessions(changedSessions: Set<BrowserSessionRecord>): void {
    for (const browserSession of changedSessions) this.emit(browserSession)
  }

  /** 隐藏时从原生 View 树移除，避免 Chromium 继续按前台 WebContentsView 调度。 */
  private detachTabView(tab: BrowserTabRecord): void {
    try { tab.view.setVisible(false) } catch { /* WebContents/View 已销毁 */ }
    const attachedOwner = tab.attachedOwner
    if (!attachedOwner) return
    tab.attachedOwner = null
    try {
      if (!attachedOwner.isDestroyed()) attachedOwner.contentView.removeChildView(tab.view)
    } catch { /* owner 或 View 已销毁/已被 Electron 移除 */ }
  }

  /** 重新展示时只恢复原生挂载、bounds 和 visible，不重建 WebContents。 */
  private attachTabView(tab: BrowserTabRecord): boolean {
    const owner = this.owner
    if (!owner || owner.isDestroyed() || tab.view.webContents.isDestroyed()) {
      this.detachTabView(tab)
      return false
    }
    if (tab.attachedOwner !== owner) {
      this.detachTabView(tab)
      try {
        owner.contentView.addChildView(tab.view)
        tab.attachedOwner = owner
      } catch {
        return false
      }
    }
    try {
      if (tab.lastBounds) tab.view.setBounds(tab.lastBounds)
      tab.view.setVisible(true)
      return true
    } catch {
      this.detachTabView(tab)
      return false
    }
  }

  private hideTabView(tab: BrowserTabRecord): boolean {
    this.detachTabView(tab)
    if (!tab.state.visible) return false
    tab.state.visible = false
    return true
  }

  private isBackgroundSession(browserSession: BrowserSessionRecord): boolean {
    if (this.presentation?.sessionId === browserSession.sessionId) return false
    if (browserSession.preserveSessionOnHide) return false
    if (browserSession.activeAgentOperationCount > 0) return false
    return [...browserSession.tabs.values()].every((tab) => !tab.state.visible)
  }

  private sessionLastActivityAt(browserSession: BrowserSessionRecord): number {
    return Math.max(0, ...[...browserSession.tabs.values()].map((tab) => tab.lastActivityAt))
  }

  /** 回收最久未使用的后台浏览器，永不关闭当前前台或已有 Agent 操作的 session。 */
  private pruneBackgroundSessions(): void {
    const candidates = [...this.sessions.values()]
      .filter((browserSession) => this.isBackgroundSession(browserSession))
      .sort((left, right) => this.sessionLastActivityAt(left) - this.sessionLastActivityAt(right))
    const excess = candidates.length - MAX_BACKGROUND_BROWSER_SESSIONS
    for (const browserSession of candidates.slice(0, Math.max(0, excess))) {
      void this.close(browserSession.sessionId).catch((error) => {
        console.warn('[受管浏览器] 回收后台浏览器失败:', error)
      })
    }
  }

  /** 用户最小化当前浏览器：保留 WebContents，并在必要时回收最久未使用的后台 session。 */
  minimize(sessionId: string): void {
    const browserSession = this.getSession(sessionId)
    const tab = this.getDisplayTab(browserSession)
    tab.lastActivityAt = Date.now()
    const changedSessions = new Set<BrowserSessionRecord>()
    if (this.hideTabView(tab)) changedSessions.add(browserSession)
    if (this.presentation?.sessionId === browserSession.sessionId) this.presentation = null
    browserSession.preserveSessionOnHide = false
    this.emitChangedSessions(changedSessions)
    this.pruneBackgroundSessions()
  }

  setLayout(layout: BrowserViewLayout): void {
    const browserSession = this.sessions.get(layout.sessionId)
    if (!browserSession) return
    // React effect cleanup 和新 slot 的 IPC 可以交错到达。只采纳当前 Session 的最新布局。
    if (!Number.isSafeInteger(layout.revision) || layout.revision <= browserSession.lastLayoutRevision) return
    browserSession.lastLayoutRevision = layout.revision
    browserSession.preserveSessionOnHide = layout.preserveSessionOnHide === true
    const tab = browserSession.tabs.get(layout.tabId ?? browserSession.activeTabId)
    // BrowserSlot 卸载与 tab 关闭可交错，晚到布局不应让 renderer 报错。
    if (!tab) return

    const bounds = layout.bounds
    const visible = layout.visible && bounds.width > 4 && bounds.height > 4 && !!this.owner && !this.owner.isDestroyed() && this.owner.isVisible()
    if (!visible) {
      this.latestPresentationRevision = Math.max(this.latestPresentationRevision, layout.revision)
      const changedSessions = new Set<BrowserSessionRecord>()
      if (this.hideTabView(tab)) changedSessions.add(browserSession)
      if (this.presentation?.sessionId === browserSession.sessionId && this.presentation.tabId === tab.tabId) {
        this.presentation = null
      }
      this.emitChangedSessions(changedSessions)
      return
    }

    // revision 在 renderer 全局单调递增。A 的旧 show 即使在 B 已显示后晚到，
    // 也不能重新把 A 的原生 view 放到前台。
    if (layout.revision <= this.latestPresentationRevision) return

    const zoomFactor = this.owner?.webContents.getZoomFactor() ?? 1
    const adjustedBounds = {
      x: Math.round(bounds.x * zoomFactor),
      y: Math.round(bounds.y * zoomFactor),
      width: Math.round(bounds.width * zoomFactor),
      height: Math.round(bounds.height * zoomFactor),
    }
    const changedSessions = this.hideAllViewsExcept(browserSession.sessionId, tab.tabId)
    if (!tab.lastBounds || Object.entries(adjustedBounds).some(([key, value]) => tab.lastBounds?.[key as keyof typeof adjustedBounds] !== value)) {
      tab.lastBounds = { ...adjustedBounds }
    }
    const shown = this.attachTabView(tab)
    if (tab.state.visible !== shown) {
      tab.state.visible = shown
      changedSessions.add(browserSession)
    }
    this.presentation = shown ? { sessionId: browserSession.sessionId, tabId: tab.tabId, revision: layout.revision } : null
    this.latestPresentationRevision = layout.revision
    this.emitChangedSessions(changedSessions)
    if (shown) this.pruneBackgroundSessions()
  }

  /**
   * 会话内切 tab 可立即复用展示区域；后台 Session 只更新自身状态，绝不抢占
   * 当前浏览器展示槽，等待其 BrowserSlot 成为前台后再由 setLayout 显示。
   */
  private activateDisplayTab(browserSession: BrowserSessionRecord, tab: BrowserTabRecord): void {
    const previous = browserSession.tabs.get(browserSession.activeTabId)
    tab.lastActivityAt = Date.now()
    browserSession.activeTabId = tab.tabId
    if (this.presentation?.sessionId !== browserSession.sessionId) {
      // 后台 Session 的 tab 切换只更新逻辑状态，所有原生 View 都保持 detach。
      for (const candidate of browserSession.tabs.values()) this.hideTabView(candidate)
      this.emit(browserSession)
      return
    }

    if (!tab.lastBounds && previous?.lastBounds) {
      tab.lastBounds = { ...previous.lastBounds }
    }
    const changedSessions = this.hideAllViewsExcept(browserSession.sessionId, tab.tabId)
    const shouldShow = !!tab.lastBounds && !!this.owner && !this.owner.isDestroyed() && this.owner.isVisible()
    const visible = shouldShow && this.attachTabView(tab)
    if (!visible) this.detachTabView(tab)
    if (tab.state.visible !== visible) {
      tab.state.visible = visible
      changedSessions.add(browserSession)
    }
    this.presentation = visible ? { ...this.presentation, tabId: tab.tabId } : null
    this.emitChangedSessions(changedSessions)
  }

  private disposePopupChildren(browserSession: BrowserSessionRecord, openerTabId: string): void {
    for (const child of [...browserSession.tabs.values()]) {
      if (child.openerTabId === openerTabId) this.disposeTab(browserSession, child)
    }
  }

  private repairTabSelection(browserSession: BrowserSessionRecord, removedTabId: string): void {
    if (browserSession.activeTabId === removedTabId || !browserSession.tabs.has(browserSession.activeTabId)) {
      browserSession.activeTabId = browserSession.tabs.keys().next().value as string
    }
    if (browserSession.agentTabId === removedTabId || (browserSession.agentTabId !== null && !browserSession.tabs.has(browserSession.agentTabId))) {
      browserSession.agentTabId = null
    }
  }

  private disposeTab(browserSession: BrowserSessionRecord, tab: BrowserTabRecord): void {
    if (!browserSession.tabs.has(tab.tabId)) return
    // Child windows use Electron's opener lifetime and must not outlive a tab closed from Proma UI either.
    this.disposePopupChildren(browserSession, tab.tabId)
    browserSession.tabs.delete(tab.tabId)
    this.clearAgentTargetHighlight(tab)
    try { if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach() } catch { /* 已销毁 */ }
    this.detachTabView(tab)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  /**
   * 达到上限时回收最久未使用的 Agent 标签。用户创建的标签、当前前台标签和 Agent 当前工作标签
   * 一律保留；若没有安全候选，宁可暂时超过限制也不擅自关闭用户内容。
   */
  private reclaimExcessAgentTabs(browserSession: BrowserSessionRecord): number {
    const candidates = [...browserSession.tabs.values()]
      .filter((tab) => tab.openedByAgent && tab.tabId !== browserSession.activeTabId && tab.tabId !== browserSession.agentTabId)
      .sort((left, right) => left.lastActivityAt - right.lastActivityAt)
    let reclaimed = 0
    while (browserSession.tabs.size > MAX_BROWSER_TABS && candidates.length > 0) {
      const tab = candidates.shift()
      if (!tab || !browserSession.tabs.has(tab.tabId)) continue
      this.disposeTab(browserSession, tab)
      reclaimed += 1
    }
    return reclaimed
  }

  /** Agent 新建工作 tab，并立即切到该标签让用户能看到接下来的操作。 */
  async createNewTab(sessionId: string, url?: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.createTab(browserSession, false, true)
    browserSession.agentTabId = tab.tabId
    this.activateDisplayTab(browserSession, tab)
    const reclaimed = this.reclaimExcessAgentTabs(browserSession)
    this.trace(browserSession, tab, 'tab', reclaimed > 0
      ? `Agent 新建并打开工作标签；已回收 ${reclaimed} 个最久未使用的 Agent 标签`
      : `Agent 新建并打开工作标签 ${tab.tabId}`)
    if (url?.trim()) return this.navigate(sessionId, url, tab.tabId)
    return structuredClone(this.buildState(browserSession))
  }

  /** 用户在浏览器面板中新建 tab；不会抢占 Agent 的工作 tab。 */
  async createDisplayTab(sessionId: string, url?: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId, [], false)
    this.assertRiskDisclaimerAcknowledged()
    this.markUserBrowserContext(browserSession)
    const tab = this.createTab(browserSession)
    this.activateDisplayTab(browserSession, tab)
    const reclaimed = this.reclaimExcessAgentTabs(browserSession)
    if (reclaimed > 0) this.trace(browserSession, tab, 'tab', `标签超过 ${MAX_BROWSER_TABS} 个上限，已回收 ${reclaimed} 个最久未使用的 Agent 标签`)
    if (url?.trim()) return this.navigateDisplay(sessionId, url)
    return this.navigateDisplay(sessionId, USER_NEW_TAB_URL, tab.tabId)
  }

  /** 用户 UI 的 tab 选择只控制显示，不影响 Agent 之后的默认操作目标。 */
  selectTab(sessionId: string, tabId: string): BrowserViewState {
    const browserSession = this.getSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    this.markUserBrowserContext(browserSession)
    const tab = this.getDisplayTab(browserSession, tabId)
    this.activateDisplayTab(browserSession, tab)
    return structuredClone(this.buildState(browserSession))
  }

  /** Agent 显式切换工作 tab，并同步激活用户可见的前台标签。 */
  selectAgentTab(sessionId: string, tabId: string): BrowserViewState {
    const browserSession = this.getSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    browserSession.agentTabId = tab.tabId
    this.activateDisplayTab(browserSession, tab)
    this.trace(browserSession, tab, 'tab', `Agent 切换并打开工作标签 ${tab.tabId}`)
    return structuredClone(this.buildState(browserSession))
  }

  async closeTab(sessionId: string, tabId: string): Promise<BrowserViewState | null> {
    const browserSession = this.getSession(sessionId)
    const tab = this.getDisplayTab(browserSession, tabId)
    this.disposeTab(browserSession, tab)
    if (browserSession.tabs.size === 0) {
      this.sessions.delete(sessionId)
      if (this.presentation?.sessionId === sessionId) this.presentation = null
      this.emitClosed(sessionId)
      return null
    }
    this.repairTabSelection(browserSession, tab.tabId)
    this.emit(browserSession)
    return structuredClone(this.buildState(browserSession))
  }

  async previewOpen(sessionId: string, inputPath: string, tabId: string | undefined, allowedRoots: string[], baseDir?: string, signal?: AbortSignal): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId, allowedRoots)
    const releaseAgentOperation = this.acquireAgentOperation(browserSession)
    try {
      this.assertRiskDisclaimerAcknowledged()
      // 先校验路径，避免无效路径遗留一个空白的 Agent 预览标签。
      const preview = createAuthorizedPreviewUrl(inputPath, browserSession.allowedRoots, baseDir)
      const tab = tabId ? this.getAgentTab(browserSession, tabId) : this.createTab(browserSession, true, true)
      browserSession.agentTabId = tab.tabId
      this.activateDisplayTab(browserSession, tab)
      const reclaimed = this.reclaimExcessAgentTabs(browserSession)
      if (reclaimed > 0) this.trace(browserSession, tab, 'tab', `已回收 ${reclaimed} 个最久未使用的 Agent 标签以保持最多 ${MAX_BROWSER_TABS} 个标签`)
      return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
        tab.isLocalPreview = true
        try {
          await this.loadUrl(tab, preview.url, operationSignal)
          this.trace(browserSession, tab, 'navigate', `预览本地文件 ${preview.filePath.split(/[\\/]/).pop() ?? preview.filePath}`, 'verified')
          this.updateNavigationState(browserSession, tab)
          return structuredClone(this.buildState(browserSession))
        } catch (error) {
          this.trace(browserSession, tab, 'navigate', error instanceof BrowserOperationAbortedError ? '本地预览已停止，结果未知' : '本地预览加载失败', error instanceof BrowserOperationAbortedError ? 'unknown' : 'failed')
          throw error
        }
      }, releaseAgentOperation)
    } catch (error) {
      releaseAgentOperation()
      throw error
    }
  }

  private async loadUrl(tab: BrowserTabRecord, url: string, signal?: AbortSignal): Promise<void> {
    throwIfBrowserOperationAborted(signal)
    await withBrowserCdpTimeout(() => tab.view.webContents.loadURL(url), 'Page.navigate', BROWSER_OBSERVE_TIMEOUT_MS + 3_000, signal)
  }

  async navigate(sessionId: string, url: string, tabId?: string, signal?: AbortSignal): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId, [])
    const releaseAgentOperation = this.acquireAgentOperation(browserSession)
    try {
      this.assertRiskDisclaimerAcknowledged()
      const tab = this.getAgentTab(browserSession, tabId)
      const safeUrl = await assertSafeBrowserDestination(url)
      const host = new URL(safeUrl).host
      return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
        tab.isLocalPreview = false
        this.trace(browserSession, tab, 'navigate', `正在打开 ${host}`, 'dispatched')
        try {
          await this.loadUrl(tab, safeUrl, operationSignal)
          this.trace(browserSession, tab, 'navigate', `已打开 ${host}`, 'verified')
          this.updateNavigationState(browserSession, tab)
          return structuredClone(this.buildState(browserSession))
        } catch (error) {
          this.trace(browserSession, tab, 'navigate', error instanceof BrowserOperationAbortedError ? `打开 ${host} 已停止，结果未知` : `无法打开 ${host}`, error instanceof BrowserOperationAbortedError ? 'unknown' : 'failed')
          throw error
        }
      }, releaseAgentOperation)
    } catch (error) {
      releaseAgentOperation()
      throw error
    }
  }

  /** 用户地址栏导航当前显示 tab，不会改变 Agent 的工作 tab。 */
  async navigateDisplay(sessionId: string, url: string, tabId?: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId, [])
    this.assertRiskDisclaimerAcknowledged()
    this.markUserBrowserContext(browserSession)
    const tab = this.getDisplayTab(browserSession, tabId)
    const safeUrl = await assertSafeBrowserDestination(url)
    const host = new URL(safeUrl).host
    return this.runTabOperation(browserSession, tab, undefined, async () => {
      tab.isLocalPreview = false
      this.trace(browserSession, tab, 'navigate', `正在打开 ${host}`, 'dispatched')
      try {
        await this.loadUrl(tab, safeUrl)
        this.trace(browserSession, tab, 'navigate', `已打开 ${host}`, 'verified')
        this.updateNavigationState(browserSession, tab)
        return structuredClone(this.buildState(browserSession))
      } catch (error) {
        this.trace(browserSession, tab, 'navigate', `无法打开 ${host}`, 'failed')
        throw error
      }
    })
  }

  async goBack(sessionId: string, tabId?: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    if (tab.view.webContents.canGoBack()) tab.view.webContents.goBack()
    this.updateNavigationState(browserSession, tab)
    return structuredClone(this.buildState(browserSession))
  }

  async goBackDisplay(sessionId: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    return this.goBack(sessionId, this.getDisplayTab(browserSession).tabId)
  }

  async goForward(sessionId: string, tabId?: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    if (tab.view.webContents.canGoForward()) tab.view.webContents.goForward()
    this.updateNavigationState(browserSession, tab)
    return structuredClone(this.buildState(browserSession))
  }

  async goForwardDisplay(sessionId: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    return this.goForward(sessionId, this.getDisplayTab(browserSession).tabId)
  }

  async reload(sessionId: string, tabId?: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    tab.view.webContents.reload()
    this.updateNavigationState(browserSession, tab)
    return structuredClone(this.buildState(browserSession))
  }

  async reloadDisplay(sessionId: string): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    return this.reload(sessionId, this.getDisplayTab(browserSession).tabId)
  }

  async observe(sessionId: string, tabId?: string, requestedMaxElements?: number, signal?: AbortSignal): Promise<BrowserObservation> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, (operationSignal) => this.observeInternal(browserSession, tab, requestedMaxElements, operationSignal))
  }

  private async observeInternal(browserSession: BrowserSessionRecord, tab: BrowserTabRecord, requestedMaxElements?: number, signal?: AbortSignal): Promise<BrowserObservation> {
    try {
      throwIfBrowserOperationAborted(signal)
      const maxElements = resolveBrowserObserveMaxElements(requestedMaxElements)
      // 全量 AX tree 在富文本编辑器、长列表和复杂 SPA 中会非常大；限制深度以保留主页面交互层，
      // 同时避免 Chromium 为整棵树做序列化而长时间阻塞。
      const observeDepth = resolveBrowserObserveAxDepth(maxElements)
      const response = await this.cdp(tab, 'Accessibility.getFullAXTree', { depth: observeDepth }, BROWSER_OBSERVE_TIMEOUT_MS, signal)
      throwIfBrowserOperationAborted(signal)
      const nodes = Array.isArray(response.nodes) ? response.nodes : []
      const candidates: Array<{ backendNodeId: number; role: string; name: string; editable: boolean }> = []
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue
        const ax = node as Record<string, unknown>
        const backendNodeId = typeof ax.backendDOMNodeId === 'number' ? ax.backendDOMNodeId : 0
        const role = textValue(ax.role)
        const name = textValue(ax.name)
        const editable = isEditableAxNode(ax)
        if (!backendNodeId || !role || (!name && !editable && !['button', 'textbox', 'link', 'checkbox', 'combobox'].includes(role))) continue
        candidates.push({ backendNodeId, role, name: name.slice(0, browserObservationNameLimit(role)), editable })
      }

      const selected = prioritizeBrowserObservationCandidates(candidates, maxElements)
      tab.generation++
      tab.refs.clear()
      const elements: BrowserObservation['elements'] = []
      for (const candidate of selected) {
        const ref = `r${tab.generation}-${elements.length + 1}`
        tab.refs.set(ref, {
          backendNodeId: candidate.backendNodeId,
          generation: tab.generation,
          label: candidate.name ? `${candidate.role}「${candidate.name.slice(0, 80)}」` : candidate.role,
          editable: candidate.editable,
        })
        elements.push({ ref, role: candidate.role, name: candidate.name, editable: candidate.editable })
      }
      this.updateNavigationState(browserSession, tab)
      this.trace(browserSession, tab, 'observe', `读取到 ${elements.length}/${maxElements} 个元素（可交互优先，AX 深度 ${observeDepth}）`)
      return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, generation: tab.generation, elements }
    } catch (error) {
      this.trace(browserSession, tab, 'observe', error instanceof BrowserCdpTimeoutError ? '页面观察超时，可重试或重新加载页面' : error instanceof BrowserOperationAbortedError ? '页面观察已停止' : '页面观察失败', error instanceof BrowserOperationAbortedError ? 'unknown' : 'failed')
      throw error
    }
  }

  private resolveRef(tab: BrowserTabRecord, ref: string): RefEntry {
    const entry = tab.refs.get(ref)
    if (!entry || entry.generation !== tab.generation) throw new Error('元素引用已失效，请先重新调用 browser_observe。')
    return entry
  }

  private async centerForRef(tab: BrowserTabRecord, ref: string, signal?: AbortSignal, generation = tab.generation): Promise<{ x: number; y: number }> {
    this.assertCurrentDocument(tab, generation, signal)
    const { backendNodeId } = this.resolveRef(tab, ref)
    // AX ref 可能来自懒加载列表的视口外节点。滚动后重新读取 box，不能复用旧坐标。
    await this.cdp(tab, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }, undefined, signal)
    this.assertCurrentDocument(tab, generation, signal)
    const box = await this.cdp(tab, 'DOM.getBoxModel', { backendNodeId }, undefined, signal)
    this.assertCurrentDocument(tab, generation, signal)
    const model = box.model as Record<string, unknown> | undefined
    const quad = Array.isArray(model?.content) ? model.content : []
    if (quad.length < 8 || !quad.every((value) => typeof value === 'number')) throw new Error('目标元素当前不可点击，请重新观察页面。')
    return { x: ((quad[0] as number) + (quad[2] as number) + (quad[4] as number) + (quad[6] as number)) / 4, y: ((quad[1] as number) + (quad[3] as number) + (quad[5] as number) + (quad[7] as number)) / 4 }
  }

  async click(sessionId: string, ref: string, tabId?: string, signal?: AbortSignal): Promise<BrowserViewState> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      const generation = tab.generation
      const target = this.resolveRef(tab, ref)
      const { x, y } = await this.centerForRef(tab, ref, operationSignal, generation)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.highlightAgentTarget(tab, target.backendNodeId)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, undefined, operationSignal)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, undefined, operationSignal)
      this.trace(browserSession, tab, 'click', `点击 ${target.label}`, 'dispatched')
      return structuredClone(this.buildState(browserSession))
    })
  }

  private async assertEditableFocus(tab: BrowserTabRecord, target: RefEntry, signal?: AbortSignal): Promise<void> {
    const response = await this.cdp(tab, 'Accessibility.getPartialAXTree', {
      backendNodeId: target.backendNodeId,
      fetchRelatives: false,
    }, undefined, signal)
    const nodes = Array.isArray(response.nodes) ? response.nodes : []
    const current = nodes.find((node) => (
      node
      && typeof node === 'object'
      && (node as Record<string, unknown>).backendDOMNodeId === target.backendNodeId
    )) as Record<string, unknown> | undefined
    if (!current || !isEditableAxNode(current)) throw new Error('目标字段已不可编辑，请重新观察页面后重试。')
    if (!axPropertyBoolean(current, 'focused')) throw new Error('无法聚焦目标字段，请重新观察页面后重试。')
  }

  async fill(sessionId: string, ref: string, text: string, tabId?: string, signal?: AbortSignal): Promise<BrowserViewState> {
    if (text.length > 10_000) throw new Error('单次输入不能超过 10000 个字符。')
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      const generation = tab.generation
      const target = this.resolveRef(tab, ref)
      if (!target.editable) throw new Error('目标元素不是可编辑字段，请重新观察后选择 input、textarea 或 contenteditable。')
      await this.highlightAgentTarget(tab, target.backendNodeId)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.cdp(tab, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: target.backendNodeId }, undefined, operationSignal)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.cdp(tab, 'DOM.focus', { backendNodeId: target.backendNodeId }, undefined, operationSignal)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.assertEditableFocus(tab, target, operationSignal)
      const selectAllModifier = process.platform === 'darwin' ? 4 : 2
      await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: selectAllModifier }, undefined, operationSignal)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: selectAllModifier }, undefined, operationSignal)
      this.assertCurrentDocument(tab, generation, operationSignal)
      await this.cdp(tab, 'Input.insertText', { text }, undefined, operationSignal)
      this.trace(browserSession, tab, 'fill', `在 ${target.label} 输入 ${Array.from(text).length} 个字符（已脱敏）`, 'dispatched')
      return structuredClone(this.buildState(browserSession))
    })
  }

  async press(sessionId: string, key: string, tabId?: string, signal?: AbortSignal): Promise<BrowserViewState> {
    const action = parseBrowserPressAction(key)
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      if (action.kind === 'key') {
        // rawKeyDown 与 windowsVirtualKeyCode 让 Chromium 识别非字符导航键并触发
        // 默认行为（PageDown 滚动、Enter 提交、Tab 移动焦点），只传 key 不会滚动。
        const keyEvent = { key: action.key, code: action.code, windowsVirtualKeyCode: action.windowsVirtualKeyCode }
        await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyEvent }, undefined, operationSignal)
        await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...keyEvent }, undefined, operationSignal)
        this.trace(browserSession, tab, 'press', `按下 ${action.key}`, 'dispatched')
      } else {
        await this.cdp(tab, 'Input.insertText', { text: action.text }, undefined, operationSignal)
        this.trace(browserSession, tab, 'press', `输入 ${Array.from(action.text).length} 个字符（已脱敏）`, 'dispatched')
      }
      return structuredClone(this.buildState(browserSession))
    })
  }

  private async executePageExpression(tab: BrowserTabRecord, expression: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.cdp(tab, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, undefined, signal)
    if (response.exceptionDetails) throw new Error(describeBrowserScriptException(response))
    const result = response.result
    if (!result || typeof result !== 'object') return null
    const remote = result as Record<string, unknown>
    if ('value' in remote) return normalizeBrowserScriptResult(remote.value)
    return {
      type: textValue(remote.type) || 'unknown',
      description: textValue(remote.description) || null,
    }
  }

  async waitFor(sessionId: string, condition: { kind: 'url' | 'text' | 'selector'; value: string }, timeoutMs = 10_000, tabId?: string, signal?: AbortSignal): Promise<{ tabId: string; url: string; title: string; matched: boolean }> {
    if (!condition.value.trim()) throw new Error('等待条件不能为空。')
    if (!Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new Error('等待超时必须在 250 到 30000 毫秒之间。')
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      const startedAt = Date.now()
      const payload = JSON.stringify(condition).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
      const expression = `(() => { const condition = ${payload}; try { if (condition.kind === 'url') return location.href.includes(condition.value); if (condition.kind === 'text') return (document.body?.innerText || '').includes(condition.value); return !!document.querySelector(condition.value); } catch { return false; } })()`
      while (Date.now() - startedAt <= timeoutMs) {
        throwIfBrowserOperationAborted(operationSignal)
        const result = await this.executePageExpression(tab, expression, operationSignal)
        if (result === true) {
          this.trace(browserSession, tab, 'wait', `已满足${condition.kind}等待条件`, 'verified')
          return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, matched: true }
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            operationSignal?.removeEventListener('abort', abort)
            resolve()
          }, 250)
          const abort = () => { clearTimeout(timer); reject(new BrowserOperationAbortedError()) }
          operationSignal?.addEventListener('abort', abort, { once: true })
        })
      }
      this.trace(browserSession, tab, 'wait', `等待${condition.kind}条件超时`, 'failed')
      return { tabId: tab.tabId, url: tab.state.url, title: tab.state.title, matched: false }
    })
  }

  /**
   * 执行固定的 selector DOM 操作，优先用于 AX 无法稳定定位的富文本编辑器。
   * 表达式由主进程生成，selector/text 均按数据而非代码传入。
   */
  async domAction(sessionId: string, input: BrowserDomActionInput, tabId?: string, signal?: AbortSignal): Promise<{ tabId: string; url: string; result: unknown }> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      const result = await this.executePageExpression(tab, buildBrowserDomActionExpression(input), operationSignal)
      this.trace(browserSession, tab, 'dom', `DOM ${input.action}：${input.selector.slice(0, 100)}`, 'dispatched')
      return { tabId: tab.tabId, url: tab.state.url, result }
    })
  }

  /**
   * 在当前页面上下文执行用户目标所需的 JavaScript。页面与结果仍停留在受管 WebContents/CDP 通道，
   * 不暴露 Electron/Node 能力；页面文本不可据此改变用户目标或诱导执行无关脚本。
   */
  async evaluate(sessionId: string, script: string, tabId?: string, signal?: AbortSignal): Promise<{ tabId: string; url: string; result: unknown }> {
    assertBrowserScript(script)
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      const result = await this.executePageExpression(tab, script, operationSignal)
      this.trace(browserSession, tab, 'script', `执行页面 JavaScript（${script.length} 字符）`, 'dispatched')
      return { tabId: tab.tabId, url: tab.state.url, result }
    })
  }

  async screenshot(sessionId: string, tabId?: string, signal?: AbortSignal): Promise<{ tabId: string; url: string; mimeType: string; base64: string }> {
    const browserSession = this.getOrCreateSession(sessionId)
    this.assertRiskDisclaimerAcknowledged()
    const tab = this.getAgentTab(browserSession, tabId)
    return this.runTabOperation(browserSession, tab, signal ?? browserSession.agentAbortController.signal, async (operationSignal) => {
      throwIfBrowserOperationAborted(operationSignal)
      const image = await withBrowserCdpTimeout(() => tab.view.webContents.capturePage(), 'Page.captureScreenshot', BROWSER_OBSERVE_TIMEOUT_MS + 3_000, operationSignal)
      throwIfBrowserOperationAborted(operationSignal)
      if (image.isEmpty()) {
        this.trace(browserSession, tab, 'screenshot', '截图为空，已拒绝返回无效图片', 'failed')
        throw new Error('截图为空：浏览器页面尚未完成可捕获布局，请稍后重试或改用 BrowserObserve。')
      }
      const { width, height } = image.getSize()
      if (width <= 0 || height <= 0) {
        this.trace(browserSession, tab, 'screenshot', '截图尺寸无效，已拒绝返回无效图片', 'failed')
        throw new Error('截图尺寸无效：浏览器页面尚未完成可捕获布局，请稍后重试或改用 BrowserObserve。')
      }
      const buffer = image.toPNG()
      if (!isValidImageBytes('image/png', buffer)) {
        this.trace(browserSession, tab, 'screenshot', '截图 PNG 数据无效，已拒绝返回无效图片', 'failed')
        throw new Error('截图 PNG 数据无效，请稍后重试或改用 BrowserObserve。')
      }
      if (buffer.byteLength > MAX_SCREENSHOT_BYTES) throw new Error('截图过大，请缩小页面或改用 browser_observe。')
      this.trace(browserSession, tab, 'screenshot', '截取当前页面', 'verified')
      return { tabId: tab.tabId, url: tab.state.url, mimeType: 'image/png', base64: buffer.toString('base64') }
    })
  }

  async close(sessionId: string): Promise<void> {
    const browserSession = this.sessions.get(sessionId)
    if (!browserSession) {
      this.emitClosed(sessionId)
      return
    }
    this.sessions.delete(sessionId)
    if (this.presentation?.sessionId === sessionId) this.presentation = null
    for (const tab of browserSession.tabs.values()) {
      this.clearAgentTargetHighlight(tab)
      try { if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach() } catch { /* 已销毁 */ }
      this.detachTabView(tab)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    browserSession.tabs.clear()
    this.emitClosed(sessionId)
  }

  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) void this.close(sessionId)
    this.configurations.clear()
    this.presentation = null
    this.latestPresentationRevision = 0
    this.owner = null
  }
}

export const browserController = new BrowserController()
