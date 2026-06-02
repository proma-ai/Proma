import * as React from 'react'
import { createSlugger } from '../lib/slugify'

export interface TocHeading {
  id: string
  level: number
  text: string
  el: HTMLElement
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/**
 * 从滚动容器内的渲染结果中提取标题树，并为每个标题注入锚点 id。
 *
 * Markdown 预览由 TipTap 异步渲染，且 Shiki 代码块高亮、图片懒加载会持续
 * 改动 DOM。因此用 MutationObserver 监听子树变化（debounce）重新提取，而非
 * 在挂载时一次性读取——否则会漏标题或拿到错误的偏移。
 *
 * @param containerRef 预览滚动容器（DiffTabContent 的 scrollContainerRef）
 * @param contentKey   文件内容标识，变化时强制重建 observer 与 id
 * @param enabled      仅在 Markdown 只读预览时为 true
 */
export function useTocHeadings(
  containerRef: React.RefObject<HTMLElement>,
  contentKey: string,
  enabled: boolean,
): TocHeading[] {
  const [headings, setHeadings] = React.useState<TocHeading[]>([])

  React.useEffect(() => {
    if (!enabled) {
      setHeadings([])
      return
    }
    const container = containerRef.current
    if (!container) return

    const extract = (): void => {
      const slug = createSlugger()
      const next: TocHeading[] = []
      const nodes = container.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
      for (const el of Array.from(nodes)) {
        const text = (el.textContent ?? '').trim()
        if (!text) continue
        const level = Number(el.tagName.slice(1))
        if (!el.id) el.id = slug(text)
        next.push({ id: el.id, level, text, el })
      }
      setHeadings((prev) => (sameHeadings(prev, next) ? prev : next))
    }

    extract()

    let raf = 0
    let timer: number | undefined
    const schedule = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(extract)
      }, 120)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(container, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [containerRef, contentKey, enabled])

  return headings
}

function sameHeadings(a: TocHeading[], b: TocHeading[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y || x.el !== y.el || x.id !== y.id || x.level !== y.level || x.text !== y.text) {
      return false
    }
  }
  return true
}
