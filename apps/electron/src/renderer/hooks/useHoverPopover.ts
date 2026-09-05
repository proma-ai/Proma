/**
 * useHoverPopover — 折叠态侧栏弹层共用的 hover / 点击 / 键盘开合控制。
 *
 * 折叠态入口只有 40px，鼠标从入口移动到弹层必然经过两者之间的空隙，也可能
 * 短暂落在侧栏容器上。因此关闭一律走宽限期：进入入口或弹层任一表面立即取消
 * 关闭，离开后延迟 HOVER_POPOVER_CLOSE_DELAY 才真正关闭。
 *
 * 不要改成「离开即关闭 + relatedTarget 命中判定」：Portal 弹层斜向移动时
 * relatedTarget 会落在侧栏滚动容器上，弹层在鼠标到达列表前就消失，列表项因此
 * 完全点不到。同理，列表项的关闭必须发生在自身 onClick 里（先执行动作再收起），
 * 不能放在弹层的 onClickCapture 上抢在业务处理之前卸载内容。
 */

import * as React from 'react'

export const HOVER_POPOVER_CLOSE_DELAY = 150

/**
 * side="right" + sideOffset={8} 弹层的共用样式：
 * - before 伪元素把 8px 间距纳入弹层命中区，鼠标横穿时不会离开 hover 表面；
 * - 退场动画期间不再拦截指针，避免正在淡出的弹层吃掉下一次点击。
 */
export const HOVER_POPOVER_CONTENT_CLASS
  = "relative before:absolute before:-left-2 before:top-0 before:h-full before:w-2 before:content-[''] data-[state=closed]:pointer-events-none"

export type HoverPopoverOpenReason = 'hover' | 'pointer' | 'keyboard'

export interface UseHoverPopoverOptions {
  /** 受控开合；省略时由 hook 自己维护状态。 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  closeDelay?: number
}

export interface HoverPopoverController {
  open: boolean
  /** 传给 Radix Popover 的 onOpenChange，同时取消待执行的延迟关闭。 */
  onOpenChange: (open: boolean) => void
  /** 入口与弹层内容共用的一组 hover 属性，两个表面视作同一个 hover 区域。 */
  hoverProps: {
    onMouseEnter: () => void
    onMouseLeave: () => void
  }
  /** 触控与键盘 affordance：记录打开原因，用于决定是否抢焦点。 */
  manualTriggerProps: {
    onPointerDown: () => void
    onKeyDown: (event: React.KeyboardEvent) => void
  }
  /** 弹层内容的焦点属性：hover 打开时不抢焦点，键盘打开时正常归还焦点。 */
  contentFocusProps: {
    onOpenAutoFocus: (event: Event) => void
    onCloseAutoFocus: (event: Event) => void
    onFocusCapture: () => void
  }
  /** 执行完列表项动作后立即收起弹层。 */
  close: () => void
  /**
   * 以键盘意图打开弹层：打开后焦点进入内容，Escape 可归还焦点。
   * 供没有独立 trigger 按钮、只靠 hover 展示的弹层保留键盘可达性。
   */
  openByKeyboard: () => void
}

export function composeEventHandlers<E extends React.SyntheticEvent>(
  first: ((event: E) => void) | undefined,
  second: (event: E) => void,
): (event: E) => void {
  return (event) => {
    first?.(event)
    second(event)
  }
}

export function useHoverPopover(options: UseHoverPopoverOptions = {}): HoverPopoverController {
  const { open: controlledOpen, onOpenChange, closeDelay = HOVER_POPOVER_CLOSE_DELAY } = options

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen

  // 受控与否在组件生命周期内固定；用 ref 读取可让回调保持稳定身份。
  const isControlledRef = React.useRef(controlledOpen !== undefined)
  const onOpenChangeRef = React.useRef(onOpenChange)
  const openRef = React.useRef(open)
  const closeTimerRef = React.useRef<number | null>(null)
  const openReasonRef = React.useRef<HoverPopoverOpenReason>('pointer')
  const focusWasInsideRef = React.useRef(false)

  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange
    openRef.current = open
  })

  const cancelScheduledClose = React.useCallback((): void => {
    if (closeTimerRef.current == null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const commitOpen = React.useCallback((next: boolean): void => {
    cancelScheduledClose()
    openRef.current = next
    if (!isControlledRef.current) setUncontrolledOpen(next)
    onOpenChangeRef.current?.(next)
  }, [cancelScheduledClose])

  const scheduleClose = React.useCallback((): void => {
    cancelScheduledClose()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      commitOpen(false)
    }, closeDelay)
  }, [cancelScheduledClose, closeDelay, commitOpen])

  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose])

  const handleHoverEnter = React.useCallback((): void => {
    if (!openRef.current) openReasonRef.current = 'hover'
    commitOpen(true)
  }, [commitOpen])

  const close = React.useCallback((): void => {
    commitOpen(false)
  }, [commitOpen])

  const openByKeyboard = React.useCallback((): void => {
    openReasonRef.current = 'keyboard'
    commitOpen(true)
  }, [commitOpen])

  return {
    open,
    onOpenChange: commitOpen,
    hoverProps: {
      onMouseEnter: handleHoverEnter,
      onMouseLeave: scheduleClose,
    },
    manualTriggerProps: {
      onPointerDown: () => {
        openReasonRef.current = 'pointer'
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') openReasonRef.current = 'keyboard'
      },
    },
    contentFocusProps: {
      onOpenAutoFocus: (event) => {
        if (openReasonRef.current === 'hover') event.preventDefault()
      },
      onCloseAutoFocus: (event) => {
        if (openReasonRef.current === 'hover' && !focusWasInsideRef.current) event.preventDefault()
        focusWasInsideRef.current = false
      },
      onFocusCapture: () => {
        focusWasInsideRef.current = true
      },
    },
    close,
    openByKeyboard,
  }
}
