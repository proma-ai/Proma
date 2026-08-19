import * as React from 'react'
import { nextBrowserLayoutRevision } from './browser-layout-revision'

// 每次 publish（包括卸载隐藏）分配全局单调 revision。旧 slot 的 IPC 即使晚到，
// 主进程也不会覆盖随后已挂载 tab 的可见性和边界。

/**
 * WebContentsView 是原生子视图，天然盖在 renderer DOM 之上；CSS z-index 无法反转。
 * 应用级 Dialog / Select / Popover / Dropdown 与 Sonner 通知出现时，临时隐藏原生视图，
 * 让 portal 内容获得正确的层级；浮层关闭后立即恢复浏览器。
 */
const APP_OVERLAY_LIFECYCLE_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-sonner-toast]',
  '[data-sonner-toaster]',
  '[data-radix-popper-content-wrapper]',
].join(', ')

function hasBlockingAppOverlay(): boolean {
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return true
  if (document.querySelector('[data-sonner-toast][data-mounted="true"], [data-sonner-toast][data-visible="true"]')) return true

  return Array.from(document.querySelectorAll<HTMLElement>('[data-radix-popper-content-wrapper]'))
    .some((wrapper) => {
      const openContent = wrapper.querySelector<HTMLElement>('[data-state="open"]')
      // 浏览器自身的 Tooltip 不需要遮住网页；菜单、选择器与 Popover 则必须优先显示。
      return !!openContent && openContent.getAttribute('role') !== 'tooltip'
    })
}

function isAppOverlayElement(element: Element): boolean {
  return element.matches(APP_OVERLAY_LIFECYCLE_SELECTOR)
}

function findAppOverlayElements(node: Node): Element[] {
  if (!(node instanceof Element)) return []
  const elements = isAppOverlayElement(node) ? [node] : []
  return elements.concat(Array.from(node.querySelectorAll(APP_OVERLAY_LIFECYCLE_SELECTOR)))
}

/**
 * 只跟踪 portal/toast 生命周期，避免 Agent 流式渲染触发无意义的 layout IPC。
 *
 * body 只监听直接子节点：Radix/Toast portal 都挂在这里，普通消息 DOM 的深层
 * 更新不会进入 observer。识别出浮层根节点后，再把 attributes/subtree 监听限制
 * 在该浮层内部，以便捕获 data-state 等开关变化。
 */
function observeAppOverlayLifecycle(onChange: () => void): () => void {
  const overlayRoots = new Set<Element>()
  const overlayObserver = new MutationObserver((mutations) => {
    if (mutations.length > 0) onChange()
  })
  const bodyObserver = new MutationObserver((mutations) => {
    let changed = false
    for (const mutation of mutations) {
      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        const overlayElements = findAppOverlayElements(node)
        if (overlayElements.length > 0) changed = true
        for (const element of overlayElements) overlayRoots.add(element)
      }
    }
    syncOverlayRoots()
    if (changed) onChange()
  })

  function syncOverlayRoots(): void {
    for (const root of overlayRoots) {
      if (!root.isConnected) overlayRoots.delete(root)
    }

    for (const root of Array.from(document.body.children)) {
      for (const element of findAppOverlayElements(root)) overlayRoots.add(element)
    }

    overlayObserver.disconnect()
    for (const root of overlayRoots) {
      overlayObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-mounted', 'data-state', 'data-visible', 'role'],
      })
    }
  }

  syncOverlayRoots()
  bodyObserver.observe(document.body, { childList: true })

  return () => {
    bodyObserver.disconnect()
    overlayObserver.disconnect()
    overlayRoots.clear()
  }
}

export function BrowserSlot({ sessionId, tabId }: { sessionId: string; tabId: string }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const element = ref.current
    const setLayout = (window.electronAPI as Partial<typeof window.electronAPI>).setAgentBrowserLayout
    if (!element || typeof setLayout !== 'function') return
    let frame = 0
    const publish = (visible: boolean, preserveSessionOnHide = false) => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        void setLayout({
          sessionId,
          tabId,
          revision: nextBrowserLayoutRevision(),
          visible: visible && rect.width > 4 && rect.height > 4,
          preserveSessionOnHide,
          bounds: {
            x: Math.round(rect.x), y: Math.round(rect.y),
            width: Math.round(rect.width), height: Math.round(rect.height),
          },
        })
      })
    }
    const publishCurrentVisibility = () => {
      const overlayOpen = hasBlockingAppOverlay()
      publish(!overlayOpen, overlayOpen)
    }
    const observer = new ResizeObserver(publishCurrentVisibility)
    const disconnectOverlayObserver = observeAppOverlayLifecycle(publishCurrentVisibility)
    const publishBounded = () => publishCurrentVisibility()
    observer.observe(element)
    window.addEventListener('resize', publishBounded)
    publishCurrentVisibility()
    return () => {
      observer.disconnect()
      disconnectOverlayObserver()
      window.removeEventListener('resize', publishBounded)
      if (frame) cancelAnimationFrame(frame)
      void setLayout({ sessionId, tabId, revision: nextBrowserLayoutRevision(), visible: false, preserveSessionOnHide: false, bounds: { x: 0, y: 0, width: 0, height: 0 } })
    }
  }, [sessionId, tabId])

  return <div ref={ref} className="flex-1 min-h-0 bg-muted/15 titlebar-no-drag" aria-label="受管浏览器页面" />
}
