export const WECHAT_AGENT_SOURCE_MARKER = '（消息通过微信 Bot 发送）'

/**
 * Marks only the model-facing copy of an incoming WeChat message.
 * The unmodified text is persisted separately as `rawUserMessage` for the session UI.
 */
export function appendWeChatAgentSourceMarker(message: string): string {
  const trimmed = message.trimEnd()
  return trimmed.endsWith(WECHAT_AGENT_SOURCE_MARKER)
    ? trimmed
    : `${trimmed}\n\n${WECHAT_AGENT_SOURCE_MARKER}`
}
