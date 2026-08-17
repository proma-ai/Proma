import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import type { BrowserViewState } from '@proma/shared'
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, LoaderCircle, Plus, RefreshCw, ShieldAlert, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BROWSER_RISK_DISCLAIMER_VERSION } from '@/types/settings'
import { detectIsWindows, getWindowControlsPaddingClass } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { browserPendingNavigationMapAtom } from '@/atoms/browser-atoms'
import { BrowserSlot } from './BrowserSlot'
import { shouldReuseInitialBrowserTab } from './agent-browser-link-utils'

interface BrowserPanelProps {
  sessionId: string
  state: BrowserViewState | null
  onClose: () => void
}

export function BrowserPanel({ sessionId, state, onClose }: BrowserPanelProps): React.ReactElement {
  const [url, setUrl] = React.useState(state?.url ?? '')
  const [riskAcknowledged, setRiskAcknowledged] = React.useState<boolean | null>(null)
  const [savingRiskAcknowledgement, setSavingRiskAcknowledgement] = React.useState(false)
  const pendingNavigationUrl = useAtomValue(browserPendingNavigationMapAtom).get(sessionId)
  const setPendingNavigationMap = useSetAtom(browserPendingNavigationMapAtom)

  React.useEffect(() => setUrl(state?.url ?? ''), [state?.url])
  React.useEffect(() => {
    let cancelled = false
    void window.electronAPI.getSettings()
      .then((settings) => {
        if (!cancelled) setRiskAcknowledged((settings.browserRiskDisclaimerVersion ?? 0) >= BROWSER_RISK_DISCLAIMER_VERSION)
      })
      .catch((error) => {
        console.error('[受管浏览器] 读取风险告知状态失败:', error)
        if (!cancelled) setRiskAcknowledged(false)
      })
    return () => { cancelled = true }
  }, [])

  const navigate = React.useCallback(async () => {
    const value = url.trim()
    const navigateBrowser = (window.electronAPI as Partial<typeof window.electronAPI>).navigateAgentBrowser
    if (!value || typeof navigateBrowser !== 'function') return
    try { await navigateBrowser({ sessionId, url: value }) } catch (error) { console.error('[受管浏览器] 导航失败:', error) }
  }, [sessionId, url])

  const openInDefaultBrowser = React.useCallback(() => {
    const value = url.trim()
    if (value.startsWith('http://') || value.startsWith('https://')) void window.electronAPI.openExternal(value)
  }, [url])

  const close = React.useCallback(async () => {
    const closeBrowser = (window.electronAPI as Partial<typeof window.electronAPI>).closeAgentBrowser
    if (typeof closeBrowser !== 'function') { onClose(); return }
    try {
      await closeBrowser(sessionId)
      onClose()
    } catch (error) {
      console.error('[受管浏览器] 关闭失败:', error)
    }
  }, [onClose, sessionId])

  const acceptRiskDisclaimer = React.useCallback(async () => {
    setSavingRiskAcknowledgement(true)
    try {
      await window.electronAPI.updateSettings({ browserRiskDisclaimerVersion: BROWSER_RISK_DISCLAIMER_VERSION })
      setRiskAcknowledged(true)
      if (pendingNavigationUrl) {
        try {
          const currentState = await window.electronAPI.getAgentBrowserState(sessionId)
          if (!currentState) throw new Error('受管浏览器会话不存在。')
          if (shouldReuseInitialBrowserTab(currentState)) {
            await window.electronAPI.navigateAgentBrowser({ sessionId, url: pendingNavigationUrl })
          } else {
            await window.electronAPI.createAgentBrowserTab({ sessionId, url: pendingNavigationUrl })
          }
        } catch (error) {
          console.error('[受管浏览器] 打开待处理链接失败:', error)
        } finally {
          setPendingNavigationMap((previous) => {
            const next = new Map(previous)
            next.delete(sessionId)
            return next
          })
        }
      }
    } catch (error) {
      console.error('[受管浏览器] 保存风险告知确认失败:', error)
    } finally {
      setSavingRiskAcknowledgement(false)
    }
  }, [pendingNavigationUrl, sessionId, setPendingNavigationMap])

  const stopBackgroundRun = React.useCallback(async () => {
    if (state?.executionSource === 'user') return
    try {
      await window.electronAPI.stopAgent(sessionId)
    } catch (error) {
      console.error('[受管浏览器] 停止后台 Agent 失败:', error)
    }
  }, [sessionId, state?.executionSource])

  const activeTabId = state?.activeTabId ?? ''
  const agentTabId = state?.agentTabId ?? ''
  const tabs = state?.tabs ?? []
  const riskBlocked = riskAcknowledged !== true
  const isBackgroundRun = state?.executionSource === 'automation' || state?.executionSource === 'delegation'
  const activity = state?.activity ?? null
  const activityStatus = activity?.status === 'unknown' ? '结果未知' : activity?.status === 'failed' ? '失败' : activity?.status === 'dispatched' ? '已派发' : '已完成'
  const activityDomain = activity?.domain ? ` · ${activity.domain}` : ''

  const selectTab = React.useCallback(async (tabId: string) => {
    const select = (window.electronAPI as Partial<typeof window.electronAPI>).selectAgentBrowserTab
    if (typeof select !== 'function') return
    try { await select({ sessionId, tabId }) } catch (error) { console.error('[受管浏览器] 切换标签失败:', error) }
  }, [sessionId])

  const createTab = React.useCallback(async () => {
    const create = (window.electronAPI as Partial<typeof window.electronAPI>).createAgentBrowserTab
    if (typeof create !== 'function') return
    try { await create({ sessionId }) } catch (error) { console.error('[受管浏览器] 新建标签失败:', error) }
  }, [sessionId])

  const closeTab = React.useCallback(async (tabId: string) => {
    const closeBrowserTab = (window.electronAPI as Partial<typeof window.electronAPI>).closeAgentBrowserTab
    if (typeof closeBrowserTab !== 'function') return
    try {
      const next = await closeBrowserTab({ sessionId, tabId })
      if (!next) onClose()
    } catch (error) { console.error('[受管浏览器] 关闭标签失败:', error) }
  }, [onClose, sessionId])

  const title = state?.title || '受管浏览器'
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden bg-content-area titlebar-no-drag">
      <div className={cn('flex items-center h-[42px] gap-1 px-2 border-b border-border/40 bg-muted/20', getWindowControlsPaddingClass(isWindows))}>
        <Globe2 className="size-4 shrink-0 text-primary ml-1" />
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={riskBlocked || !state?.canGoBack} onClick={() => void window.electronAPI.goBackAgentBrowser?.(sessionId)}><ArrowLeft className="size-3.5" /></Button></TooltipTrigger><TooltipContent>后退</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={riskBlocked || !state?.canGoForward} onClick={() => void window.electronAPI.goForwardAgentBrowser?.(sessionId)}><ArrowRight className="size-3.5" /></Button></TooltipTrigger><TooltipContent>前进</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={riskBlocked} onClick={() => void window.electronAPI.reloadAgentBrowser?.(sessionId)}><RefreshCw className="size-3.5" /></Button></TooltipTrigger><TooltipContent>刷新</TooltipContent></Tooltip>
        <form className="flex-1 min-w-0" onSubmit={(event) => { event.preventDefault(); if (!riskBlocked) void navigate() }}>
          <Input disabled={riskBlocked} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="输入域名或 URL（默认 HTTPS，仅公共网站）" className="h-7 text-xs bg-background/70" aria-label="浏览器地址" />
        </form>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={!url.startsWith('http://') && !url.startsWith('https://')} onClick={openInDefaultBrowser} aria-label="在系统默认浏览器中打开当前网页"><ExternalLink className="size-3.5" /></Button></TooltipTrigger><TooltipContent>在系统默认浏览器中打开</TooltipContent></Tooltip>
        {state?.loading && <LoaderCircle className="size-3.5 text-muted-foreground animate-spin" />}
        {isBackgroundRun && (
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7 text-amber-600 hover:text-amber-700" onClick={() => void stopBackgroundRun()} aria-label="停止当前后台 Agent"><Square className="size-3.5 fill-current" /></Button></TooltipTrigger><TooltipContent>停止当前{state?.executionSource === 'automation' ? '自动任务' : '委派'}运行</TooltipContent></Tooltip>
        )}
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" className="size-7" onClick={() => void close()}><X className="size-3.5" /></Button></TooltipTrigger><TooltipContent>关闭并销毁受管浏览器</TooltipContent></Tooltip>
      </div>
      <div className="flex items-center h-8 gap-1 px-2 border-b border-border/30 bg-muted/10 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.tabId}
            type="button"
            disabled={riskBlocked}
            onClick={() => void selectTab(tab.tabId)}
            className={`group flex items-center gap-1.5 h-6 min-w-[120px] max-w-[220px] px-2 rounded text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${tab.tabId === activeTabId ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
            aria-label={`切换到 ${tab.title || '新建标签页'}${tab.openedByAgent ? '（由 Agent 创建）' : tab.openedByPopup ? '（由网页新窗口创建）' : ''}`}
          >
            <Globe2 className="size-3 shrink-0" />
            <span className="truncate flex-1 text-left">{tab.title || '新建标签页'}</span>
            {tab.openedByAgent && <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[9px] font-medium text-primary">Agent</span>}
            {tab.openedByPopup && <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">Popup</span>}
            <span
              role="button"
              tabIndex={0}
              className="shrink-0 rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
              aria-label={`关闭 ${tab.title || '标签'}`}
              onClick={(event) => { event.stopPropagation(); void closeTab(tab.tabId) }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void closeTab(tab.tabId) } }}
            >
              <X className="size-3" />
            </span>
          </button>
        ))}
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" disabled={riskBlocked} onClick={() => void createTab()} aria-label="新建浏览器标签"><Plus className="size-3.5" /></Button></TooltipTrigger><TooltipContent>新建标签</TooltipContent></Tooltip>
      </div>
      {activity && (
        <div className="flex min-h-7 items-center gap-2 border-b border-border/25 bg-primary/[0.04] px-3 py-1 text-[11px]" role="status" aria-live="polite">
          <span className="shrink-0 font-medium text-primary">Agent 活动</span>
          <span className="shrink-0 text-muted-foreground">{activityStatus}</span>
          <span className="truncate text-foreground/80">{activity.summary}{activityDomain}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">{activity.tabId === agentTabId ? '工作标签' : `标签 ${activity.tabId}`}</span>
        </div>
      )}
      {riskAcknowledged === true ? (
        <BrowserSlot key={activeTabId} sessionId={sessionId} tabId={activeTabId} />
      ) : (
        <div className="flex flex-1 min-h-0 items-center justify-center bg-muted/15 px-8 text-center">
          <div className="max-w-sm space-y-2 text-muted-foreground">
            <ShieldAlert className="mx-auto size-7 text-amber-500/90" />
            <p className="text-sm font-medium text-foreground">使用前请阅读风险告知</p>
            <p className="text-xs leading-5">受管浏览器将在确认后启用，登录状态只保存在本机。</p>
          </div>
        </div>
      )}
      <AlertDialog open={riskAcknowledged === false} onOpenChange={(open) => { if (!open && !savingRiskAcknowledgement) void close() }}>
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-5" />
            </div>
            <AlertDialogTitle className="text-balance">首次使用受管浏览器</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left leading-6">
                <p>Proma 可让 Agent 在浏览器中读取、搜索、点击和输入。部分平台可能将这些行为或高频操作识别为自动化活动。</p>
                <p>这可能导致验证码、限流、功能限制、账号风控，严重时可能造成账号处罚或封禁。请自行了解并遵守目标平台规则，并自行承担相应风险。</p>
                <p className="text-xs">Proma 不会保证第三方平台接受这些操作；请避免不必要的高频互动，并在重要操作前核对页面状态。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingRiskAcknowledgement}>暂不使用</AlertDialogCancel>
            <Button type="button" disabled={savingRiskAcknowledgement} onClick={() => void acceptRiskDisclaimer()}>
              {savingRiskAcknowledgement ? '正在确认…' : '我已知悉并承担风险'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state && state.trace.length > 0 && (
        <div className="flex items-center h-7 px-3 gap-2 border-t border-border/30 text-[11px] text-muted-foreground bg-muted/15">
          <span className="shrink-0 text-primary/80">Agent 操作</span>
          <span className="truncate">{state.trace[state.trace.length - 1]?.summary}</span>
          <span className="ml-auto shrink-0 hidden lg:inline">点击与输入目标会短暂高亮</span>
        </div>
      )}
    </div>
  )
}
