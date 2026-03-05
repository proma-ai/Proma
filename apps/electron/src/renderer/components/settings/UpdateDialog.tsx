/**
 * UpdateDialog - 新版本通知弹窗
 *
 * 当检测到新版本时自动弹出，引导用户前往 GitHub Releases 下载。
 * 同一版本只弹一次，用户关闭后不再重复弹出。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink } from 'lucide-react'
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

const DOWNLOAD_URL = 'https://proma.cool/download'

export function UpdateDialog(): React.ReactElement | null {
  const updateStatus = useAtomValue(updateStatusAtom)
  const [open, setOpen] = React.useState(false)
  const [release, setRelease] = React.useState<GitHubRelease | null>(null)
  // 弹窗打开时锁定的版本号，不随 atom 变化而丢失
  const [dialogVersion, setDialogVersion] = React.useState<string | null>(null)
  // 记录已弹出过的版本号，同一版本不重复弹出
  const shownVersionRef = React.useRef<string | null>(null)

  // 当状态变为 available 且是新版本时，自动弹出
  React.useEffect(() => {
    if (
      updateStatus.status === 'available' &&
      updateStatus.version &&
      shownVersionRef.current !== updateStatus.version
    ) {
      const version = updateStatus.version
      shownVersionRef.current = version
      setDialogVersion(version)

      // 获取 Release 信息
      window.electronAPI
        .getReleaseByTag(`v${version}`)
        .then((r) => {
          if (r) setRelease(r)
        })
        .catch((err) => {
          console.error('[更新弹窗] 获取 Release 信息失败:', err)
        })

      setOpen(true)
    }
  }, [updateStatus.status, updateStatus.version])

  const handleGoToDownload = (e: React.MouseEvent): void => {
    e.preventDefault()
    const url = release?.html_url || GITHUB_RELEASES_URL
    window.electronAPI.openExternal(url)
  }

  const downloadUrl = DOWNLOAD_URL

  if (!dialogVersion) return null

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>发现新版本</AlertDialogTitle>
          <AlertDialogDescription>
            v{dialogVersion} 已发布，请前往下载页面获取最新版本覆盖安装。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Release Notes */}
        {release && (
          <div className="max-h-64 overflow-y-auto rounded-md border p-3">
            <ReleaseNotesViewer release={release} showHeader={false} compact />
          </div>
        )}

        {/* 手动下载提示 */}
        <p className="text-xs text-muted-foreground">
          如果自动更新失败，请前往{' '}
          <a
            href={downloadUrl}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.openExternal(downloadUrl)
            }}
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            官网下载页
            <ExternalLink className="h-3 w-3" />
          </a>
          {' '}下载最新版本覆盖安装。
        </p>


        <AlertDialogFooter>
          <AlertDialogCancel>
            稍后再说
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleGoToDownload}>
            <ExternalLink className="h-4 w-4 mr-1.5" />
            前往下载
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
