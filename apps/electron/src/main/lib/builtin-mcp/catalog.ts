/**
 * Proma 内置 MCP 能力目录
 *
 * 这里只维护可展示的元数据和可用性判断，不负责运行时注入。
 * 元数据本身来自 default-mcp.json（经 baseline 加载），本文件只在其上叠加
 * 运行时可用性判断（API Key、工作区、登录态等）。这样前端能力摘要可以安全读取
 * 内置 MCP 列表，而不会引入 Agent 编排层循环依赖。
 */

import type { BuiltinMcpServerSummary } from '@proma/shared'
import { getToolCredentials, getToolState } from '../chat-tool-config'
import { getMemoryConfig } from '../memory-service'
import { getBuiltinMcpDefinitions, type BuiltinMcpDefinition } from './baseline'
import { isBuiltinMcpDefaultDisabled, isBuiltinMcpUserEnabled } from './settings'

interface BuiltinMcpListContext {
  workspaceSlug?: string
}

function resolveAvailability(
  item: BuiltinMcpDefinition,
  ctx: BuiltinMcpListContext,
): Pick<BuiltinMcpServerSummary, 'enabled' | 'available' | 'availabilityReason'> {
  // 基础设施型（如 proma-cloud）：登录后始终注入，不受用户开关影响
  if (item.toggleable === false) {
    return { enabled: true, available: true }
  }

  const userEnabled = isBuiltinMcpUserEnabled(item.id)
  if (!userEnabled) {
    return {
      enabled: false,
      available: false,
      availabilityReason: isBuiltinMcpDefaultDisabled(item.id)
        ? '默认关闭，可手动开启'
        : '已手动关闭',
    }
  }

  if (item.id === 'collaboration') {
    const available = !!ctx.workspaceSlug
    return {
      enabled: true,
      available,
      availabilityReason: available ? undefined : '需要先选择工作区',
    }
  }

  if (item.id === 'mem') {
    const config = getMemoryConfig()
    const available = config.enabled && !!config.apiKey
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : config.enabled ? '需要配置 MemOS API Key' : '记忆工具未启用',
    }
  }

  if (item.id === 'nano-banana') {
    const state = getToolState('nano-banana')
    const credentials = getToolCredentials('nano-banana')
    const available = state.enabled && !!credentials.apiKey
    return {
      enabled: true,
      available,
      availabilityReason: available
        ? undefined
        : state.enabled ? '需要配置 Gemini API Key' : 'Nano Banana 未启用',
    }
  }

  return { enabled: true, available: true }
}

export function listBuiltinMcpServers(ctx: BuiltinMcpListContext = {}): BuiltinMcpServerSummary[] {
  return getBuiltinMcpDefinitions().map((item) => ({
    id: item.id,
    name: item.name,
    displayName: item.displayName,
    description: item.description,
    category: item.category,
    tools: item.tools,
    toggleable: item.toggleable,
    ...resolveAvailability(item, ctx),
  }))
}
