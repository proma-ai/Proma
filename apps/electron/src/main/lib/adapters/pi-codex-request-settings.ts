import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  isCodexFastModeSupportedModel,
  type AgentThinkingLevel,
} from '@proma/shared'

type ProviderPayload = Record<string, unknown>

export const CODEX_FAST_MODE_SERVICE_TIER = 'priority'

export interface CodexRequestSettings {
  fastMode?: boolean
  thinkingLevel?: AgentThinkingLevel
}

function isProviderPayload(payload: unknown): payload is ProviderPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}

function isReasoningPayload(value: unknown): value is ProviderPayload {
  return isProviderPayload(value)
}

/** 为符合条件的 Codex Responses 请求附加 OpenAI priority service tier。 */
export function injectCodexFastMode(payload: unknown): unknown {
  if (!isProviderPayload(payload)) return payload
  const modelId = typeof payload.model === 'string' ? payload.model : undefined
  if (!isCodexFastModeSupportedModel(modelId)) return payload
  return { ...payload, service_tier: CODEX_FAST_MODE_SERVICE_TIER }
}

/**
 * 对 Pi 已构造好的 Codex request body 补充会话级思考深度。
 *
 * Pi 在 thinkingLevel=off 时不会发出 reasoning 字段；但 GPT-5.5/5.6 的服务端
 * 默认值为 medium。因此关闭滑块时必须显式写入 effort=none，才能保持 UI 语义。
 * 同时，Fast Mode 的自定义 streamFn 直接调用 provider stream，绕过 Pi 对
 * `options.reasoning` → `reasoningEffort` 的通用转换；故此处统一补齐所有档位。
 */
export function injectOpenAIThinkingLevel(payload: unknown, settings: CodexRequestSettings): unknown {
  if (!isProviderPayload(payload)) return payload
  const effort = settings.thinkingLevel === 'minimal' ? 'low' : settings.thinkingLevel === 'off' ? 'none' : settings.thinkingLevel
  if (!effort) return payload

  const existingReasoning = isReasoningPayload(payload.reasoning) ? payload.reasoning : {}
  // ChatGPT Codex OAuth 不支持 reasoning.mode；直接 Responses 本次也明确不暴露该
  // 维度，因此统一剥离，避免上游 Pi 或其他扩展将该字段透传到请求。
  const { mode: _unsupportedReasoningMode, ...reasoningWithoutMode } = existingReasoning
  const reasoning = {
    ...reasoningWithoutMode,
    // 已有 provider 值优先，避免覆盖 Pi 模型 catalog 的未来专属映射；Fast Mode
    // 的直接 provider stream 不会写入它，因此会落到会话级滑块值。
    ...(effort === 'none' || existingReasoning.effort === undefined ? { effort } : {}),
  }
  return { ...payload, reasoning }
}

/** Pi Agent 内部 streamFn 使用的 provider 专属 service tier。 */
export function withCodexFastModeServiceTier<T extends object | undefined>(options: T): T & { serviceTier: typeof CODEX_FAST_MODE_SERVICE_TIER } {
  return { ...options, serviceTier: CODEX_FAST_MODE_SERVICE_TIER } as T & { serviceTier: typeof CODEX_FAST_MODE_SERVICE_TIER }
}

/** Pi 内联扩展：Proma 不依赖用户安装第三方 Pi extension。 */
export function createCodexRequestSettingsExtension(settings: CodexRequestSettings): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      const withFastMode = settings.fastMode ? injectCodexFastMode(event.payload) : event.payload
      const updatedPayload = injectOpenAIThinkingLevel(withFastMode, settings)
      return updatedPayload === event.payload ? undefined : updatedPayload
    })
  }
}
