/**
 * SettingsUIConstants - 设置界面统一样式 token
 *
 * 集中管理设置组件中使用的 Tailwind class，
 * 确保所有设置页面保持一致的视觉语言。
 */

/** 标签样式 */
export const LABEL_CLASS = 'text-sm font-medium text-foreground'

/** 描述文字样式 */
export const DESCRIPTION_CLASS = 'text-sm text-muted-foreground'

/** 区块标题样式 */
export const SECTION_TITLE_CLASS = 'text-base font-semibold text-foreground'

/** 区块描述样式 */
export const SECTION_DESCRIPTION_CLASS = 'text-sm text-muted-foreground mt-1'

/** 卡片容器样式 - 只有默认深色主题用透明，其他都用卡片背景 */
export const CARD_CLASS = 'rounded-xl overflow-hidden settings-card'

/** 卡片内行样式 */
export const ROW_CLASS = 'flex items-center justify-between px-4 py-3'

/** 卡片内分隔线样式 */
export const DIVIDER_CLASS = 'border-border/50'
