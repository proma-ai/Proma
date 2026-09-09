import type { Channel } from '@proma/shared'

/**
 * 禁用没有 API Key 的已启用 DeepSeek 直连渠道。
 *
 * 配置迁移在主进程中负责解密 API Key；本函数保持纯粹，便于覆盖迁移边界。
 */
export function disableUnconfiguredDeepSeekChannel(channel: Channel, apiKey: string): Channel {
  if (channel.provider !== 'deepseek' || !channel.enabled || apiKey.trim()) return channel
  return { ...channel, enabled: false }
}
