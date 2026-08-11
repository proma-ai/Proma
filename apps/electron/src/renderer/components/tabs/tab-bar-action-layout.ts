export interface TabBarActionLayout {
  scrollPaddingClassName: string
  shortcutPositionClassName: string
  panelPositionClassName: string
}

/**
 * 保持 Tab 栏右侧操作区与窗口控制按钮分离，同时为标签滚动区留出空间。
 */
export function getTabBarActionLayout(isWindows: boolean, hasPanelButton: boolean): TabBarActionLayout {
  if (!isWindows) {
    return {
      scrollPaddingClassName: hasPanelButton ? 'pr-20' : 'pr-10',
      shortcutPositionClassName: hasPanelButton
        ? 'inset-y-0 items-end pb-[3px] z-10 right-9'
        : 'inset-y-0 items-end pb-[3px] z-10 right-1',
      panelPositionClassName: 'inset-y-0 right-1 items-end pb-[3px] z-10',
    }
  }

  return {
    // 126px WindowControls + 60px 快捷操作区；文件面板按钮额外占用 28px 与 4px 间隔。
    scrollPaddingClassName: hasPanelButton ? 'pr-[218px]' : 'pr-[190px]',
    shortcutPositionClassName: hasPanelButton
      ? 'inset-y-0 items-end pb-[3px] z-10 right-[158px]'
      : 'inset-y-0 items-end pb-[3px] z-10 right-[130px]',
    panelPositionClassName: 'inset-y-0 right-[126px] items-end pb-[3px] z-10',
  }
}
