/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。设置以浮窗形式叠加显示。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { tabsAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { SettingsDialog } from '@/components/settings'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { TabBar } from './TabBar'
import { TabContent } from './TabContent'

export function MainArea(): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)

  // [FLASH-DEBUG] 监控 tabs 变化，如果 tabs.length 变为 0 说明所有标签被卸载
  React.useEffect(() => {
    if (tabs.length === 0) {
      console.warn('[FLASH-DEBUG] MainArea: tabs.length === 0, showing WelcomeView!', new Error().stack)
    }
  }, [tabs.length])

  // 兜底：tabs 存在但 activeTabId 为空时，自动激活第一个标签。
  // 正常路径（openTab/closeTab/持久化恢复）都会维护 activeTabId，此分支只为防御
  // 异常状态（如外部原子被误清空），避免渲染 WelcomeView 触发重复 openTab 循环。
  React.useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      setActiveTabId(tabs[0]!.id)
    }
  }, [tabs, activeTabId, setActiveTabId])

  return (
    <>
      <Panel
        variant="grow"
        className="bg-content-area rounded-2xl shadow-xl"
      >
        <TabBar />
        {tabs.length === 0 ? (
          <WelcomeView />
        ) : activeTabId ? (
          <div className="flex-1 min-h-0 titlebar-no-drag">
            <TabContent tabId={activeTabId} />
          </div>
        ) : null}
      </Panel>
      <SettingsDialog />
    </>
  )
}
