import type { Channel, ProviderType } from '@proma/shared'

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

/** 跨渠道委派的模型解析结果 */
export interface ResolvedAgentModelTarget {
  channelId: string
  modelId?: string
}

/**
 * 纯函数核心：在给定渠道集合内解析委派目标模型，便于 BDD 测试。
 *
 * 解析规则（按优先级）：
 * 1. channelId + modelId：按指定渠道校验模型
 * 2. 仅 modelId：在全部已启用渠道内解析；命中多个渠道时要求显式消歧
 * 3. 仅 channelId：使用该渠道的第一个启用模型
 * 4. 都未传：回退父会话渠道与模型
 */
export function resolveDelegationModelTargetFromChannels(
  input: {
    channelId?: string
    modelId?: string
    fallbackChannelId?: string
    fallbackModelId?: string
    purpose: string
  },
  channels: Channel[],
): ResolvedAgentModelTarget {
  const modelId = input.modelId?.trim() || undefined
  const explicitChannelId = input.channelId?.trim() || undefined

  if (explicitChannelId && modelId) {
    assertChannelModelEnabled(channels, explicitChannelId, modelId, input.purpose)
    return { channelId: explicitChannelId, modelId }
  }

  if (modelId) {
    const matched = channels.filter(
      (channel) => channel.enabled && channel.models.some((model) => model.id === modelId && model.enabled),
    )
    if (matched.length === 0) {
      throw new Error(`${input.purpose}模型在所有已启用渠道中均不存在或未启用: ${modelId}`)
    }
    if (matched.length > 1) {
      throw new Error(
        `${input.purpose}模型存在于多个渠道（${matched.map((item) => item.id).join('、')}），请显式传入 channelId 消歧: ${modelId}`,
      )
    }
    const target = matched[0]
    if (!target) {
      throw new Error(`${input.purpose}未找到可用的模型渠道: ${modelId}`)
    }
    return { channelId: target.id, modelId }
  }

  if (explicitChannelId) {
    const channel = channels.find((item) => item.id === explicitChannelId && item.enabled)
    if (!channel) {
      throw new Error(`${input.purpose}引用的渠道不存在或未启用: ${explicitChannelId}`)
    }
    const model = channel.models.find((item) => item.enabled)
    if (!model) {
      throw new Error(`${input.purpose}渠道内没有已启用的模型: ${explicitChannelId}`)
    }
    return { channelId: channel.id, modelId: model.id }
  }

  const fallbackChannelId = input.fallbackChannelId?.trim() || undefined
  const fallbackModelId = input.fallbackModelId?.trim() || undefined
  if (!fallbackChannelId) {
    throw new Error(`${input.purpose}需要可用的 channelId`)
  }
  if (fallbackModelId) {
    assertChannelModelEnabled(channels, fallbackChannelId, fallbackModelId, input.purpose)
  }
  return { channelId: fallbackChannelId, modelId: fallbackModelId }
}

/** 全渠道分组视图：列出所有已启用渠道及其可用模型（供跨渠道委派选择） */
export function listEnabledAgentModelsGroupedFromChannels(channels: Channel[]): {
  channels: AvailableAgentModelsForChannel[]
} {
  return {
    channels: channels
      .filter((channel) => channel.enabled && channel.models.some((model) => model.enabled))
      .map((channel) => ({
        channelId: channel.id,
        channelName: channel.name,
        provider: channel.provider,
        models: channel.models
          .filter((model) => model.enabled)
          .map((model) => ({ id: model.id, name: model.name, source: model.source })),
      })),
  }
}

/** 校验渠道存在且启用、模型已启用；不满足则抛错（纯函数版本，避免引入 electron 依赖链） */
function assertChannelModelEnabled(
  channels: Channel[],
  channelId: string,
  modelId: string,
  purpose: string,
): void {
  const channel = channels.find((item) => item.id === channelId && item.enabled)
  if (!channel) {
    throw new Error(`${purpose}引用的渠道不存在或未启用: ${channelId}`)
  }
  const model = channel.models.find((item) => item.id === modelId && item.enabled)
  if (!model) {
    throw new Error(`${purpose}模型不属于当前渠道或未启用: ${modelId}`)
  }
}
