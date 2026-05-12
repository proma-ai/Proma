/**
 * StorageSettings — 磁盘管理设置面板
 *
 * 展示各数据类别的磁盘占用、孤儿数据检测、手动/自动清理。
 */

import * as React from 'react'
import { HardDrive, Trash2, RefreshCw, AlertTriangle } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from './primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'

interface StorageCategory {
  label: string
  key: string
  bytes: number
  count: number
  hasOrphans: boolean
  orphanBytes: number
  orphanCount: number
}

interface StorageStats {
  categories: StorageCategory[]
  totalBytes: number
  calculatedAt: number
}

interface CleanupResult {
  freedBytes: number
  deletedCount: number
  errors: string[]
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const BAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-cyan-500',
]

function StorageBar({ categories, totalBytes }: { categories: StorageCategory[]; totalBytes: number }): React.ReactElement {
  if (totalBytes === 0) {
    return <div className="h-3 w-full rounded-full bg-muted" />
  }
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {categories.map((cat, i) => {
        const pct = (cat.bytes / totalBytes) * 100
        if (pct < 0.5) return null
        return (
          <div
            key={cat.key}
            className={cn('h-full transition-all', BAR_COLORS[i % BAR_COLORS.length])}
            style={{ width: `${pct}%` }}
            title={`${cat.label}: ${formatBytes(cat.bytes)}`}
          />
        )
      })}
    </div>
  )
}

