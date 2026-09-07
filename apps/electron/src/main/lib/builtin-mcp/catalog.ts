/**
 * Proma 内置 MCP 能力目录。
 *
 * 元数据来自 default-mcp.json。旧搜索、生图的凭据与开关不再参与能力目录，
 * 外部 MCP 仍由工作区配置管理。
 */

import type { BuiltinMcpServerSummary } from '@proma/shared'
import { getBuiltinMcpDefinitions } from './baseline'

export function listBuiltinMcpServers(): BuiltinMcpServerSummary[] {
  return getBuiltinMcpDefinitions().map((item) => ({
    id: item.id,
    name: item.name,
    displayName: item.displayName,
    description: item.description,
    category: item.category,
    tools: item.tools,
    toggleable: item.toggleable,
    enabled: item.defaultEnabled,
    available: item.defaultEnabled,
  }))
}
