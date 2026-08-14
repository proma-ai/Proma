import type { SDKMessage } from '@proma/shared'

/**
 * 为可持久化的 Agent 输出保留本次运行实际使用的渠道身份。
 *
 * 模型 ID 只在单个渠道内唯一；会话恢复时需要 channelId 才能在同名模型间
 * 还原正确的别名、provider 与 logo。保留 SDK 或上游已经提供的有效值。
 */
export function withAgentMessageChannelIdentity<T extends SDKMessage>(message: T, channelId: string): T {
  if (!channelId || (message.type !== 'assistant' && message.type !== 'result')) return message
  if (typeof message._channelId === 'string') return message

  return { ...message, _channelId: channelId } as T
}
