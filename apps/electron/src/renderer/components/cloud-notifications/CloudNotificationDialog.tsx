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
      className="max-h-[calc(100vh-5rem)] max-w-2xl overflow-y-auto"
      onEscapeKeyDown={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>{notification.title}</DialogTitle>
      </DialogHeader>

      <div className="prose prose-sm dark:prose-invert max-w-none break-words">
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

      <DialogFooter>
        <Button onClick={() => void handleAcknowledge()} disabled={acknowledging}>
          {acknowledging ? '正在确认…' : '已读'}
        </Button>
      </DialogFooter>
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
