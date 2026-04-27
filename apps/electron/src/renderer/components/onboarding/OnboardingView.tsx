/**
 * Onboarding 视图组件
 *
 * 首次启动时显示的全屏欢迎界面。
 *
 * 说明：Claude Agent SDK 0.2.113+ 自带编译好的 claude native binary，Proma 核心
 * 功能不再依赖宿主机的 Node.js 或 Git。Onboarding 不再做环境阻塞式检测，用户
 * 如需查看运行时信息可在「设置 → 关于」页面自助检查。
 */

import { useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TutorialViewer } from '@/components/tutorial/TutorialViewer'

interface OnboardingViewProps {
  /** 完成回调（进入主界面） */
  onComplete: () => void
}

/**
 * Onboarding 视图
 */
export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [showTutorial, setShowTutorial] = useState(false)

  // 完成 Onboarding
  const handleComplete = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
    })
    onComplete()
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-8">
      {/* 顶部区域 */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold mb-4">欢迎使用 Proma</h1>
        <p className="text-lg text-muted-foreground">
          下一代桌面 AI 软件，让通用 Agent 触手可及
        </p>
      </div>

      {/* 教程入口 */}
      <div className="w-full max-w-2xl mb-8">
        <button
          onClick={() => setShowTutorial(true)}
          className="w-full rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/15 p-4 flex items-center gap-4 hover:from-primary/10 hover:via-primary/15 hover:to-primary/10 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <GraduationCap size={20} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">查看使用教程</h3>
            <p className="text-xs text-muted-foreground mt-0.5">了解 Proma 的全部功能和使用技巧</p>
          </div>
        </button>
      </div>

      {/* 底部操作栏 */}
      <div className="flex gap-4">
        <Button onClick={handleComplete}>开始使用</Button>
      </div>

      {/* 教程 Sheet */}
      <Sheet open={showTutorial} onOpenChange={setShowTutorial}>
        <SheetContent side="right" className="w-[560px] sm:max-w-[560px] p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <GraduationCap size={18} className="text-primary" />
              Proma 使用教程
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="px-6 py-4">
              <TutorialViewer />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}
