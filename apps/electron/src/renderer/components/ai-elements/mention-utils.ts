/**
 * Mention 节点自身携带的触发符才是持久化协议的权威来源。
 * 当旧草稿的 @/#/& 节点遇到仅注册 `/` suggestion 的编辑器时，
 * 不能回退成当前 suggestion 的字符。
 */
export function resolveMentionSuggestionChar(nodeChar: unknown, fallbackChar?: string | null): string {
  if (typeof nodeChar === 'string' && nodeChar.length > 0) return nodeChar
  if (typeof fallbackChar === 'string' && fallbackChar.length > 0) return fallbackChar
  return '@'
}
