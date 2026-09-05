/**
 * GPT-6 Astra 模型家族。
 *
 * 后端会原样下发 `gpt-6-astra-1`、`gpt-6-astra-az` 等 SKU；这些模型与
 * 基准 Astra 共享已验证的 Responses reasoning、1M context 与 Codex 请求契约。
 * 上游以 `gpt-6-astra` 作为稳定家族前缀，因此接受其后的任意后缀。
 */
const GPT_6_ASTRA_FAMILY_PREFIX = 'gpt-6-astra'

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
  return normalized?.startsWith(GPT_6_ASTRA_FAMILY_PREFIX) === true
}
