/**
 * 联网搜索工具模块（Chat 模式）
 *
 * 基于 Tavily Search API 提供实时联网搜索能力。
 * 凭据存储在 ~/.proma/chat-tools.json 的 toolCredentials 中。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@proma/core'
import type { ChatToolMeta } from '@proma/shared'
import { getToolCredentials } from '../chat-tool-config'

// ===== 工具元数据 =====

export const WEB_SEARCH_TOOL_META: ChatToolMeta = {
  id: 'web-search',
  name: '联网搜索',
  description: '实时搜索互联网获取最新信息',
  params: [
    { name: 'query', type: 'string', description: '搜索查询', required: true },
  ],
  icon: 'Globe',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<web_search_instructions>
你拥有联网搜索能力。

**web_search — 搜索：**
当用户询问你不确定或可能过时的信息时主动调用：
- 时事新闻、最新数据、实时信息
- 你不确定的事实性问题
- 用户明确要求搜索或查找信息

搜索时使用简洁明确的关键词，返回结果后综合整理回答用户。
</web_search_instructions>`,
}

// ===== 工具定义（ToolDefinition 格式，传给 Provider） =====

export const WEB_SEARCH_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the internet for real-time information. Use this when the user asks about current events, recent data, or information you are unsure about.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
      },
      required: ['query'],
    },
  },
]

// ===== 可用性检查 =====

/**
 * 检查搜索工具是否可用（API Key 已配置）
 */
export function isWebSearchAvailable(): boolean {
  const credentials = getToolCredentials('web-search')
  return !!credentials.apiKey
}

// ===== 工具执行 =====

/** 搜索工具名称集合 */
const WEB_SEARCH_TOOL_NAMES = new Set(['web_search'])

/**
 * 判断是否为搜索工具调用
 */
export function isWebSearchToolCall(toolName: string): boolean {
  return WEB_SEARCH_TOOL_NAMES.has(toolName)
}

/** Tavily API 搜索结果类型 */
interface TavilySearchResult {
  title: string
  url: string
  content: string
  score: number
}

interface TavilySearchResponse {
  results: TavilySearchResult[]
  answer?: string
}

/**
 * 执行联网搜索工具调用
 */
export async function executeWebSearchTool(toolCall: ToolCall): Promise<ToolResult> {
  const credentials = getToolCredentials('web-search')

  if (!credentials.apiKey) {
    return {
      toolCallId: toolCall.id,
      content: '搜索工具未配置 API Key',
      isError: true,
    }
  }

  try {
    const query = toolCall.arguments.query as string | undefined

    if (!query) {
      return {
        toolCallId: toolCall.id,
        content: '搜索参数缺失: query',
        isError: true,
      }
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: credentials.apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        toolCallId: toolCall.id,
        content: `搜索请求失败 (${response.status}): ${errorText}`,
        isError: true,
      }
    }

    const data = await response.json() as TavilySearchResponse
    return {
      toolCallId: toolCall.id,
      content: formatSearchResults(data),
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[联网搜索] 执行失败:`, error)
    return {
      toolCallId: toolCall.id,
      content: `Search failed: ${msg}`,
      isError: true,
    }
  }
}

/**
 * 格式化搜索结果为 LLM 可读文本
 */
function formatSearchResults(data: TavilySearchResponse): string {
  const parts: string[] = []

  if (data.answer) {
    parts.push(`**概要：** ${data.answer}`)
    parts.push('')
  }

  if (data.results && data.results.length > 0) {
    parts.push('**搜索结果：**')
    for (const result of data.results) {
      parts.push(`- [${result.title}](${result.url})`)
      parts.push(`  ${result.content.slice(0, 300)}`)
      parts.push('')
    }
  } else {
    parts.push('未找到相关结果。')
  }

  return parts.join('\n')
}
