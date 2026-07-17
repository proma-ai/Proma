import type { SDKAssistantMessage, SDKMessage } from '@proma/shared'

/**
 * Pi runtime 的 message_update 会用 _partial 标记预览帧。
 * 这些帧通常携带“当前累计全文”，只适合 UI upsert，不应进入 IM Bridge 的最终回复 buffer。
 */
export function isPartialSDKMessage(message: SDKMessage): boolean {
  return (message as Record<string, unknown>)._partial === true
}

export function extractFinalAssistantText(message: SDKMessage): string {
  if (message.type !== 'assistant') return ''
  if (isPartialSDKMessage(message)) return ''

  const assistant = message as SDKAssistantMessage
  return (assistant.message?.content ?? [])
    .map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .join('')
}
