import { getChannelById } from './channel-manager'
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

  const model = channel.models.find((item) => item.id === modelId && item.enabled)
  if (!model) {
    throw new Error(`${input.purpose}模型不属于当前渠道或未启用: ${modelId}`)
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
