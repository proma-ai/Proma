/**
 * StickyUserMessage — 用户最新消息悬浮置顶条
 *
 * 当用户最近一条消息完全滚出 Conversation 视口顶部时，
 * 在顶部显示一个精简版悬浮条，点击可回滚到原始消息位置。
 * 必须放在 StickToBottom（Conversation）内部使用。
 */

import * as React from 'react'
import { FileText, FileImage, ChevronUp } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { useAtomValue } from 'jotai'
import { UserAvatar } from '@/components/chat/UserAvatar'
import { userProfileAtom } from '@/atoms/user-profile'
import { cn } from '@/lib/utils'

interface StickyAttachment {
  filename: string
  isImage: boolean
}

interface StickyUserMessageProps {
  lastUserGroupId: string | null
  text: string
  attachments: StickyAttachment[]
}

/** 计算 node 相对于 container 的实际顶部偏移（递归累积 offsetTop） */
function getOffsetTopRelativeTo(node: HTMLElement, container: HTMLElement): number {
  let top = 0
  let el: HTMLElement | null = node
  while (el && el !== container) {
    top += el.offsetTop
    el = el.offsetParent as HTMLElement | null
  }
  return top
}

export function StickyUserMessage({ lastUserGroupId, text, attachments }: StickyUserMessageProps): React.ReactElement {
  const { scrollRef, stopScroll, state: stickyState } = useStickToBottomContext()
  const userProfile = useAtomValue(userProfileAtom)
  const [isSticky, setIsSticky] = React.useState(false)

  // 检测最后一条用户消息是否已完全滚出视口顶部
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !lastUserGroupId) {
      setIsSticky(false)
      return
    }

    const check = () => {
      const nodes = el.querySelectorAll<HTMLElement>('[data-message-role="user"]')
      const lastNode = nodes[nodes.length - 1]
      if (!lastNode) {
        setIsSticky(false)
        return
      }
      const offsetTop = getOffsetTopRelativeTo(lastNode, el)
      const nodeBottom = offsetTop + lastNode.offsetHeight
      setIsSticky(nodeBottom < el.scrollTop)
    }

    el.addEventListener('scroll', check, { passive: true })
    const observer = new ResizeObserver(check)
    observer.observe(el)

    // 初始检查
    check()

    return () => {
      el.removeEventListener('scroll', check)
      observer.disconnect()
    }
  }, [scrollRef, lastUserGroupId])

  // 点击回滚到原始消息
  const scrollToOriginal = React.useCallback(() => {
    const el = scrollRef.current
    if (!el || !lastUserGroupId) return

    const target = el.querySelector<HTMLElement>(`[data-message-id="${lastUserGroupId}"]`)
    if (!target) return

    stopScroll()
    stickyState.animation = undefined
    stickyState.velocity = 0
    stickyState.accumulated = 0

    const offsetTop = getOffsetTopRelativeTo(target, el)
    el.scrollTo({ top: Math.max(0, offsetTop - 24), behavior: 'smooth' })
  }, [scrollRef, stopScroll, stickyState, lastUserGroupId])

  const hasContent = text || attachments.length > 0

  if (!hasContent) return <></>

  return (
    <div
      className={cn(
        'absolute left-0 right-0 top-0 z-20 transition-all duration-150 ease-out',
        isSticky
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 -translate-y-2 pointer-events-none'
      )}
    >
      <div
        className="mx-8 mt-2 rounded-xl bg-background/95 backdrop-blur-sm border border-border/40 shadow-sm cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={scrollToOriginal}
      >
        <div className="px-3.5 py-2.5">
          {/* 头部：头像 + 用户名 + 提示 */}
          <div className="flex items-center gap-2 mb-1">
            <UserAvatar avatar={userProfile.avatar} size={18} />
            <span className="text-xs font-medium text-foreground/60">{userProfile.userName}</span>
            <ChevronUp className="size-3 text-muted-foreground ml-auto" />
          </div>

          {/* 文本内容：最多两行 */}
          {text && (
            <p className="text-sm text-foreground/80 line-clamp-2 leading-relaxed">{text}</p>
          )}

          {/* 附件 badges */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {attachments.map((att) => {
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
  )
}
