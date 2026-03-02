/**
 * 记忆工具模块（Chat 模式）
 *
 * 从 chat-service.ts 提取的记忆工具定义和执行逻辑。
 * 凭据通过 getMemoryConfig() 从 memory.json 读取（Chat + Agent 共用）。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@proma/core'
import type { ChatToolMeta } from '@proma/shared'
import { getMemoryConfig } from '../memory-service'
import { searchMemory, addMemory, formatSearchResult } from '../memos-client'

// ===== 工具元数据 =====

export const MEMORY_TOOL_META: ChatToolMeta = {
  id: 'memory',
  name: '记忆',
  description: '跨会话记忆能力，记住用户偏好和重要信息',
  params: [
    { name: 'query', type: 'string', description: '搜索查询', required: true },
  ],
  icon: 'Brain',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<memory_instructions>
你拥有跨会话的记忆能力。

**recall_memory — 回忆：**
在你觉得过去的经历可能对当前有帮助时主动调用：
- 用户提到"之前"、"上次"等回溯性表述
- 当前任务可能和过去做过的事情有关

**add_memory — 记住：**
当对话中发生值得记住的事时调用：
- 用户分享了工作方式或偏好
- 一起做了重要决定
- 解决了棘手问题

自然地运用记忆，不要提及"记忆系统"等内部概念。
</memory_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式，传给 Provider） =====

export const MEMORY_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'recall_memory',
    description: 'Search user memories (facts and preferences). Use this to recall relevant context about the user before responding.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for memory retrieval' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_memory',
    description: 'Store a conversation message pair for long-term memory. Call this after meaningful exchanges worth remembering.',
    parameters: {
      type: 'object',
      properties: {
        userMessage: { type: 'string', description: 'The user message to store' },
        assistantMessage: { type: 'string', description: 'The assistant response to store' },
      },
      required: ['userMessage'],
    },
  },
]

// ===== 可用性检查 =====

/**
 * 检查记忆工具是否可用（凭据已配置）
 */
export function isMemoryAvailable(): boolean {
  const config = getMemoryConfig()
  return !!config.apiKey
}

// ===== 工具执行 =====

/** 记忆工具名称集合 */
const MEMORY_TOOL_NAMES = new Set(['recall_memory', 'add_memory'])

/**
 * 判断是否为记忆工具调用
 */
export function isMemoryToolCall(toolName: string): boolean {
  return MEMORY_TOOL_NAMES.has(toolName)
}

/**
 * 执行记忆工具调用
 */
export async function executeMemoryTool(toolCall: ToolCall): Promise<ToolResult> {
  const memoryConfig = getMemoryConfig()
  const credentials = {
    apiKey: memoryConfig.apiKey,
    userId: memoryConfig.userId?.trim() || 'proma-user',
    baseUrl: memoryConfig.baseUrl,
  }

  try {
    if (toolCall.name === 'recall_memory') {
      const query = toolCall.arguments.query as string
      const result = await searchMemory(credentials, query)
      return {
        toolCallId: toolCall.id,
        content: formatSearchResult(result),
      }
    } else if (toolCall.name === 'add_memory') {
      const userMessage = toolCall.arguments.userMessage as string
      const assistantMessage = toolCall.arguments.assistantMessage as string | undefined
      await addMemory(credentials, { userMessage, assistantMessage })
      return {
        toolCallId: toolCall.id,
        content: 'Memory stored successfully.',
      }
    }
    return {
      toolCallId: toolCall.id,
      content: `未知记忆工具: ${toolCall.name}`,
      isError: true,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[记忆工具] 执行失败 (${toolCall.name}):`, error)
    return {
      toolCallId: toolCall.id,
      content: `Tool execution failed: ${msg}`,
      isError: true,
    }
  }
}
