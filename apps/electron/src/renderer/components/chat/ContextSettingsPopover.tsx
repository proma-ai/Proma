/**
 * ContextSettingsPopover - 上下文长度设置弹出层
 *
 * Popover 内含上下文长度 Slider（0/5/10/15/20/∞ 轮）。
 * 简化版移植自 proma-frontend，去掉 Token 估算部分。
 */

import { useState } from 'react'
import { useAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Settings2 } from 'lucide-react'
import {
  contextLengthAtom,
  CONTEXT_LENGTH_OPTIONS,
  type ContextLengthValue,
} from '@/atoms/chat-atoms'

/** 上下文长度滑块标签 */
function getContextLengthLabel(value: ContextLengthValue): string {
  if (value === 'infinite') return '无限'
  if (value === 0) return '0 轮'
  return `${value} 轮`
}

/** 将滑块位置转换为实际值 */
function sliderPositionToValue(position: number): ContextLengthValue {
  return CONTEXT_LENGTH_OPTIONS[position]!
}

/** 将实际值转换为滑块位置 */
function valueToSliderPosition(value: ContextLengthValue): number {
  const index = CONTEXT_LENGTH_OPTIONS.indexOf(value)
  return index >= 0 ? index : CONTEXT_LENGTH_OPTIONS.length - 2 // 默认 20
}

export function ContextSettingsPopover(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [contextLength, setContextLength] = useAtom(contextLengthAtom)

  const sliderPosition = valueToSliderPosition(contextLength)
  const maxSliderPosition = CONTEXT_LENGTH_OPTIONS.length - 1

  const handleSliderChange = (values: number[]): void => {
    const newValue = sliderPositionToValue(values[0]!)
    // 暂不允许选择 infinite
    if (newValue === 'infinite') {
      return
    }
    setContextLength(newValue)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>上下文设置</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72" side="top" align="center">
        <div className="space-y-3">
          {/* 上下文长度设置 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">上下文长度</span>
              <span className="text-xs text-muted-foreground">
                {getContextLengthLabel(contextLength)}
              </span>
            </div>

            <Slider
              value={[sliderPosition]}
              onValueChange={handleSliderChange}
              max={maxSliderPosition}
              step={1}
              className="w-full"
            />

            {/* 刻度标签 */}
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0</span>
              <span>5</span>
              <span>10</span>
              <span>15</span>
              <span>20</span>
              <span className={cn(
                contextLength === 'infinite' ? '' : 'opacity-50'
              )}>
                ∞
              </span>
            </div>

            {/* 无限上下文提示 */}
            <p className="text-[10px] text-muted-foreground">
              ∞ 无限上下文（即将推出）
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
