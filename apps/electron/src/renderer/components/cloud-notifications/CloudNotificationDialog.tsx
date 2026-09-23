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
import { getNotificationMediaLayout, resolveNotificationMedia } from './notification-media'
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

export const markdownComponents: Components = {
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
          className="my-3 w-full bg-black object-contain"
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

/** 主视觉贴齐弹窗外缘；比例由媒体本身决定，文案较长时仅裁切超出的边缘。 */
export function NotificationMediaView({
  media,
  title,
  aspectRatio,
  onDimensions,
}: {
  media: NotificationMedia
  title: string
  aspectRatio?: number
  onDimensions?: (width: number, height: number) => void
}): React.ReactElement {
  const [failed, setFailed] = React.useState(false)
  const isVideo = media.type === 'video'
  return (
    <div
      className={`relative min-w-0 w-full self-stretch overflow-hidden ${isVideo ? 'min-h-[min(50vh,300px)] bg-black' : 'min-h-44'}`}
      style={{
        aspectRatio: aspectRatio && aspectRatio > 0 ? aspectRatio : isVideo ? 16 / 9 : 1,
        maxHeight: isVideo ? 'min(70vh, 520px)' : 'min(62vh, 420px)',
      }}
      role="group"
      aria-label="通知媒体"
    >
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center bg-muted/30 px-4 text-center text-sm text-muted-foreground" role="status">
          媒体暂时无法加载，请阅读右侧通知内容。
        </p>
      ) : isVideo ? (
        <video
          className="absolute inset-0 block h-full w-full bg-black object-cover"
          src={media.url}
          controls
          preload="metadata"
          aria-label={`${title}的视频`}
          onLoadedMetadata={(event) => onDimensions?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          onError={() => setFailed(true)}
        >你的系统不支持播放此视频。</video>
      ) : (
        <img
          className="absolute inset-0 block h-full w-full object-cover"
          src={media.url}
          alt={title}
          onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          onError={() => setFailed(true)}
        />
      )}
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
  const [mediaSize, setMediaSize] = React.useState<{ id: string; url: string; width: number; height: number } | null>(null)

  React.useEffect(() => {
    setAcknowledging(false)
    setError(null)
  }, [notification?.id])

  if (!notification) return null
  const media = resolveNotificationMedia(notification)
  const dimensions = mediaSize?.id === notification.id && mediaSize.url === media?.url ? mediaSize : null
  const layout = media ? getNotificationMediaLayout(
    dimensions?.width ?? (media.type === 'video' ? 16 : 320),
    dimensions?.height ?? (media.type === 'video' ? 9 : 400),
    media.type,
  ) : null

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
        ? `max-h-[calc(100vh-4rem)] w-[calc(100vw-3rem)] gap-0 overflow-hidden border-0 p-0 transition-[width] duration-200 motion-reduce:transition-none ${media.type === 'video' ? 'max-w-[1080px]' : 'max-w-[1120px]'}`
        : 'max-h-[calc(100vh-5rem)] max-w-2xl overflow-y-auto'}
      style={layout ? { width: `min(calc(100vw - 3rem), ${layout.dialogWidth}px)` } : undefined}
      onEscapeKeyDown={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <div
        className={media
          ? `grid min-h-0 transition-[grid-template-columns] duration-200 motion-reduce:transition-none ${media.type === 'video' ? 'max-h-[min(70vh,520px)]' : 'max-h-[min(62vh,420px)]'}`
          : 'contents'}
        style={layout ? { gridTemplateColumns: media?.type === 'video'
          ? `minmax(0, min(${layout.mediaColumnWidth}px, 54%, calc(100% - 350px))) minmax(0, 1fr)`
          : `minmax(0, min(${layout.mediaColumnWidth}px, 57%, calc(100% - 320px))) minmax(0, 1fr)` } : undefined}
      >
        {media && <NotificationMediaView
          key={`${notification.id}:${media.url}`}
          media={media}
          title={notification.title}
          aspectRatio={dimensions ? dimensions.width / dimensions.height : undefined}
          onDimensions={(width, height) => {
            if (width <= 0 || height <= 0) return
            setMediaSize((current) => current?.id === notification.id && current.url === media.url
              && current.width === width && current.height === height
              ? current : { id: notification.id, url: media.url, width, height })
          }}
        />}
        <div className={media ? 'flex min-h-0 min-w-0 flex-col gap-3 px-7 py-7' : 'contents'}>
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
