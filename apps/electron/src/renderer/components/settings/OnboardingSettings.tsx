import * as React from 'react'
import { useSetAtom } from 'jotai'
import { GraduationCap, RotateCcw } from 'lucide-react'
import { onboardingReplayRequestedAtom } from '@/atoms/onboarding'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from './primitives'

/** 设置中的二次确认页，避免点击左侧导航后误触直接进入全屏引导。 */
export function OnboardingSettings(): React.ReactElement {
  const setReplayRequested = useSetAtom(onboardingReplayRequestedAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)

  const handleReplay = (): void => {
    setReplayRequested(true)
    setSettingsOpen(false)
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Proma 新手引导"
        description="重新了解 Proma 的核心工作方式"
      >
        <SettingsCard>
          <div className="flex items-start gap-4 px-4 py-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <GraduationCap className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-foreground">准备好重新认识 Proma 了吗？</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                引导会从 Agent 和 Chat 的区别开始，依次介绍项目、文件、子会话、自动任务、记忆、侧边回答和 FAQ。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleReplay} className="shrink-0">
              <RotateCcw />
              重放引导
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
