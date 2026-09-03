import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { AppShell } from './components/app-shell/AppShell'
import { OnboardingView } from './components/onboarding/OnboardingView'
import { EnvironmentCheckDialog } from './components/environment/EnvironmentCheckDialog'
import { ThirdPartyChannelRemovedDialog } from './components/channels/ThirdPartyChannelRemovedDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { CloudAuthGate } from './components/cloud-auth'
import { QuotaExceededDialog } from './components/billing/QuotaExceededDialog'
import { OnboardingBillingPromptDialog } from './components/billing/OnboardingBillingPromptDialog'
import { agentChannelIdAtom, agentModelIdAtom, agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from './atoms/agent-atoms'
import { appModeAtom } from './atoms/app-mode'
import { PROMA_OFFICIAL_CHANNEL_ID, PROMA_OFFICIAL_DEFAULT_AGENT_MODEL } from '@proma/shared'
import { ShortcutGuideDialog } from './components/shortcuts/ShortcutGuideDialog'
import { FaqDialog } from './components/shortcuts/FaqDialog'
import { WindowControls } from './components/WindowControls'
import { detectIsWindows } from './lib/platform'
import { getWindowTitlebarContentInsetClass } from './lib/window-titlebar-layout'
import { cn } from './lib/utils'
import { PlanningReminderRail } from './components/planning/PlanningReminderRail'
import { environmentCheckDialogOpenAtom } from './atoms/environment'
import { onboardingReplayRequestedAtom } from './atoms/onboarding'
import { settingsOpenAtom, settingsTabAtom } from './atoms/settings-tab'
import { tabsAtom, activeTabIdAtom, openTab } from './atoms/tab-atoms'
import { CURRENT_ONBOARDING_VERSION, hasCompletedCurrentOnboarding } from '../types'
import hopperSeasideWhiteHouse from './assets/onboarding/hopper-seaside-white-house.png'
import promaMarkWhite from './assets/onboarding/proma-mark-white.svg'

export default function App(): React.ReactElement {
  // 应用级初始化状态。

  const store = useStore()
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const [isLoading, setIsLoading] = React.useState(true)
  const [showOnboarding, setShowOnboarding] = React.useState(false)
  const [onboardingBillingPromptOpen, setOnboardingBillingPromptOpen] = React.useState(false)
  const [onboardingReplayRequested, setOnboardingReplayRequested] = useAtom(onboardingReplayRequestedAtom)
  const [isReplayingOnboarding, setIsReplayingOnboarding] = React.useState(false)
  const isWindows = React.useMemo(() => detectIsWindows(), [])

  // 初始化：检查是否需要显示 Onboarding
  // macOS/Linux 上 SDK 自带 claude native binary 不依赖宿主 Node/Git；
  // Windows 上仍需 Git Bash/WSL，由 Onboarding Step 2 与聊天错误卡片引导用户安装。
  React.useEffect(() => {
    const initialize = async () => {
      try {
        const settings = await window.electronAPI.getSettings()
        if (!hasCompletedCurrentOnboarding(settings)) {
          setShowOnboarding(true)
        }
      } catch (error) {
        console.error('[App] 初始化失败:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initialize()
  }, [])

  // 设置页请求重放时跳过欢迎页，但保留完整的后续 Onboarding 流程。
  React.useEffect(() => {
    if (!onboardingReplayRequested || isLoading) return

    setIsReplayingOnboarding(true)
    setShowOnboarding(true)
    setOnboardingReplayRequested(false)
  }, [isLoading, onboardingReplayRequested, setOnboardingReplayRequested])

  // 完成 onboarding 回调：创建引用模式的 Agent 欢迎会话，并可提示购买额度。
  const handleOnboardingComplete = async (options?: { openBilling?: boolean }): Promise<void> => {
    const replayingOnboarding = isReplayingOnboarding
    let onboardingMarkedComplete = false

    try {
      await window.electronAPI.updateSettings({
        onboardingCompleted: true,
        onboardingVersion: CURRENT_ONBOARDING_VERSION,
      })
      onboardingMarkedComplete = true

      if (replayingOnboarding) {
        store.set(settingsTabAtom, 'onboarding')
        store.set(settingsOpenAtom, true)
      } else {
        const meta = await window.electronAPI.createAgentSession(
          '开始使用 Proma',
          agentChannelId ?? PROMA_OFFICIAL_CHANNEL_ID,
          currentWorkspaceId || undefined,
          agentModelId ?? PROMA_OFFICIAL_DEFAULT_AGENT_MODEL,
        )
        const sessions = store.get(agentSessionsAtom)
        store.set(agentSessionsAtom, [meta, ...sessions])
        setAppMode('agent')
        setCurrentAgentSessionId(meta.id)

        const tabs = store.get(tabsAtom)
        const result = openTab(tabs, {
          type: 'agent',
          sessionId: meta.id,
          title: meta.title,
        })
        store.set(tabsAtom, result.tabs)
        store.set(activeTabIdAtom, result.activeTabId)

        // 欢迎消息失败不应回滚已创建的会话，否则重试会产生重复会话。
        void window.electronAPI.sendAgentMessage({
          sessionId: meta.id,
          channelId: meta.channelId ?? agentChannelId ?? PROMA_OFFICIAL_CHANNEL_ID,
          modelId: meta.modelId ?? agentModelId ?? PROMA_OFFICIAL_DEFAULT_AGENT_MODEL,
          workspaceId: meta.workspaceId ?? currentWorkspaceId ?? undefined,
          userMessage: '你好，我刚完成 Proma 的首次设置。请作为我的上手引导助手：先用简洁友好的方式欢迎我，说明你可以如何协助我完成真实工作；然后只问我一个最关键的问题，帮助你了解我现在想完成的第一件事。请不要一次性罗列大量功能，也不要执行任何工具或修改文件，等我回复后再继续。',
        }).catch((error: unknown) => console.error('[App] 发送欢迎消息失败:', error))
      }

      if (options?.openBilling && !replayingOnboarding) {
        setOnboardingBillingPromptOpen(true)
      }
      setShowOnboarding(false)
      setIsReplayingOnboarding(false)
    } catch (error) {
      if (onboardingMarkedComplete) {
        try {
          await window.electronAPI.updateSettings({ onboardingCompleted: false })
        } catch (rollbackError) {
          console.error('[App] 回滚 onboarding 状态失败:', rollbackError)
        }
      }
      console.error('[App] 完成 onboarding 失败:', error)
      setOnboardingBillingPromptOpen(false)
      throw error
    }
  }

  // 加载中状态
  if (isLoading) {
    return <StartupLoadingScreen />
  }

  // 显示 onboarding 界面
  if (showOnboarding) {
    return (
      <TooltipProvider delayDuration={200} disableHoverableContent>
        <div className={cn('relative h-screen w-screen overflow-hidden', getWindowTitlebarContentInsetClass(isWindows))}>
          <WindowControls />
          <OnboardingView
            initialStep={isReplayingOnboarding ? 'guide' : 'welcome'}
            onComplete={handleOnboardingComplete}
          />
        </div>
      </TooltipProvider>
    )
  }

  // 显示主界面
  return (
    <TooltipProvider delayDuration={200} disableHoverableContent>
      <CloudAuthGate>
        <AppShell />
        <PlanningReminderRail />
        <QuotaExceededDialog />
        <OnboardingBillingPromptDialog
          open={onboardingBillingPromptOpen}
          onOpenChange={setOnboardingBillingPromptOpen}
        />
      </CloudAuthGate>
      <ShortcutGuideDialog />
      <FaqDialog />
      <GlobalEnvironmentCheckDialog />
      <GlobalThirdPartyChannelRemovedDialog />
    </TooltipProvider>
  )
}

/**
 * 应用启动时复用 Onboarding 首屏的画作，让冷启动阶段也保持一致的品牌体验。
 */
function StartupLoadingScreen(): React.ReactElement {
  return (
    <main
      className="relative flex h-screen items-center justify-center overflow-hidden bg-[#1b3f2d] text-white"
      aria-busy="true"
      aria-live="polite"
    >
      <img
        src={hopperSeasideWhiteHouse}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/35 to-black/15" />

      <div className="relative flex w-full max-w-sm flex-col items-center px-8 text-center">
        <div className="flex items-center gap-3">
          <img
            src={promaMarkWhite}
            alt=""
            className="h-9 w-9 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
          />
          <span className="text-xl font-light tracking-wide">Proma</span>
        </div>

        <p className="mt-6 max-w-xs text-balance text-lg font-light leading-relaxed tracking-[0.04em] text-white/95">
          让协作自然发生，让想法流动成形
        </p>

        <div className="mt-7 h-px w-24 overflow-hidden bg-white/35">
          <div className="h-full w-2/5 animate-pulse bg-white/90" />
        </div>
        <p className="mt-4 text-sm font-medium tracking-[0.08em] text-white/95">正在启动 Proma</p>
      </div>

      <p className="absolute bottom-8 px-6 text-center text-[11px] uppercase tracking-[0.3em] text-white/65">
        Local-first AI Agent
      </p>
    </main>
  )
}

/**
 * 全局环境检测 Dialog，由错误卡片的 recovery action 按钮打开。
 */
function GlobalEnvironmentCheckDialog(): React.ReactElement {
  const [open, setOpen] = useAtom(environmentCheckDialogOpenAtom)
  return <EnvironmentCheckDialog open={open} onOpenChange={setOpen} />
}

/**
 * 全局「第三方中转站已被移除」通知 Dialog。
 *
 * 应用启动后调用一次 `consumeChannelRemovalNotice`（主进程读取即清除）：
 * 没有待展示内容时不渲染任何内容，避免第一次启动就打一次徒劳的 IPC。
 */
function GlobalThirdPartyChannelRemovedDialog(): React.ReactElement | null {
  const [notice, setNotice] = React.useState<import('@proma/shared').ChannelRemovalNotice | null>(null)
  const [open, setOpen] = React.useState(false)
  // `consumeChannelRemovalNotice` 是读取即清除的操作。开发态 React Strict Mode 会
  // 模拟一次 effect 的卸载/重挂，因此必须复用同一个 Promise，避免第二次 effect
  // 把第一次尚未展示的通知读成空。
  const noticeRequestRef = React.useRef<Promise<import('@proma/shared').ChannelRemovalNotice | null> | null>(null)

  React.useEffect(() => {
    let active = true
    noticeRequestRef.current ??= window.electronAPI.consumeChannelRemovalNotice()

    noticeRequestRef.current
      .then((result) => {
        if (!active || !result || result.channels.length === 0) return
        setNotice(result)
        setOpen(true)
      })
      .catch((error) => {
        if (active) console.error('[App] 读取渠道移除通知失败:', error)
      })

    return () => {
      active = false
    }
  }, [])

  if (!notice) return null
  return <ThirdPartyChannelRemovedDialog open={open} onOpenChange={setOpen} channels={notice.channels} />
}
