import type { ProviderType } from '../types/channel'

/**
 * 模型上下文窗口推断 — 单一 source of truth。
 *
 * 1M 上下文已随各家模型转正为默认能力（Anthropic 于 2026-03 对 Opus 4.6 /
 * Sonnet 4.6 起 GA，无需 context-1m beta header；Sonnet 5 / Opus 4.7+ 延续），
 * 故不再下发任何 beta。Claude Agent SDK 仍要求通过 `[1m]` 模型后缀显式选择
 * 扩展上下文（发送请求前会自动剥离），因此前端推断、后端用量统计和 SDK 模型
 * 选择必须共用同一份判定，否则会出现"UI 显示 1M 但实际只 200K"的不一致。
 */

/** 默认上下文窗口（无法识别模型时使用） */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** 1M 上下文窗口 */
export const ONE_MILLION_CONTEXT_WINDOW = 1_000_000

/** 已确认需要显式选择 Claude Agent SDK `[1m]` 变体的模型。 */
const AGENT_SDK_1M_CONTEXT_RULES = {
  // Claude 系列
  claude: [
    'claude-sonnet-4-6',
    'claude-sonnet-5',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
  ],
  // DeepSeek
  deepseek: ['deepseek-v4'],
  // 智谱 GLM
  glm: ['glm-5.2'],
  // 小米 MiMo
  mimo: ['mimo-v2.5'],
  // MiniMax
  minimax: ['minimax-m3'],
  // Kimi
  kimi: ['k3'],
  // 通义千问
  qwen: [
    'qwen3.8',
    'qwen3.7',
    'qwen3.6-plus',
    'qwen3.6-flash',
    'qwen3.5-plus',
    'qwen3.5-flash',
    'qwen3-coder-plus',
  ],
} as const

const AGENT_SDK_1M_CONTEXT_PROVIDER_RULES: Partial<Record<ProviderType, readonly string[]>> = {
  anthropic: AGENT_SDK_1M_CONTEXT_RULES.claude,
  deepseek: AGENT_SDK_1M_CONTEXT_RULES.deepseek,
  'zhipu-coding': AGENT_SDK_1M_CONTEXT_RULES.glm,
  'zhipu-coding-team': AGENT_SDK_1M_CONTEXT_RULES.glm,
  minimax: AGENT_SDK_1M_CONTEXT_RULES.minimax,
  xiaomi: AGENT_SDK_1M_CONTEXT_RULES.mimo,
  'xiaomi-token-plan': AGENT_SDK_1M_CONTEXT_RULES.mimo,
  'ark-coding-plan': [
    ...AGENT_SDK_1M_CONTEXT_RULES.deepseek,
    ...AGENT_SDK_1M_CONTEXT_RULES.glm,
    ...AGENT_SDK_1M_CONTEXT_RULES.kimi,
    ...AGENT_SDK_1M_CONTEXT_RULES.minimax,
  ],
  'kimi-api': AGENT_SDK_1M_CONTEXT_RULES.kimi,
  'kimi-coding': AGENT_SDK_1M_CONTEXT_RULES.kimi,
}

const AGENT_SDK_1M_CONTEXT_DISPLAY_RULES = Object.values(AGENT_SDK_1M_CONTEXT_RULES).flat()

function matchesContextRule(model: string, pattern: string): boolean {
  if (pattern.length <= 3) {
    return model === pattern || model.startsWith(`${pattern}[`)
  }
  return model.includes(pattern)
}

/**
 * 上下文窗口配置表。仅影响显示推断的模型加在 rules；已实测 Agent SDK 1M
 * 行为的模型加在上方 AGENT_SDK_1M_CONTEXT_RULES，并自动复用于 rules。
 *
 * 匹配规则：modelId.toLowerCase() 包含 pattern 即命中（substring match）。
 * exclude 列表优先级最高：命中 exclude 的模型始终返回 DEFAULT_CONTEXT_WINDOW。
 *
 * 参考：https://docs.anthropic.com/en/docs/build-with-claude/context-windows
 */
const CONTEXT_WINDOW_CONFIG = {
  /** 始终使用默认窗口的模型特征（优先级高于 rules） */
  exclude: ['haiku'],

  /** 1M 上下文模型匹配规则 */
  rules: [
    ...AGENT_SDK_1M_CONTEXT_DISPLAY_RULES,
    // 已废弃的 MiMo V2 Pro 仅保留历史显示推断，不主动启用 SDK 1M 变体
    'mimo-v2-pro',
  ] as const,
} as const

/**
 * 判断模型是否支持 1M context window（现为各模型默认能力，无需 beta header）。
 */
export function supports1MContext(modelId: string): boolean {
  if (!modelId) return false
  const m = modelId.toLowerCase()
  if (CONTEXT_WINDOW_CONFIG.exclude.some((p) => m.includes(p))) return false
  return CONTEXT_WINDOW_CONFIG.rules.some((p) => matchesContextRule(m, p))
}

/**
 * 按模型名推断 contextWindow（token 数）。
 *
 * SDK 流式过程中不返回此字段，只有 result 消息的 modelUsage 才带（且部分渠道不返回）。
 * 本函数提供一个按模型家族的 fallback，保证进度环永远有分母可用。
 */
export function inferContextWindow(model?: string): number | undefined {
  if (!model) return undefined
  if (supports1MContext(model)) return ONE_MILLION_CONTEXT_WINDOW
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * 按 Agent SDK 实际启用的窗口推断 contextWindow。
 *
 * 与 resolveAgentSdkModelId 不同，这里只判断模型窗口能力，不判断是否要把
 * `[1m]` 后缀传给 SDK。通用 Anthropic-compatible 端点可能不接受带后缀的
 * 模型名，但这不应把已知 1M 模型的上下文分母降级为 200K。
 */
export function inferAgentSdkContextWindow(modelId: string | undefined, provider: ProviderType): number | undefined {
  if (!modelId) return undefined
  return supports1MContext(modelId)
    || resolveAgentSdkModelId(modelId, provider) !== modelId
    || /\[1m\]$/i.test(modelId)
    ? ONE_MILLION_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW
}

/**
 * 将已确认的 1M Agent 模型转换为 Claude Agent SDK 的扩展上下文变体。
 *
 * `[1m]` 仅用于已验证的内置供应商组合。泛化的 Anthropic-compatible
 * 端点无法保证 SDK 会在请求前剥离后缀，因此必须保留用户配置的真实模型 ID。
 */
export function resolveAgentSdkModelId(modelId: string, provider: ProviderType): string {
  if (!modelId || /\[1m\]$/i.test(modelId)) {
    return modelId
  }
  const model = modelId.toLowerCase()
  const rules = AGENT_SDK_1M_CONTEXT_PROVIDER_RULES[provider]
  if (!rules?.some((pattern) => matchesContextRule(model, pattern))) return modelId
  return `${modelId}[1m]`
}
