/**
 * 读取 Proma 会话 JSONL → SDKMessage[]
 *
 * 逻辑迁移自 apps/electron 主进程 agent-session-manager.ts 的
 * getAgentSessionSDKMessages / convertLegacyMessage，作为唯一真源由
 * Electron 主进程与 proma CLI 共用。旧扁平格式（AgentMessage，带 role 字段）
 * 在此统一归一为近似 SDKMessage，下游无需再区分「格式 A / 格式 B」。
 */
/**
 * 解析会话 JSONL 文本为 SDKMessage[]（纯函数，浏览器安全，无文件 IO）。
 *
 * 注意：本文件刻意不 import 'node:fs'，以便被 Electron 渲染层（浏览器环境）
 * 经主 barrel 引入。需要从磁盘读取的 readSessionMessages 在 './read-fs' 中，
 * 仅通过 '@proma/session-core/node' 子路径暴露给 Node 侧（CLI / 主进程）。
 */
import type { AgentMessage, SDKMessage } from '@proma/shared'

/**
 * 将旧的 AgentMessage 转换为近似的 SDKMessage（向后兼容）。
 * 不需要完美还原，只需在渲染/导出中可读即可。
 */
export function convertLegacyMessage(legacy: AgentMessage): SDKMessage {
  if (legacy.role === 'user') {
    return {
      type: 'user',
      message: {
        content: [{ type: 'text', text: legacy.content }],
      },
      parent_tool_use_id: null,
      _legacy: true,
      _createdAt: legacy.createdAt,
    } as unknown as SDKMessage
  }

  if (legacy.role === 'assistant') {
    return {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: legacy.content }],
        model: legacy.model,
      },
      parent_tool_use_id: null,
      _legacy: true,
      _createdAt: legacy.createdAt,
    } as unknown as SDKMessage
  }

  if (legacy.role === 'status') {
    // 错误消息转换为 assistant error 格式
    return {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: legacy.content }],
      },
      parent_tool_use_id: null,
      error: { message: legacy.content, errorType: legacy.errorCode },
      _legacy: true,
      _createdAt: legacy.createdAt,
      _errorCode: legacy.errorCode,
      _errorTitle: legacy.errorTitle,
      _errorDetails: legacy.errorDetails,
      _errorCanRetry: legacy.errorCanRetry,
      _errorActions: legacy.errorActions,
    } as unknown as SDKMessage
  }

  // 其他类型，作为 system 消息返回
  return {
    type: 'system',
    subtype: 'init',
    _legacy: true,
    _createdAt: legacy.createdAt,
  } as unknown as SDKMessage
}

/**
 * 解析 JSONL 文本为 SDKMessage[]（纯函数，便于测试与非文件来源）。
 * 损坏行（截断的 JSON）静默跳过，不中断整份会话解析。
 */
export function readSessionMessagesFromString(raw: string): SDKMessage[] {
  const lines = raw.split('\n')
  const messages: SDKMessage[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // 容错：跳过损坏行
    }
    // 旧格式检测：AgentMessage 有 `role` 字段，SDKMessage 有 `type` 字段
    if (parsed && typeof parsed === 'object' && 'role' in parsed && !('type' in parsed)) {
      messages.push(convertLegacyMessage(parsed as AgentMessage))
    } else {
      messages.push(parsed as SDKMessage)
    }
  }
  return messages
}
