/**
 * DiffPanelTabBar — 右侧面板顶部 Tab 栏
 *
 * 切换「工作区文件」和「代码改动」两个视图。最右侧有关闭按钮。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { PanelRightClose } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { agentDiffUnseenChangesAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'

type DiffPanelTab = 'files' | 'changes'

interface DiffPanelTabBarProps {
  activeTab: DiffPanelTab
  onTabChange: (tab: DiffPanelTab) => void
  onClose?: () => void
}

interface PreviousTabState {
  sessionId: string | null
  activeTab: DiffPanelTab
}

export function DiffPanelTabBar({ activeTab, onTabChange, onClose }: DiffPanelTabBarProps): React.ReactElement {
  const unseenMap = useAtomValue(agentDiffUnseenChangesAtom)
  const setUnseenMap = useSetAtom(agentDiffUnseenChangesAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
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
      <div className="absolute inset-0 titlebar-drag-region" />
      <div className="relative flex items-end flex-1 titlebar-no-drag">
        <button
          type="button"
          onClick={() => onTabChange('files')}
          className={cn(
            'flex-1 px-3 h-[34px] rounded-t-lg text-xs transition-colors select-none cursor-pointer',
            'border-t border-l border-r',
            activeTab === 'files'
              ? 'bg-content-area text-foreground border-border/50'
              : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50',
          )}
        >
          工作区文件
        </button>
        <button
          type="button"
          onClick={handleChangesClick}
          className={cn(
            'flex-1 px-3 h-[34px] rounded-t-lg text-xs transition-colors select-none cursor-pointer relative',
            'border-t border-l border-r',
            activeTab === 'changes'
              ? 'bg-content-area text-foreground border-border/50'
              : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50',
          )}
        >
          <span className="inline-flex items-center gap-1">
            {unseenChanges && activeTab !== 'changes' && (
              <span className="size-2 rounded-full bg-primary ring-1 ring-background shrink-0" />
            )}
            文件改动
          </span>
        </button>
        {/* 右侧关闭按钮（常驻，两个 tab 下都可见） */}
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
