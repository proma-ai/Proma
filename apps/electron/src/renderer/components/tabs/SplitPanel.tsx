/**
 * SplitPanel — 单个分屏面板
 *
 * 包装面板内容，处理焦点切换和视觉指示。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { splitLayoutAtom } from '@/atoms/tab-atoms'
import { TabContent } from './TabContent'
import { cn } from '@/lib/utils'
import type { SplitPanel as SplitPanelType } from '@/atoms/tab-atoms'

export interface SplitPanelProps {
  panel: SplitPanelType
  panelIndex: number
  gridArea: string
  isFocused: boolean
  showBorder: boolean
}

export function SplitPanel({
  panel,
  panelIndex,
  gridArea,
  isFocused,
  showBorder,
}: SplitPanelProps): React.ReactElement {
  const setLayout = useSetAtom(splitLayoutAtom)

  const handleClick = React.useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      focusedPanelIndex: panelIndex,
    }))
  }, [panelIndex, setLayout])

  return (
    <div
      className={cn(
        'min-h-0 min-w-0 overflow-hidden',
        showBorder && 'rounded-lg border border-border/60',
        showBorder && isFocused && 'border-primary/40',
      )}
      style={{ gridArea }}
      onClick={handleClick}
    >
      {panel.activeTabId ? (
        <TabContent tabId={panel.activeTabId} />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          从侧边栏选择一个会话
        </div>
      )}
    </div>
  )
}
