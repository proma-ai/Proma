import * as React from 'react'
import { useSetAtom } from 'jotai'
import { useStore } from 'jotai'
import { AppShell } from './components/app-shell/AppShell'
import { OnboardingView } from './components/onboarding/OnboardingView'
import { TutorialBanner } from './components/tutorial/TutorialBanner'
import { TooltipProvider } from './components/ui/tooltip'
import { CloudAuthGate } from './components/cloud-auth'
import { QuotaExceededDialog } from './components/billing/QuotaExceededDialog'
import { environmentCheckResultAtom } from './atoms/environment'
import { conversationsAtom } from './atoms/chat-atoms'
import { tabsAtom, activeTabIdAtom, openTab } from './atoms/tab-atoms'
import type { AppShellContextType } from './contexts/AppShellContext'

export default function App(): React.ReactElement {
  // [FLASH-DEBUG] 监控 App 组件重渲染（如果看到频繁日志，说明根组件被频繁重渲染）
  const appRenderCountRef = React.useRef(0)
  appRenderCountRef.current++
  if (appRenderCountRef.current > 1) {
    console.warn(`[FLASH-DEBUG] App re-render #${appRenderCountRef.current}, isLoading/showOnboarding may have changed`)
  }

  const setEnvironmentResult = useSetAtom(environmentCheckResultAtom)
  const store = useStore()
  const [isLoading, setIsLoading] = React.useState(true)
  const [showOnboarding, setShowOnboarding] = React.useState(false)

  // 初始化：检查 onboarding 状态和环境
  React.useEffect(() => {
    const initialize = async () => {
      try {
        // 1. 获取设置，检查是否需要 onboarding
        const settings = await window.electronAPI.getSettings()

        // 2. 执行环境检测（无论是否完成 onboarding）
        const envResult = await window.electronAPI.checkEnvironment()
        setEnvironmentResult(envResult)

        // 3. 判断是否显示 onboarding
        if (!settings.onboardingCompleted) {
          setShowOnboarding(true)
        }
      } catch (error) {
        console.error('[App] 初始化失败:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initialize()
  }, [setEnvironmentResult])

  // 完成 onboarding 回调：创建欢迎对话
  const handleOnboardingComplete = async () => {
    setShowOnboarding(false)

    try {
      const meta = await window.electronAPI.createWelcomeConversation()
      if (meta) {
        // 添加到对话列表
        const conversations = store.get(conversationsAtom)
        store.set(conversationsAtom, [meta, ...conversations])

        // 打开对话标签页
        const tabs = store.get(tabsAtom)
        const result = openTab(tabs, {
          type: 'chat',
          sessionId: meta.id,
          title: meta.title,
        })
        store.set(tabsAtom, result.tabs)
        store.set(activeTabIdAtom, result.activeTabId)
      }
    } catch (error) {
      console.error('[App] 创建欢迎对话失败:', error)
    }
  }

  // 加载中状态
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">正在初始化...</p>
        </div>
      </div>
    )
  }

  // 显示 onboarding 界面
  if (showOnboarding) {
    return (
      <TooltipProvider delayDuration={200}>
        <OnboardingView onComplete={handleOnboardingComplete} />
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
        <QuotaExceededDialog />
      </CloudAuthGate>
      <TutorialBanner />
    </TooltipProvider>
  )
}
