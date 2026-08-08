import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { AppShell } from './components/app-shell/AppShell'
import { OnboardingView } from './components/onboarding/OnboardingView'
import { TutorialBanner } from './components/tutorial/TutorialBanner'
import { EnvironmentCheckDialog } from './components/environment/EnvironmentCheckDialog'
import { MigrationImportDialog } from './components/migration/MigrationImportDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { CloudAuthGate } from './components/cloud-auth'
import { QuotaExceededDialog } from './components/billing/QuotaExceededDialog'
import { agentChannelIdAtom, agentModelIdAtom, agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from './atoms/agent-atoms'
import { appModeAtom } from './atoms/app-mode'
import { PROMA_OFFICIAL_CHANNEL_ID, PROMA_OFFICIAL_DEFAULT_AGENT_MODEL } from '@proma/shared'
import { ShortcutGuideDialog } from './components/shortcuts/ShortcutGuideDialog'
import { FaqDialog } from './components/shortcuts/FaqDialog'
import { PlanningReminderRail } from './components/planning/PlanningReminderRail'
import { environmentCheckDialogOpenAtom } from './atoms/environment'
import { onboardingReplayRequestedAtom } from './atoms/onboarding'
import { settingsOpenAtom, settingsTabAtom } from './atoms/settings-tab'
import { tabsAtom, activeTabIdAtom, openTab, TUTORIAL_TAB_ID } from './atoms/tab-atoms'
import { hasCompletedCurrentOnboarding } from '../types'
import hopperSeasideWhiteHouse from './assets/onboarding/hopper-seaside-white-house.png'
import promaMarkWhite from './assets/onboarding/proma-mark-white.svg'
import type { AppShellContextType } from './contexts/AppShellContext'

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
  const [onboardingReplayRequested, setOnboardingReplayRequested] = useAtom(onboardingReplayRequestedAtom)
  const [isReplayingOnboarding, setIsReplayingOnboarding] = React.useState(false)

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

  // 完成 onboarding 回调：创建引用模式的 Agent 欢迎会话，可选打开教程 Tab
  const handleOnboardingComplete = async (openTutorial?: boolean) => {
    const replayingOnboarding = isReplayingOnboarding
    setShowOnboarding(false)
    setIsReplayingOnboarding(false)

    if (replayingOnboarding) {
      store.set(settingsTabAtom, 'onboarding')
      store.set(settingsOpenAtom, true)
      return
    }

    if (openTutorial) {
      const tabs = store.get(tabsAtom)
      const result = openTab(tabs, { type: 'tutorial', sessionId: TUTORIAL_TAB_ID, title: 'Proma 使用教程' })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
      return
    }

    try {
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

      // 首次会话以一条真实用户消息启动，让 Agent 基于当前工作区主动完成引导。
      await window.electronAPI.sendAgentMessage({
        sessionId: meta.id,
        channelId: meta.channelId ?? agentChannelId ?? PROMA_OFFICIAL_CHANNEL_ID,
        modelId: meta.modelId ?? agentModelId ?? PROMA_OFFICIAL_DEFAULT_AGENT_MODEL,
        workspaceId: meta.workspaceId ?? currentWorkspaceId ?? undefined,
        userMessage: '你好，我刚完成 Proma 的首次设置。请作为我的上手引导助手：先用简洁友好的方式欢迎我，说明你可以如何协助我完成真实工作；然后只问我一个最关键的问题，帮助你了解我现在想完成的第一件事。请不要一次性罗列大量功能，也不要执行任何工具或修改文件，等我回复后再继续。',
      })
    } catch (error) {
      console.error('[App] 创建欢迎对话失败:', error)
    }
  }

  // 加载中状态
  if (isLoading) {
    return <StartupLoadingScreen />
  }

  // 显示 onboarding 界面
  if (showOnboarding) {
    return (
      <TooltipProvider delayDuration={200}>
        <OnboardingView
          initialStep={isReplayingOnboarding ? 'guide' : 'welcome'}
          onComplete={handleOnboardingComplete}
        />
        <MigrationImportDialog />
      </TooltipProvider>
    )
  }

  // Placeholder context value
  const contextValue: AppShellContextType = {}

  // 显示主界面
  return (
    <TooltipProvider delayDuration={200}>
      <CloudAuthGate>
        <AppShell contextValue={contextValue} />
        <PlanningReminderRail />
        <QuotaExceededDialog />
      </CloudAuthGate>
      <ShortcutGuideDialog />
      <FaqDialog />
      <TutorialBanner />
      <GlobalEnvironmentCheckDialog />
      <MigrationImportDialog />
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
        <p className="mt-2 text-xs tracking-[0.12em] text-white/70">正在初始化你的工作空间</p>
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
