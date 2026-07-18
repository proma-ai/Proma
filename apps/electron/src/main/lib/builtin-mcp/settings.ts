/**
 * Proma 内置 MCP 开关设置
 *
 * 大部分内置 MCP 默认开启，由 builtinMcpDisabledIds 黑名单管理关闭项；
 * 少数内置 MCP（DEFAULT_DISABLED_IDS）默认关闭，由 builtinMcpEnabledIds 白名单
 * 管理用户手动开启的项。是否真正可用（如 API Key）仍由各 MCP 自己的配置判断。
 */

import { getSettings, updateSettings } from '../settings-service'

/**
 * 默认关闭的内置 MCP ID。
 * 这些 MCP 需要用户额外配置（如 API Key）才有意义，默认不向 Agent 注入，
 * 需用户在能力列表中手动开启。
 */
const DEFAULT_DISABLED_IDS = new Set<string>(['nano-banana', 'chrome-devtools'])

/** 判断某个内置 MCP 是否默认关闭（需用户手动开启） */
export function isBuiltinMcpDefaultDisabled(id: string): boolean {
  return DEFAULT_DISABLED_IDS.has(id)
}

export function isBuiltinMcpUserEnabled(id: string): boolean {
  if (DEFAULT_DISABLED_IDS.has(id)) {
    // 默认关闭：仅当用户显式加入白名单时才启用
    return (getSettings().builtinMcpEnabledIds ?? []).includes(id)
  }
  // 默认开启:仅当用户显式加入黑名单时才关闭
  return !(getSettings().builtinMcpDisabledIds ?? []).includes(id)
}

export function setBuiltinMcpUserEnabled(id: string, enabled: boolean): void {
  if (DEFAULT_DISABLED_IDS.has(id)) {
    const enabledIds = new Set(getSettings().builtinMcpEnabledIds ?? [])
    if (enabled) {
      enabledIds.add(id)
    } else {
      enabledIds.delete(id)
    }
    updateSettings({ builtinMcpEnabledIds: Array.from(enabledIds).sort() })
    return
  }

  const disabledIds = new Set(getSettings().builtinMcpDisabledIds ?? [])
  if (enabled) {
    disabledIds.delete(id)
  } else {
    disabledIds.add(id)
  }

  updateSettings({ builtinMcpDisabledIds: Array.from(disabledIds).sort() })
}
