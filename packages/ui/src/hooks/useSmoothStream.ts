/**
 * useSmoothStream - 流式文本平滑渲染 Hook
 *
 * 将后端推送的流式文本（可能每秒几十次更新）转化为
 * 平滑的逐字渲染效果，类似打字机。
 *
 * 核心机制：
 * 1. 新增 delta 通过 Intl.Segmenter 拆分为字符粒度后入队
 * 2. requestAnimationFrame 驱动渲染循环
 * 3. 每帧动态计算渲染字符数（队列长时加速追赶，短时放慢）
 * 4. 流结束后加速但渐进排空队列（不一次性 dump，避免跳动）
 *
 * 参考 Cherry Studio 的 useSmoothStream 实现。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSmoothStreamOptions {
  /** 原始流式内容（每次 chunk 累积后的完整文本） */
  content: string
  /** 是否正在流式输出中 */
  isStreaming: boolean
  /** 每帧最小间隔（ms），默认 10 */
  minDelay?: number
}

interface UseSmoothStreamReturn {
  /** 平滑后的显示内容 */
  displayedContent: string
}

/** 多语言字符分割器（正确处理中文、日文等多字节字符） */
const segmenter = new Intl.Segmenter(
  ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-PT', 'ru-RU'],
)

/** 用 Intl.Segmenter 将文本拆分为字符数组 */
function segmentText(text: string): string[] {
  return Array.from(segmenter.segment(text)).map((s) => s.segment)
}

/**
 * 流式文本平滑渲染 Hook
 *
 * @example
 * ```tsx
 * const streamingContent = useAtomValue(streamingContentAtom)
 * const isStreaming = useAtomValue(streamingAtom)
 *
 * const { displayedContent } = useSmoothStream({
 *   content: streamingContent,
 *   isStreaming,
 * })
 *
 * return <MessageResponse>{displayedContent}</MessageResponse>
 * ```
 */
export function useSmoothStream({
  content,
  isStreaming,
  minDelay = 10,
}: UseSmoothStreamOptions): UseSmoothStreamReturn {
  const [displayedContent, setDisplayedContent] = useState(content)

  // 字符队列（待渲染的字符）
  const chunkQueueRef = useRef<string[]>([])
  // rAF ID
  const rafRef = useRef<number | null>(null)
  // 已渲染到 UI 的文本
  const displayedRef = useRef(content)
  // 上一次收到的完整内容（用于计算 delta）
  const prevContentRef = useRef(content)
  // 上次渲染时间
  const lastRenderTimeRef = useRef(0)
  // 流是否结束
  const streamDoneRef = useRef(!isStreaming)

  // 同步 streamDone 状态
  streamDoneRef.current = !isStreaming

  // 检测内容变化，计算 delta 并入队
  useEffect(() => {
    const prevContent = prevContentRef.current
    const newContent = content

    if (newContent === prevContent) return

    // 检测是否为追加（正常流式）
    const isAppend = newContent.startsWith(prevContent)

    if (isAppend) {
      // 增量部分拆分为字符后入队
      const delta = newContent.slice(prevContent.length)
      if (delta) {
        const chars = segmentText(delta)
        chunkQueueRef.current.push(...chars)
      }
    } else {
      // 内容重置（用户重新发送等场景）
      chunkQueueRef.current = []
      displayedRef.current = newContent
      setDisplayedContent(newContent)
    }

    prevContentRef.current = newContent
  }, [content])

  // 非流式状态时，确保最终内容一致（安全网，不立即 flush 队列）
  useEffect(() => {
    if (!isStreaming) {
      // 如果 rAF 循环仍在运行，让它自然排空队列
      if (rafRef.current) return

      // rAF 已停止：同步剩余内容
      if (chunkQueueRef.current.length > 0) {
        displayedRef.current += chunkQueueRef.current.join('')
        chunkQueueRef.current = []
      }
      if (displayedRef.current !== content) {
        displayedRef.current = content
      }
      setDisplayedContent(displayedRef.current)
    }
  }, [isStreaming, content])

  // 渲染循环
  const renderLoop = useCallback((currentTime: number) => {
    const queue = chunkQueueRef.current

    // 队列为空
    if (queue.length === 0) {
      if (streamDoneRef.current) {
        // 流结束 + 队列空 → 同步最终内容并停止
        if (displayedRef.current !== prevContentRef.current) {
          displayedRef.current = prevContentRef.current
          setDisplayedContent(displayedRef.current)
        }
        rafRef.current = null
        return
      }
      // 流未结束但队列空 → 等下一帧
      rafRef.current = requestAnimationFrame(renderLoop)
      return
    }

    // 最小延迟控制
    if (currentTime - lastRenderTimeRef.current < minDelay) {
      rafRef.current = requestAnimationFrame(renderLoop)
      return
    }
    lastRenderTimeRef.current = currentTime

    // 动态计算本帧渲染字符数：除数越大缓冲越深、输出越匀
    // 流式中 /8 保持较深缓冲（牺牲少许延迟换取丝滑），结束后 /4 加速排空
    const divisor = streamDoneRef.current ? 4 : 8
    const count = Math.max(1, Math.floor(queue.length / divisor))

    // 取出字符并更新
    const chars = queue.splice(0, count)
    displayedRef.current += chars.join('')
    setDisplayedContent(displayedRef.current)

    // 队列未空或流未结束 → 继续
    if (queue.length > 0 || !streamDoneRef.current) {
      rafRef.current = requestAnimationFrame(renderLoop)
    } else {
      // 队列刚排空 + 流已结束 → 同步最终内容并停止
      if (displayedRef.current !== prevContentRef.current) {
        displayedRef.current = prevContentRef.current
        setDisplayedContent(displayedRef.current)
      }
      rafRef.current = null
    }
  }, [minDelay])

  // 启动/重启渲染循环（流结束后也继续运行直到队列排空）
  useEffect(() => {
    if ((isStreaming || chunkQueueRef.current.length > 0) && !rafRef.current) {
      rafRef.current = requestAnimationFrame(renderLoop)
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isStreaming, renderLoop])

  return { displayedContent }
}
