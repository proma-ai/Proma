/**
 * Proma 内置 MCP 能力目录
 *
 * 这里只维护可展示的元数据和可用性判断，不负责运行时注入。
 * 这样前端能力摘要可以安全读取内置 MCP 列表，而不会引入 Agent 编排层循环依赖。
 */

import type { BuiltinMcpServerSummary, McpToolSummary } from '@proma/shared'
import { getToolCredentials, getToolState } from '../chat-tool-config'
import { getMemoryConfig } from '../memory-service'
import { isBuiltinMcpUserEnabled } from './settings'

interface BuiltinMcpCatalogItem {
  id: string
  name: string
  displayName: string
  description: string
  category: BuiltinMcpServerSummary['category']
  tools: McpToolSummary[]
}

interface BuiltinMcpListContext {
  workspaceSlug?: string
}

const BUILTIN_MCP_CATALOG: BuiltinMcpCatalogItem[] = [
  {
    id: 'automation',
    name: 'automation',
    displayName: '定时任务',
    description: '创建、查看、更新、删除和立即运行 Proma 持久化定时任务。',
    category: 'automation',
    tools: [
      { name: 'list_automations', description: '列出 Proma 定时任务。', readOnly: true },
      { name: 'get_automation', description: '读取单个定时任务详情和运行记录。', readOnly: true },
      { name: 'create_automation', description: '创建持久化定时任务。' },
      { name: 'update_automation', description: '更新定时任务配置。' },
      { name: 'delete_automation', description: '删除定时任务。' },
      { name: 'run_automation_now', description: '立即运行一次定时任务。' },
    ],
  },
  {
    id: 'collaboration',
    name: 'collaboration',
    displayName: '协作子 Agent',
    description: '创建、等待、读取和停止真实可见的 Proma 协作子 Agent 会话。',
    category: 'collaboration',
    tools: [
      { name: 'list_available_agent_models', description: '列出当前渠道下可用于协作子 Agent 的模型。', readOnly: true },
      { name: 'delegate_agent', description: '创建单个协作子 Agent 会话。' },
      { name: 'delegate_agents', description: '批量创建协作子 Agent 会话。' },
      { name: 'wait_for_delegations', description: '等待一组协作子会话完成。', readOnly: true },
      { name: 'list_delegations', description: '列出当前父会话创建的子会话。', readOnly: true },
      { name: 'get_delegation_results', description: '按委派 ID 读取子会话结果摘要。', readOnly: true },
      { name: 'stop_delegation', description: '停止单个协作子会话。' },
      { name: 'stop_delegations', description: '批量停止协作子会话。' },
    ],
  },
  {
    id: 'mem',
    name: 'mem',
    displayName: '记忆',
    description: '通过 MemOS Cloud 检索和写入长期记忆。',
    category: 'memory',
    tools: [
      { name: 'recall_memory', description: '检索用户长期记忆。', readOnly: true },
      { name: 'add_memory', description: '写入一条长期记忆。' },
    ],
  },
  {
    id: 'nano-banana',
    name: 'nano-banana',
    displayName: 'Nano Banana 生图',
    description: '通过 Gemini Image Generation 为 Agent 提供图片生成和编辑能力。',
    category: 'media',
    tools: [
      { name: 'generate_image', description: '生成或编辑图片。' },
    ],
  },
]

function resolveAvailability(
  item: BuiltinMcpCatalogItem,
  ctx: BuiltinMcpListContext,
): Pick<BuiltinMcpServerSummary, 'enabled' | 'available' | 'availabilityReason'> {
  const userEnabled = isBuiltinMcpUserEnabled(item.id)
  if (!userEnabled) {
    return {
      enabled: false,
      available: false,
      availabilityReason: '已手动关闭',
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
  return BUILTIN_MCP_CATALOG.map((item) => ({
    ...item,
    ...resolveAvailability(item, ctx),
  }))
}
