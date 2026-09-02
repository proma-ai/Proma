import * as React from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTocHeadings } from '@/hooks/useTocHeadings'
import { useScrollSpy } from '@/hooks/useScrollSpy'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface MarkdownTocProps {
  /** 预览滚动容器，标题提取与跳转都基于它 */
  containerRef: React.RefObject<HTMLElement>
  /** 文件完整 Markdown 内容，目录从源文本生成 */
  content: string
  /** LiveMarkdown 编辑器实例，用于虚拟化文档的精确跳转 */
  editorRef?: React.RefObject<{
    scrollToPosition: (position: number) => void
    getPositionAtViewportY: (viewportY: number) => number | null
  } | null>
  /** LiveMarkdown 已完成异步初始化，可可靠执行 scrollToPosition */
  editorReady?: boolean
  /** 仅 Markdown 预览时为 true */
  enabled: boolean
  /** 在目录跳转前取消可能覆盖目标位置的延迟滚动恢复 */
  onBeforeNavigate?: () => void
  /** 用户手动折叠目录 */
  onOpenChange?: (open: boolean) => void
}

/** 计算标题相对滚动容器的 top（不依赖 offsetParent 链） */
function offsetTopWithin(node: HTMLElement, container: HTMLElement): number {
  return node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

export function MarkdownTocScrollTail({ containerRef, enabled }: { containerRef: React.RefObject<HTMLElement>; enabled: boolean }): React.ReactElement | null {
  const tailRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    const tail = tailRef.current
    if (!container || !tail) return

    const update = (): void => {
      // 只补足当前滚动视口高度，让文档末尾标题可精确对齐顶部；
      // 不把固定的 100vh 写进编辑器内容或持久化滚动状态。
      tail.style.height = `${Math.max(container.clientHeight, 0)}px`
    }
    update()
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(container)
    window.addEventListener('resize', update)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [containerRef, enabled])

  if (!enabled) return null
  return <div ref={tailRef} aria-hidden="true" className="pointer-events-none w-px shrink-0" />
}

export function MarkdownToc({ containerRef, content, editorRef, editorReady, enabled, onBeforeNavigate, onOpenChange }: MarkdownTocProps): React.ReactElement | null {
  const headings = useTocHeadings(containerRef, content, enabled, !editorRef)
  const activeId = useScrollSpy(containerRef, headings, editorRef)
  const listRef = React.useRef<HTMLDivElement>(null)
  // LiveMarkdown 的 imperative handle 会早于异步 ink() 初始化创建；仅 ref 存在还不能跳转。
  const navigationReady = !editorRef || editorReady === true

  React.useEffect(() => {
    if (!activeId || !listRef.current) return
    listRef.current.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const minLevel = React.useMemo(
    () => (headings.length ? Math.min(...headings.map((h) => h.level)) : 1),
    [headings],
  )

  if (!enabled) return null

  const jumpTo = (heading: (typeof headings)[number]): void => {
    const editor = editorRef?.current
    if (editor && navigationReady) {
      onBeforeNavigate?.()
      editor.scrollToPosition(heading.position)
      return
    }
    const container = containerRef.current
    if (!container || !heading.el) return
    onBeforeNavigate?.()
    const top = offsetTopWithin(heading.el, container)
    container.scrollTo({ top: Math.max(top - 8, 0), behavior: 'smooth' })
  }

  return (
    <nav aria-label="文档目录" className="m-2 flex h-[calc(100%-1rem)] min-h-0 w-52 shrink-0 self-start flex-col rounded-lg bg-muted/40">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div className="min-w-0 flex-1 text-[11px] font-medium text-foreground/40 select-none">目录</div>
        {onOpenChange && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onOpenChange(false)} className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground/70" aria-label="收起目录">
                <ChevronLeft className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">收起目录</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin px-1 pb-2">
        {headings.map((heading) => (
          <button key={heading.id} type="button" data-toc-id={heading.id} onClick={() => jumpTo(heading)} disabled={!navigationReady} title={navigationReady ? heading.text : '正在准备目录跳转'} style={{ paddingLeft: `${(heading.level - minLevel) * 12 + 8}px` }} className={cn('block w-full text-left truncate rounded py-1 pr-2 text-[12px] leading-snug transition-colors disabled:cursor-wait disabled:opacity-50', 'border-l-2 border-transparent', heading.id === activeId ? 'border-primary text-foreground font-medium bg-foreground/[0.04]' : 'text-foreground/55 hover:text-foreground/80 hover:bg-foreground/[0.03]')}>
            {heading.text}
          </button>
        ))}
      </div>
    </nav>
  )
}
