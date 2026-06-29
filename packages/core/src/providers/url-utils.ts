/**
 * URL 规范化工具
 *
 * 各供应商 Base URL 的规范化处理。
 * 所有 Anthropic URL 规范化逻辑统一收口在此文件，避免分散重复。
 */

import type { ProviderType } from '@proma/shared'

function trimTrailingUrlPathSlash(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  const separatorIndex = trimmed.search(/[?#]/)
  if (separatorIndex === -1) {
    return trimmed.replace(/\/+$/, '')
  }

  const pathPart = trimmed.slice(0, separatorIndex).replace(/\/+$/, '')
  return `${pathPart}${trimmed.slice(separatorIndex)}`
}

function hasPathSuffix(rawUrl: string, suffix: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim())
    return parsed.pathname.replace(/\/+$/, '').endsWith(suffix)
  } catch {
    const withoutQuery = rawUrl.trim().split(/[?#]/, 1)[0] ?? ''
    return withoutQuery.replace(/\/+$/, '').endsWith(suffix)
  }
}

function replacePathSuffix(rawUrl: string, suffix: string, replacement: string): string {
  const trimmed = rawUrl.trim()
  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    if (!pathname.endsWith(suffix)) return trimTrailingUrlPathSlash(trimmed)
    parsed.pathname = `${pathname.slice(0, -suffix.length)}${replacement}`
    return parsed.toString()
  } catch {
    const separatorIndex = trimmed.search(/[?#]/)
    const pathPart = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex)
    const tail = separatorIndex === -1 ? '' : trimmed.slice(separatorIndex)
    const normalizedPath = pathPart.replace(/\/+$/, '')
    if (!normalizedPath.endsWith(suffix)) return trimTrailingUrlPathSlash(trimmed)
    return `${normalizedPath.slice(0, -suffix.length)}${replacement}${tail}`
  }
}

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
 * 没有版本路径时追加 `/v1`，已有版本路径（如 `/coding/v1`）则保持不变。
 * 例如：
 * - "https://api.minimaxi.com/anthropic" → "https://api.minimaxi.com/anthropic/v1"
 * - "https://api.minimaxi.com/anthropic/v1/messages" → "https://api.minimaxi.com/anthropic/v1"
 * - "https://api.deepseek.com/anthropic" → "https://api.deepseek.com/anthropic/v1"
 * - "https://api.kimi.com/coding/v1" → 不变（已有版本路径）
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

/**
 * 解析 OpenAI Chat Completions 请求地址。
 *
 * OpenAI 兼容格式（custom）要求用户直接填写完整请求端点。
 * 内置 OpenAI 协议供应商仍允许填写协议根地址，例如：
 * - "https://api.example.com/v1" → "https://api.example.com/v1/chat/completions"
 * - custom: "https://api.example.com/v1/chat/completions" → 原样使用
 */
export function resolveOpenAIChatCompletionsUrl(baseUrl: string, provider: ProviderType = 'openai'): string {
  if (provider === 'custom') {
    return trimTrailingUrlPathSlash(baseUrl)
  }
  if (hasPathSuffix(baseUrl, '/chat/completions')) {
    return trimTrailingUrlPathSlash(baseUrl)
  }
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`
}

/**
 * 解析 OpenAI Models 地址。
 *
 * 当用户把兼容格式配置为完整 /chat/completions 端点时，模型列表需要回到同级 /models。
 */
export function resolveOpenAIModelsUrl(baseUrl: string): string {
  if (hasPathSuffix(baseUrl, '/chat/completions')) {
    return replacePathSuffix(baseUrl, '/chat/completions', '/models')
  }
  return `${normalizeBaseUrl(baseUrl)}/models`
}

/**
 * 根据 Anthropic 协议供应商类型选择对应的 URL 规范化策略。
 *
 * 统一收口 channel-manager 和 AnthropicAdapter 中重复的条件分支逻辑。
 * 仅适用于走 Anthropic 协议且允许填写协议根路径的内置供应商。
 *
 * DeepSeek / Kimi 等以 `/anthropic` 为协议根路径的供应商，实际端点仍位于
 * `/anthropic/v1/messages`，因此统一走 normalizeVersionedAnthropicBaseUrl 按需补 `/v1`
 * （已含版本路径如 `/coding/v1` 的不会重复追加），与 Agent SDK 自动拼接 /v1/messages 的行为保持一致。
 */
export function normalizeAnthropicProviderUrl(baseUrl: string, provider: ProviderType): string {
  if (
    provider === 'minimax'
    || provider === 'xiaomi'
    || provider === 'xiaomi-token-plan'
    || provider === 'qwen-anthropic'
    || provider === 'zhipu-coding'
    || provider === 'deepseek'
    || provider === 'kimi-api'
    || provider === 'kimi-coding'
  ) {
    return normalizeVersionedAnthropicBaseUrl(baseUrl)
  }
  return normalizeAnthropicBaseUrl(baseUrl)
}

/**
 * 解析 Anthropic Messages 请求地址。
 *
 * Anthropic 兼容格式要求用户直接填写完整请求端点。
 * 内置 Anthropic 协议供应商仍允许填写协议根地址，例如：
 * - minimax: "https://api.minimaxi.com/anthropic" → ".../anthropic/v1/messages"
 * - anthropic-compatible: "https://gateway.example.com/v1/messages" → 原样使用
 */
export function resolveAnthropicMessagesUrl(baseUrl: string, provider: ProviderType): string {
  if (provider === 'anthropic-compatible') {
    return trimTrailingUrlPathSlash(baseUrl)
  }
  if (hasPathSuffix(baseUrl, '/messages')) {
    return trimTrailingUrlPathSlash(baseUrl)
  }
  return `${normalizeAnthropicProviderUrl(baseUrl, provider)}/messages`
}

/**
 * 解析 Anthropic Models 地址。
 *
 * Anthropic 兼容格式不推导模型端点；内置供应商按协议根地址推导 /models。
 */
export function resolveAnthropicModelsUrl(baseUrl: string, provider: ProviderType): string {
  if (provider === 'anthropic-compatible') {
    return trimTrailingUrlPathSlash(baseUrl)
  }
  if (hasPathSuffix(baseUrl, '/messages')) {
    return replacePathSuffix(baseUrl, '/messages', '/models')
  }
  return `${normalizeAnthropicProviderUrl(baseUrl, provider)}/models`
}

/**
 * 将旧版本（v1）存储的通用兼容渠道 Base URL 一次性迁移为完整请求端点。
 *
 * 背景：custom / anthropic-compatible 两类通用兼容渠道，旧版本把存储值当作 Base URL，
 * 运行时再自动补全 /chat/completions 或 /v1/messages。新版本改为「用户填写完整请求地址，
 * 原样使用」。若不迁移，存量渠道升级后会向缺少端点后缀的地址发请求而失败（通常 404）。
 *
 * 本函数把存量 Base URL 补全为旧版本「实际请求过」的完整 URL，使升级后的运行时行为与升级前一致：
 * - custom（OpenAI 兼容）：复现旧 OpenAIAdapter 的 `normalizeBaseUrl(base) + '/chat/completions'`
 * - anthropic-compatible：复现旧 normalizeAnthropicProviderUrl 的 versioned 分支
 *   `normalizeVersionedAnthropicBaseUrl(base) + '/messages'`
 *
 * 幂等保证：空值、非这两类 provider、以及已经是完整端点的值都原样返回，可安全重复执行。
 *
 * 注意：anthropic-compatible 渠道的 baseUrl 同时被 Agent SDK 路径
 * （normalizeAnthropicBaseUrlForSdk）消费，该函数会剥除 /v\d+/messages 后缀，
 * 因此迁移成完整 /v1/messages 端点后 SDK 路径仍能还原出与升级前一致的根地址，互不影响。
 */
export function migrateCompatibleChannelBaseUrl(baseUrl: string, provider: ProviderType): string {
  const trimmed = baseUrl.trim()
  // 空 Base URL（如未配置的渠道）无需迁移
  if (trimmed === '') {
    return baseUrl
  }

  if (provider === 'custom') {
    // 已是完整端点则不重复追加
    if (hasPathSuffix(trimmed, '/chat/completions')) {
      return trimTrailingUrlPathSlash(trimmed)
    }
    return `${normalizeBaseUrl(trimmed)}/chat/completions`
  }

  if (provider === 'anthropic-compatible') {
    if (hasPathSuffix(trimmed, '/messages')) {
      return trimTrailingUrlPathSlash(trimmed)
    }
    return `${normalizeVersionedAnthropicBaseUrl(trimmed)}/messages`
  }

  // 其他 provider 的 URL 语义未改变，原样返回
  return baseUrl
}
