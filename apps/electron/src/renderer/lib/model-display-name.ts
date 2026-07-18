import type { Channel } from '@proma/shared'

/**
 * 将模型 ID 转为渠道配置的显示名称。
 *
 * 同一 modelId 可以被多个渠道供应；没有渠道上下文时不得猜测任何一个渠道的别名，
 * 否则官方促销文案可能被错误展示到第三方/OAuth 渠道的模型上。
 */
export type ModelDisplayContext = 'chat' | 'agent'

function findChannelModel(channel: Channel, modelId: string, context: ModelDisplayContext) {
  const models = context === 'agent' ? channel.agentModels ?? channel.models : channel.models
  return models.find((candidate) => candidate.id === modelId)
}

export function resolveModelDisplayName(
  modelId: string,
  channels: Channel[],
  channelId?: string,
  context: ModelDisplayContext = 'chat',
): string {
  if (channelId) {
    const selectedChannel = channels.find((channel) => channel.id === channelId)
    const model = selectedChannel && findChannelModel(selectedChannel, modelId, context)
    // 渠道上下文已明确但暂时无法匹配时，不能跨渠道猜测别名。
    return model?.name && model.name !== model.id ? model.name : modelId
  }

  const channelsWithModel = channels.filter((channel) => findChannelModel(channel, modelId, context))
  if (channelsWithModel.length !== 1) return modelId

  const [onlyChannel] = channelsWithModel
  const model = onlyChannel && findChannelModel(onlyChannel, modelId, context)
  return model?.name && model.name !== model.id ? model.name : modelId
}
