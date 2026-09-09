import * as React from 'react'

interface SidebarScrollBoundaryProps {
  /** 唯一直接 DOM 子元素必须是列表的原生滚动容器。 */
  children: React.ReactNode
}

/** 顶部反馈局限在小组件内，滚动不会触发整个 LeftSidebar 重渲染。 */
export function SidebarScrollBoundary({ children }: SidebarScrollBoundaryProps): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const scrolledRef = React.useRef(false)
  const [isScrolled, setIsScrolled] = React.useState(false)

  const syncScrollState = React.useCallback((): void => {
    const scrollContainer = rootRef.current?.firstElementChild
    if (!scrollContainer) return

    // 忽略回弹负值和亚像素偏移；只有跨越顶部边界时才调度 React 更新。
    const nextIsScrolled = scrollContainer.scrollTop > 1
    if (scrolledRef.current === nextIsScrolled) return
    scrolledRef.current = nextIsScrolled
    setIsScrolled(nextIsScrolled)
  }, [])

  // 挂载、切换内容及列表缩短后同步实际位置，不重置用户的滚动位置。
  React.useLayoutEffect(syncScrollState)

  const handleScrollCapture = React.useCallback((event: React.UIEvent<HTMLDivElement>): void => {
    // 忽略会话行内预览等嵌套滚动，虚拟列表的直接根节点就是滚动容器。
    if (event.target === rootRef.current?.firstElementChild) syncScrollState()
  }, [syncScrollState])

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col"
      onScrollCapture={handleScrollCapture}
    >
      {children}
      <div
        aria-hidden="true"
        data-sidebar-scroll-boundary={isScrolled ? 'scrolled' : 'top'}
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-4 border-t-[0.5px] border-border bg-[linear-gradient(to_bottom,hsl(var(--sidebar-surface)/0.85)_0%,hsl(var(--sidebar-surface)/0)_100%)] transition-opacity duration-150 motion-reduce:transition-none ${isScrolled ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}
