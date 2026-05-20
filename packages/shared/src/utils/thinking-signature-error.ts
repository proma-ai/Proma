export const THINKING_SIGNATURE_ERROR_CODE = 'thinking_signature_invalid'
export const THINKING_SIGNATURE_ERROR_TITLE = '思考内容无法继续'
export const THINKING_SIGNATURE_ERROR_MESSAGE =
  '这个错误通常是因为中途切换了模型，不同模型的思考标签不互认。可以先切回原来的模型再重试；如果这是很早之前的会话，也可以在新对话中引用当前会话继续。'

export function isThinkingSignatureError(...messages: Array<string | null | undefined>): boolean {
  // API 错误消息中 signature/thinking 可能被反引号包裹（如 Invalid `signature` in `thinking` block），
  // 先去除反引号再匹配，避免 \s+ 无法跨越反引号导致检测失败。
  const combined = messages.filter(Boolean).join('\n').replace(/`/g, '')
  // 三种已知形态：
  // 1. "Invalid signature ... thinking block"（原生 Anthropic 报错）
  // 2. "thinking block ... Invalid signature"（顺序颠倒变体）
  // 3. "....signature: Field required"（中转/网关把 content.N.thinking.signature 路径段脱敏成 *** 后透传的 Pydantic 校验报错，
  //    如 "***.***.***.***.***.signature: Field required"）
  return /(?:invalid\s+signature[\s\S]{0,240}thinking\s+block|thinking\s+block[\s\S]{0,240}invalid\s+signature|\bsignature\s*:\s*field\s+required)/i.test(combined)
}

export function formatThinkingSignatureError(): string {
  return `${THINKING_SIGNATURE_ERROR_TITLE}：${THINKING_SIGNATURE_ERROR_MESSAGE}`
}

export function normalizeThinkingSignatureError(error: string): string {
  return isThinkingSignatureError(error) ? formatThinkingSignatureError() : error
}
