/**
 * ModelHealthIndicator - 模型健康指示器（用于模型选择器）
 *
 * 显示：健康率 + 电量条
 * 仅在 Proma 官方渠道 + Claude 模型时显示
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { modelHealthByIdAtom } from '@/atoms/model-health'
import { HealthBar } from '@/components/ui/health-bar'
import { cn } from '@/lib/utils'

interface ModelHealthIndicatorProps {
  /** 模型 ID */
  modelId: string
  /** 额外 className */
  className?: string
}

export function ModelHealthIndicator({
  modelId,
  className,
}: ModelHealthIndicatorProps): React.ReactElement | null {
  const healthMap = useAtomValue(modelHealthByIdAtom)
  const health = healthMap.get(modelId)

  // 无健康数据时不显示
  if (!health) return null

  return (
    <div className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span
        className={cn(
          'font-medium w-[40px] text-right',
          health.healthRatePercent >= 90
            ? 'text-[#64BA09]'
            : health.healthRatePercent >= 70
              ? 'text-[#FBBF24]'
              : 'text-[#DC2626]',
        )}
      >
        {health.healthRatePercent}%
      </span>
      <HealthBar cells={health.healthBar} size="sm" />
    </div>
  )
}
