/**
 * 应用生命周期共享状态
 *
 * 抽取退出/更新标志为独立模块，避免 index.ts ↔ auto-updater.ts 循环依赖。
 */

/** 是否正在退出应用（用于区分关闭窗口和退出应用） */
let _isQuitting = false

/** 是否正在安装更新（防止 before-quit 中额外操作破坏安装流程） */
let _isUpdating = false

export function getIsQuitting(): boolean {
  return _isQuitting
}

export function setQuitting(value = true): void {
  _isQuitting = value
}

export function isUpdating(): boolean {
  return _isUpdating
}

export function setUpdating(value: boolean): void {
  _isUpdating = value
}
