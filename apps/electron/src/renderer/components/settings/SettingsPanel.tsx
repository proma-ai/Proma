/**
 * SettingsPanel - 设置面板
 *
 * 左侧导航 + 右侧 ScrollArea 内容区域。
 * 四个标签页：通用 / 渠道配置 / 外观 / 关于
 * 使用 Jotai atom 管理当前标签页状态。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { Settings, Radio, Palette, Info, Plug, CreditCard, KeyRound } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { settingsTabAtom } from '@/atoms/settings-tab'
import type { SettingsTab } from '@/atoms/settings-tab'
import { appModeAtom } from '@/atoms/app-mode'
import { hasUpdateAtom } from '@/atoms/updater'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { ChannelSettings } from './ChannelSettings'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { AboutSettings } from './AboutSettings'
import { AgentSettings } from './AgentSettings'
import { BillingSettings } from '@/components/billing/BillingSettings'
import { ApiKeysSettings } from './ApiKeysSettings'
import { isCloudMode } from '@/lib/mode'

/** 设置 Tab 定义 */
interface TabItem {
  id: SettingsTab
  label: string
  icon: React.ReactNode
}

/** 基础 Tabs（所有模式都有） */
const BASE_TABS: TabItem[] = [
  { id: 'general', label: '通用', icon: <Settings size={16} /> },
  { id: 'channels', label: '渠道', icon: <Radio size={16} /> },
]

/** Agent 模式专属 Tab */
const AGENT_TAB: TabItem = { id: 'agent', label: '配置', icon: <Plug size={16} /> }

/** Cloud 模式专属 Tab */
const BILLING_TAB: TabItem = { id: 'billing', label: '账单', icon: <CreditCard size={16} /> }

/** Cloud 模式专属 Tab - API Key 管理 */
const API_TAB: TabItem = { id: 'api', label: 'API', icon: <KeyRound size={16} /> }

/** 尾部 Tabs */
const TAIL_TABS: TabItem[] = [
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'about', label: '关于', icon: <Info size={16} /> },
]

/** 根据标签页 id 渲染对应内容 */
function renderTabContent(tab: SettingsTab): React.ReactElement {
  switch (tab) {
    case 'general':
      return <GeneralSettings />
    case 'channels':
      return <ChannelSettings />
    case 'agent':
      return <AgentSettings />
    case 'billing':
      return <BillingSettings />
    case 'api':
      return <ApiKeysSettings />
    case 'appearance':
      return <AppearanceSettings />
    case 'about':
      return <AboutSettings />
  }
}

export function SettingsPanel(): React.ReactElement {
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom)
  const appMode = useAtomValue(appModeAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)

  // Agent 模式时在渠道后插入 Agent Tab，Cloud 模式插入 Billing Tab
  const tabs = React.useMemo(() => {
    const result = [...BASE_TABS]
    if (appMode === 'agent') {
      result.push(AGENT_TAB)
    }
    if (isCloudMode()) {
      result.push(BILLING_TAB)
      result.push(API_TAB)
    }
    result.push(...TAIL_TABS)
    return result
  }, [appMode])

  return (
    <div className="flex h-full">
      {/* 左侧 Tab 导航 */}
      <div className="w-[180px] border-r border-border/50 pt-14 px-2">
        <h2 className="text-xs font-medium text-muted-foreground px-3 mb-2 uppercase tracking-wider">
          设置
        </h2>
        <nav className="flex flex-col gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                activeTab === tab.id
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === 'about' && (hasUpdate || hasEnvironmentIssues) && (
                <span className="w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧内容区域 */}
      <ScrollArea className="flex-1 pt-14">
        <div className="px-6 pb-6">
          {renderTabContent(activeTab)}
        </div>
      </ScrollArea>
    </div>
  )
}
