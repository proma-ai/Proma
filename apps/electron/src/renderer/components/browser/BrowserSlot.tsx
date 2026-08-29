import * as React from 'react'
import type { BrowserLayoutSnapshot } from '@proma/shared'
import { nextBrowserLayoutRevision } from './browser-layout-revision'

// 每次 publish（包括卸载隐藏）分配全局单调 revision。旧 slot 的 IPC 即使晚到，
// 主进程也不会覆盖随后已挂载 tab 的可见性和边界。
// WebContentsView 是原生子视图，天然盖在 renderer DOM 之上；CSS z-index 无法反转。
// 它的可见性由三件事控制：Slot 尺寸、Tab 生命周期，以及 suppressed 避让状态——
// 右侧加号菜单等 renderer 弹层需要覆盖原生视图时，先展示最近一次页面快照作为
// 静态占位，再隐藏原生视图；弹层关闭后保持占位直到视图确认重新挂载，
// 保证两个切换方向都不出现灰帧闪烁。

export function BrowserSlot({ sessionId, tabId, suppressed = false }: { sessionId: string; tabId: string; suppressed?: boolean }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)
  const suppressedRef = React.useRef(suppressed)
  const requestIdRef = React.useRef(0)
  const publishRef = React.useRef<((slotVisible: boolean) => void) | null>(null)
  const snapshotRef = React.useRef<BrowserLayoutSnapshot | null>(null)
  const [snapshot, setSnapshot] = React.useState<BrowserLayoutSnapshot | null>(null)
  // 主进程确认当前展示的是本 Slot 的原生视图；占位图只在视图未展示时兜底。
  const [viewPresented, setViewPresented] = React.useState(true)

  React.useLayoutEffect(() => {
    const element = ref.current
    const setLayout = (window.electronAPI as Partial<typeof window.electronAPI>).setAgentBrowserLayout
    if (!element || typeof setLayout !== 'function') return
    let frame = 0
    const commitLayout = (slotVisible: boolean) => {
      const rect = element.getBoundingClientRect()
      const suppressedNow = suppressedRef.current
      const visible = slotVisible && !suppressedNow && rect.width > 4 && rect.height > 4
      const requestId = ++requestIdRef.current
      void setLayout({
        sessionId,
        tabId,
        revision: nextBrowserLayoutRevision(),
        visible,
        // 避让隐藏只是临时让出原生层，session 不应进入后台回收。
        preserveSessionOnHide: suppressedNow,
        bounds: {
          x: Math.round(rect.x), y: Math.round(rect.y),
          width: Math.round(rect.width), height: Math.round(rect.height),
        },
      })
        .then((result) => {
          if (requestId !== requestIdRef.current) return
          if (result) snapshotRef.current = result
          setSnapshot(snapshotRef.current)
          setViewPresented(visible)
        })
        .catch((error) => console.error('[受管浏览器] 更新浏览器布局失败:', error))
    }
    const publish = (slotVisible: boolean) => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        commitLayout(slotVisible)
      })
    }
    publishRef.current = publish
    const observer = new ResizeObserver(() => publish(true))
    const publishBounded = () => publish(true)
    observer.observe(element)
    window.addEventListener('resize', publishBounded)
    // Tab 切换时先前 Slot 会立即发出 hide。新 Slot 不能再等一帧才 show，
    // 否则快速左右切换时原生视图会停留在隐藏状态，表现为页面内容消失。
    commitLayout(true)
    return () => {
      publishRef.current = null
      observer.disconnect()
      window.removeEventListener('resize', publishBounded)
      if (frame) cancelAnimationFrame(frame)
      requestIdRef.current += 1
      void setLayout({ sessionId, tabId, revision: nextBrowserLayoutRevision(), visible: false, preserveSessionOnHide: false, bounds: { x: 0, y: 0, width: 0, height: 0 } })
    }
  }, [sessionId, tabId])

  // 避让状态变化时立即发布；快照占位图的显隐由下方 render 依据 suppressed 同帧决定，
  // 不等 IPC 往返，因此打开瞬间不会露出灰底。
  const isFirstSuppressedRunRef = React.useRef(true)
  React.useEffect(() => {
    suppressedRef.current = suppressed
    if (isFirstSuppressedRunRef.current) {
      isFirstSuppressedRunRef.current = false
      return
    }
    publishRef.current?.(true)
  }, [suppressed])

  // 打开避让：suppressed 变化的同一次 commit 就渲染占位图（原生视图此时尚未隐藏，
  // 画面像素无缝衔接）；关闭避让：占位图保留到主进程确认重新挂载为止。
  const showSnapshotImage = (suppressed || !viewPresented) && snapshot

  return (
    <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden bg-muted/15 titlebar-no-drag" aria-label="受管浏览器页面">
      {showSnapshotImage && (
        <img
          src={`data:${snapshot.mimeType};base64,${snapshot.base64}`}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-fill"
        />
      )}
    </div>
  )
}
