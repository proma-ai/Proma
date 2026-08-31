/**
 * CloudSidebarExtension — 商业版 Cloud 功能在 LeftSidebar 中的扩展
 *
 * 将 Cloud 侧边栏逻辑集中到此组件，减少对 LeftSidebar.tsx 的侵入式修改，
 * 降低与上游合并时的冲突面。
 */

import * as React from 'react'
import { isCloudMode } from '@/lib/mode'
import { SidebarCreditTooltip } from '@/components/billing/SidebarCreditTooltip'

interface CloudSidebarCreditTooltipProps {
  children: React.ReactElement
}

/** Cloud 模式下为左下角用户区添加额度悬浮提示，不额外渲染任何侧边栏元素。 */
export function CloudSidebarCreditTooltip({ children }: CloudSidebarCreditTooltipProps): React.ReactElement {
  if (!isCloudMode()) return children
  return <SidebarCreditTooltip>{children}</SidebarCreditTooltip>
}
