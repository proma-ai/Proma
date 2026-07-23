import { isOpenAIReasoningMaxSupportedModel, isPromaOfficialOpenAIReasoningModel, type AgentSessionMeta, type AgentThinkingLevel, type ProviderType } from '@proma/shared'
import type { AppSettings } from '../../types'

type ThinkingSettings = Pick<AppSettings, 'agentThinking' | 'agentEffort'>
type ThinkingSessionMeta = Pick<AgentSessionMeta, 'openAIThinkingLevel'>

function supportsSessionOpenAIThinkingLevel(
  provider: ProviderType | undefined,
  modelId: string | undefined,
): boolean {
  return provider === 'openai-codex'
    || provider === 'openai-responses'
    || provider === 'openai'
    || provider === 'custom'
    || (provider === 'proma' && isPromaOfficialOpenAIReasoningModel(modelId))
}

export function resolvePiThinkingLevel(
  settings: ThinkingSettings,
  sessionMeta: ThinkingSessionMeta | undefined,
  provider: ProviderType | undefined,
  modelId?: string,
): AgentThinkingLevel {
  if (supportsSessionOpenAIThinkingLevel(provider, modelId) && sessionMeta?.openAIThinkingLevel) {
    if (sessionMeta.openAIThinkingLevel === 'max' && modelId && !isOpenAIReasoningMaxSupportedModel(modelId)) {
      return 'xhigh'
    }
    return sessionMeta.openAIThinkingLevel
  }
  if (settings.agentThinking?.type === 'disabled') return 'off'
  if (settings.agentEffort === 'max') return 'xhigh'
  return settings.agentEffort ?? 'high'
}
