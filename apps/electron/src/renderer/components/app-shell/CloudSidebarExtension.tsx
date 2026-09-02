/**
 * CloudSidebarExtension — 商业版 Cloud 功能在 LeftSidebar 中的扩展
 *
 * 将 Cloud 侧边栏逻辑集中到此组件，减少对 LeftSidebar.tsx 的侵入式修改，
 * 降低与上游合并时的冲突面。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { isCloudMode } from '@/lib/mode'
import { SidebarCreditIndicator } from '@/components/billing/SidebarCreditIndicator'
import { SidebarCreditTooltip } from '@/components/billing/SidebarCreditTooltip'
import { sidebarCreditIndicatorVisibleAtom } from '@/atoms/ui-preferences'

interface CloudSidebarCreditTooltipProps {
  children: React.ReactElement
}

/** Cloud 侧边栏余额指示器；用户可从通用设置隐藏。 */
export function CloudSidebarCreditIndicator(): React.ReactElement | null {
  const visible = useAtomValue(sidebarCreditIndicatorVisibleAtom)

  if (!isCloudMode() || !visible) return null
  return (
    <div className="px-3">
      <SidebarCreditIndicator />
    </div>
  )
}

/** Cloud 模式下为左下角用户区添加额度悬浮提示，保留余额查看与设置发现路径。 */
export function CloudSidebarCreditTooltip({ children }: CloudSidebarCreditTooltipProps): React.ReactElement {
  if (!isCloudMode()) return children
  return <SidebarCreditTooltip>{children}</SidebarCreditTooltip>
}
