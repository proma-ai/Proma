import * as React from 'react'
import type { TocHeading } from './useTocHeadings'

interface PositionAwareEditor {
  getPositionAtViewportY: (viewportY: number) => number | null
}

/** 返回给定源码位置所在的最后一个章节。 */
function headingAtPosition(headings: TocHeading[], position: number): TocHeading | null {
  let current: TocHeading | null = null
  for (const heading of headings) {
    if (heading.position > position) break
    current = heading
  }
  return current ?? headings[0] ?? null
}

/**
 * 滚动联动高亮：返回预览正文当前所在章节的 id。
 *
 * LiveMarkdown 使用 CodeMirror 虚拟化，远离 viewport 的标题没有 DOM 节点。
 * 这条路径直接把滚动容器顶部坐标映射为源码位置，再从完整标题列表查找章节；
 * IntersectionObserver 只作为普通、非虚拟化 Markdown DOM 的回退实现。
 */
export function useScrollSpy(
  containerRef: React.RefObject<HTMLElement>,
  headings: TocHeading[],
  editorRef?: React.RefObject<PositionAwareEditor | null>,
): string | null {
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const activeIdRef = React.useRef<string | null>(null)

  const updateActiveId = React.useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveId((previous) => previous === id ? previous : id)
  }, [])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container || headings.length === 0) {
      updateActiveId(null)
      return
    }

    const visible = new Set<string>()
    let frame = 0

    const recompute = (): void => {
      const editor = editorRef?.current
      if (editor) {
        const rect = container.getBoundingClientRect()
        const position = editor.getPositionAtViewportY(rect.top + 10)
        if (position != null) {
          updateActiveId(headingAtPosition(headings, position)?.id ?? null)
          return
        }

        // CodeMirror 正在换 viewport 时坐标映射可能短暂不可用。保留当前值，
        // 但不阻止下一次 scroll/rAF 用真实源码位置重新计算。
        if (activeIdRef.current && headings.some((heading) => heading.id === activeIdRef.current)) return
      }

      const firstVisible = headings.find((heading) => visible.has(heading.id))
      if (firstVisible) {
        updateActiveId(firstVisible.id)
        return
      }

      const containerTop = container.getBoundingClientRect().top
      let candidate: string | null = headings[0]?.id ?? null
      for (const heading of headings) {
        if (heading.el && heading.el.getBoundingClientRect().top - containerTop <= 1) {
          candidate = heading.id
        }
      }
      updateActiveId(candidate)
    }

    const scheduleRecompute = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        recompute()
      })
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id
          if (!id) continue
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        scheduleRecompute()
      },
      { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )

    for (const heading of headings) {
      if (heading.el) observer.observe(heading.el)
    }

    const resizeObserver = new ResizeObserver(scheduleRecompute)
    resizeObserver.observe(container)
    container.addEventListener('scroll', scheduleRecompute, { passive: true })
    window.addEventListener('resize', scheduleRecompute)

    recompute()
    scheduleRecompute()

    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      container.removeEventListener('scroll', scheduleRecompute)
      window.removeEventListener('resize', scheduleRecompute)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [containerRef, editorRef, headings, updateActiveId])

  return activeId
}
