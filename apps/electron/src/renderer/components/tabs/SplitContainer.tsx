/**
 * SplitContainer — 分屏容器
 *
 * 使用 CSS Grid 实现 1-4 面板布局。
 * 根据 splitLayoutAtom.mode 自动切换布局。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { splitLayoutAtom } from '@/atoms/tab-atoms'
import { SplitPanel } from './SplitPanel'
import type { SplitMode } from '@/atoms/tab-atoms'

/** 获取 CSS Grid 样式 */
function getGridStyle(mode: SplitMode): React.CSSProperties {
  switch (mode) {
    case 'single':
      return { gridTemplate: '"a" 1fr / 1fr' }
    case 'horizontal-2':
      return { gridTemplate: '"a b" 1fr / 1fr 1fr' }
    case 'vertical-2':
      return { gridTemplate: '"a" 1fr "b" 1fr / 1fr' }
    case 'grid-4':
      return { gridTemplate: '"a b" 1fr "c d" 1fr / 1fr 1fr' }
  }
}

const GRID_AREAS = ['a', 'b', 'c', 'd']

export function SplitContainer(): React.ReactElement {
  const layout = useAtomValue(splitLayoutAtom)

  const isSplit = layout.mode !== 'single'

  return (
    <div
      className={isSplit ? 'flex-1 min-h-0 p-1.5 titlebar-no-drag' : 'flex-1 min-h-0 titlebar-no-drag'}
      style={{
        display: 'grid',
        gap: isSplit ? 6 : 0,
        ...getGridStyle(layout.mode),
      }}
    >
      {layout.panels.map((panel, idx) => (
        <SplitPanel
          key={idx}
          panel={panel}
          panelIndex={idx}
          gridArea={GRID_AREAS[idx]!}
          isFocused={idx === layout.focusedPanelIndex}
          showBorder={isSplit}
        />
      ))}
    </div>
  )
}
