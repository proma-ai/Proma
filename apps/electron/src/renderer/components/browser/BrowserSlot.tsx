import * as React from 'react'
import { nextBrowserLayoutRevision } from './browser-layout-revision'

// 每次 publish（包括卸载隐藏）分配全局单调 revision。旧 slot 的 IPC 即使晚到，
// 主进程也不会覆盖随后已挂载 tab 的可见性和边界。
// WebContentsView 是原生子视图，天然盖在 renderer DOM 之上；CSS z-index 无法反转。
//
// 可见性策略：
// - 常规情况只由 BrowserSlot 的尺寸和 Tab 生命周期控制，不为 Popover、Dropdown、
//   Toast 等局部浮层隐藏，避免频繁隐藏/恢复导致右侧浏览器白屏与闪烁。
// - 全屏模态（Dialog/AlertDialog 等带全屏遮罩的居中弹窗，如删除项目确认框）打开
//   时，弹窗与浏览器区域相交且会被原生视图压住。此时临时隐藏视图（保留
//   session），模态关闭后立即恢复。
//
// 模态判定直接观测 DOM：Radix Dialog/AlertDialog 关闭后会卸载其内容节点
// （role=dialog / role=alertdialog），因此以「内容是否存在」为准天然无状态，
// 不会因 HMR、StrictMode 或页面整载导致计数漂移而把浏览器永久隐藏。

/** 是否存在已挂载的全屏模态内容（Radix Dialog 内容随开关挂载/卸载）。 */
function hasMountedModalContent(): boolean {
  return (
    typeof document !== 'undefined'
    && (document.querySelector('[role="dialog"]') !== null
      || document.querySelector('[role="alertdialog"]') !== null)
  )
}

const MODAL_POLL_INTERVAL_MS = 200

export function BrowserSlot({ sessionId, tabId }: { sessionId: string; tabId: string }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const element = ref.current
    const setLayout = (window.electronAPI as Partial<typeof window.electronAPI>).setAgentBrowserLayout
    if (!element || typeof setLayout !== 'function') return
    let frame = 0
    const commitLayout = (visible: boolean, preserveSessionOnHide: boolean) => {
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
    }
    const publish = (visible: boolean, preserveSessionOnHide = false, immediate = false) => {
      if (frame) cancelAnimationFrame(frame)
      if (immediate) {
        frame = 0
        commitLayout(visible, preserveSessionOnHide)
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        commitLayout(visible, preserveSessionOnHide)
      })
    }
    const publishCurrentVisibility = (immediate = false) => publish(!hasMountedModalContent(), false, immediate)
    const observer = new ResizeObserver(() => publishCurrentVisibility())
    const publishBounded = () => publishCurrentVisibility()
    observer.observe(element)
    window.addEventListener('resize', publishBounded)
    // Tab 切换时先前 Slot 会立即发出 hide。新 Slot 不能再等一帧才 show，
    // 否则快速左右切换时原生视图会停留在隐藏状态，表现为页面内容消失。
    publishCurrentVisibility(true)
    // 轮询观测全屏模态的打开/关闭：模态打开立即让位，关闭后立即恢复。
    // 轮询同时充当自愈——即使某次状态翻转被 HMR/页面重载打断，也会在下一个
    // tick 校正，不会把原生视图永久留在隐藏态。
    let modalWasOpen = hasMountedModalContent()
    const modalPollTimer = window.setInterval(() => {
      const modalIsOpen = hasMountedModalContent()
      if (modalIsOpen === modalWasOpen) return
      modalWasOpen = modalIsOpen
      publishCurrentVisibility(true)
    }, MODAL_POLL_INTERVAL_MS)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publishBounded)
      window.clearInterval(modalPollTimer)
      if (frame) cancelAnimationFrame(frame)
      void setLayout({ sessionId, tabId, revision: nextBrowserLayoutRevision(), visible: false, preserveSessionOnHide: false, bounds: { x: 0, y: 0, width: 0, height: 0 } })
    }
  }, [sessionId, tabId])

  return <div ref={ref} className="flex-1 min-h-0 bg-muted/15 titlebar-no-drag" aria-label="受管浏览器页面" />
}
