/**
 * URL 规范化工具
 *
 * 各供应商 Base URL 的规范化处理。
 */

/**
 * 规范化 Anthropic Base URL
 *
 * 去除尾部斜杠，去除误填的 /messages 后缀，如果没有版本路径则追加 /v1。
 * 例如：
 * - "https://api.anthropic.com" → "https://api.anthropic.com/v1"
 * - "https://api.anthropic.com/v1" → 不变
 * - "https://proxy.example.com/v2/" → "https://proxy.example.com/v2"
 * - "https://proxy.example.com/v1/messages" → "https://proxy.example.com/v1"
 * - "https://proxy.example.com/v1/messages/" → "https://proxy.example.com/v1"
 */
export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '')
  // 去除用户误填的 /messages 后缀，避免后续拼接时路径重复
  url = url.replace(/\/messages$/, '')
  if (!url.match(/\/v\d+$/)) {
    url = `${url}/v1`
  }
  return url
}

/**
 * 规范化通用 Base URL
 *
 * 仅去除尾部斜杠，适用于 OpenAI / Google 等。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}
