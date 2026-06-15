/**
 * Usage 归一化 — 把不同协议口径的 token 计数统一为 Anthropic 原生语义。
 *
 * 背景：
 * Anthropic 原生 API 的 usage 字段语义：
 *   input_tokens              = 本次请求中**未缓存**的输入 token
 *   cache_read_input_tokens   = 命中缓存的输入 token（独立计数）
 *   cache_creation_input_tokens = 写入缓存的输入 token（独立计数）
 *   三者相加 = 真实发送给模型的总输入 token
 *
 * OpenAI ChatCompletions 兼容协议（zhipu / doubao / qwen / openai / custom）的 usage 语义：
 *   prompt_tokens (= SDK 映射后的 input_tokens)        = **总输入**（已含缓存命中部分）
 *   prompt_tokens_details.cached_tokens (= SDK 映射后
 *   的 cache_read_input_tokens)                          = 总输入中命中缓存的子集
 *
 * 当第三方翻译层把 OpenAI 响应映射到 Anthropic schema 时，若不做扣减，
 * 会出现：
 *   input_tokens(=总输入 100) + cache_read_input_tokens(=80) = 180
 * 即把缓存部分计了两次，导致 UI 上下文指示器显示值显著大于真实值。
 *
 * 本工具在 main 进程单点归一化：对 OpenAI 兼容渠道，从 input_tokens 中
 * 扣除已缓存的子集，使其退化为 Anthropic 的"未缓存"语义。
 * 归一化后所有下游（renderer 公式、持久化、complete 事件）都按统一口径计算。
 */

import type { ProviderType } from '../types/channel'

/**
 * 走 OpenAI ChatCompletions 兼容协议的 provider。
 * 这些 provider 的 prompt_tokens 已含缓存命中部分，需要归一化。
 *
 * 注意：google 走 Gemini 原生协议，语义另算，暂不在此列。
 */
const OPENAI_COMPATIBLE_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'openai',
  'zhipu',
  'doubao',
  'qwen',
  'custom',
])

/** 是否为 OpenAI 兼容协议 provider（需要 usage 归一化）。 */
export function isOpenAICompatibleProvider(provider: string | undefined | null): boolean {
  if (!provider) return false
  return OPENAI_COMPATIBLE_PROVIDERS.has(provider as ProviderType)
}

/** Anthropic 风格 usage 结构（与 SDK 上报字段对齐，所有字段可选）。 */
export interface AnthropicLikeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * 把 usage 归一化为 Anthropic 原生语义。
 *
 * - Anthropic 原生 / Google / 其他：原样返回（无副作用）
 * - OpenAI 兼容：若 input_tokens > cache_read + cache_creation，
 *   说明 input_tokens 已含缓存部分，从中扣减；否则原样返回
 *   （某些端点可能已经按 Anthropic 口径上报，扣减会变负，此时尊重端点原值）
 *
 * 返回新对象，不修改入参。
 */
export function normalizeUsage<T extends AnthropicLikeUsage>(
  usage: T | undefined | null,
  provider: string | undefined | null,
): T | undefined | null {
  if (!usage) return usage
  if (!isOpenAICompatibleProvider(provider)) return usage

  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const cachedTotal = cacheRead + cacheCreation
  if (cachedTotal === 0) return usage
  if (usage.input_tokens == null) return usage
  // 若 input_tokens 已小于等于缓存总量，说明此端点已按 Anthropic 口径上报，不再扣减
  if (usage.input_tokens <= cachedTotal) return usage

  return {
    ...usage,
    input_tokens: usage.input_tokens - cachedTotal,
  }
}
