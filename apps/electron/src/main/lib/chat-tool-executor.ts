/**
 * Chat 工具统一执行器
 *
 * 统一分发工具调用到对应的执行模块。
 * 替代 chat-service.ts 中硬编码的 if/else 分支。
 */

import type { ToolCall, ToolResult } from '@proma/core'
import type { WebContents } from 'electron'
import type { FileAttachment } from '@proma/shared'
import { CHAT_IPC_CHANNELS } from '@proma/shared'
import { isCustomHttpToolCall, executeHttpTool } from './chat-tools/http-tool-executor'
import { isAgentRecommendToolCall, executeAgentRecommendTool } from './chat-tools/agent-recommend-tool'
import { isGptImage2ToolCall, executeGptImage2Tool } from './chat-tools/gpt-image-2-tool' // [Proma Cloud]
import type { GptImage2Context } from './chat-tools/gpt-image-2-tool' // [Proma Cloud]
import { getChatToolsConfig } from './chat-tool-config'

/** 工具执行上下文 */
export interface ToolExecutionContext {
  /** webContents 用于推送工具活动事件 */
  webContents: WebContents
  /** 对话 ID */
  conversationId: string
  /** 当前用户消息的附件列表 */
  currentAttachments?: FileAttachment[]
  /**
   * 最近 N 轮对话中所有消息的附件（user + assistant），按时间倒序
   * 由 chat-service 提取，供 GPT Image 2 等多轮参考图工具使用
   */
  recentRoundsAttachments?: FileAttachment[]
}

/**
 * 执行工具调用列表
 *
 * 依次执行每个工具调用，推送活动事件给前端，返回所有结果。
 *
 * @param toolCalls 模型返回的工具调用列表
 * @param context 执行上下文
 * @returns 工具执行结果列表
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolExecutionContext,
): Promise<ToolResult[]> {
  const results: ToolResult[] = []

  for (const tc of toolCalls) {
    let result: ToolResult

    if (isAgentRecommendToolCall(tc.name)) {
      result = await executeAgentRecommendTool(tc)
    // [Proma Cloud] GPT Image 2 tool dispatch
    } else if (isGptImage2ToolCall(tc.name)) {
      const gptImageContext: GptImage2Context = {
        conversationId: context.conversationId,
        currentAttachments: context.currentAttachments,
        recentRoundsAttachments: context.recentRoundsAttachments,
      }
      result = await executeGptImage2Tool(tc, gptImageContext)
    } else if (isCustomHttpToolCall(tc.name)) {
      const config = getChatToolsConfig()
      const meta = config.customTools.find((t) => t.id === tc.name)
      result = meta
        ? await executeHttpTool(tc, meta)
        : { toolCallId: tc.id, content: `自定义工具未找到: ${tc.name}`, isError: true }
    } else {
      // 未知工具
      console.warn(`[Chat 工具执行器] 未知工具: ${tc.name}`)
      result = {
        toolCallId: tc.id,
        content: `未知工具: ${tc.name}`,
        isError: true,
      }
    }

    results.push(result)

    // 推送工具结果事件给前端
    context.webContents.send(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, {
      conversationId: context.conversationId,
      activity: {
        type: 'result',
        toolName: tc.name,
        toolCallId: tc.id,
        result: result.content,
        isError: result.isError,
        input: tc.arguments,
      },
    })
  }

  return results
}
