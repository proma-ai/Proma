/**
 * HealthBar - 模型健康电量条组件
 *
 * 显示 20 格电量条，每格根据健康状态显示不同颜色：
 * - 绿色：2 次检测都健康
 * - 黄色：1 次健康 1 次不健康
 * - 红色：2 次检测都不健康
 * - 灰色：无数据
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { HealthBarCell, HealthBarCellStatus } from '@proma/shared'

/** 状态对应的颜色类名 */
const STATUS_COLORS: Record<HealthBarCellStatus, string> = {
  green: 'bg-[#64BA09]',
  yellow: 'bg-[#FBBF24]',
  red: 'bg-[#DC2626]',
  gray: 'bg-muted-foreground/30',
}

interface HealthBarProps {
  /** 电量条数据 */
  cells: HealthBarCell[]
  /** 尺寸：sm = 模型选择器，md = 设置页表格 */
  size?: 'sm' | 'md'
  /** 额外 className */
  className?: string
}

export function HealthBar({ cells, size = 'sm', className }: HealthBarProps): React.ReactElement {
  const cellSize = size === 'sm' ? 'w-[2px] h-2' : 'w-[3px] h-3'
  const gap = size === 'sm' ? 'gap-[2px]' : 'gap-[2px]'

  return (
    <div className={cn('flex items-center', gap, className)}>
      {cells.map((cell, index) => (
        <Tooltip key={index} delayDuration={200}>
          <TooltipTrigger asChild>
            <div
              className={cn(cellSize, 'rounded-[1px] transition-colors', STATUS_COLORS[cell.status])}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {cell.startTime ? (
              <>
                {formatTime(cell.startTime)} - {formatTime(cell.endTime)}
                <br />
                {getStatusLabel(cell.status)}
              </>
            ) : (
              '无数据'
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

/** 格式化时间为 "HH:MM" */
function formatTime(isoString: string): string {
  if (!isoString) return '--:--'
  const date = new Date(isoString)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 获取状态文字描述 */
function getStatusLabel(status: HealthBarCellStatus): string {
  switch (status) {
    case 'green':
      return '正常'
    case 'yellow':
      return '不稳定'
    case 'red':
      return '异常'
    case 'gray':
      return '无数据'
  }
}
