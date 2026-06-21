/**
 * Proma 内置记忆 MCP
 *
 * 运行时注入 MemOS Cloud 工具。配置来源仍沿用 memory-service，
 * 不写入工作区 mcp.json。
 */

import { getMemoryConfig } from '../memory-service'
import { addMemory, formatSearchResult, searchMemory } from '../memos-client'

export async function injectMemoryMcpServer(
  sdk: typeof import('@anthropic-ai/claude-agent-sdk'),
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<void> {
  const memoryConfig = getMemoryConfig()
  const memUserId = memoryConfig.userId?.trim() || 'proma-user'
  if (!memoryConfig.enabled || !memoryConfig.apiKey) return

  const { z } = await import('zod')
  const memosServer = sdk.createSdkMcpServer({
    name: 'mem',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'recall_memory',
        'Search user memories (facts and preferences) from MemOS Cloud. Use this to recall relevant context about the user.',
        { query: z.string().describe('Search query for memory retrieval'), limit: z.number().optional().describe('Max results (default 6)') },
        async (args) => {
          const result = await searchMemory(
            { apiKey: memoryConfig.apiKey, userId: memUserId, baseUrl: memoryConfig.baseUrl },
            args.query,
            args.limit,
          )
          return { content: [{ type: 'text' as const, text: formatSearchResult(result) }] }
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdk.tool(
        'add_memory',
        'Store a conversation message pair into MemOS Cloud for long-term memory. Call this after meaningful exchanges worth remembering.',
        {
          userMessage: z.string().describe('The user message to store'),
          assistantMessage: z.string().optional().describe('The assistant response to store'),
          conversationId: z.string().optional().describe('Conversation ID for grouping'),
          tags: z.array(z.string()).optional().describe('Tags for categorization'),
        },
        async (args) => {
          await addMemory(
            { apiKey: memoryConfig.apiKey, userId: memUserId, baseUrl: memoryConfig.baseUrl },
            args,
          )
          return { content: [{ type: 'text' as const, text: 'Memory stored successfully.' }] }
        },
      ),
    ],
  })

  mcpServers.mem = memosServer as unknown as Record<string, unknown>
  console.log('[Agent 编排] 已注入内置记忆工具 (mem)')
}
