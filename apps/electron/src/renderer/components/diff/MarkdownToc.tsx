import * as React from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTocHeadings } from '@/hooks/useTocHeadings'
import { useScrollSpy } from '@/hooks/useScrollSpy'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface MarkdownTocProps {
  /** 预览滚动容器，标题提取与跳转都基于它 */
  containerRef: React.RefObject<HTMLElement>
  /** 文件内容标识，变化时重建目录 */
  contentKey: string
  /** 仅 Markdown 只读预览时为 true */
  enabled: boolean
  /** 用户手动折叠目录 */
  onOpenChange?: (open: boolean) => void
}

/** 计算标题相对滚动容器的 top（不依赖 offsetParent 链） */
function offsetTopWithin(node: HTMLElement, container: HTMLElement): number {
  return node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

export function MarkdownToc({ containerRef, contentKey, enabled, onOpenChange }: MarkdownTocProps): React.ReactElement | null {
  const headings = useTocHeadings(containerRef, contentKey, enabled)
  const activeId = useScrollSpy(containerRef, headings)
  const listRef = React.useRef<HTMLDivElement>(null)

  // active 项保持在侧栏可视区内
  React.useEffect(() => {
    if (!activeId || !listRef.current) return
    const item = listRef.current.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const minLevel = React.useMemo(
    () => (headings.length ? Math.min(...headings.map((h) => h.level)) : 1),
    [headings],
  )

  if (!enabled) return null

  const jumpTo = (heading: (typeof headings)[number]): void => {
    const container = containerRef.current
    if (!container) return
    const top = offsetTopWithin(heading.el, container)
    container.scrollTo({ top: Math.max(top - 8, 0), behavior: 'smooth' })
  }

  return (
    <nav
      aria-label="文档目录"
      className="flex flex-col w-52 shrink-0 self-start max-h-full m-2 rounded-lg bg-muted/40"
    >
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div className="min-w-0 flex-1 text-[11px] font-medium text-foreground/40 select-none">目录</div>
        {onOpenChange && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/70"
                aria-label="收起目录"
              >
                <ChevronLeft className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">收起目录</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div ref={listRef} className="min-h-0 overflow-auto scrollbar-thin px-1 pb-2">
        {headings.map((heading) => {
          const active = heading.id === activeId
          return (
            <button
              key={heading.id}
              type="button"
              data-toc-id={heading.id}
              onClick={() => jumpTo(heading)}
              title={heading.text}
              style={{ paddingLeft: `${(heading.level - minLevel) * 12 + 8}px` }}
              className={cn(
                'block w-full text-left truncate rounded py-1 pr-2 text-[12px] leading-snug transition-colors',
                'border-l-2 border-transparent',
                active
                  ? 'border-primary text-foreground font-medium bg-foreground/[0.04]'
                  : 'text-foreground/55 hover:text-foreground/80 hover:bg-foreground/[0.03]',
              )}
            >
              {heading.text}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
