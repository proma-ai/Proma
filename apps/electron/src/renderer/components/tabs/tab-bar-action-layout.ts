export interface TabBarActionLayout {
  scrollPaddingClassName: string
  shortcutPositionClassName: string
  panelPositionClassName: string
}

/** 保持 Tab 栏右侧操作区与标签滚动区分离。窗口控制按钮位于全局顶部标题栏。 */
export function getTabBarActionLayout(hasPanelButton: boolean, hasBrowserButton = false): TabBarActionLayout {
  return {
    scrollPaddingClassName: hasPanelButton
      ? (hasBrowserButton ? 'pr-28' : 'pr-20')
      : (hasBrowserButton ? 'pr-20' : 'pr-10'),
    shortcutPositionClassName: hasPanelButton
      ? 'inset-y-0 items-end pb-[3px] z-10 right-9'
      : 'inset-y-0 items-end pb-[3px] z-10 right-1',
    panelPositionClassName: 'inset-y-0 right-1 items-end pb-[3px] z-10',
  }
}
