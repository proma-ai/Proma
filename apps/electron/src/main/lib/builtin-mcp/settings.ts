/**
 * Proma 内置 MCP 开关设置
 *
 * 仅管理用户是否允许注入某个内置 MCP。依赖是否可用（如 API Key）
 * 由各 MCP 自己的配置判断。
 */

import { getSettings, updateSettings } from '../settings-service'

export function isBuiltinMcpUserEnabled(id: string): boolean {
  return !(getSettings().builtinMcpDisabledIds ?? []).includes(id)
}

export function setBuiltinMcpUserEnabled(id: string, enabled: boolean): void {
  const disabledIds = new Set(getSettings().builtinMcpDisabledIds ?? [])
  if (enabled) {
    disabledIds.delete(id)
  } else {
    disabledIds.add(id)
  }

  updateSettings({ builtinMcpDisabledIds: Array.from(disabledIds).sort() })
}
