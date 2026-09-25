/**
 * CloudNotificationDialog — 必须确认的富媒体公告弹窗。
 *
 * 只解析 Markdown，不启用 raw HTML；链接、图片与视频仅允许 HTTPS。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Pause, Play } from 'lucide-react'
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

export async function toggleNotificationVideoPlayback(video: Pick<HTMLVideoElement, 'paused' | 'play' | 'pause'>): Promise<void> {
  if (!video.paused) {
    video.pause()
    return
  }
  try {
    await video.play()
  } catch {
    // 自动播放策略或媒体错误可能阻止播放；onPlay 未触发时按钮仍显示“播放”。
  }
}

function NotificationVideoPlayer({
  src,
  title,
  inline = false,
  onDimensions,
  onError,
}: {
  src: string
  title: string
  inline?: boolean
  onDimensions?: (width: number, height: number) => void
  onError?: () => void
}): React.ReactElement {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = React.useState(false)
  return (
    <>
      <video
        ref={videoRef}
        className={inline
          ? 'block max-h-[min(58vh,420px)] w-full bg-black object-contain'
          : 'absolute inset-0 block h-full w-full bg-black object-cover'}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        aria-label={title}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => onDimensions?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
        onError={onError}
        onContextMenu={(event) => event.preventDefault()}
      >你的系统不支持播放此视频。</video>
      <button
        type="button"
        className={`absolute z-10 flex size-10 items-center justify-center rounded-full bg-black/65 text-white shadow-sm transition-[background-color,transform] hover:bg-black/80 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${inline ? 'bottom-3 left-3' : 'bottom-4 left-4'}`}
        aria-label={playing ? '暂停视频' : '播放视频'}
        title={playing ? '暂停视频' : '播放视频'}
        onClick={() => {
          if (videoRef.current) void toggleNotificationVideoPlayback(videoRef.current)
        }}
      >
        {playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" className="translate-x-px" aria-hidden="true" />}
      </button>
    </>
  )
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
        <span className="relative my-3 block w-full overflow-hidden bg-black">
          <NotificationVideoPlayer src={src} title="通知内嵌视频" inline />
        </span>
      )
    }
    if (!isHttpsUrl(src)) return null
    return <img src={src} alt={alt ?? ''} className="my-3 max-h-[min(54vh,520px)] w-auto max-w-full rounded-lg border border-border/60 object-contain" />
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
      className={`relative min-w-0 w-full self-stretch overflow-hidden ${isVideo ? 'min-h-[min(58vh,360px)] bg-black' : 'min-h-52'}`}
      style={{
        aspectRatio: aspectRatio && aspectRatio > 0 ? aspectRatio : isVideo ? 16 / 9 : 1,
        maxHeight: isVideo ? 'min(76vh, 640px)' : 'min(70vh, 560px)',
      }}
      role="group"
      aria-label="通知媒体"
    >
      {failed ? (
        <p className="absolute inset-0 flex items-center justify-center bg-muted/30 px-4 text-center text-sm text-muted-foreground" role="status">
          媒体暂时无法加载，请阅读右侧通知内容。
        </p>
      ) : isVideo ? (
        <NotificationVideoPlayer
          src={media.url}
          title={`${title}的视频`}
          onDimensions={onDimensions}
          onError={() => setFailed(true)}
        />
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
        ? `max-h-[calc(100vh-4rem)] w-[calc(100vw-3rem)] gap-0 overflow-hidden border-0 p-0 transition-[width] duration-200 motion-reduce:transition-none ${media.type === 'video' ? 'max-w-[1280px]' : 'max-w-[1320px]'}`
        : 'max-h-[calc(100vh-5rem)] max-w-2xl overflow-y-auto'}
      style={layout ? { width: `min(calc(100vw - 3rem), ${layout.dialogWidth}px)` } : undefined}
      onEscapeKeyDown={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <div
        className={media
          ? `grid min-h-0 transition-[grid-template-columns] duration-200 motion-reduce:transition-none ${media.type === 'video' ? 'max-h-[min(76vh,640px)]' : 'max-h-[min(70vh,560px)]'}`
          : 'contents'}
        style={layout ? { gridTemplateColumns: media?.type === 'video'
          ? `minmax(0, min(${layout.mediaColumnWidth}px, 58%, calc(100% - 390px))) minmax(0, 1fr)`
          : `minmax(0, min(${layout.mediaColumnWidth}px, 60%, calc(100% - 350px))) minmax(0, 1fr)` } : undefined}
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
            ? 'prose prose-sm dark:prose-invert min-h-0 max-h-[min(66vh,520px)] max-w-none flex-1 overflow-y-auto break-words pr-1 [text-wrap:pretty]'
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
