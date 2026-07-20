import { isAgentCompatibleProvider, type Channel } from '@proma/shared'

/**
 * 没有独立渠道开关时，Claude runtime 的白名单完全由「渠道已启用 + 协议兼容」派生。
 * Pi runtime 不读取该白名单。
 */
export function getEnabledClaudeAgentChannelIds(
  channels: readonly Pick<Channel, 'id' | 'enabled' | 'provider'>[],
): string[] {
  return channels
    .filter((channel) => channel.enabled && isAgentCompatibleProvider(channel.provider))
    .map((channel) => channel.id)
}
