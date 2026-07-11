import { createHash } from 'node:crypto'

const DINGTALK_BOT_ID_PREFIX = 'dingtalk-bot-'

/**
 * 基于钉钉 Client ID 生成稳定 Bot ID。
 *
 * Bot ID 会参与绑定文件路径，不能使用升级/迁移时重新生成的随机值，
 * 否则同一个钉钉群会读不到旧的 chatId -> sessionId 绑定。
 */
export function createStableDingTalkBotId(clientId: string): string | undefined {
  const normalized = clientId.trim()
  if (!normalized) return undefined

  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  return `${DINGTALK_BOT_ID_PREFIX}${digest}`
}
