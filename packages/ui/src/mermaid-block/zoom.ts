/**
 * Mermaid 图表缩放的纯函数工具
 *
 * 内联卡片与全屏预览共用同一套边界、步长和取整规则，
 * 避免两处缩放行为随迭代漂移。
 */

/** 缩放范围 */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3
/** 单次点击的缩放步长 */
export const ZOOM_STEP = 0.15
/** 初始缩放比例（100%） */
export const INITIAL_SCALE = 1

/**
 * 浮点累加会产生 1.1500000000000001 这类尾差，
 * 统一收敛到两位小数，保证反复缩放后仍能回到 100%。
 */
function roundScale(scale: number): number {
  return Math.round(scale * 100) / 100
}

/** 收敛到 [ZOOM_MIN, ZOOM_MAX] */
export function clampScale(scale: number): number {
  return roundScale(Math.min(Math.max(scale, ZOOM_MIN), ZOOM_MAX))
}

/** 放大一档 */
export function zoomIn(scale: number): number {
  return clampScale(scale + ZOOM_STEP)
}

/** 缩小一档 */
export function zoomOut(scale: number): number {
  return clampScale(scale - ZOOM_STEP)
}

/** 头部按钮显示的整数百分比，例如 115 */
export function toZoomPercent(scale: number): number {
  return Math.round(scale * 100)
}
