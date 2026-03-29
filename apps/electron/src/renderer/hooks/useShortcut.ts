/**
 * useShortcut — 快捷键 React Hook
 *
 * 将快捷键 handler 绑定到 React 组件生命周期。
 * 组件卸载时自动注销。
 */

import { useEffect } from 'react'
import { registerShortcut } from '@/lib/shortcut-registry'

/**
 * 注册一个快捷键 handler
 *
 * @param id - 快捷键 ID（对应 shortcut-defaults.ts 中的定义）
 * @param callback - 触发时的回调
 * @param enabled - 是否启用（默认 true）
 */
export function useShortcut(
  id: string,
  callback: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    return registerShortcut(id, callback)
  }, [id, callback, enabled])
}
