import { inferAgentReasoningTransport, normalizeReasoningCapabilityLevel, normalizeReasoningLevel, resolveReasoningProfile, type AgentSessionMeta, type AgentThinkingLevel, type ProviderType, type ReasoningCapability } from '@proma/shared'
import type { AppSettings } from '../../types'

type ThinkingSettings = Pick<AppSettings, 'agentThinking' | 'agentEffort'>
type ThinkingSessionMeta = Pick<AgentSessionMeta, 'reasoningLevel' | 'openAIThinkingLevel'>

export function resolvePiThinkingLevel(
  settings: ThinkingSettings,
  sessionMeta: ThinkingSessionMeta | undefined,
  provider: ProviderType | undefined,
  modelId?: string,
  capability?: ReasoningCapability,
  modelApiProtocol?: 'anthropic-messages' | 'openai-responses' | 'google-generative-ai',
): AgentThinkingLevel {
  const reasoningProfile = resolveReasoningProfile({
    modelId,
    transport: inferAgentReasoningTransport(provider, modelId, modelApiProtocol),
  })
  const persistedLevel = sessionMeta?.reasoningLevel ?? sessionMeta?.openAIThinkingLevel
  const configuredLevel = settings.agentThinking?.type === 'disabled' ? 'off' : settings.agentEffort
  if (reasoningProfile) return normalizeReasoningLevel(reasoningProfile, persistedLevel ?? configuredLevel)!
  if (capability) return normalizeReasoningCapabilityLevel(capability, persistedLevel ?? configuredLevel)!
  if (settings.agentThinking?.type === 'disabled') return 'off'
  if (settings.agentEffort === 'max') return 'xhigh'
  return settings.agentEffort ?? 'high'
}