export function StorageSettings(): React.ReactElement {
  const [stats, setStats] = React.useState<StorageStats | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [cleaningKey, setCleaningKey] = React.useState<string | null>(null)
  const [lastResult, setLastResult] = React.useState<CleanupResult | null>(null)
  const [autoCleanupTemp, setAutoCleanupTemp] = React.useState(true)
  const [autoCleanupDays, setAutoCleanupDays] = React.useState(0)

  const loadStats = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getStorageStats() as StorageStats
      setStats(result)
    } catch (e) {
      console.error('[存储管理] 获取统计失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadStats()
    window.electronAPI.getSettings().then((settings) => {
      setAutoCleanupTemp(settings.autoCleanupTempOnStart !== false)
      setAutoCleanupDays(settings.autoCleanupArchivedDays ?? 0)
    }).catch(console.error)
  }, [loadStats])

  const handleCleanCategory = async (key: string, orphansOnly: boolean): Promise<void> => {
    setCleaningKey(key)
    setLastResult(null)
    try {
      const result = await window.electronAPI.cleanupStorage({
        categories: [key],
        orphansOnly,
        archivedBeforeDays: 0,
      }) as CleanupResult
      setLastResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理失败:', e)
    } finally {
      setCleaningKey(null)
    }
  }

  const handleCleanTemp = async (): Promise<void> => {
    setCleaningKey('temp-files')
    setLastResult(null)
    try {
      const result = await window.electronAPI.cleanupTempStorage() as CleanupResult
      setLastResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理临时文件失败:', e)
    } finally {
      setCleaningKey(null)
    }
  }

  const handleCleanAllOrphans = async (): Promise<void> => {
    setCleaningKey('all-orphans')
    setLastResult(null)
    try {
      const result = await window.electronAPI.cleanupStorage({
        categories: ['agent-sessions', 'sdk-config', 'workspaces'],
        orphansOnly: true,
        archivedBeforeDays: 0,
      }) as CleanupResult
      setLastResult(result)
      await loadStats()
    } catch (e) {
      console.error('[存储管理] 清理孤儿数据失败:', e)
    } finally {
      setCleaningKey(null)
    }
  }

  const handleAutoCleanupTempChange = async (enabled: boolean): Promise<void> => {
    setAutoCleanupTemp(enabled)
    try {
      await window.electronAPI.updateSettings({ autoCleanupTempOnStart: enabled })
    } catch (e) {
      console.error('[存储管理] 更新自动清理设置失败:', e)
    }
  }

  const handleAutoCleanupDaysChange = async (value: string): Promise<void> => {
    const days = parseInt(value, 10)
    setAutoCleanupDays(days)
    try {
      await window.electronAPI.updateSettings({ autoCleanupArchivedDays: days })
    } catch (e) {
      console.error('[存储管理] 更新自动清理天数失败:', e)
    }
  }

  const totalOrphanBytes = stats?.categories.reduce((sum, c) => sum + c.orphanBytes, 0) ?? 0
  const hasOrphans = totalOrphanBytes > 0

  return (
    <div className="space-y-6">
      {/* 存储用量 */}
      <SettingsSection
        title="存储用量"
        description={stats ? `总计 ${formatBytes(stats.totalBytes)}` : '正在计算...'}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={loadStats}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            刷新
          </Button>
        }
      >
        {stats && (
          <div className="mb-4">
            <StorageBar categories={stats.categories} totalBytes={stats.totalBytes} />
          </div>
        )}
        <SettingsCard>
          {stats?.categories.map((cat, i) => (
            <SettingsRow key={cat.key} label={cat.label}>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn('inline-block h-2.5 w-2.5 rounded-full', BAR_COLORS[i % BAR_COLORS.length])}
                  />
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatBytes(cat.bytes)}
                  </span>
                  {cat.hasOrphans && (
                    <span className="flex items-center gap-1 text-xs text-amber-500">
                      <AlertTriangle size={12} />
                      孤儿 {formatBytes(cat.orphanBytes)}
                    </span>
                  )}
                </div>
                {cat.key === 'temp-files' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCleanTemp}
                    disabled={cleaningKey !== null || cat.bytes === 0}
                    className="h-7 gap-1 text-xs"
                  >
                    <Trash2 size={12} />
                    {cleaningKey === 'temp-files' ? '清理中...' : '清理'}
                  </Button>
                ) : cat.hasOrphans ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCleanCategory(cat.key, true)}
                    disabled={cleaningKey !== null}
                    className="h-7 gap-1 text-xs"
                  >
                    <Trash2 size={12} />
                    {cleaningKey === cat.key ? '清理中...' : '清理孤儿'}
                  </Button>
                ) : null}
              </div>
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>

      {/* 自动清理 */}
      <SettingsSection
        title="自动清理"
        description="配置启动时和定期的自动清理规则"
      >
        <SettingsCard>
          <SettingsToggle
            label="启动时清理临时文件"
            description="每次启动时自动删除预览和安装缓存"
            checked={autoCleanupTemp}
            onCheckedChange={handleAutoCleanupTempChange}
          />
          <SettingsRow label="清理已归档会话数据" description="自动清理超过指定天数的已归档会话消息和 SDK 数据">
            <Select value={String(autoCleanupDays)} onValueChange={handleAutoCleanupDaysChange}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">禁用</SelectItem>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="90">90 天</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {/* 深度清理 */}
      <SettingsSection
        title="深度清理"
        description="检测并清理已删除会话遗留的孤儿数据"
      >
        <SettingsCard>
          <SettingsRow
            label="孤儿数据"
            description="删除会话后残留的消息文件、SDK 缓存和工作目录"
          >
            <div className="flex items-center gap-3">
              {hasOrphans && (
                <span className="flex items-center gap-1 text-sm text-amber-500">
                  <AlertTriangle size={14} />
                  {formatBytes(totalOrphanBytes)}
                </span>
              )}
              <Button
                variant={hasOrphans ? 'default' : 'ghost'}
                size="sm"
                onClick={handleCleanAllOrphans}
                disabled={cleaningKey !== null || !hasOrphans}
                className="gap-1.5"
              >
                <HardDrive size={14} />
                {cleaningKey === 'all-orphans' ? '清理中...' : hasOrphans ? '一键清理' : '无孤儿数据'}
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {/* 操作结果提示 */}
      {lastResult && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          {lastResult.freedBytes > 0 ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              已释放 {formatBytes(lastResult.freedBytes)}，删除 {lastResult.deletedCount} 个文件
            </span>
          ) : (
            <span className="text-muted-foreground">没有需要清理的数据</span>
          )}
          {lastResult.errors.length > 0 && (
            <div className="mt-1 text-xs text-destructive">
              {lastResult.errors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
