import * as React from 'react'
import type { TocHeading } from './useTocHeadings'

/**
 * 滚动联动高亮：监听正文标题进入视口，返回当前所在章节的 id。
 *
 * 用 IntersectionObserver 以滚动容器为 root，`rootMargin` 把判定带压到容器
 * 顶部 ~30% 区域：标题滚到该带内即视为「当前」。多个标题同时命中时取最靠上
 * 的（DOM 顺序最小）。容器顶部尚无标题命中时，回退为最后一个已滚过顶部的标题。
 *
 * @param containerRef 预览滚动容器
 * @param headings     useTocHeadings 提取的标题树
 */
export function useScrollSpy(
  containerRef: React.RefObject<HTMLElement>,
  headings: TocHeading[],
): string | null {
  const [activeId, setActiveId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container || headings.length === 0) {
      setActiveId(null)
      return
    }

    const visible = new Set<string>()

    const recompute = (): void => {
      // DOM 顺序中第一个可见标题即当前章节
      const firstVisible = headings.find((h) => visible.has(h.id))
      if (firstVisible) {
        setActiveId(firstVisible.id)
        return
      }
      // 无标题在判定带内：取最后一个顶端已滚过容器顶部的标题
      const containerTop = container.getBoundingClientRect().top
      let candidate: string | null = headings[0]?.id ?? null
      for (const h of headings) {
        if (h.el.getBoundingClientRect().top - containerTop <= 1) {
          candidate = h.id
        }
      }
      setActiveId(candidate)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id
          if (!id) continue
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        recompute()
      },
      { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )

    for (const h of headings) observer.observe(h.el)
    recompute()

    return () => observer.disconnect()
  }, [containerRef, headings])

  return activeId
}
