/**
 * SettingsPanel - 设置面板
 *
 * 顶部 Header（标题 + 关闭按钮）+ 下方（左侧导航 + 右侧 ScrollArea 内容区域）。
 * 使用 Jotai atom 管理当前标签页状态。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { Settings, Radio, Palette, Info, Plug, Globe, BookOpen, Wrench, Bot, GraduationCap, X, Keyboard } from 'lucide-react'
// Cloud 模式专属图标
import { CreditCard, KeyRound, ScrollText } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { settingsTabAtom } from '@/atoms/settings-tab'
import type { SettingsTab } from '@/atoms/settings-tab'
import { appModeAtom } from '@/atoms/app-mode'
import { hasUpdateAtom } from '@/atoms/updater'
import { hasEnvironmentIssuesAtom } from '@/atoms/environment'
import { ChannelSettings } from './ChannelSettings'
import { GeneralSettings } from './GeneralSettings'
import { ProxySettings } from './ProxySettings'
import { AppearanceSettings } from './AppearanceSettings'
import { AboutSettings } from './AboutSettings'
import { AgentSettings } from './AgentSettings'
import { PromptSettings } from './PromptSettings'
import { ToolSettings } from './ToolSettings'
// Cloud 模式专属组件
import { BillingSettings } from '@/components/billing/BillingSettings'
import { ApiKeysSettings } from './ApiKeysSettings'
import { UsageSettings } from './UsageSettings'
import { isCloudMode } from '@/lib/mode'
import { BotHubSettings } from './BotHubSettings'
import { TutorialViewer } from '../tutorial/TutorialViewer'
import { ShortcutSettings } from './ShortcutSettings'

/** 设置 Tab 定义 */
interface TabItem {
  id: SettingsTab
  label: string
  icon: React.ReactNode
}

/** 基础 Tabs（所有模式都有） */
const BASE_TABS: TabItem[] = [
  { id: 'general', label: '通用', icon: <Settings size={16} /> },
  { id: 'channels', label: '模型', icon: <Radio size={16} /> },
  { id: 'prompts', label: '提示词', icon: <BookOpen size={16} /> },
  { id: 'proxy', label: '代理', icon: <Globe size={16} /> },
]

/** Agent 模式专属 Tab */
const AGENT_TAB: TabItem = { id: 'agent', label: '配置', icon: <Plug size={16} /> }
const TOOLS_TAB: TabItem = { id: 'tools', label: '工具', icon: <Wrench size={16} /> }
const BOTS_TAB: TabItem = { id: 'bots', label: '机器人', icon: <Bot size={16} /> }
const TUTORIAL_TAB: TabItem = { id: 'tutorial', label: '教程', icon: <GraduationCap size={16} /> }
const SHORTCUTS_TAB: TabItem = { id: 'shortcuts', label: '快捷键', icon: <Keyboard size={16} /> }

/** Cloud 模式专属 Tab */
const BILLING_TAB: TabItem = { id: 'billing', label: '账单', icon: <CreditCard size={16} /> }

/** Cloud 模式专属 Tab - API Key 管理 */
const API_TAB: TabItem = { id: 'api', label: 'API', icon: <KeyRound size={16} /> }

/** Cloud 模式专属 Tab - 用量日志 */
const USAGE_TAB: TabItem = { id: 'usage', label: '日志', icon: <ScrollText size={16} /> }

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
    case 'prompts':
      return <PromptSettings />
    case 'proxy':
      return <ProxySettings />
    case 'agent':
      return <AgentSettings />
    case 'tools':
      return <ToolSettings />
    // Cloud 模式专属页面
    case 'billing':
      return <BillingSettings />
    case 'api':
      return <ApiKeysSettings />
    case 'usage':
      return <UsageSettings />
    case 'appearance':
      return <AppearanceSettings />
    case 'about':
      return <AboutSettings />
    case 'bots':
      return <BotHubSettings />
    case 'tutorial':
      return <TutorialViewer />
    case 'shortcuts':
      return <ShortcutSettings />
  }
}

interface SettingsPanelProps {
  onClose?: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.ReactElement {
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom)
  const appMode = useAtomValue(appModeAtom)
  const hasUpdate = useAtomValue(hasUpdateAtom)
  const hasEnvironmentIssues = useAtomValue(hasEnvironmentIssuesAtom)

  // Agent 模式时在渠道后插入 Agent Tab，记忆/工具 tab 两种模式都显示，Cloud 模式插入 Billing Tab
  const tabs = React.useMemo(() => {
    const result = [...BASE_TABS]
    if (appMode === 'agent') {
      result.push(AGENT_TAB)
    }
    result.push(TOOLS_TAB)
    result.push(BOTS_TAB)
    result.push(TUTORIAL_TAB)
    result.push(SHORTCUTS_TAB)
    if (isCloudMode()) {
      result.push(BILLING_TAB)
      result.push(API_TAB)
      result.push(USAGE_TAB)
    }
    result.push(...TAIL_TABS)
    return result
  }, [appMode])

  // 当前 tab 标题
  const activeTabLabel = tabs.find((t) => t.id === activeTab)?.label ?? '设置'

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 Header 栏 */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-foreground">{activeTabLabel}</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* 下方主体：左导航 + 右内容 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧 Tab 导航 */}
        <div className="w-[160px] border-r border-border/50 pt-3 px-2 flex-shrink-0">
          <nav className="flex flex-col gap-0.5">
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
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">
            {renderTabContent(activeTab)}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
