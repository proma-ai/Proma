/**
 * 滚动位置记忆 — 切换对话/会话时保存并恢复滚动位置
 *
 * 解决切换对话时 StickToBottom 的 spring 动画导致的卡顿和眩晕问题。
 *
 * 原理：
 * - scroll 事件持续保存 distanceFromBottom 到模块级 Map
 * - 切换对话时 ready=false → Conversation 的 resize 切为 "instant"（消除动画）
 * - ready=true 时：有保存位置 → stopScroll() + 设置 scrollTop；无保存 → scrollToBottom("instant")
 * - stopScroll() 让 StickToBottom 内部 isAtBottom=false，ResizeObserver 不再争抢滚动
 *
 * 配合 Conversation 的 resize prop 动态切换：
 *   <Conversation resize={ready ? "smooth" : "instant"}>
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'

/** 模块级缓存：对话/会话 ID → 距底部像素距离 */
const scrollPositionCache = new Map<string, number>()

/**
 * ScrollPositionManager — 放在 Conversation（StickToBottom）内部
 */
export function ScrollPositionManager({ id, ready }: { id: string; ready: boolean }): null {
  const { scrollRef, stopScroll, scrollToBottom } = useStickToBottomContext()
  const restoredRef = useRef(false)
  const prevIdRef = useRef(id)

  // 持续保存滚动位置（距底部距离）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const savePosition = (): void => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      scrollPositionCache.set(id, distanceFromBottom)
    }

    el.addEventListener('scroll', savePosition, { passive: true })
    return () => el.removeEventListener('scroll', savePosition)
  }, [scrollRef, id])

  // id 变化时重置恢复标记
  useEffect(() => {
    if (id !== prevIdRef.current) {
      prevIdRef.current = id
      restoredRef.current = false
    }
  }, [id])

  // ready 后恢复位置 — useLayoutEffect 在浏览器绘制前执行，配合 opacity=0 无闪烁
  useLayoutEffect(() => {
    if (!ready || restoredRef.current) return
    restoredRef.current = true

    const el = scrollRef.current
    if (!el) return

    const savedDistance = scrollPositionCache.get(id)
    if (savedDistance != null && savedDistance > 5) {
      // 有保存的非底部位置：停止 StickToBottom 自动滚动，恢复位置
      stopScroll()
      const targetScrollTop = el.scrollHeight - el.clientHeight - savedDistance
      el.scrollTop = Math.max(0, targetScrollTop)
    } else {
      // 无保存位置或在底部：直接跳到底部（无动画）
      scrollToBottom('instant')
    }
  }, [ready, id, scrollRef, stopScroll, scrollToBottom])

  return null
}
