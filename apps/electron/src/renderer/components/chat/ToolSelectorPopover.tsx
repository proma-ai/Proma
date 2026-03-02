/**
 * ToolSelectorPopover - 工具选择器弹出层
 *
 * 在 ChatInput footer 中显示工具开关列表。
 * 用户可以快速启用/禁用工具（记忆、联网搜索等）。
 * 类似 ContextSettingsPopover 的交互方式。
 */

import { useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Wrench, Brain, Globe, Settings } from 'lucide-react'
import { chatToolsAtom, enabledToolIdsAtom, hasActiveToolsAtom } from '@/atoms/chat-tool-atoms'
import { settingsTabAtom } from '@/atoms/settings-tab'
import { activeViewAtom } from '@/atoms/active-view'

/** 工具 ID 到图标的映射 */
function getToolIcon(iconName?: string): React.ReactElement {
  switch (iconName) {
    case 'Brain':
      return <Brain className="size-4" />
    case 'Globe':
      return <Globe className="size-4" />
    default:
      return <Wrench className="size-4" />
  }
}

export function ToolSelectorPopover(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const tools = useAtomValue(chatToolsAtom)
  const [enabledIds, setEnabledIds] = useAtom(enabledToolIdsAtom)
  const hasActiveTools = useAtomValue(hasActiveToolsAtom)
  const [, setActiveView] = useAtom(activeViewAtom)
  const [, setSettingsTab] = useAtom(settingsTabAtom)

  /** 切换工具开关 */
  const toggleTool = (toolId: string): void => {
    if (enabledIds.includes(toolId)) {
      setEnabledIds(enabledIds.filter((id) => id !== toolId))
    } else {
      setEnabledIds([...enabledIds, toolId])
    }
  }

  /** 跳转到设置页工具 tab */
  const goToToolSettings = (): void => {
    setOpen(false)
    setActiveView('settings')
    setSettingsTab('tools')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-[30px] rounded-full',
                hasActiveTools ? 'text-blue-500' : 'text-foreground/60 hover:text-foreground',
              )}
            >
              <Wrench className="size-5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>工具</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64" side="top" align="center">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">工具</span>
          </div>

          {/* 工具列表 */}
          {tools.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">加载中...</p>
          ) : (
            <div className="space-y-1">
              {tools.map((tool) => {
                const isEnabled = enabledIds.includes(tool.meta.id)
                const canToggle = tool.available

                return (
                  <div
                    key={tool.meta.id}
                    className="flex items-center justify-between py-1.5 px-1 rounded-md hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        'shrink-0',
                        !canToggle && 'opacity-40',
                      )}>
                        {getToolIcon(tool.meta.icon)}
                      </span>
                      <span className={cn(
                        'text-sm truncate',
                        !canToggle && 'text-muted-foreground',
                      )}>
                        {tool.meta.name}
                      </span>
                      {!canToggle && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          需配置
                        </span>
                      )}
                    </div>
                    <Switch
                      checked={isEnabled && canToggle}
                      onCheckedChange={() => toggleTool(tool.meta.id)}
                      disabled={!canToggle}
                      className="scale-75"
                    />
                  </div>
                )
              })}
            </div>
          )}

          {/* 管理工具链接 */}
          <button
            type="button"
            onClick={goToToolSettings}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full pt-1 border-t border-border/50"
          >
            <Settings className="size-3" />
            <span>管理工具</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
