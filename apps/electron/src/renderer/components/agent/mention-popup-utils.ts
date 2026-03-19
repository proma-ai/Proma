/**
 * Mention Popup 工具函数
 *
 * 共享弹窗创建和定位逻辑，统一处理：
 * - 初始隐藏（防闪烁）
 * - rAF 定位后显示
 * - 右侧/顶部边界限制
 */

const POPUP_GAP = 4
const VIEWPORT_PADDING = 8

/** 创建弹窗容器并挂载到 body */
export function createMentionPopup(content: HTMLElement): HTMLDivElement {
  const popup = document.createElement('div')
  popup.style.position = 'absolute'
  popup.style.zIndex = '9999'
  popup.style.visibility = 'hidden'
  document.body.appendChild(popup)
  popup.appendChild(content)
  return popup
}

/** 定位弹窗到光标位置上方，含边界限制 */
export function positionPopup(
  popup: HTMLDivElement | null,
  rect: DOMRect | null | undefined,
): void {
  if (!rect || !popup) return

  requestAnimationFrame(() => {
    if (!popup) return

    const popupWidth = popup.offsetWidth
    const popupHeight = popup.offsetHeight

    // 水平定位：不超出右侧视口
    const left = Math.min(rect.left, window.innerWidth - popupWidth - VIEWPORT_PADDING)
    popup.style.left = `${Math.max(VIEWPORT_PADDING, left)}px`

    // 垂直定位：优先向上弹出，空间不足时向下
    const spaceAbove = rect.top
    if (spaceAbove >= popupHeight + POPUP_GAP) {
      popup.style.top = `${rect.top - popupHeight - POPUP_GAP}px`
    } else {
      popup.style.top = `${rect.bottom + POPUP_GAP}px`
    }

    popup.style.visibility = 'visible'
  })
}
