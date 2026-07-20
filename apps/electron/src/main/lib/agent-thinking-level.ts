import type { AgentSessionMeta, AgentThinkingLevel, ProviderType } from '@proma/shared'
import type { AppSettings } from '../../types'

type ThinkingSettings = Pick<AppSettings, 'agentThinking' | 'agentEffort'>
type ThinkingSessionMeta = Pick<AgentSessionMeta, 'openAIThinkingLevel'>

function isOpenAIReasoningProvider(provider: ProviderType | undefined): boolean {
  return provider === 'openai-codex' || provider === 'openai-responses'
}

export function resolvePiThinkingLevel(
  settings: ThinkingSettings,
  sessionMeta: ThinkingSessionMeta | undefined,
  provider: ProviderType | undefined,
): AgentThinkingLevel {
  if (isOpenAIReasoningProvider(provider) && sessionMeta?.openAIThinkingLevel) {
    return sessionMeta.openAIThinkingLevel
  }
  if (settings.agentThinking?.type === 'disabled') return 'off'
  if (settings.agentEffort === 'max') return 'xhigh'
  return settings.agentEffort ?? (settings.agentThinking ? 'high' : 'off')
}
