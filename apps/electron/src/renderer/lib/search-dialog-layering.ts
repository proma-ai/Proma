/** 搜索弹窗各 Portal 层级，项目菜单必须高于弹窗本体。 */
export const SEARCH_DIALOG_LAYERS = {
  overlay: 99,
  dialog: 100,
  scopeMenu: 110,
} as const

/** 外层 Dialog 已负责交互边界，嵌套菜单不再重复锁定 body。 */
export const SEARCH_SCOPE_MENU_MODAL = false
