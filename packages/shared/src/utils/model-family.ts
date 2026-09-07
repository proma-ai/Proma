/**
 * GPT-6 Astra 已发布模型家族。
 *
 * 后端会原样下发 `gpt-6-astra-1`、`gpt-6-astra-az` 等 SKU；这些模型与
 * 基准 Astra 共享已验证的 Responses reasoning、372K context 与 Codex 请求契约。
 * 只接受由 `-` 分隔的字母数字后缀，避免把 `gpt-6-astral` 等无关模型误归类。
 */
const GPT_6_ASTRA_FAMILY_PATTERN = /^gpt-6-astra(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
  return normalized !== undefined && GPT_6_ASTRA_FAMILY_PATTERN.test(normalized)
}
