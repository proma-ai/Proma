/**
 * Agent SDK 输出 token 上限判定。
 *
 * 只有真正的 Claude 模型才应注入 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`。此前用
 * `modelId.includes('claude')` 判断，任何仅**包含** "claude" 子串的 ID 都会误命中：
 * - 用户自定义模型名 `my-not-claude-fork`
 * - 第三方网关别名 `gateway/claude-proxy`（实际后端并非 Claude）
 *
 * 判定沿用仓库既有的模型识别惯例：真实 Claude 模型 ID 一定带**系列名**，而网关别名
 * 与自定义分支不带。参见 `adapters/pi-model-registry.ts` 的 `getClaudeFamilyKey`
 * （同样要求 `claude` + 系列名，并使用同一套分隔符类以兼容
 * `anthropic.claude-opus-4-6-v1`、`vendor/Claude-Opus-4-8`、`claude-sonnet-4-6[1m]`
 * 等别名形态）；`mythos` 系列见 `packages/core/src/providers/thinking-capability.ts`
 * 对 `claude-mythos-preview` 的处理。
 *
 * 两种命名形态都要覆盖，避免收窄现有行为：
 * - 系列名在前（4.x 起）：`claude-sonnet-4-6`、`claude-opus-4-8`、`claude-haiku-4-5`
 * - 版本号在前（3.x 旧命名）：`claude-3-opus-20240229`、`claude-3-5-sonnet-20241022`
 */
const CLAUDE_MODEL_PATTERN =
  /claude[\s._:/-]+(?:(?:opus|sonnet|haiku|fable|mythos)\b|\d+(?:[\s._:/-]+\d+)?[\s._:/-]+(?:opus|sonnet|haiku)\b)/i

export function getAgentSdkMaxOutputTokens(modelId: string | undefined): string | undefined {
  return modelId && CLAUDE_MODEL_PATTERN.test(modelId) ? '64000' : undefined
}
