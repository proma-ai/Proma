/**
 * 上下文占用率计算工具 — 主进程与渲染进程共用的纯函数。
 *
 * `usedTokens` 是"已占用上下文"的 token 总量，调用方需自行按
 * input_tokens + cache_read_input_tokens + cache_creation_input_tokens 聚合后传入
 * （SDK 的 usage 中这三者是分开计数的，input_tokens 不含 cache 部分）。
 */

/**
 * 计算上下文占用率（0-1）。
 *
 * 任一输入无效（非有限数、缺失、非正）时返回 undefined。
 * 调用方应将 undefined 解释为「占用率未知」，而不是 0%——这通常意味着
 * session 还没有任何流式结果，或 contextWindow 无法推断，应保守处理。
 */
export function calculateContextUsageRatio(
  usedTokens: number | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (
    usedTokens === undefined ||
    contextWindow === undefined ||
    !Number.isFinite(usedTokens) ||
    !Number.isFinite(contextWindow) ||
    usedTokens < 0 ||
    contextWindow <= 0
  ) {
    return undefined
  }
  return usedTokens / contextWindow
}
