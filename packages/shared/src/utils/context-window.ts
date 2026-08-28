/**
 * 模型上下文窗口推断 — 单一 source of truth。
 *
 * 1M 上下文已随各家模型转正为默认能力（Anthropic 于 2026-03 对 Opus 4.6 /
 * Sonnet 4.6 起 GA，无需 context-1m beta header；Sonnet 5 / Opus 4.7+ 延续），
 * 故不再下发任何 beta。Proma 统一按模型能力推断窗口，前端展示、后端用量统计和运行时注册
 * 必须共用同一份判定，避免出现"UI 显示 1M 但实际只 200K"的不一致。
 */

/** 默认上下文窗口（无法识别模型时使用） */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** 1M 上下文窗口 */
export const ONE_MILLION_CONTEXT_WINDOW = 1_000_000

/** ChatGPT Codex 已验证的 GPT-5.x 上下文窗口；第三方同名模型沿用此展示基线。 */
export const CODEX_GPT_54_55_CONTEXT_WINDOW = 272_000
export const CODEX_GPT_54_MINI_CONTEXT_WINDOW = 400_000
export const CODEX_GPT_56_CONTEXT_WINDOW = 372_000

/**
 * 为与 ChatGPT Codex 同名的 GPT-5.x 模型返回统一上下文窗口。
 *
 * 仅覆盖 Codex 已明确标记的模型；Pro/Nano 等未出现在 Codex 目录的变体继续交由
 * provider catalog 决定，避免把不同 SKU 误写成同一窗口。
 */
export function inferCodexAlignedGPT5ContextWindow(modelId: string | undefined): number | undefined {
  const model = modelId?.toLowerCase().replace(/\[1m\]$/i, '')
  switch (model) {
    case 'gpt-5.4-mini': return CODEX_GPT_54_MINI_CONTEXT_WINDOW
    case 'gpt-5.4':
    case 'gpt-5.5': return CODEX_GPT_54_55_CONTEXT_WINDOW
    case 'gpt-5.6':
    case 'gpt-5.6-sol':
    case 'gpt-5.6-terra':
    case 'gpt-5.6-luna': return CODEX_GPT_56_CONTEXT_WINDOW
    default: return undefined
  }
}

/** 已确认支持 1M 上下文的模型。 */
const ONE_MILLION_CONTEXT_RULES = {
  // Claude 系列
  claude: [
    'claude-sonnet-4-6',
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
  ],
  // DeepSeek
  deepseek: ['deepseek-v4'],
  // 智谱 GLM
  glm: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
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

const ONE_MILLION_CONTEXT_DISPLAY_RULES = Object.values(ONE_MILLION_CONTEXT_RULES).flat()
const EXACT_CONTEXT_RULES = new Set(['k3', 'kimi-k3'])

function matchesContextRule(model: string, pattern: string): boolean {
  if (EXACT_CONTEXT_RULES.has(pattern)) {
    return model === pattern || model.startsWith(`${pattern}[`)
  }
  return model.includes(pattern)
}

/**
 * 上下文窗口配置表。仅影响显示推断的模型加在 rules；已确认 1M
 * 能力的模型加在上方 ONE_MILLION_CONTEXT_RULES，并自动复用于 rules。
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
    ...ONE_MILLION_CONTEXT_DISPLAY_RULES,
    // OpenAI 协议渠道（如 OpenCode Go）使用该真实模型 ID。
    'kimi-k3',
    // 已废弃的 MiMo V2 Pro 仅保留历史显示推断
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
  const codexAlignedWindow = inferCodexAlignedGPT5ContextWindow(model)
  if (codexAlignedWindow !== undefined) return codexAlignedWindow
  if (supports1MContext(model)) return ONE_MILLION_CONTEXT_WINDOW
  return DEFAULT_CONTEXT_WINDOW
}
