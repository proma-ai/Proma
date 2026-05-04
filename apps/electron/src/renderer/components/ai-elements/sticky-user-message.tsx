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
}

export function StickyUserMessage({ userMessages }: StickyUserMessageProps): React.ReactElement {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const userProfile = useAtomValue(userProfileAtom)
  const stickyEnabled = useAtomValue(stickyUserMessageEnabledAtom)

  // 当前悬浮展示的消息
  const [stickyMessage, setStickyMessage] = React.useState<UserMessageData | null>(null)

  // 构建 id → data 查找表
  const messageMap = React.useMemo(() => {
    const map = new Map<string, UserMessageData>()
    for (const msg of userMessages) {
      if (msg.id) map.set(msg.id, msg)
    }
    return map
  }, [userMessages])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || userMessages.length === 0 || !stickyEnabled) {
      setStickyMessage(null)
      return
    }

    const check = () => {
      const containerRect = el.getBoundingClientRect()
      const nodes = el.querySelectorAll<HTMLElement>('[data-message-role="user"]')

      // 从后往前找第一个完全在视口上方的用户消息节点
      let found: UserMessageData | null = null
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]!
        const nodeRect = node.getBoundingClientRect()
        if (nodeRect.bottom < containerRect.top) {
          // 找到了视口上方最近的用户消息
          const msgId = node.getAttribute('data-message-id')
          if (msgId) {
            found = messageMap.get(msgId) ?? null
          }
          break
        }
      }
      setStickyMessage(found)
    }

    el.addEventListener('scroll', check, { passive: true })

    // 监听容器尺寸变化
    const resizeObserver = new ResizeObserver(check)
    resizeObserver.observe(el)

    // 监听内容区域 DOM 变化（流式输出、消息加载后及时检测）
    const contentEl = el.firstElementChild as HTMLElement | null
    if (contentEl) {
      resizeObserver.observe(contentEl)
    }

    // 延迟一帧执行初始检查，确保 DOM 已完成渲染
    const rafId = requestAnimationFrame(check)

    return () => {
      el.removeEventListener('scroll', check)
      resizeObserver.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [scrollRef, userMessages, messageMap, stickyEnabled])

  // 点击回滚到原始消息
  const scrollToOriginal = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickyMessage?.id) return

    const target = el.querySelector<HTMLElement>(`[data-message-id="${stickyMessage.id}"]`)
    if (!target) return

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const containerRect = el.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetScrollTop = el.scrollTop + (targetRect.top - containerRect.top)
    el.scrollTo({ top: Math.max(0, targetScrollTop - 24), behavior: 'smooth' })
  }, [scrollRef, stopScroll, stickyState, stickyMessage])

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
          className="ml-[46px] rounded-xl bg-background/95 backdrop-blur-sm border border-border/40 shadow-sm cursor-pointer hover:bg-accent/50 transition-colors"
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
              <div className="text-sm text-foreground/80 line-clamp-2 leading-relaxed max-h-[3.25em]">
                <MessageResponse
                  className="prose-p:my-0 prose-p:inline prose-headings:my-0 prose-headings:text-sm prose-pre:hidden prose-ul:my-0 prose-ol:my-0"
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
