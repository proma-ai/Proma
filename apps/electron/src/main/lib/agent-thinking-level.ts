import type { AgentSessionMeta, AgentThinkingLevel, ProviderType } from '@proma/shared'
import type { AppSettings } from '../../types'

type ThinkingSettings = Pick<AppSettings, 'agentThinking' | 'agentEffort'>
type ThinkingSessionMeta = Pick<AgentSessionMeta, 'openAIThinkingLevel'>

function isOpenAIReasoningProvider(provider: ProviderType | undefined): boolean {
  // 同名 GPT-5.x 的第三方 OpenAI / custom 渠道也使用会话级深度，保证与 Codex
  // 及 Responses API 的 UI、Pi thinkingLevel 和最终请求参数一致。
  return provider === 'openai-codex'
    || provider === 'openai-responses'
    || provider === 'openai'
    || provider === 'custom'
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
  // 无持久化配置的旧用户也采用新的默认值；显式 disabled 仍优先关闭。
  return settings.agentEffort ?? 'high'
}
