/**
 * DetachedPreviewApp — 独立文件预览窗口
 *
 * 通过主进程保存的 previewId 读取当前文件预览上下文，复用 DiffTabContent。
 */

import * as React from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useSetAtom } from 'jotai'
import type { DetachedPreviewWindowData } from '@proma/shared'
import { agentDiffRefreshVersionAtom } from '@/atoms/agent-atoms'
import { cn } from '@/lib/utils'
import { DiffTabContent } from './DiffTabContent'
import { DefaultAppOpenButton } from './DefaultAppOpenButton'
import { getDefaultAppTargetPath, getPreviewFileAccess } from './preview-open-path'

function getPreviewId(): string | null {
  return new URLSearchParams(window.location.search).get('previewId')
}

function getFileName(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() || filePath
}

export function DetachedPreviewApp(): React.ReactElement {
  const [data, setData] = React.useState<DetachedPreviewWindowData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const setRefreshVersionMap = useSetAtom(agentDiffRefreshVersionAtom)

  React.useEffect(() => {
    const previewId = getPreviewId()
    if (!previewId) {
      setError('缺少预览窗口 ID')
      setLoading(false)
      return
    }

    window.electronAPI.getDetachedPreviewData(previewId)
      .then((payload) => {
        if (!payload) {
          setError('预览数据已失效')
          return
        }
        setData(payload)
        document.title = payload.title || getFileName(payload.filePath)
      })
      .catch((err) => {
        console.error('[DetachedPreviewApp] 加载预览数据失败:', err)
        setError('加载预览数据失败')
      })
      .finally(() => setLoading(false))
  }, [])

  const handleRefresh = React.useCallback(() => {
    if (!data) return
    setRefreshVersionMap((prev) => {
      const map = new Map(prev)
      map.set(data.sessionId, (prev.get(data.sessionId) ?? 0) + 1)
      return map
    })
  }, [data, setRefreshVersionMap])

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-content-area text-xs text-muted-foreground">
        正在打开预览...
      </div>
    )
  }

  if (!data || error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-content-area text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4" />
          <span>{error ?? '无法打开预览'}</span>
        </div>
      </div>
    )
  }

  const defaultAppTargetPath = getDefaultAppTargetPath(data, data.dirPath)
  const defaultAppAccess = getPreviewFileAccess(data.sessionId, data, data.dirPath)

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-content-area text-foreground">
      <div className="h-11 flex items-center gap-2 px-3 border-b border-border/40 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{getFileName(data.filePath)}</div>
          <div className="text-[11px] text-muted-foreground truncate" title={data.filePath}>
            {data.filePath}
          </div>
        </div>
        <DefaultAppOpenButton
          filePath={defaultAppTargetPath}
          access={defaultAppAccess}
        />
        <button
          type="button"
          onClick={handleRefresh}
          className={cn(
            'size-7 flex items-center justify-center rounded-md text-muted-foreground',
            'hover:bg-muted/60 hover:text-foreground transition-colors',
          )}
          title="刷新预览"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <DiffTabContent
          filePath={data.filePath}
          dirPath={data.dirPath}
          sessionId={data.sessionId}
          gitRoot={data.gitRoot}
          previewOnly={data.previewOnly}
          readOnly={data.readOnly}
          basePaths={data.basePaths}
        />
      </div>
    </div>
  )
}
