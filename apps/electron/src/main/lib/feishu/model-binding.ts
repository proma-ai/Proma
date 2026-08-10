import type { AgentSessionMeta, Channel, FeishuChatBinding } from '@proma/shared'

export interface ModelSelectionDefaults {
  channelId?: string
  modelId?: string
}

export interface FeishuRunTarget {
  channelId: string
  modelId: string
  source: 'binding' | 'bot-default' | 'global-default'
}

interface ResolveFeishuRunTargetInput {
  binding: Pick<FeishuChatBinding, 'channelId' | 'modelId'>
  botDefaults: ModelSelectionDefaults
  globalDefaults: ModelSelectionDefaults
  channels: readonly Channel[]
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined
}

/** Bridge 启动时只补齐空字段，绝不覆盖聊天已经显式选择的渠道或模型。 */
export function initializeBindingModelSelection(
  binding: Pick<FeishuChatBinding, 'channelId' | 'modelId'>,
  botDefaults: ModelSelectionDefaults,
  globalDefaults: ModelSelectionDefaults,
): Pick<FeishuChatBinding, 'channelId' | 'modelId'> {
  return {
    channelId: nonEmpty(binding.channelId)
      ?? nonEmpty(botDefaults.channelId)
      ?? nonEmpty(globalDefaults.channelId)
      ?? '',
    modelId: nonEmpty(binding.modelId)
      ?? nonEmpty(botDefaults.modelId)
      ?? nonEmpty(globalDefaults.modelId),
  }
}

/** Session 镜像必须成对继承桌面会话，不能把会话渠道和全局模型拼在一起。 */
export function resolveSessionMirrorModelSelection(
  session: Pick<AgentSessionMeta, 'channelId' | 'modelId'>,
): ModelSelectionDefaults {
  return {
    channelId: nonEmpty(session.channelId),
    modelId: nonEmpty(session.modelId),
  }
}

/**
 * 按聊天绑定 → Bot 默认 → 全局默认解析可运行的渠道/模型。
 *
 * 指定模型失效时跳到下一级完整来源；来源未指定模型时，使用该渠道第一个
 * 启用模型，兼容旧绑定只有 channelId 的情况。
 */
export function resolveFeishuRunTarget(input: ResolveFeishuRunTargetInput): FeishuRunTarget {
  const candidates: Array<{
    source: FeishuRunTarget['source']
    selection: ModelSelectionDefaults
  }> = [
    { source: 'binding', selection: input.binding },
    { source: 'bot-default', selection: input.botDefaults },
    { source: 'global-default', selection: input.globalDefaults },
  ]

  for (const candidate of candidates) {
    const channelId = nonEmpty(candidate.selection.channelId)
    if (!channelId) continue

    const channel = input.channels.find((item) => item.id === channelId && item.enabled)
    if (!channel) continue

    const enabledModels = channel.models.filter((model) => model.enabled)
    const configuredModelId = nonEmpty(candidate.selection.modelId)
    const model = configuredModelId
      ? enabledModels.find((item) => item.id === configuredModelId)
      : enabledModels[0]
    if (!model) continue

    return {
      channelId: channel.id,
      modelId: model.id,
      source: candidate.source,
    }
  }

  throw new Error('没有可用的渠道/模型。已按聊天绑定 → Bot 默认 → 全局默认检查，请在 Proma 设置中启用渠道和模型。')
}
