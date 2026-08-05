import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  normalizeReasoningLevel,
  resolveReasoningProfile,
  type AgentThinkingLevel,
  type ReasoningProfile,
} from '@proma/shared'

type ProviderPayload = Record<string, unknown>

export interface DeepSeekReasoningRequestSettings {
  profile?: ReasoningProfile
  thinkingLevel?: AgentThinkingLevel
}

function isProviderPayload(payload: unknown): payload is ProviderPayload {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}

/**
 * Rewrites Pi's generic Anthropic extended-thinking body to DeepSeek V4's
 * Anthropic-compatible protocol. DeepSeek ignores `thinking.budget_tokens`;
 * strength must be carried by `output_config.effort`.
 */
export function injectDeepSeekReasoningLevel(
  payload: unknown,
  settings: DeepSeekReasoningRequestSettings,
): unknown {
  if (!isProviderPayload(payload)) return payload

  const modelId = typeof payload.model === 'string' ? payload.model : undefined
  const profile = settings.profile ?? resolveReasoningProfile({
    modelId,
    transport: 'anthropic-messages',
  })
  const encoding = profile?.encodings['anthropic-messages']
  if (encoding?.kind !== 'deepseek-output-effort' || !settings.thinkingLevel) return payload

  const normalizedLevel = normalizeReasoningLevel(profile, settings.thinkingLevel)
  if (!normalizedLevel) return payload

  const { thinking: _upstreamThinking, output_config: _upstreamOutputConfig, ...body } = payload
  if (normalizedLevel === 'off') {
    return { ...body, thinking: { type: 'disabled' } }
  }

  const effort = encoding.effortMap[normalizedLevel]
  if (typeof effort !== 'string') return payload
  return {
    ...body,
    thinking: { type: 'enabled' },
    output_config: { effort },
  }
}

/** Pi inline extension for DeepSeek V4 Anthropic-compatible reasoning requests. */
export function createDeepSeekReasoningRequestExtension(
  settings: DeepSeekReasoningRequestSettings,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on('before_provider_request', (event) => {
      const updatedPayload = injectDeepSeekReasoningLevel(event.payload, settings)
      return updatedPayload === event.payload ? undefined : updatedPayload
    })
  }
}
