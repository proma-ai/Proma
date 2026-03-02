/**
 * MainArea — 主内容区域
 *
 * 替代原 MainContentPanel，组合 TabBar + SplitContainer。
 * Settings 视图仍为独立全屏覆盖。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { activeViewAtom } from '@/atoms/active-view'
import { tabsAtom } from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { SettingsPanel } from '@/components/settings'
import { TabBar } from './TabBar'
import { SplitContainer } from './SplitContainer'
import { MessageSquare } from 'lucide-react'

export function MainArea(): React.ReactElement {
  const activeView = useAtomValue(activeViewAtom)
  const tabs = useAtomValue(tabsAtom)

  // Settings 视图覆盖整个右侧
  if (activeView === 'settings') {
    return (
      <Panel
        variant="grow"
        className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl rounded-2xl shadow-xl border border-border/50 titlebar-no-drag"
      >
        <SettingsPanel />
      </Panel>
    )
  }

  // 标签视图
  return (
    <Panel
      variant="grow"
      className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl rounded-2xl shadow-xl border border-border/50"
    >
      <TabBar />
      {tabs.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground titlebar-no-drag" style={{ zoom: 1.1 }}>
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <MessageSquare size={32} className="text-muted-foreground/60" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-lg font-medium text-foreground">开始使用</h2>
            <p className="text-sm max-w-[300px]">
              从左侧选择或创建一个对话，它将以标签页的形式打开
            </p>
          </div>
        </div>
      ) : (
        <SplitContainer />
      )}
    </Panel>
  )
}
