/**
 * VersionHistory - 版本历史组件
 *
 * 显示 GitHub Release 历史版本列表
 */

import * as React from 'react'
import type { GitHubRelease } from '@proma/shared'
import { RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'
import { SettingsCard } from './primitives'

/**
 * VersionHistory 组件
 */
export function VersionHistory(): React.ReactElement {
  const [releases, setReleases] = React.useState<GitHubRelease[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set())

  // 加载 releases
  const loadReleases = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await window.electronAPI.listReleases({
        perPage: 3,
        includePrerelease: false,
      })
      setReleases(data)
    } catch (err) {
      console.error('[版本历史] 加载失败:', err)
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  React.useEffect(() => {
    loadReleases()
  }, [loadReleases])

  // 切换展开/折叠
  const toggleExpand = (id: number): void => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <SettingsCard>
      {/* 标题栏 */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">版本历史</h3>
          <button
            onClick={loadReleases}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            刷新
          </button>
        </div>
        {error && (
          <p className="text-xs text-destructive mt-2">
            {error}
          </p>
        )}
      </div>

      {/* 版本列表 */}
      <div className="divide-y">
        {loading && releases.length === 0 ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">加载中...</p>
          </div>
        ) : releases.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">暂无版本历史</p>
          </div>
        ) : (
          releases.map((release, index) => {
            const isExpanded = expandedIds.has(release.id)
            const isLatest = index === 0

            return (
              <div key={release.id} className="p-4">
                {/* 版本标题（可点击展开） */}
                <button
                  onClick={() => toggleExpand(release.id)}
                  className="w-full flex items-center justify-between text-left hover:bg-accent/50 -m-4 p-4 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium font-mono truncate">
                          {release.tag_name}
                        </span>
                        {isLatest && (
                          <span className="text-xs text-primary font-medium">
                            最新
                          </span>
                        )}
                      </div>
                      {release.name && release.name !== release.tag_name && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {release.name}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(release.published_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  )}
                </button>

                {/* Release Notes（展开时显示） */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <ReleaseNotesViewer
                      release={release}
                      showHeader={false}
                      compact
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </SettingsCard>
  )
}
