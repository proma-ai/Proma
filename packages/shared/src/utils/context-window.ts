/**
 * 模型上下文窗口推断 — 单一 source of truth。
 *
 * 后端（agent-orchestrator 是否发 `context-1m-2025-08-07` beta）和
 * 前端（ContextUsageBadge 进度环分母 fallback）必须共用同一份判定，
 * 否则会出现"UI 显示 1M 但实际只 200K"或反过来的不一致。
 */

/** 默认上下文窗口（无法识别模型时使用） */
export const DEFAULT_CONTEXT_WINDOW = 200_000

/** 1M 上下文窗口 */
export const ONE_MILLION_CONTEXT_WINDOW = 1_000_000

/**
 * 上下文窗口配置表 — 新增模型只需在此处加一行。
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
    // Claude 系列
    'claude-sonnet-4',
    'claude-sonnet-5',
    'claude-opus-4-6',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    // DeepSeek
    'deepseek-v4',
    // 小米 MiMo
    'mimo-v2.5',
    'mimo-v2-pro',
    // 智谱 GLM
    'glm-5.2',
    // MiniMax
    'minimax-m3',
    // Qwen3.7（DashScope Anthropic 兼容端点默认 1M，无需 context-1m beta header）
    'qwen3.7',
  ] as const,
} as const

/**
 * 判断模型是否支持 1M context window beta（context-1m-2025-08-07）。
 */
export function supports1MContext(modelId: string): boolean {
  if (!modelId) return false
  const m = modelId.toLowerCase()
  if (CONTEXT_WINDOW_CONFIG.exclude.some((p) => m.includes(p))) return false
  return CONTEXT_WINDOW_CONFIG.rules.some((p) => m.includes(p))
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
