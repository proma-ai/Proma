import { getChannelById, listChannels } from './channel-manager'
import { isAgentCompatibleProvider } from '@proma/shared'
import type { ProviderType } from '@proma/shared'

export interface AvailableAgentModel {
  id: string
  name: string
  source?: 'manual' | 'fetched'
}

export interface AvailableAgentModelsForChannel {
  channelId: string
  channelName: string
  provider: ProviderType
  models: AvailableAgentModel[]
}

export function assertEnabledModelForChannel(input: {
  channelId?: string
  modelId?: string
  purpose: string
  /** 目标 Agent runtime；传入 'claude' 时额外校验渠道协议兼容 Claude Agent Core。 */
  agentRuntime?: string
}): string | undefined {
  if (input.modelId == null) return undefined

  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error(`${input.purpose}模型 ID 不能为空`)
  }
  if (!input.channelId) {
    throw new Error(`${input.purpose}需要可用的 channelId`)
  }

  const channel = getChannelById(input.channelId)
  if (!channel || !channel.enabled) {
    throw new Error(`${input.purpose}引用的渠道不存在或未启用: ${input.channelId}`)
  }

  if (input.agentRuntime === 'claude' && !isAgentCompatibleProvider(channel.provider)) {
    throw new Error(`${input.purpose}渠道 ${channel.name} (${channel.provider}) 不兼容 Claude Agent Core，请选择 Anthropic 兼容协议渠道或改用 Pi runtime`)
  }

  const model = channel.models.find((item) => item.id === modelId && item.enabled)
  if (!model) {
    throw new Error(`${input.purpose}模型不属于渠道 ${channel.name} 或未启用: ${modelId}`)
  }

  return modelId
}

export function listEnabledAgentModelsForChannel(
  channelId: string | undefined,
  purpose: string,
): AvailableAgentModelsForChannel {
  if (!channelId) {
    throw new Error(`${purpose}需要可用的 channelId`)
  }

  const channel = getChannelById(channelId)
  if (!channel || !channel.enabled) {
    throw new Error(`${purpose}引用的渠道不存在或未启用: ${channelId}`)
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
    provider: channel.provider,
    models: channel.models
      .filter((model) => model.enabled)
      .map((model) => ({
        id: model.id,
        name: model.name,
        source: model.source,
      })),
  }
}

/**
 * 列出所有已启用渠道的 Agent 模型，供跨渠道派发子会话时选择。
 *
 * 每个渠道独立成一条记录；渠道的 apiKey 保持加密状态，不在此处解密。
 *
 * @param agentRuntime 可选；传入 'claude' 时仅返回兼容 Claude Agent Core 的渠道，避免 Agent 选中后运行前才发现不兼容。
 */
export function listAllEnabledAgentModels(agentRuntime?: string): AvailableAgentModelsForChannel[] {
  return listChannels()
    .filter((channel) => channel.enabled)
    .filter((channel) => agentRuntime !== 'claude' || isAgentCompatibleProvider(channel.provider))
    .map((channel) => ({
      channelId: channel.id,
      channelName: channel.name,
      provider: channel.provider,
      models: channel.models
        .filter((model) => model.enabled)
        .map((model) => ({
          id: model.id,
          name: model.name,
          source: model.source,
        })),
    }))
}
