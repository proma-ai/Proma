/**
 * URL 规范化工具
 *
 * 各供应商 Base URL 的规范化处理。
 * 所有 Anthropic URL 规范化逻辑统一收口在此文件，避免分散重复。
 */

/**
 * 规范化 Anthropic Base URL（用于 Proma Chat 直接调用 API）
 *
 * 去除尾部斜杠，去除误填的 /messages 后缀，如果没有版本路径则追加 /v1。
 * 结果用于直接拼接 /messages 发起请求。
 *
 * 例如：
 * - "https://api.anthropic.com" → "https://api.anthropic.com/v1"
 * - "https://api.anthropic.com/v1" → 不变
 * - "https://proxy.example.com/v2/" → "https://proxy.example.com/v2"
 * - "https://proxy.example.com/v1/messages" → "https://proxy.example.com/v1"
 * - "https://proxy.example.com/v1/messages/" → "https://proxy.example.com/v1"
 * - "https://api.deepseek.com/anthropic" → 不变（已有非版本路径）
 */
export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '')
  url = url.replace(/\/messages$/, '')
  if (!url.match(/\/v\d+$/)) {
    // 仅对根路径或纯域名追加 /v1；已有路径（如 deepseek /anthropic）保持原样
    try {
      const pathname = new URL(url).pathname
      if (pathname === '/' || pathname === '') {
        url = `${url}/v1`
      }
    } catch {
      url = `${url}/v1`
    }
  }
  return url
}

/**
 * 规范化带版本路径的 Anthropic 兼容 Base URL。
 *
 * 某些网关以 `/anthropic` 作为协议根路径，但实际 API 仍位于 `/v1/messages`。
 * 例如：
 * - "https://api.minimaxi.com/anthropic" → "https://api.minimaxi.com/anthropic/v1"
 * - "https://api.minimaxi.com/anthropic/v1/messages" → "https://api.minimaxi.com/anthropic/v1"
 */
export function normalizeVersionedAnthropicBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '')
  url = url.replace(/\/messages$/, '')
  if (!url.match(/\/v\d+$/)) {
    url = `${url}/v1`
  }
  return url
}

/**
 * 规范化 Anthropic Base URL（用于 Agent SDK 环境变量 ANTHROPIC_BASE_URL）
 *
 * SDK 内部会自动拼接 /v1/messages，所以这里需要去除用户误填的路径后缀，
 * 只保留根路径。
 *
 * 例如：
 * - "https://api.anthropic.com" → "https://api.anthropic.com"
 * - "https://api.anthropic.com/v1" → "https://api.anthropic.com"
 * - "https://api.anthropic.com/v1/messages" → "https://api.anthropic.com"
 * - "https://gateway.example.com/anthropic/v1/messages" → "https://gateway.example.com/anthropic"
 * - "https://gateway.example.com/anthropic/" → "https://gateway.example.com/anthropic"
 */
export function normalizeAnthropicBaseUrlForSdk(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+\/messages$/, '')
    .replace(/\/v\d+$/, '')
}

/**
 * 规范化通用 Base URL
 *
 * 仅去除尾部斜杠，适用于 OpenAI / Google 等。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}
