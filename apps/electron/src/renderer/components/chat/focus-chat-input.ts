/** 在右侧 Chat 已渲染后聚焦指定会话的编辑器，避免误聚焦主区域的 Chat。 */
export function focusChatInput(conversationId: string): void {
  const selector = `[data-input-mode="chat"][data-conversation-id="${CSS.escape(conversationId)}"] .ProseMirror`
  const focus = (attemptsLeft: number): void => {
    const editor = document.querySelector<HTMLElement>(selector)
    if (editor) {
      editor.focus()
      return
    }
    // 新建会话会在切换右侧 Tab 后才挂载输入框；最多等待两帧，不轮询常驻。
    if (attemptsLeft > 0) requestAnimationFrame(() => focus(attemptsLeft - 1))
  }
  requestAnimationFrame(() => focus(1))
}
