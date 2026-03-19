/**
 * Chat 工具注册表
 *
 * 管理所有可用的 Chat 工具：
 * - 内置工具（记忆、联网搜索）
 * - 自定义工具（用户配置的 HTTP 工具）
 *
 * 提供统一接口获取启用的工具定义和系统提示词。
 */

import type { ToolDefinition, ToolParameterProperty } from '@proma/core'
import type { ChatToolInfo, ChatToolMeta } from '@proma/shared'
import { getChatToolsConfig } from './chat-tool-config'
import {
  MEMORY_TOOL_META,
  MEMORY_TOOL_DEFINITIONS,
  isMemoryAvailable,
} from './chat-tools/memory-tool'
import {
  WEB_SEARCH_TOOL_META,
  WEB_SEARCH_TOOL_DEFINITIONS,
  isWebSearchAvailable,
} from './chat-tools/web-search-tool'
import {
  AGENT_RECOMMEND_TOOL_META,
  AGENT_RECOMMEND_TOOL_DEFINITIONS,
  isAgentRecommendAvailable,
} from './chat-tools/agent-recommend-tool'
import {
  NANO_BANANA_TOOL_META,
  NANO_BANANA_TOOL_DEFINITIONS,
  isNanoBananaAvailable,
} from './chat-tools/nano-banana-tool'

// ===== 内置工具注册 =====

/** 内置工具列表（元数据 + 获取 ToolDefinition 的方法） */
interface BuiltinToolEntry {
  meta: ChatToolMeta
  getDefinitions: () => ToolDefinition[]
  checkAvailable: () => boolean
}

/** 所有内置工具 */
const BUILTIN_TOOLS: BuiltinToolEntry[] = [
  {
    meta: MEMORY_TOOL_META,
    getDefinitions: () => MEMORY_TOOL_DEFINITIONS,
    checkAvailable: isMemoryAvailable,
  },
  {
    meta: WEB_SEARCH_TOOL_META,
    getDefinitions: () => WEB_SEARCH_TOOL_DEFINITIONS,
    checkAvailable: isWebSearchAvailable,
  },
  {
    meta: AGENT_RECOMMEND_TOOL_META,
    getDefinitions: () => AGENT_RECOMMEND_TOOL_DEFINITIONS,
    checkAvailable: isAgentRecommendAvailable,
  },
  {
    meta: NANO_BANANA_TOOL_META,
    getDefinitions: () => NANO_BANANA_TOOL_DEFINITIONS,
    checkAvailable: isNanoBananaAvailable,
  },
]

// ===== 自定义工具转换 =====

/**
 * 将 ChatToolMeta 转换为 ToolDefinition（Provider API 格式）
 *
 * 将简化的 params 格式映射为 JSON Schema。
 */
function convertMetaToDefinition(meta: ChatToolMeta): ToolDefinition {
  const properties: Record<string, ToolParameterProperty> = {}
  const required: string[] = []

  for (const param of meta.params) {
    const prop: ToolParameterProperty = {
      type: param.type,
      description: param.description,
    }
    if (param.enum && param.enum.length > 0) {
      prop.enum = param.enum
    }
    properties[param.name] = prop

    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    name: meta.id,
    description: meta.description,
    parameters: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
  }
}

// ===== 公开接口 =====

/** 获取启用工具的返回结果 */
export interface EnabledToolsResult {
  /** 合并后的工具定义列表 */
  tools: ToolDefinition[] | undefined
  /** 合并后的系统提示词追加 */
  systemPromptAppend: string | undefined
}

/**
 * 获取当前启用的工具定义
 *
 * 根据前端传入的 enabledToolIds 和配置文件中的开关状态，
 * 返回最终要注入到 API 请求中的工具定义和系统提示词。
 *
 * @param enabledToolIds 前端传入的启用工具 ID 列表
 * @returns 合并后的工具定义和系统提示词
 */
export function getEnabledTools(enabledToolIds?: string[]): EnabledToolsResult {
  // 未传入 enabledToolIds 时使用配置文件的开关状态
  const config = getChatToolsConfig()

  const allDefinitions: ToolDefinition[] = []
  const systemPromptParts: string[] = []

  for (const entry of BUILTIN_TOOLS) {
    const toolId = entry.meta.id
    const state = config.toolStates[toolId]

    // 检查工具是否启用（前端开关 + 配置开关）
    const isEnabledByUser = enabledToolIds ? enabledToolIds.includes(toolId) : (state?.enabled ?? false)
    if (!isEnabledByUser) continue

    // 检查工具是否可用（凭据已配置）
    if (!entry.checkAvailable()) continue

    // 收集工具定义
    allDefinitions.push(...entry.getDefinitions())

    // 收集系统提示词
    if (entry.meta.systemPromptAppend) {
      systemPromptParts.push(entry.meta.systemPromptAppend)
    }
  }

  // 自定义工具
  for (const customMeta of config.customTools) {
    const toolId = customMeta.id
    const isEnabledByUser = enabledToolIds
      ? enabledToolIds.includes(toolId)
      : (config.toolStates[toolId]?.enabled ?? false)
    if (!isEnabledByUser) continue

    // 自定义工具不需要凭据检查，httpConfig 即为配置
    allDefinitions.push(convertMetaToDefinition(customMeta))

    if (customMeta.systemPromptAppend) {
      systemPromptParts.push(customMeta.systemPromptAppend)
    }
  }

  return {
    tools: allDefinitions.length > 0 ? allDefinitions : undefined,
    systemPromptAppend: systemPromptParts.length > 0 ? systemPromptParts.join('\n') : undefined,
  }
}

/**
 * 获取所有工具信息（供前端展示）
 *
 * 返回所有内置 + 自定义工具的元数据、开关状态和可用性。
 */
export function getAllToolInfos(): ChatToolInfo[] {
  const config = getChatToolsConfig()
  const infos: ChatToolInfo[] = []

  // 内置工具
  for (const entry of BUILTIN_TOOLS) {
    const toolId = entry.meta.id
    const state = config.toolStates[toolId]

    infos.push({
      meta: entry.meta,
      enabled: state?.enabled ?? false,
      available: entry.checkAvailable(),
    })
  }

  // 自定义工具
  for (const customMeta of config.customTools) {
    const state = config.toolStates[customMeta.id]

    infos.push({
      meta: customMeta,
      enabled: state?.enabled ?? false,
      available: !!customMeta.httpConfig,
    })
  }

  return infos
}
