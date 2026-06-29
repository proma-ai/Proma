/**
 * DiffPanelTabBar — 右侧面板顶部 Tab 栏
 *
 * 切换「会话文件」「工作区文件」和「代码改动」三个视图。最右侧有关闭按钮。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { PanelRightClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WINDOW_CONTROLS_INSET_RIGHT } from '@/lib/platform'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { agentDiffUnseenChangesAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { interfaceVariantAtom } from '@/atoms/theme'

type DiffPanelTab = 'session' | 'workspace' | 'changes'

interface DiffPanelTabBarProps {
  activeTab: DiffPanelTab
  onTabChange: (tab: DiffPanelTab) => void
  onClose?: () => void
  isWindows?: boolean
}

interface PreviousTabState {
  sessionId: string | null
  activeTab: DiffPanelTab
}

export function DiffPanelTabBar({ activeTab, onTabChange, onClose, isWindows = false }: DiffPanelTabBarProps): React.ReactElement {
  const unseenMap = useAtomValue(agentDiffUnseenChangesAtom)
  const setUnseenMap = useSetAtom(agentDiffUnseenChangesAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'
  const unseenChanges = unseenMap.get(currentSessionId ?? '') ?? false
  const prevTabStateRef = React.useRef<PreviousTabState>({ sessionId: currentSessionId, activeTab })

  const clearUnseen = React.useCallback((sessionId = currentSessionId) => {
    if (!sessionId) return
    setUnseenMap((prev) => {
      if (prev.get(sessionId) === false) return prev
      const m = new Map(prev)
      m.set(sessionId, false)
      return m
    })
  }, [currentSessionId, setUnseenMap])

  // 同一会话内，从「文件改动」切走时，说明用户已经看过当前改动。
  React.useEffect(() => {
    const previous = prevTabStateRef.current
    if (previous.sessionId === currentSessionId && previous.activeTab === 'changes' && activeTab !== 'changes') {
      clearUnseen(currentSessionId)
    }
    prevTabStateRef.current = { sessionId: currentSessionId, activeTab }
  }, [activeTab, currentSessionId, clearUnseen])

  const handleChangesClick = () => {
    clearUnseen()
    if (activeTab !== 'changes') {
      onTabChange('changes')
    }
  }

  return (
    <div className="flex items-end h-[34px] tabbar-bg relative flex-shrink-0">
      <div className={cn("absolute inset-0 titlebar-drag-region", isWindows && WINDOW_CONTROLS_INSET_RIGHT)} />
      <div className="relative flex items-end flex-1 titlebar-no-drag">
        <button
          type="button"
          onClick={() => onTabChange('session')}
          className={cn(
            'flex-1 px-3 h-[34px] text-xs transition-colors select-none cursor-pointer whitespace-nowrap overflow-hidden',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            activeTab === 'session'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          会话文件
        </button>
        <button
          type="button"
          onClick={() => onTabChange('workspace')}
          className={cn(
            'flex-1 px-3 h-[34px] text-xs transition-colors select-none cursor-pointer whitespace-nowrap overflow-hidden',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            activeTab === 'workspace'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          工作区文件
        </button>
        <button
          type="button"
          onClick={handleChangesClick}
          className={cn(
            'flex-1 px-3 h-[34px] text-xs transition-colors select-none cursor-pointer relative whitespace-nowrap overflow-hidden',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            activeTab === 'changes'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          <span className="inline-flex items-center gap-1">
            {unseenChanges && activeTab !== 'changes' && (
              <span className="size-2 rounded-full bg-primary ring-1 ring-background shrink-0" />
            )}
            文件改动
          </span>
        </button>
        {/* 右侧关闭按钮（常驻，三个 tab 下都可见） */}
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center size-[28px] mr-1 mb-[3px] rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
              >
                <PanelRightClose className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">折叠文件面板 ({navigator.platform.includes('Mac') ? '⌘⇧B' : 'Ctrl+Shift+B'})</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
