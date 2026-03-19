/**
 * ModelHealthTable - 模型健康详细表格（设置页使用）
 *
 * 显示所有 Claude 模型的健康状态：
 * - 模型名称
 * - 电量条
 * - 历史健康率百分比
 *
 * 默认显示 4 个模型，可展开查看更多
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { HealthBar } from '@/components/ui/health-bar'
import {
  modelHealthDataAtom,
  modelHealthLoadingAtom,
  modelHealthErrorAtom,
  loadModelHealth,
} from '@/atoms/model-health'
import { SettingsCard } from './primitives/SettingsCard'
import { cn } from '@/lib/utils'

/** 默认显示的模型数量 */
const DEFAULT_VISIBLE_COUNT = 4

export function ModelHealthTable(): React.ReactElement {
  const healthData = useAtomValue(modelHealthDataAtom)
  const loading = useAtomValue(modelHealthLoadingAtom)
  const error = useAtomValue(modelHealthErrorAtom)
  const setData = useSetAtom(modelHealthDataAtom)
  const setLoading = useSetAtom(modelHealthLoadingAtom)
  const setError = useSetAtom(modelHealthErrorAtom)
  const [expanded, setExpanded] = React.useState(false)

  const handleRefresh = (): void => {
    loadModelHealth(setData, setLoading, setError)
  }

  // 获取时间范围标签（取第一个模型的）
  const timeRangeLabel = healthData[0]?.timeRangeLabel ?? ''

  // 根据展开状态决定显示的模型
  const visibleModels = expanded ? healthData : healthData.slice(0, DEFAULT_VISIBLE_COUNT)
  const hasMore = healthData.length > DEFAULT_VISIBLE_COUNT

  return (
    <div className="mt-3">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">模型健康状态</span>
          {timeRangeLabel && (
            <span className="text-xs text-muted-foreground/60">
              截至 {timeRangeLabel}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={handleRefresh} disabled={loading} className="h-7 px-2">
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {error ? (
        <SettingsCard divided={false}>
          <div className="text-sm text-destructive py-4 text-center">{error}</div>
        </SettingsCard>
      ) : healthData.length === 0 ? (
        <SettingsCard divided={false}>
          <div className="text-sm text-muted-foreground py-4 text-center">
            {loading ? '加载中...' : '暂无健康数据'}
          </div>
        </SettingsCard>
      ) : (
        <SettingsCard divided={false}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">模型</TableHead>
                <TableHead>健康状态（最近 2 小时）</TableHead>
                <TableHead className="w-[80px] text-right">健康率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleModels.map((model) => (
                <TableRow key={model.modelId}>
                  <TableCell className="font-medium">{model.displayName}</TableCell>
                  <TableCell>
                    <HealthBar cells={model.healthBar} size="md" />
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        'font-medium',
                        model.healthRatePercent >= 90
                          ? 'text-[#64BA09]'
                          : model.healthRatePercent >= 70
                            ? 'text-[#FBBF24]'
                            : 'text-[#DC2626]',
                      )}
                    >
                      {model.healthRatePercent}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* 展开/收起按钮 */}
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors border-t border-border/50"
            >
              {expanded ? (
                <>
                  <ChevronUp size={14} />
                  收起
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  查看更多（{healthData.length - DEFAULT_VISIBLE_COUNT} 个）
                </>
              )}
            </button>
          )}
        </SettingsCard>
      )}
    </div>
  )
}
