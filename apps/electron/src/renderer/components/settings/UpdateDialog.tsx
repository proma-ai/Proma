/**
 * UpdateDialog - 自动更新弹窗
 *
 * 三阶段 UI：
 * 1. 发现新版本 → 显示版本信息和 release notes
 * 2. 下载中 → 显示进度条
 * 3. 下载完成 → 提供「立即重启」按钮
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink, RotateCw } from 'lucide-react'
import type { GitHubRelease } from '@proma/shared'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { updateStatusAtom } from '@/atoms/updater'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'

// 【商业版】下载地址指向官网，合并 upstream 时勿改为开源仓库地址
const DOWNLOAD_URL = 'https://proma.cool/download'

export function UpdateDialog(): React.ReactElement | null {
  const updateStatus = useAtomValue(updateStatusAtom)
  const [open, setOpen] = React.useState(false)
  const [release, setRelease] = React.useState<GitHubRelease | null>(null)
  const [dialogVersion, setDialogVersion] = React.useState<string | null>(null)
  const shownVersionRef = React.useRef<string | null>(null)
  const postponedDownloadedVersionRef = React.useRef<string | null>(null)

  const fetchRelease = React.useCallback((version: string) => {
    window.electronAPI
      .getReleaseByTag(`v${version}`)
      .then((r) => {
        if (r) setRelease(r)
      })
      .catch((err) => {
        console.error('[更新弹窗] 获取 Release 信息失败:', err)
      })
  }, [])

  React.useEffect(() => {
    if (
      updateStatus.status === 'available' &&
      updateStatus.version &&
      shownVersionRef.current !== updateStatus.version
    ) {
      const version = updateStatus.version
      shownVersionRef.current = version
      postponedDownloadedVersionRef.current = null
      setDialogVersion(version)
      setRelease(null)

      fetchRelease(version)

      setOpen(true)
    }

    // 下载完成时如果弹窗已关闭，首次提醒用户；用户点过「稍后重启」后不再循环弹出。
    if (
      updateStatus.status === 'downloaded' &&
      updateStatus.version &&
      !open &&
      postponedDownloadedVersionRef.current !== updateStatus.version
    ) {
      if (dialogVersion !== updateStatus.version) {
        setDialogVersion(updateStatus.version)
        setRelease(null)
        fetchRelease(updateStatus.version)
      }
      setOpen(true)
    }
  }, [updateStatus.status, updateStatus.version, open, dialogVersion, fetchRelease])

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen && updateStatus.status === 'downloaded' && dialogVersion) {
      postponedDownloadedVersionRef.current = dialogVersion
    }
    setOpen(nextOpen)
  }

  const handleQuitAndInstall = (): void => {
    window.electronAPI.updater?.quitAndInstall()
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (!dialogVersion) return null

  const isDownloading = updateStatus.status === 'downloading'
  const isDownloaded = updateStatus.status === 'downloaded'

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isDownloaded ? '更新已就绪' : isDownloading ? '正在下载更新' : '发现新版本'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDownloaded
              ? `v${dialogVersion} 已下载完成，重启应用即可完成更新。`
              : isDownloading
                ? `正在下载 v${dialogVersion}...`
                : `v${dialogVersion} 已发布，正在后台下载更新。`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* 下载进度 */}
        {isDownloading && updateStatus.progress && (
          <div className="space-y-2">
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${updateStatus.progress.percent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{formatBytes(updateStatus.progress.transferred)} / {formatBytes(updateStatus.progress.total)}</span>
              <span>{formatBytes(updateStatus.progress.bytesPerSecond)}/s</span>
            </div>
          </div>
        )}

        {/* Release Notes（仅在非下载阶段显示） */}
        {!isDownloading && release && (
          <div className="max-h-64 overflow-y-auto rounded-md border p-3">
            <ReleaseNotesViewer release={release} showHeader={false} compact />
          </div>
        )}

        {/* 手动下载提示 */}
        <p className="text-xs text-muted-foreground">
          如果自动更新失败，请前往{' '}
          <a
            href={DOWNLOAD_URL}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.openExternal(DOWNLOAD_URL)
            }}
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            官网下载页
            <ExternalLink className="h-3 w-3" />
          </a>
          {' '}下载最新版本覆盖安装。
        </p>

        <AlertDialogFooter>
          {isDownloaded ? (
            <>
              <AlertDialogCancel>稍后重启</AlertDialogCancel>
              <AlertDialogAction onClick={handleQuitAndInstall}>
                <RotateCw className="h-4 w-4 mr-1.5" />
                立即重启更新
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogCancel>
              {isDownloading ? '后台下载' : '知道了'}
            </AlertDialogCancel>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
