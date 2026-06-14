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
 * 判断模型是否支持 1M context window beta（context-1m-2025-08-07）。
 *
 * 当前支持：
 * - Claude Sonnet 4 / 4.5 / 4.6
 * - Claude Opus 4.6 / 4.7 / 4.8
 * - Claude Fable 5
 * - DeepSeek V4 系列
 * - 小米 MiMo V2.5 / V2.5 Pro / V2 Pro
 * - 智谱 GLM-5.2、GLM-X-Preview[1m]
 * - MiniMax M3（智谱式兼容端点支持）
 *
 * 参考：https://docs.anthropic.com/en/docs/build-with-claude/context-windows
 */
export function supports1MContext(modelId: string): boolean {
  if (!modelId) return false
  const m = modelId.toLowerCase()
  if (m.includes('haiku')) return false
  if (m.includes('claude')) {
    if (m.includes('sonnet-4')) return true
    if (m.includes('opus-4-6') || m.includes('opus-4-7') || m.includes('opus-4-8')) return true
    if (m.includes('fable-5')) return true
    return false
  }
  if (m.includes('deepseek-v4')) return true
  if (m.includes('mimo-v2.5') || m.includes('mimo-v2-pro')) return true
  if (m.includes('glm-5.2')) return true
  if (m.includes('glm-x-preview[1m]')) return true
  if (m.includes('minimax-m3')) return true
  return false
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
