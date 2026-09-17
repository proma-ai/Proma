/**
 * VersionHistory - 版本历史组件
 *
 * 显示来自公开更新日志接口的历史版本列表
 */

import * as React from 'react'
import type { ChangelogItem } from '@proma/shared'
import { RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'
import { SettingsCard } from './primitives'

/**
 * VersionHistory 组件
 */
export function VersionHistory(): React.ReactElement {
  const [changelogs, setChangelogs] = React.useState<ChangelogItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set())

  // 加载更新日志
  const loadChangelogs = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await window.electronAPI.listChangelogs({ limit: 3 })
      setChangelogs(data.changelogs)
    } catch (err) {
      console.error('[版本历史] 加载失败:', err)
      let errorMessage = err instanceof Error ? err.message : '加载失败'
      // 过滤掉 Electron IPC 的英文前缀，只保留中文错误信息
      // IPC 错误格式: "Error invoking remote method 'xxx': Error: 中文错误信息"
      const ipcPrefixMatch = errorMessage.match(/Error invoking remote method[^:]*:\s*Error:\s*(.+)/s)
      if (ipcPrefixMatch && ipcPrefixMatch[1]) {
        errorMessage = ipcPrefixMatch[1].trim()
      }
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载
  React.useEffect(() => {
    void loadChangelogs()
  }, [loadChangelogs])

  // 切换展开/折叠
  const toggleExpand = (id: string): void => {
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
            onClick={loadChangelogs}
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
      </div>

      {/* 版本列表 */}
      <div className="divide-y">
        {loading && changelogs.length === 0 ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">加载中...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">加载失败</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </div>
        ) : changelogs.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">暂无版本历史</p>
          </div>
        ) : (
          changelogs.map((changelog, index) => {
            const isExpanded = expandedIds.has(changelog.id)
            const isLatest = index === 0
            const version = changelog.version ?? '未标注版本'

            return (
              <div key={changelog.id} className="p-4">
                {/* 版本标题（可点击展开） */}
                <button
                  onClick={() => toggleExpand(changelog.id)}
                  className="w-full flex items-center justify-between text-left hover:bg-accent/50 -m-4 p-4 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium font-mono truncate">
                          {version}
                        </span>
                        {isLatest && (
                          <span className="text-xs text-primary font-medium">
                            最新
                          </span>
                        )}
                      </div>
                      {changelog.title && changelog.title !== version && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {changelog.title}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {changelog.publishedAt
                        ? new Date(changelog.publishedAt).toLocaleDateString('zh-CN')
                        : '未发布'}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  )}
                </button>

                {/* 更新说明（展开时显示） */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <ReleaseNotesViewer
                      release={changelog}
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
