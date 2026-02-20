/**
 * UpdateDialog - 全局更新弹窗
 *
 * 当检测到更新下载完成时自动弹出，提供安装和手动下载两条路径。
 * 同一版本只弹一次，用户关闭后不再重复弹出。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, ExternalLink } from 'lucide-react'
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
import { updateStatusAtom, installUpdate } from '@/atoms/updater'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'

const GITHUB_RELEASES_URL = 'https://github.com/ErlichLiu/Proma/releases'

export function UpdateDialog(): React.ReactElement | null {
  const updateStatus = useAtomValue(updateStatusAtom)
  const [open, setOpen] = React.useState(false)
  const [release, setRelease] = React.useState<GitHubRelease | null>(null)
  // 弹窗打开时锁定的版本号，不随 atom 变化而丢失
  const [dialogVersion, setDialogVersion] = React.useState<string | null>(null)
  // 记录已弹出过的版本号，同一版本不重复弹出
  const shownVersionRef = React.useRef<string | null>(null)

  // 当状态变为 downloaded 且是新版本时，自动弹出
  React.useEffect(() => {
    if (
      updateStatus.status === 'downloaded' &&
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

  const isInstalling = updateStatus.status === 'installing'

  const handleInstall = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    await installUpdate()
  }

  const githubUrl = release?.html_url || GITHUB_RELEASES_URL

  if (!dialogVersion) return null

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>发现新版本</AlertDialogTitle>
          <AlertDialogDescription>
            v{dialogVersion} 已下载完成，是否立即安装？
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
            href={githubUrl}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI.openExternal(githubUrl)
            }}
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            GitHub Release
            <ExternalLink className="h-3 w-3" />
          </a>
          {' '}页面下载最新版本覆盖安装。
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isInstalling}>
            稍后提醒
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleInstall} disabled={isInstalling}>
            {isInstalling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                正在安装...
              </>
            ) : (
              '立即安装'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
