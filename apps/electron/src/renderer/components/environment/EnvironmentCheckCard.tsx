/**
 * 环境检测卡片组件
 *
 * 显示单个环境项（Shell / Node.js 等）的检测结果，
 * 支持两种恢复动作：
 *  - download: 从 proma-api 返回的清单一键下载官方安装包，并自动拉起
 *  - openExternal: 打开外部链接（macOS / 高级用户的官方下载页）
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Download,
  Rocket,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  installerDownloadStatesAtom,
  installerManifestAtom,
  type InstallerDownloadState,
} from '@/atoms/environment'
import type { InstallerDownloadRequest } from '@proma/shared'

type CheckStatus = 'checking' | 'success' | 'warning' | 'error'

type CardAction =
  | { type: 'none' }
  | { type: 'openExternal'; url: string; label?: string }
  | { type: 'download'; installerId: string; labelPrefix?: string }

interface EnvironmentCheckCardProps {
  /** 环境项名称（如 "Shell 环境"、"Node.js"） */
  name: string
  /** 检测状态 */
  status: CheckStatus
  /** 版本号 */
  version?: string
  /** 要求说明 */
  requirement: string
  /** 状态描述（覆盖默认文案） */
  statusText?: string
  /** 操作类型 */
  action: CardAction
}

export function EnvironmentCheckCard({
  name,
  status,
  version,
  requirement,
  statusText,
  action,
}: EnvironmentCheckCardProps) {
  const StatusIcon = {
    checking: Loader2,
    success: CheckCircle2,
    warning: AlertCircle,
    error: XCircle,
  }[status]

  const iconColor = {
    checking: 'text-muted-foreground',
    success: 'text-green-600 dark:text-green-500',
    warning: 'text-yellow-600 dark:text-yellow-500',
    error: 'text-red-600 dark:text-red-500',
  }[status]

  const statusTextDefault = {
    checking: '检测中...',
    success: version ? `v${version} (已安装)` : '已安装',
    warning: version ? `v${version} (建议升级)` : '版本过低',
    error: '未安装',
  }[status]

  return (
    <div className="flex items-start gap-3 rounded-lg bg-card p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex-shrink-0">
        <StatusIcon
          className={`h-4 w-4 ${iconColor} ${status === 'checking' ? 'animate-spin' : ''}`}
        />
      </div>

      <div className="flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-medium">{name}</h4>
            <p className="text-xs text-muted-foreground">{statusText || statusTextDefault}</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">{requirement}</p>

        {(status === 'error' || status === 'warning') && action.type !== 'none' && (
          <CardAction action={action} toolName={name} />
        )}
      </div>
    </div>
  )
}

function CardAction({ action, toolName }: { action: CardAction; toolName: string }) {
  if (action.type === 'openExternal') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => window.electronAPI.openExternal(action.url)}
        className="mt-1.5 h-7 text-xs"
      >
        <ExternalLink className="mr-1.5 h-3 w-3" />
        {action.label ?? `下载 ${toolName}`}
      </Button>
    )
  }

  if (action.type === 'download') {
    return <DownloadAction installerId={action.installerId} toolName={toolName} />
  }

  return null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function detectArch(): 'x64' | 'arm64' {
  const ua = navigator.userAgent || ''
  if (/arm64|aarch64/i.test(ua)) return 'arm64'
  return 'x64'
}

function DownloadAction({ installerId, toolName }: { installerId: string; toolName: string }) {
  const [downloadStates, setDownloadStates] = useAtom(installerDownloadStatesAtom)
  const manifest = useAtomValue(installerManifestAtom)

  const arch = detectArch()
  const key = `${installerId}:${arch}`
  const state: InstallerDownloadState = downloadStates[key] ?? { status: 'idle' }

  React.useEffect(() => {
    const off = window.electronAPI.onInstallerProgress((payload) => {
      if (payload.key !== key) return
      setDownloadStates((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] ?? { status: 'downloading' }),
          status: 'downloading',
          downloaded: payload.downloaded,
          total: payload.total,
          speed: payload.speed,
        },
      }))
    })
    return () => {
      off()
    }
  }, [key, setDownloadStates])

  const handleDownload = async () => {
    setDownloadStates((prev) => ({
      ...prev,
      [key]: { status: 'downloading', downloaded: 0, total: 0, speed: 0 },
    }))
    try {
      const req: InstallerDownloadRequest = { id: installerId, arch }
      const result = await window.electronAPI.downloadInstaller(req)
      setDownloadStates((prev) => ({
        ...prev,
        [key]: { status: 'done', filePath: result.filePath },
      }))
      // 下载完自动拉起安装程序
      await window.electronAPI.launchInstaller(result.filePath).catch((err) => {
        console.error('[Installer] launch failed:', err)
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setDownloadStates((prev) => ({
        ...prev,
        [key]: {
          status: msg === 'cancelled' ? 'cancelled' : 'failed',
          error: msg,
        },
      }))
    }
  }

  const handleCancel = () => {
    window.electronAPI.cancelInstallerDownload(key)
  }

  const handleRelaunch = async () => {
    if (state.filePath) {
      await window.electronAPI.launchInstaller(state.filePath).catch(() => {})
    }
  }

  // 如果 manifest 里完全没有这个 installer（远程拉失败且内置 fallback 也没覆盖），禁用按钮
  const hasSource =
    manifest?.installers.some((i) => i.id === installerId && i.arch === arch) ?? true

  if (state.status === 'downloading') {
    const pct =
      state.total && state.downloaded
        ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
        : 0
    return (
      <div className="mt-1.5 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            下载中 {pct}%（{formatBytes(state.downloaded ?? 0)} /{' '}
            {formatBytes(state.total ?? 0)}）
          </span>
          <span>{formatBytes(state.speed ?? 0)}/s</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          className="h-6 text-[11px]"
        >
          取消下载
        </Button>
      </div>
    )
  }

  if (state.status === 'done') {
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          已下载完成，请在安装器中完成安装，然后点「重新检测」刷新状态。
        </p>
        <Button variant="outline" size="sm" onClick={handleRelaunch} className="h-7 text-xs">
          <Rocket className="mr-1.5 h-3 w-3" />
          再次打开安装程序
        </Button>
      </div>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-[11px] text-destructive">下载失败：{state.error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={!hasSource}
          className="h-7 text-xs"
        >
          <Download className="mr-1.5 h-3 w-3" />
          重试下载
        </Button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={!hasSource}
      className="mt-1.5 h-7 text-xs"
    >
      <Download className="mr-1.5 h-3 w-3" />
      一键下载 {toolName}
    </Button>
  )
}
