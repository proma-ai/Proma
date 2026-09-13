import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { PanelLeft, Search } from 'lucide-react'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchDialog } from './SearchDialog'

const BUTTON_CLASS_NAME = 'titlebar-no-drag fixed z-[110] flex items-center justify-center rounded-md bg-transparent text-foreground/50 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const BUTTON_STYLE: React.CSSProperties = {
  top: 'var(--sidebar-toggle-top)',
  width: 'var(--sidebar-toggle-size, 28px)',
  height: 'var(--sidebar-toggle-size, 28px)',
}
const ICON_STYLE: React.CSSProperties = {
  width: 'var(--sidebar-toggle-icon-size, 16px)',
  height: 'var(--sidebar-toggle-icon-size, 16px)',
}

/** 侧栏开关与搜索常驻窗口层，展开、收起时保留 DOM 节点和焦点。 */
export function SidebarTitlebarControls(): React.ReactElement {
  const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)
  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)
  const label = collapsed ? '展开侧边栏' : '收起侧边栏'

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={!collapsed}
            aria-controls="app-left-sidebar"
            onClick={() => setCollapsed((previous) => !previous)}
            className={BUTTON_CLASS_NAME}
            style={{ ...BUTTON_STYLE, left: 'var(--sidebar-toggle-left)' }}
          >
            <PanelLeft aria-hidden="true" style={ICON_STYLE} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="flex items-center gap-2">
            {label}
            <ShortcutKeycaps shortcutId="toggle-sidebar" />
          </span>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="搜索"
            aria-haspopup="dialog"
            onClick={() => setSearchDialogOpen(true)}
            className={BUTTON_CLASS_NAME}
            style={{ ...BUTTON_STYLE, left: 'var(--sidebar-search-left)' }}
          >
            <Search aria-hidden="true" style={ICON_STYLE} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="flex items-center gap-2">
            搜索
            <ShortcutKeycaps shortcutId="global-search" />
          </span>
        </TooltipContent>
      </Tooltip>
      <SearchDialog />
    </>
  )
}
