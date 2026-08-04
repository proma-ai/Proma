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

interface MentionToken {
  text: string
  triggerOffset: number
}

function getMentionToken(paragraphText: string, triggerOffset: number): MentionToken | null {
  if (triggerOffset < 0 || triggerOffset >= paragraphText.length) return null

  const beforeTrigger = paragraphText.slice(0, triggerOffset)
  const tokenStart = Math.max(
    beforeTrigger.lastIndexOf(' '),
    beforeTrigger.lastIndexOf('\n'),
    beforeTrigger.lastIndexOf('\r'),
    beforeTrigger.lastIndexOf('\t'),
  ) + 1
  const afterTrigger = paragraphText.slice(triggerOffset)
  const whitespaceOffset = afterTrigger.search(/\s/)
  const tokenEnd = whitespaceOffset === -1 ? paragraphText.length : triggerOffset + whitespaceOffset

  return {
    text: paragraphText.slice(tokenStart, tokenEnd),
    triggerOffset: triggerOffset - tokenStart,
  }
}

/** URL 中的 `/`、`#`、`@` 和 `&` 都是合法字符，不能作为引用菜单触发符。 */
export function isMentionTriggerInsideUrl(paragraphText: string, triggerOffset: number): boolean {
  const token = getMentionToken(paragraphText, triggerOffset)
  if (!token) return false

  // 覆盖 HTTP(S)、SSH、Git、FTP、file 等带 scheme 的 URL，以及 Git 常见的 SCP 风格地址。
  const urlStart = token.text.search(/[A-Za-z][A-Za-z\d+.-]*:\/\//)
  if (urlStart !== -1) {
    return urlStart === 0 || !/[\p{L}\p{N}_-]/u.test(token.text[urlStart - 1] ?? '')
  }
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]*$/.test(token.text)
}

/** 粘贴或拖入是内容输入，不应把其中的普通文本解释成 Mention 快捷输入。 */
export function shouldShowMentionSuggestion(uiEvent: unknown): boolean {
  return uiEvent !== 'paste' && uiEvent !== 'drop'
}

interface MentionTriggerPolicyInput {
  paragraphText: string
  triggerOffset: number
  trigger: string
  isCodeContext?: boolean
}

/**
 * 仅过滤有明确语义的文本语法，保留中文后直接输入 `/skill`、`#mcp` 等快捷方式。
 */
export function shouldAllowMentionTrigger({
  paragraphText,
  triggerOffset,
  trigger,
  isCodeContext = false,
}: MentionTriggerPolicyInput): boolean {
  if (isCodeContext || isMentionTriggerInsideUrl(paragraphText, triggerOffset)) return false

  const token = getMentionToken(paragraphText, triggerOffset)
  if (!token) return false

  switch (trigger) {
    case '@':
      // 邮箱和 npm scope 不应触发文件搜索；以 @ 开头的普通文件查询仍保持可用。
      return !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*$/.test(token.text)
        && !/^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]*$/.test(token.text)
    case '/':
      // 单段 `/skill` 保持可用；仅抑制明确的相对、home、驱动器、UNC 或多段绝对路径。
      return !(
        /^[~～][\\/]/.test(token.text)
        || /^\.\.?\//.test(token.text)
        || /^[A-Za-z]:[\\/]/.test(token.text)
        || /^\/\//.test(token.text)
        || /^\/(?:Applications|Library|System|Users|Volumes|bin|boot|data|dev|etc|home|media|mnt|opt|private|proc|root|run|srv|sys|tmp|usr|var)(?:\/|$)/.test(token.text)
        || /^\/[^/\s]+\//.test(token.text)
      )
    case '#':
      // Markdown 标题会在输入空格后自动失活；已完整的标题、Issue 和色值直接抑制。
      return !(/^#\s/.test(paragraphText.slice(triggerOffset)) || /^#\d+$/.test(token.text) || /^#[0-9a-f]{3,8}$/i.test(token.text))
    case '&':
      return !(token.text.includes('&&') || /^&(?:amp|apos|gt|lt|nbsp|quot|#\d+|#x[\da-f]+);$/i.test(token.text))
    case '~':
    case '～':
      return !/^[~～][\\/]/.test(token.text)
    default:
      return true
  }
}
