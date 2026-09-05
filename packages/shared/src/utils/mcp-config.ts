import type { WorkspaceMcpConfig } from '../types/agent'

/**
 * Removes one MCP entry without changing the configuration or enablement state
 * of every other server.
 */
export function removeMcpServerFromConfig(
  config: WorkspaceMcpConfig,
  name: string,
): WorkspaceMcpConfig {
  const servers = { ...config.servers }
  delete servers[name]
  return { servers }
}
