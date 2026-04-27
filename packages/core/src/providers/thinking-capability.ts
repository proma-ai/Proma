/**
 * Claude 思考模式能力检测
 *
 * Anthropic 在 Claude 4.6+ 引入了 adaptive thinking，协议与旧版 extended thinking 不兼容：
 * - Opus 4.7 / Mythos Preview：只支持 adaptive，发送旧版 `{type: 'enabled', budget_tokens}` 会 400
 * - Opus 4.6 / Sonnet 4.6：两种都支持，adaptive 为推荐
 * - 更老的 Claude 系列（Sonnet 4.5 / Opus 4.5 / 3.x 等）：只支持 manual
 *
 * DeepSeek v4 系列走 Anthropic 兼容端点，但思考强度通过 `output_config.effort` 控制
 * （`high` / `max`），且默认就开启思考。本项目策略：开启思考 → max；关闭思考 → 显式 disabled。
 *
 * 本模块根据模型 ID 推断思考协议，供适配器构造请求体时分支使用。
 */
import type { ProviderType } from '@proma/shared'

/** 思考协议能力 */
export type ThinkingMode =
  /** 仅支持 adaptive（Opus 4.7 / Mythos Preview） */
  | 'adaptive-only'
  /** 同时支持 adaptive 和 manual，推荐用 adaptive（Opus 4.6 / Sonnet 4.6） */
  | 'adaptive-preferred'
  /** 仅支持 manual（旧 Claude 4.5 及以下，以及 DeepSeek v3/reasoner 等） */
  | 'manual-only'
  /** DeepSeek v4 系列：`{type: enabled}` + `output_config.effort = 'max'`，关闭需显式 disabled */
  | 'effort-based-max'
  /** 不支持思考（非 Claude/Anthropic 兼容模型） */
  | 'none'

/** 禁用思考的方式（用于标题生成等） */
export type ThinkingDisableStrategy =
  /** 显式发送 `thinking: {type: 'disabled'}` */
  | 'explicit-disabled'
  /** 省略 thinking 字段（Mythos Preview 不接受 disabled） */
  | 'omit-field'

export interface ThinkingCapability {
  mode: ThinkingMode
  disableStrategy: ThinkingDisableStrategy
}

/**
 * 匹配模型 ID（不区分大小写，允许 -latest、-20250101 等后缀）
 */
function startsWith(modelId: string, prefix: string): boolean {
  const id = modelId.toLowerCase()
  return id === prefix || id.startsWith(`${prefix}-`)
}

/**
 * 根据模型 ID 推断思考协议能力
 *
 * 匹配策略：
 * - 优先按**模型 ID** 识别 DeepSeek v4（历史遗留：用户早期配的 DeepSeek 渠道 providerType 是
 *   'anthropic'，不是 'deepseek'；只靠 providerType 匹配会落到 manual-only，导致
 *   思考关闭时不发 `thinking` 字段、而 DeepSeek v4 默认开思考 → 报「thinking must be passed back」）
 * - 再按 providerType 兜底
 *
 * @param providerType 供应商类型
 * @param modelId 模型 ID
 */
export function detectThinkingCapability(
  providerType: ProviderType,
  modelId: string,
): ThinkingCapability {
  // DeepSeek v4 系列（按模型 ID 识别，不依赖 providerType）：
  // effort-based-max 模式会在思考关闭时显式发 `{type:'disabled'}`，这是 DeepSeek v4 的硬要求
  if (startsWith(modelId, 'deepseek-v4')) {
    return { mode: 'effort-based-max', disableStrategy: 'explicit-disabled' }
  }

  // DeepSeek 其它模型（v3 / reasoner 等）：旧 manual 协议
  if (providerType === 'deepseek') {
    return { mode: 'manual-only', disableStrategy: 'explicit-disabled' }
  }

  // Kimi 的 Anthropic 协议渠道（Kimi API / Kimi Coding Plan）
  // Kimi K2 系列非 reasoning 模型，协议层面不支持 thinking 参数，直接省略
  if (providerType === 'kimi-api' || providerType === 'kimi-coding') {
    return { mode: 'none', disableStrategy: 'omit-field' }
  }

  // 其它非 Anthropic 供应商：不发 thinking
  if (providerType !== 'anthropic') {
    return { mode: 'manual-only', disableStrategy: 'explicit-disabled' }
  }

  // Claude Mythos Preview：adaptive 是默认且唯一，不接受 disabled
  if (startsWith(modelId, 'claude-mythos-preview')) {
    return { mode: 'adaptive-only', disableStrategy: 'omit-field' }
  }

  // Claude Opus 4.7:adaptive 唯一模式
  if (startsWith(modelId, 'claude-opus-4-7')) {
    return { mode: 'adaptive-only', disableStrategy: 'explicit-disabled' }
  }

  // Claude Opus 4.6 / Sonnet 4.6：两者都支持，优先 adaptive
  if (
    startsWith(modelId, 'claude-opus-4-6') ||
    startsWith(modelId, 'claude-sonnet-4-6')
  ) {
    return { mode: 'adaptive-preferred', disableStrategy: 'explicit-disabled' }
  }

  // 其它 Claude（4.5 及以下、3.x 等）：仅 manual
  return { mode: 'manual-only', disableStrategy: 'explicit-disabled' }
}
