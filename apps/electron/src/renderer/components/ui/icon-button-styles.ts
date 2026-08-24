/**
 * 图标按钮不使用描边式焦点环；调用方需结合自身主题补充 focus-visible 背景或颜色。
 * 鼠标点击不会残留边框，同时保留键盘焦点的非边框反馈。
 */
export const iconButtonNoRingFocusClass =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0'
