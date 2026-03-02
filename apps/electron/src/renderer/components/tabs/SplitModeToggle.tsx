/**
 * SplitModeToggle — 分屏模式切换按钮
 *
 * 提供 Popover 选择布局模式：单面板 / 左右 / 上下 / 四格
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { splitLayoutAtom, setSplitMode } from '@/atoms/tab-atoms'
import type { SplitMode } from '@/atoms/tab-atoms'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

/** 布局模式图标 SVG */
function LayoutIcon({ mode, className }: { mode: SplitMode; className?: string }): React.ReactElement {
  const size = 16
  const stroke = 'currentColor'
  const fill = 'none'

  switch (mode) {
    case 'single':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke={stroke} fill={fill} strokeWidth="1.2" />
        </svg>
      )
    case 'horizontal-2':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke={stroke} fill={fill} strokeWidth="1.2" />
          <line x1="8" y1="2" x2="8" y2="14" stroke={stroke} strokeWidth="1.2" />
        </svg>
      )
    case 'vertical-2':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke={stroke} fill={fill} strokeWidth="1.2" />
          <line x1="2" y1="8" x2="14" y2="8" stroke={stroke} strokeWidth="1.2" />
        </svg>
      )
    case 'grid-4':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke={stroke} fill={fill} strokeWidth="1.2" />
          <line x1="8" y1="2" x2="8" y2="14" stroke={stroke} strokeWidth="1.2" />
          <line x1="2" y1="8" x2="14" y2="8" stroke={stroke} strokeWidth="1.2" />
        </svg>
      )
  }
}

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: 'single', label: '单面板' },
  { mode: 'horizontal-2', label: '左右分屏' },
  { mode: 'vertical-2', label: '上下分屏' },
  { mode: 'grid-4', label: '四格分屏' },
]

export function SplitModeToggle(): React.ReactElement {
  const [layout, setLayout] = useAtom(splitLayoutAtom)
  const [open, setOpen] = React.useState(false)

  const handleSelect = (mode: SplitMode): void => {
    setLayout((prev) => setSplitMode(prev, mode))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-[34px] shrink-0 rounded-none text-muted-foreground hover:text-foreground titlebar-no-drag"
            >
              <LayoutIcon mode={layout.mode} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>分屏模式</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="w-auto p-1.5">
        <div className="flex gap-1">
          {MODES.map(({ mode, label }) => (
            <Tooltip key={mode}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-8 rounded-md',
                    layout.mode === mode && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => handleSelect(mode)}
                >
                  <LayoutIcon mode={mode} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{label}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
