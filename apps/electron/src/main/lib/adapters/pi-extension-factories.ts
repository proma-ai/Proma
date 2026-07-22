import type {
  InlineExtension,
} from '@earendil-works/pi-coding-agent'
import type { AgentThinkingLevel, ProviderType } from '@proma/shared'
import { isOpenAIReasoningSupportedModel } from '@proma/shared'
import { createCodexRequestSettingsExtension } from './pi-codex-request-settings'
import { createPromaGoalExtension } from './pi-goal-extension'

export interface PiExtensionFactoryOptions {
  provider: ProviderType
  modelReasoning: boolean
  modelId?: string
  codexFastMode?: boolean
  openAIThinkingLevel?: AgentThinkingLevel
}

export function buildPiExtensionFactories(options: PiExtensionFactoryOptions): InlineExtension[] {
  const extensionFactories: InlineExtension[] = [createPromaGoalExtension()]
  const usesCodexResponses = options.provider === 'openai-codex' || options.provider === 'openai-responses'

  if (usesCodexResponses && options.modelReasoning && isOpenAIReasoningSupportedModel(options.modelId)) {
    extensionFactories.push(createCodexRequestSettingsExtension({
      fastMode: options.codexFastMode,
      thinkingLevel: options.openAIThinkingLevel,
    }))
  }

  return extensionFactories
}
