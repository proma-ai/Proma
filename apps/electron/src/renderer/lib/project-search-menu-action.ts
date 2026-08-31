export type OpenProjectSearch = (workspaceId: string, workspaceName: string) => void

export interface MutableBooleanFlag {
  current: boolean
}

export interface PreventableEvent {
  preventDefault: () => void
}

/**
 * 等待 Radix DropdownMenu 完成关闭与焦点恢复后再打开项目搜索。
 * 同步打开非模态 Dialog 会被菜单的 close autofocus 立即关闭。
 */
export function scheduleProjectSearchOpen(
  openProjectSearch: OpenProjectSearch,
  workspaceId: string,
  workspaceName: string,
): void {
  setTimeout(() => openProjectSearch(workspaceId, workspaceName), 0)
}

/** 仅消费项目搜索触发的菜单关闭，避免焦点恢复把新打开的非模态 Dialog 关闭。 */
export function consumeProjectSearchMenuCloseAutoFocus(
  pendingProjectSearch: MutableBooleanFlag,
  event: PreventableEvent,
): void {
  if (!pendingProjectSearch.current) return
  pendingProjectSearch.current = false
  event.preventDefault()
}
