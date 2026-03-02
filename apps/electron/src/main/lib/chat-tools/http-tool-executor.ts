/**
 * HTTP 工具执行器（自定义工具用）
 *
 * 根据 ChatToolMeta 中的 httpConfig 配置执行 HTTP 请求。
 * 支持 URL/Body 模板占位符替换、超时控制、响应路径提取。
 */

import type { ToolCall, ToolResult } from '@proma/core'
import type { ChatToolMeta, ChatToolHttpConfig } from '@proma/shared'
import { getChatToolsConfig } from '../chat-tool-config'

/** HTTP 请求超时（30 秒） */
const HTTP_TIMEOUT_MS = 30_000

/**
 * 判断是否为自定义 HTTP 工具调用
 *
 * 通过查找 customTools 配置判断 toolName 是否属于自定义工具。
 */
export function isCustomHttpToolCall(toolName: string): boolean {
  const config = getChatToolsConfig()
  return config.customTools.some((t) => t.id === toolName)
}

/**
 * 替换模板中的 {{paramName}} 占位符
 *
 * @param template 模板字符串
 * @param args 参数键值对
 * @param urlEncode 是否对值做 URL 编码
 */
function replaceTemplatePlaceholders(
  template: string,
  args: Record<string, unknown>,
  urlEncode: boolean,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, paramName: string) => {
    const value = args[paramName]
    const str = value != null ? String(value) : ''
    return urlEncode ? encodeURIComponent(str) : str
  })
}

/**
 * 通过点号路径提取嵌套对象的值
 *
 * @param obj 源对象
 * @param path 点号路径（如 "data.results"）
 * @returns 提取的值，路径不存在时返回 undefined
 */
function extractByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * 执行自定义 HTTP 工具调用
 *
 * @param toolCall 模型返回的工具调用
 * @param meta 工具元数据（包含 httpConfig）
 * @returns 工具执行结果
 */
export async function executeHttpTool(toolCall: ToolCall, meta: ChatToolMeta): Promise<ToolResult> {
  const httpConfig = meta.httpConfig

  if (!httpConfig) {
    return {
      toolCallId: toolCall.id,
      content: `工具 ${meta.id} 缺少 HTTP 配置`,
      isError: true,
    }
  }

  try {
    const result = await executeHttpRequest(toolCall.arguments, httpConfig)
    return {
      toolCallId: toolCall.id,
      content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[HTTP 工具] ${meta.id} 执行失败:`, error)
    return {
      toolCallId: toolCall.id,
      content: `HTTP 请求失败: ${msg}`,
      isError: true,
    }
  }
}

/**
 * 执行 HTTP 请求
 */
async function executeHttpRequest(
  args: Record<string, unknown>,
  config: ChatToolHttpConfig,
): Promise<unknown> {
  // URL 占位符替换（URL 编码）
  const url = replaceTemplatePlaceholders(config.urlTemplate, args, true)

  // 请求头
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers,
  }

  // 请求配置
  const fetchInit: RequestInit = {
    method: config.method,
    headers,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  }

  // POST 请求体
  if (config.method === 'POST' && config.bodyTemplate) {
    fetchInit.body = replaceTemplatePlaceholders(config.bodyTemplate, args, false)
  }

  const response = await fetch(url, fetchInit)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  // 解析响应
  const contentType = response.headers.get('content-type') || ''
  let data: unknown

  if (contentType.includes('application/json')) {
    data = await response.json()
  } else {
    data = await response.text()
  }

  // 路径提取
  if (config.resultPath && typeof data === 'object' && data !== null) {
    const extracted = extractByPath(data, config.resultPath)
    return extracted !== undefined ? extracted : data
  }

  return data
}
