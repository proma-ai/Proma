/**
 * 应用生命周期共享状态
 *
 * 抽取退出标志为独立模块，避免循环依赖。
 */

/** 是否正在退出应用（用于区分关闭窗口和退出应用） */
let _isQuitting = false

export function getIsQuitting(): boolean {
  return _isQuitting
}

export function setQuitting(value = true): void {
  _isQuitting = value
}
