/**
 * Proma 可配置内置能力开关。
 *
 * 这里只有需要用户配置凭据或显式启用的能力；自动化与协作属于 Pi runtime
 * 基础工具，始终按会话上下文注入，不在此处登记或展示。
 */

import { getSettings, updateSettings } from '../settings-service'

const NANO_BANANA_ID = 'nano-banana'

/** Nano Banana 默认关闭，配置好 Gemini 后由用户显式启用。 */
export function isBuiltinMcpDefaultDisabled(id: string): boolean {
  return id === NANO_BANANA_ID
}

export function isBuiltinMcpUserEnabled(id: string): boolean {
  return id === NANO_BANANA_ID && (getSettings().builtinMcpEnabledIds ?? []).includes(id)
}

export function setBuiltinMcpUserEnabled(id: string, enabled: boolean): void {
  if (id !== NANO_BANANA_ID) throw new Error(`不支持配置内置能力：${id}`)

  const enabledIds = new Set(getSettings().builtinMcpEnabledIds ?? [])
  if (enabled) enabledIds.add(id)
  else enabledIds.delete(id)
  updateSettings({ builtinMcpEnabledIds: Array.from(enabledIds).sort() })
}
