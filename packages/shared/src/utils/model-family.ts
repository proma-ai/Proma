/**
 * GPT-6 Astra 已发布模型家族。
 *
 * 后端会原样下发 `gpt-6-astra-1`、`gpt-6-astra-az` 等 SKU；这些模型与
 * 基准 Astra 共享已验证的 Responses reasoning 与 Codex 请求契约；上下文窗口按渠道配置决定。
 * 只接受由 `-` 分隔的字母数字后缀，避免把 `gpt-6-astral` 等无关模型误归类。
 */
const GPT_6_ASTRA_FAMILY_PATTERN = /^gpt-6-astra(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/
const GPT_6_SOL_FAMILY_PATTERN = /^gpt-6-sol(?:-\d+)?$/
const GPT_6_LUNA_FAMILY_PATTERN = /^gpt-6-luna(?:-\d+)?$/

function normalizeModelId(modelId: string | undefined): string | undefined {
  return modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
}

/**
 * 官方 Claude 的这些系列允许附加纯数字 SKU 后缀，例如 `claude-opus-5-1`。
 * 此处表达的是能力家族，而非请求 ID 到另一个模型 ID 的映射：调用方必须继续
 * 用用户选中的完整 ID 发请求。Fable 的 `-1` 是真实版本号，故不属于该规则。
 */
export type PromaOfficialClaudeCapabilityFamily =
  | 'claude-opus-5'
  | 'claude-opus-4-8'
  | 'claude-sonnet-5'

const PROMA_OFFICIAL_CLAUDE_CAPABILITY_FAMILY_PATTERNS: ReadonlyArray<readonly [
  PromaOfficialClaudeCapabilityFamily,
  RegExp,
]> = [
  ['claude-opus-5', /^claude-opus-5(?:-\d+)?$/],
  ['claude-opus-4-8', /^claude-opus-4-8(?:-\d+)?$/],
  ['claude-sonnet-5', /^claude-sonnet-5(?:-\d+)?$/],
]

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_ASTRA_FAMILY_PATTERN.test(normalized)
}

/** GPT-6 Sol 的官方数字 SKU 复用基准模型的思考档位；不匹配未验证的文字后缀。 */
export function isGpt6SolFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_SOL_FAMILY_PATTERN.test(normalized)
}

/** GPT-6 Luna 的官方数字 SKU 复用基准模型的思考档位；不匹配未验证的文字后缀。 */
export function isGpt6LunaFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_LUNA_FAMILY_PATTERN.test(normalized)
}

/**
 * Identify an official Claude capability family for catalog fallback only.
 * Returns undefined for actual-version suffixes and unknown future families.
 */
export function getPromaOfficialClaudeCapabilityFamily(
  modelId: string | undefined,
): PromaOfficialClaudeCapabilityFamily | undefined {
  const normalized = normalizeModelId(modelId)
  if (!normalized) return undefined
  return PROMA_OFFICIAL_CLAUDE_CAPABILITY_FAMILY_PATTERNS
    .find(([, pattern]) => pattern.test(normalized))?.[0]
}
