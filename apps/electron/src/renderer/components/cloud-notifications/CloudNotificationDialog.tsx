/**
 * CloudNotificationDialog — 必须确认的富媒体公告弹窗。
 *
 * 只解析 Markdown，不启用 raw HTML；链接、图片与视频仅允许 HTTPS。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cloudNotificationsAtom, invalidateCloudNotificationFetches } from '@/atoms/cloud-notifications'
import type { CloudNotification } from '@proma/shared'
import { resolveNotificationMedia } from './notification-media'
import type { NotificationMedia } from './notification-media'

const REMARK_PLUGINS = [remarkGfm]

function isHttpsUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isVideoMarkdownImage(alt: string | undefined, src: string | undefined): src is string {
  if (alt?.trim().toLowerCase() !== 'video' || !isHttpsUrl(src)) return false
  return new URL(src).pathname.toLowerCase().endsWith('.mp4')
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (!isHttpsUrl(href)) return <>{children}</>
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault()
          void window.electronAPI.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  },
  img: ({ alt, src }) => {
    if (isVideoMarkdownImage(alt, src)) {
      return (
        <video
          controls
          preload="metadata"
          className="my-3 w-full rounded-lg border border-border/60 bg-black"
          src={src}
        >
          抱歉，你的系统不支持播放此视频。
        </video>
      )
    }
    if (!isHttpsUrl(src)) return null
    return <img src={src} alt={alt ?? ''} className="my-3 max-h-80 w-auto max-w-full rounded-lg border border-border/60 object-contain" />
  },
}

/** 主视觉与正文分开渲染；失败时保留右侧内容及已读操作。 */
export function NotificationMediaView({ media, title }: { media: NotificationMedia; title: string }): React.ReactElement {
  const [failed, setFailed] = React.useState(false)
  return (
    <div className="flex min-w-0 items-center justify-center bg-muted/30 p-4 dark:bg-muted/15" role="group" aria-label="通知媒体">
      <div className="flex aspect-[4/3] max-h-[min(68vh,420px)] w-full items-center justify-center overflow-hidden rounded-xl bg-background/70 shadow-[0_2px_12px_rgba(0,0,0,0.05)] ring-1 ring-black/10 dark:bg-black/20 dark:ring-white/10">
        {failed ? (
          <p className="px-4 text-center text-sm text-muted-foreground" role="status">媒体暂时无法加载，请阅读右侧通知内容。</p>
        ) : media.type === 'video' ? (
          <video
            className="h-full w-full object-contain"
            src={media.url}
            controls
            preload="metadata"
            aria-label={`${title}的视频`}
            onError={() => setFailed(true)}
          >你的系统不支持播放此视频。</video>
        ) : (
          <img
            className="h-full w-full object-contain"
            src={media.url}
            alt={title}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  )
}

interface CloudNotificationDialogProps {
  notification: CloudNotification | null
  onAcknowledge: (notificationId: string) => Promise<void>
}

function NotificationDialogContent({
  notification,
  onAcknowledge,
}: CloudNotificationDialogProps): React.ReactElement | null {
  const [acknowledging, setAcknowledging] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setAcknowledging(false)
    setError(null)
  }, [notification?.id])

  if (!notification) return null
  const media = resolveNotificationMedia(notification)

  const handleAcknowledge = async (): Promise<void> => {
    setAcknowledging(true)
    setError(null)
    try {
      await onAcknowledge(notification.id)
    } catch (acknowledgeError) {
      setError(acknowledgeError instanceof Error ? acknowledgeError.message : '确认通知失败，请稍后重试')
    } finally {
      setAcknowledging(false)
    }
  }

  return (
    <DialogContent
      hideClose
      className={media
        ? 'max-h-[calc(100vh-4rem)] w-[calc(100vw-3rem)] max-w-[900px] gap-0 overflow-hidden p-0'
        : 'max-h-[calc(100vh-5rem)] max-w-2xl overflow-y-auto'}
      onEscapeKeyDown={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <div className={media ? 'grid min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'contents'}>
        {media && <NotificationMediaView key={notification.id} media={media} title={notification.title} />}
        <div className={media ? 'flex min-h-0 min-w-0 flex-col gap-5 px-7 py-7' : 'contents'}>
          <DialogHeader>
            <DialogTitle className={media ? 'text-balance text-xl leading-snug' : undefined}>{notification.title}</DialogTitle>
          </DialogHeader>

          <div className={media
            ? 'prose prose-sm dark:prose-invert min-h-0 max-h-[min(60vh,420px)] max-w-none flex-1 overflow-y-auto break-words pr-1 [text-wrap:pretty]'
            : 'prose prose-sm dark:prose-invert max-w-none break-words'}>
            <Markdown
              remarkPlugins={REMARK_PLUGINS}
              skipHtml
              urlTransform={(url) => isHttpsUrl(url) ? url : ''}
              components={markdownComponents}
            >
              {notification.bodyMarkdown}
            </Markdown>
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

          <DialogFooter className={media ? 'mt-auto' : undefined}>
            <Button className="min-h-10" onClick={() => void handleAcknowledge()} disabled={acknowledging}>
              {acknowledging ? '正在确认…' : '已读'}
            </Button>
          </DialogFooter>
        </div>
      </div>
    </DialogContent>
  )
}

/** 连接通知队列、确认 IPC 与不可取消的富媒体 Dialog。 */
export function CloudNotificationDialog(): React.ReactElement | null {
  const [notifications, setNotifications] = useAtom(cloudNotificationsAtom)
  const notification = notifications[0] ?? null

  const acknowledge = React.useCallback(async (notificationId: string): Promise<void> => {
    const result = await window.electronAPI.cloudNotifications.acknowledge(notificationId)
    if (!result.success) throw new Error(result.error ?? '确认通知失败，请稍后重试')
    invalidateCloudNotificationFetches()
    setNotifications((current) => current.filter((item) => item.id !== notificationId))
  }, [setNotifications])

  if (notifications.length === 0 || !notification) return null

  return (
    <Dialog open onOpenChange={() => undefined}>
      <NotificationDialogContent notification={notification} onAcknowledge={acknowledge} />
    </Dialog>
  )
}
