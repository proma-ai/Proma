/**
 * CloudSidebarExtension — 商业版 Cloud 功能在 LeftSidebar 中的扩展
 *
 * 将 Cloud 侧边栏逻辑集中到此组件，减少对 LeftSidebar.tsx 的侵入式修改，
 * 降低与上游合并时的冲突面。
 */

import * as React from 'react'
import { isCloudMode } from '@/lib/mode'
import { SidebarCreditIndicator } from '@/components/billing/SidebarCreditIndicator'

/** Cloud 侧边栏余额指示器。 */
export function CloudSidebarCreditIndicator(): React.ReactElement | null {
  if (!isCloudMode()) return null
  return (
    <div className="px-3">
      <SidebarCreditIndicator />
    </div>
  )
}
