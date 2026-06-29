/**
 * Mention Popup 工具函数
 *
 * 共享弹窗创建和定位逻辑，统一处理：
 * - 初始隐藏（防闪烁）
 * - rAF 定位后显示
 * - 右侧/顶部边界限制
 * - 可选底部锚定（弹窗向上生长）
 */

import type { Editor } from '@tiptap/react'

const POPUP_GAP = 4
const VIEWPORT_PADDING = 8

/**
 * 校验 suggestion 触发符是否仍存在于编辑器「当前」文档的指定 range。
 *
 * 用于防御 TipTap suggestion 的异步竞态：插件的 view.update 是 async，handleStart
 * 阶段会 `await items()`（Proma 的 items 走 IPC，耗时）。若在 await 期间用户删除了
 * 触发符（如打了 `/` 又立刻删掉 / 全选删除），suggestion 已触发 onExit 并变为
 * inactive；但 await 返回后插件仍会用「过期 props」调用 onStart。此时若继续建弹窗，
 * 会留下一个 plugin state 已 inactive、连 Esc（handleKeyDown 在 !active 时直接返回）
 * 都无法关闭的「幽灵弹窗」。各 onStart 开头调用此函数，过期则跳过建弹窗。
 */
export function isSuggestionTriggerPresent(
  editor: Editor,
  range: { from: number; to: number },
  char: string,
): boolean {
  const { from, to } = range
  const docSize = editor.state.doc.content.size
  if (from < 0 || to <= from || to > docSize) return false
  return editor.state.doc.textBetween(from, to, '', '').startsWith(char)
}

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

export interface PositionOptions {
  /** 底部锚定：弹窗底部固定对齐光标上方，高度变化时向上生长 */
  anchorBottom?: boolean
}

/** 定位弹窗到光标位置 */
export function positionPopup(
  popup: HTMLDivElement | null,
  rect: DOMRect | null | undefined,
  options?: PositionOptions,
): void {
  if (!rect || !popup) return

  requestAnimationFrame(() => {
    if (!popup) return

    const popupWidth = popup.offsetWidth
    const popupHeight = popup.offsetHeight

    // 水平定位：不超出右侧视口
    const left = Math.min(rect.left, window.innerWidth - popupWidth - VIEWPORT_PADDING)
    popup.style.left = `${Math.max(VIEWPORT_PADDING, left)}px`

    if (options?.anchorBottom) {
      // 底部锚定：弹窗底部固定在光标上方，向上生长
      const bottom = rect.top - POPUP_GAP
      let top = bottom - popupHeight
      if (top < VIEWPORT_PADDING) {
        top = VIEWPORT_PADDING
      }
      popup.style.top = `${top}px`
    } else {
      // 垂直定位：优先向上弹出，空间不足时向下
      const spaceAbove = rect.top
      if (spaceAbove >= popupHeight + POPUP_GAP) {
        popup.style.top = `${rect.top - popupHeight - POPUP_GAP}px`
      } else {
        popup.style.top = `${rect.bottom + POPUP_GAP}px`
      }
    }

    popup.style.visibility = 'visible'
  })
}
