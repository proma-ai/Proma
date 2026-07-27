import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  normalizeReasoningLevel,
  resolveReasoningProfile,
  type AgentThinkingLevel,
  type ReasoningProfile,
} from '@proma/shared'

type ProviderPayload = Record<string, unknown>

export interface OpenAIReasoningRequestSettings {
  profile?: ReasoningProfile
  thinkingLevel?: AgentThinkingLevel
}

function isProviderPayload(payload: unknown): payload is ProviderPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}

function isReasoningPayload(value: unknown): value is ProviderPayload {
  return isProviderPayload(value)
}

/**
 * 对 Pi 已构造好的 OpenAI Responses request body 补充会话级 reasoning effort。
 *
 * Pi 在 off 时可能省略 reasoning 字段，而 reasoning 模型的服务端默认值通常不是
 * none；这里统一用 profile 的 encoding 明确写入目标 effort。Codex Fast Mode 的
 * 自定义 stream function 同样会经过此 hook，因此无需为 Fast Mode 维护另一份映射。
 */
export function injectOpenAIReasoningLevel(
  payload: unknown,
  settings: OpenAIReasoningRequestSettings,
): unknown {
  if (!isProviderPayload(payload)) return payload

  const modelId = typeof payload.model === 'string' ? payload.model : undefined
  const profile = settings.profile ?? resolveReasoningProfile({
    modelId,
    transport: 'openai-responses',
  })
  const encoding = profile?.encodings['openai-responses']
  if (encoding?.kind !== 'openai-reasoning-effort' || !settings.thinkingLevel) return payload

  const normalizedLevel = normalizeReasoningLevel(profile, settings.thinkingLevel)
  if (!normalizedLevel) return payload
  const effort = encoding.effortMap[normalizedLevel] ?? normalizedLevel
  if (effort === null) return payload

  const existingReasoning = isReasoningPayload(payload.reasoning) ? payload.reasoning : {}
  // ChatGPT Codex OAuth does not accept reasoning.mode. Responses channels likewise
  // do not expose it in Proma, so remove any upstream mode before dispatching.
  const { mode: _unsupportedReasoningMode, ...reasoningWithoutMode } = existingReasoning
  const reasoning = {
    ...reasoningWithoutMode,
    ...(effort === 'none' || existingReasoning.effort === undefined ? { effort } : {}),
  }
  return { ...payload, reasoning }
}

/** Pi inline extension for OpenAI Responses reasoning requests. */
export function createOpenAIReasoningRequestExtension(
  settings: OpenAIReasoningRequestSettings,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      const updatedPayload = injectOpenAIReasoningLevel(event.payload, settings)
      return updatedPayload === event.payload ? undefined : updatedPayload
    })
  }
}
