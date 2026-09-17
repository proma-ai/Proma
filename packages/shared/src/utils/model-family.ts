/**
 * GPT-6 Astra 已发布模型家族。
 *
 * 后端会原样下发 `gpt-6-astra-1`、`gpt-6-astra-az` 等 SKU；这些模型与
 * 基准 Astra 共享已验证的 Responses reasoning、372K context 与 Codex 请求契约。
 * 只接受由 `-` 分隔的字母数字后缀，避免把 `gpt-6-astral` 等无关模型误归类。
 */
const GPT_6_ASTRA_FAMILY_PATTERN = /^gpt-6-astra(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/

/**
 * 官方 1 折模型是独立的请求 SKU，而非上游模型版本。仅这些经过确认的
 * 别名复用基准模型的 thinking 与 Pi catalog capability；绝不能通用剥离 `-1`，
 * 因为 `claude-fable-5-1` 等模型的后缀是真实版本号。
 */
const PROMA_OFFICIAL_CAPABILITY_MODEL_IDS: Readonly<Record<string, string>> = {
  'claude-opus-5-1': 'claude-opus-5',
  'claude-opus-4-8-1': 'claude-opus-4-8',
  'claude-sonnet-5-1': 'claude-sonnet-5',
}

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
  return normalized !== undefined && GPT_6_ASTRA_FAMILY_PATTERN.test(normalized)
}

/** Return the known capability baseline while preserving the caller's request model ID. */
export function resolvePromaOfficialModelCapabilityId(modelId: string | undefined): string | undefined {
  const normalized = modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
  if (!normalized) return undefined
  return PROMA_OFFICIAL_CAPABILITY_MODEL_IDS[normalized] ?? normalized
}
