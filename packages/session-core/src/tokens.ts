/**
 * 近似 token 估算。无第三方 tokenizer 依赖，用便宜启发式：
 * 约 4 字符/token（英文）；CJK 字符按约 1.5 字符/token 加权。
 * 仅用于 info / outline 的"够不够塞进上下文"量级判断，非精确计费。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字 + 常见中日韩区段
    if (code >= 0x3000 && code <= 0x9fff) cjk++
  }
  const ascii = text.length - cjk
  return Math.ceil(ascii / 4 + cjk / 1.5)
}
