import * as React from 'react'
import { extractMarkdownHeadings, type MarkdownHeading } from '@/lib/markdown-rich-text'
import { createSlugger } from '../lib/slugify'

export interface TocHeading {
  id: string
  level: number
  text: string
  position: number
  el: HTMLElement | null
}

/**
 * 从完整 Markdown 源文本生成 TOC。CodeMirror 只渲染 viewport 附近的行，
 * 因此不能依赖 querySelectorAll 从预览 DOM 反推整篇文档的标题。
 */
export function useTocHeadings(
  containerRef: React.RefObject<HTMLElement>,
  content: string,
  enabled: boolean,
  bindRenderedElements = true,
): TocHeading[] {
  const sourceHeadings = React.useMemo(
    () => enabled ? extractMarkdownHeadings(content) : [],
    [content, enabled],
  )
  const ids = React.useMemo(() => {
    const slugger = createSlugger()
    return sourceHeadings.map((heading) => slugger(heading.text))
  }, [sourceHeadings])
  const positionIndexes = React.useMemo(
    () => new Map(sourceHeadings.map((heading, index) => [heading.position, index])),
    [sourceHeadings],
  )
  const [elements, setElements] = React.useState<Map<number, HTMLElement>>(new Map())

  React.useEffect(() => {
    if (!enabled || !bindRenderedElements) {
      setElements((previous) => previous.size === 0 ? previous : new Map())
      return
    }
    const container = containerRef.current
    if (!container) return

    const collect = (): void => {
      const next = new Map<number, HTMLElement>()
      let renderedHeadingIndex = 0
      const nodes = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [data-markdown-heading]')
      for (const el of Array.from(nodes)) {
        const position = Number(el.dataset.tocPosition)
        const sourceIndex = Number.isInteger(position)
          ? positionIndexes.get(position) ?? -1
          : renderedHeadingIndex
        renderedHeadingIndex++
        if (sourceIndex < 0 || sourceIndex >= sourceHeadings.length) continue
        el.id = ids[sourceIndex] ?? ''
        next.set(sourceIndex, el)
      }
      setElements((previous) => {
        if (previous.size === next.size && [...next].every(([index, el]) => previous.get(index) === el)) return previous
        return next
      })
    }

    let frame = 0
    const scheduleCollect = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        collect()
      })
    }

    collect()
    const observer = new MutationObserver(scheduleCollect)
    observer.observe(container, { childList: true, characterData: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [bindRenderedElements, containerRef, enabled, ids, positionIndexes, sourceHeadings])

  return React.useMemo(
    () => sourceHeadings.map((heading: MarkdownHeading, index) => ({
      id: ids[index] ?? 'section',
      level: heading.level,
      text: heading.text,
      position: heading.position,
      el: elements.get(index) ?? null,
    })),
    [elements, ids, sourceHeadings],
  )
}
