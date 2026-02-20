/**
 * 渲染进程模式判断工具
 *
 * 商业版固定为 Cloud 模式。
 * 通过 import.meta.env.VITE_PROMA_MODE 读取（兼容 Vite dev/build）。
 */

import type { PromaMode } from '@proma/shared/types'

/** 判断当前是否为 Cloud 模式（渲染进程） */
export function isCloudMode(): boolean {
  return true
}

/** 获取当前运行模式（渲染进程） */
export function getPromaMode(): PromaMode {
  return 'cloud'
}
