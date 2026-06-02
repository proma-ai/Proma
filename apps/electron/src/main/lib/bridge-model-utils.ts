/**
 * IM Bridge 模型切换共享工具
 *
 * 为飞书 / 钉钉 / 微信 Bridge 提供统一的「渠道/模型」数据逻辑：
 * 过滤可用渠道、按序号解析渠道与模型、解析当前绑定的渠道名+模型名。
 *
 * 纯数据逻辑，不耦合任何平台的消息呈现（卡片 / 纯文本由各 Bridge 自行拼装）。
 */

import type { Channel, ChannelModel } from '@proma/shared'
import { listChannels, getChannelById } from './channel-manager'

/** 取渠道下启用的模型 */
export function getEnabledModels(channel: Channel): ChannelModel[] {
  return channel.models.filter((m) => m.enabled)
}

/**
 * 列出「可切换」的渠道：已启用且至少有一个启用模型。
 * 过滤掉停用渠道和未配置（无可用模型）的渠道，避免用户切到用不了的渠道。
 */
export function listSwitchableChannels(): Channel[] {
  return listChannels().filter((c) => c.enabled && getEnabledModels(c).length > 0)
}

/** 按 1 起始的序号解析可切换渠道，越界返回 undefined */
export function resolveChannelByIndex(index: number): Channel | undefined {
  const channels = listSwitchableChannels()
  if (!Number.isInteger(index) || index < 1 || index > channels.length) return undefined
  return channels[index - 1]
}

/** 按 1 起始的序号解析渠道下的启用模型，越界返回 undefined */
export function resolveModelByIndex(channel: Channel, index: number): ChannelModel | undefined {
  const models = getEnabledModels(channel)
  if (!Number.isInteger(index) || index < 1 || index > models.length) return undefined
  return models[index - 1]
}

/** 解析当前绑定的渠道/模型展示信息，供 /now 使用 */
export interface BindingModelDescription {
  /** 渠道展示名（解析失败时为 channelId 原值或「未设置」） */
  channelName: string
  /** 模型展示名（解析失败时为 modelId 原值或「未设置」） */
  modelName: string
  /** 渠道与模型是否都仍有效（存在且未被删除） */
  valid: boolean
}

export function describeBindingModel(
  channelId: string | undefined,
  modelId: string | undefined,
): BindingModelDescription {
  const channel = channelId ? getChannelById(channelId) : undefined
  const model = channel && modelId ? channel.models.find((m) => m.id === modelId) : undefined

  const channelName = channel ? channel.name : channelId || '未设置'
  const modelName = model ? model.name : modelId || '未设置'
  const valid = Boolean(channel) && Boolean(model)

  return { channelName, modelName, valid }
}
