/**
 * StickyUserMessage — 用户消息悬浮置顶条
 *
 * 当任意用户消息完全滚出 Conversation 视口顶部时，
 * 在顶部显示该消息的精简版悬浮条，点击可回滚到原始消息位置。
 * 必须放在 StickToBottom（Conversation）内部使用。
 *
 * 核心逻辑：遍历所有 [data-message-role="user"] DOM 节点，
 * 找到最后一个 bottom < containerTop 的节点（即视口上方最近的用户消息），
 * 匹配其 data-message-id 到 userMessages 数据列表，显示对应内容。
 */

import * as React from 'react'
import { FileText, FileImage, ChevronUp } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { useAtomValue } from 'jotai'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
import { stickyUserMessageEnabledAtom } from '@/atoms/ui-preferences'
import { MessageResponse, remarkMentions } from './message'
import type { RemarkPluginFn } from './message'
import { cn } from '@/lib/utils'

/** 悬浮条专用 remark 插件（仅 mention，不保留换行） */
const STICKY_REMARK_PLUGINS: RemarkPluginFn[] = [remarkMentions]

/** 去除 fenced code block，替换为 [code] 占位符 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' [code] ')
}

interface StickyAttachment {
  filename: string
  isImage: boolean
}

interface UserMessageData {
  id: string | null
  text: string
  attachments: StickyAttachment[]
}

interface StickyUserMessageProps {
  userMessages: UserMessageData[]
  getStickyMessageId?: (scrollTop: number) => string | null
  onScrollToMessage?: (id: string) => void
}

interface UserMessagePosition {
  id: string
  bottom: number
}

export function StickyUserMessage({
  userMessages,
  getStickyMessageId,
  onScrollToMessage,
}: StickyUserMessageProps): React.ReactElement {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const userProfile = useAtomValue(userProfileAtom)
  const stickyEnabled = useAtomValue(stickyUserMessageEnabledAtom)

  // 当前悬浮展示的消息
  const [stickyMessage, setStickyMessage] = React.useState<UserMessageData | null>(null)
  const positionsRef = React.useRef<UserMessagePosition[]>([])

  const userMessageSignature = React.useMemo(
    () => userMessages.map((message) => message.id ?? '').join('\u0000'),
    [userMessages],
  )

  // 构建 id → data 查找表；流式 assistant 更新会重建上游数组，但用户消息未变时
  // 保持 map 引用稳定，避免重新绑定观察器和测量全部历史消息。
  const messageMap = React.useMemo(() => {
    const map = new Map<string, UserMessageData>()
    for (const msg of userMessages) {
      if (msg.id) map.set(msg.id, msg)
    }
    return map
  }, [userMessageSignature])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || userMessages.length === 0 || !stickyEnabled) {
      positionsRef.current = []
      setStickyMessage(null)
      return
    }

    let scrollFrame: number | null = null
    let measureFrame: number | null = null
    let containerWidth = el.clientWidth

    const updateStickyMessage = (): void => {
      const scrollTop = el.scrollTop
      if (getStickyMessageId) {
        const id = getStickyMessageId(scrollTop)
        const found = id ? messageMap.get(id) ?? null : null
        setStickyMessage((previous) => previous?.id === found?.id ? previous : found)
        return
      }

      const positions = positionsRef.current
      let low = 0
      let high = positions.length - 1
      let match: UserMessagePosition | undefined
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const candidate = positions[middle]!
        if (candidate.bottom < scrollTop) {
          match = candidate
          low = middle + 1
        } else {
          high = middle - 1
        }
      }
      const found = match ? messageMap.get(match.id) ?? null : null
      setStickyMessage((previous) => previous?.id === found?.id ? previous : found)
    }

    const measurePositions = (): void => {
      const containerRect = el.getBoundingClientRect()
      const positions: UserMessagePosition[] = []
      for (const node of el.querySelectorAll<HTMLElement>('[data-message-role="user"]')) {
        const id = node.getAttribute('data-message-id')
        if (!id) continue
        const rect = node.getBoundingClientRect()
        positions.push({ id, bottom: rect.bottom - containerRect.top + el.scrollTop })
      }
      positionsRef.current = positions
      if (!getStickyMessageId) {
        const messageElements = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
        const lastUserMessageIndex = messageElements.findLastIndex(
          (message) => message.dataset.messageRole === 'user',
        )
        for (const message of messageElements.slice(0, lastUserMessageIndex + 1)) {
          resizeObserver.observe(message)
        }
      }
      updateStickyMessage()
    }

    const scheduleMeasure = (): void => {
      if (measureFrame !== null) return
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null
        measurePositions()
      })
    }
    const scheduleScrollUpdate = (): void => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        updateStickyMessage()
      })
    }

    el.addEventListener('scroll', scheduleScrollUpdate, { passive: true })
    const resizeObserver = new ResizeObserver((entries) => {
      const containerEntry = entries.find((entry) => entry.target === el)
      if (containerEntry && Math.abs(containerEntry.contentRect.width - containerWidth) >= 1) {
        containerWidth = containerEntry.contentRect.width
        scheduleMeasure()
        return
      }
      if (entries.some((entry) => entry.target !== el)) scheduleMeasure()
    })
    const virtualContent = el.querySelector<HTMLElement>('[data-index]')?.parentElement
      ?? el.firstElementChild
    if (virtualContent && virtualContent !== el) resizeObserver.observe(virtualContent)

    const mutationObserver = getStickyMessageId ? null : new MutationObserver(scheduleMeasure)
    // 只有最后一条用户消息及其之前的内容会改变用户消息的绝对位置。
    // 当前流式 assistant 位于它之后，不纳入观察，避免每个流式高度更新重测整段历史。
    if (!getStickyMessageId) {
      const messageElements = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
      const lastUserMessageIndex = messageElements.findLastIndex(
        (message) => message.dataset.messageRole === 'user',
      )
      for (const message of messageElements.slice(0, lastUserMessageIndex + 1)) {
        resizeObserver.observe(message)
      }
      mutationObserver?.observe(el, { childList: true, subtree: true })
    }

    scheduleMeasure()

    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      if (measureFrame !== null) cancelAnimationFrame(measureFrame)
      el.removeEventListener('scroll', scheduleScrollUpdate)
      mutationObserver?.disconnect()
      resizeObserver.disconnect()
    }
  }, [getStickyMessageId, scrollRef, userMessageSignature, messageMap, stickyEnabled])

  // 点击回滚到原始消息
  const scrollToOriginal = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickyMessage?.id) return

    const target = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.getAttribute('data-message-id') === stickyMessage.id
    )
    if (!target) {
      onScrollToMessage?.(stickyMessage.id)
      return
    }

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const containerRect = el.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetScrollTop = el.scrollTop + (targetRect.top - containerRect.top)
    el.scrollTo({ top: Math.max(0, targetScrollTop - 24), behavior: 'smooth' })
  }, [onScrollToMessage, scrollRef, stopScroll, stickyState, stickyMessage])

  const isSticky = stickyMessage !== null
  const hasContent = stickyMessage && (stickyMessage.text || stickyMessage.attachments.length > 0)

  if (!stickyEnabled) return <></>
  if (!hasContent && !isSticky) return <></>

  return (
    <div
      className={cn(
        'absolute left-0 right-0 top-0 z-20 transition-all duration-150 ease-out',
        isSticky
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 -translate-y-2 pointer-events-none'
      )}
    >
      {/* 复用 ConversationContent(px-8) + Message(px-2.5) 的 padding 链，保证与内容区等宽 */}
      <div className="mx-8 px-2.5 pt-2">
        <div
          className="sticky-user-banner ml-[46px] rounded-xl bg-[hsl(var(--input-surface))] shadow-sm cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={scrollToOriginal}
        >
          <div className="px-3.5 py-2.5">
            {/* 头部：头像 + 用户名 + 提示 */}
            <div className="flex items-center gap-2 mb-1">
              <UserAvatar avatar={userProfile.avatar} size={18} />
              <span className="text-xs font-medium text-foreground/60">{userProfile.userName}</span>
              <ChevronUp className="size-3 text-muted-foreground ml-auto" />
            </div>

            {/* 文本内容：最多两行，支持 Markdown 渲染 */}
            {stickyMessage?.text && (
              <div className="text-sm text-foreground/80 line-clamp-2 leading-relaxed">
                <MessageResponse
                  className="prose-p:my-0 prose-p:inline prose-headings:my-0 prose-headings:text-sm prose-pre:hidden prose-ul:my-0 prose-ol:my-0 prose-li:my-0"
                  remarkPlugins={STICKY_REMARK_PLUGINS}
                >
                  {stripCodeBlocks(stickyMessage.text)}
                </MessageResponse>
              </div>
            )}

            {/* 附件 badges */}
            {stickyMessage && stickyMessage.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {stickyMessage.attachments.map((att) => {
                  const Icon = att.isImage ? FileImage : FileText
                  return (
                    <div
                      key={att.filename}
                      className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      <Icon className="size-3 shrink-0" />
                      <span className="truncate max-w-[150px]">{att.filename}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
