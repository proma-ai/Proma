/**
 * 渲染进程模式判断工具
 *
 * 通过 Vite define 注入的 __PROMA_MODE__ 全局常量判断当前模式
 */

import type { PromaMode } from '@proma/shared/types'

/** 判断当前是否为 Cloud 模式（渲染进程） */
export function isCloudMode(): boolean {
  return __PROMA_MODE__ === 'cloud'
}

/** 获取当前运行模式（渲染进程） */
export function getPromaMode(): PromaMode {
  return __PROMA_MODE__
}
