/**
 * Desktop Control MCP builtin server backed by the bundled cua-driver binary.
 */

import { getSettings } from '../settings-service'
import { resolveCuaDriverMcpServerConfig } from '../cua-driver-runtime'
import { getBuiltinMcpName } from './baseline'

export const DESKTOP_CONTROL_MCP_ID = 'desktop-control'

export function injectDesktopControlMcpServer(
  mcpServers: Record<string, Record<string, unknown>>,
  runtimeEnv?: Record<string, string>,
): void {
  if (getSettings().desktopAutomation?.enabled !== true) return

  const name = getBuiltinMcpName(DESKTOP_CONTROL_MCP_ID)
  if (mcpServers[name]) return

  mcpServers[name] = resolveCuaDriverMcpServerConfig(runtimeEnv)
}
