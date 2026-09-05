import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { SlackBotConfig, SlackBotConfigInput, SlackConfig } from '@proma/shared'
import { getSlackConfigPath } from './config-paths'
import { redactSensitiveLogValue } from './bridge-log-redaction'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'

const EMPTY_CONFIG: SlackConfig = { version: 1, bots: [] }
const CHINESE_CHARACTER_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF]/u

function encryptSecret(secret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[Slack 配置] safeStorage 加密不可用，将以明文存储')
    return secret
  }
  return safeStorage.encryptString(secret).toString('base64')
}

function decryptSecret(secret: string): string {
  if (!secret) return ''
  if (!safeStorage.isEncryptionAvailable()) return secret
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch (error) {
    console.error('[Slack 配置] 解密 token 失败:', redactSensitiveLogValue(error))
    throw new Error('Slack token 解密失败，请重新保存配置')
  }
}

function isSlackBotConfig(value: unknown): value is SlackBotConfig {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SlackBotConfig>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.enabled === 'boolean'
    && typeof candidate.botToken === 'string'
    && typeof candidate.appToken === 'string'
}

function normalizeBotConfig(value: SlackBotConfig): SlackBotConfig {
  // Explicitly whitelist supported fields so a read migrates away legacy DM metadata.
  const candidate = value as SlackBotConfig & Record<string, unknown>
  return {
    id: candidate.id,
    name: candidate.name,
    enabled: candidate.enabled,
    botToken: candidate.botToken,
    appToken: candidate.appToken,
    defaultChannelId: candidate.defaultChannelId?.trim() || undefined,
    defaultModelId: candidate.defaultModelId?.trim() || undefined,
    homeChannelId: candidate.homeChannelId?.trim() || undefined,
  }
}

function readRawConfig(): SlackConfig {
  const parsed = readJsonFileSafe<unknown>(getSlackConfigPath())
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_CONFIG }
  const candidate = parsed as Partial<SlackConfig>
  if (candidate.version !== 1 || !Array.isArray(candidate.bots)) return { ...EMPTY_CONFIG }

  const bots = candidate.bots.filter(isSlackBotConfig).map(normalizeBotConfig)
  const normalized: SlackConfig = { version: 1, bots }
  if (JSON.stringify(candidate.bots) !== JSON.stringify(bots)) {
    writeJsonFileAtomic(getSlackConfigPath(), normalized)
  }
  return normalized
}

function saveRawConfig(config: SlackConfig): void {
  writeJsonFileAtomic(getSlackConfigPath(), config)
}

export function getSlackConfig(): SlackConfig {
  return readRawConfig()
}

export function getSlackBotById(botId: string): SlackBotConfig | undefined {
  return readRawConfig().bots.find((bot) => bot.id === botId)
}

export function saveSlackBotConfig(input: SlackBotConfigInput): SlackBotConfig {
  const config = readRawConfig()
  const name = input.name.trim() || 'Proma'
  if (CHINESE_CHARACTER_PATTERN.test(name)) {
    throw new Error('Slack App 名称不能包含中文，请使用英文名称')
  }

  if (input.id) {
    const index = config.bots.findIndex((bot) => bot.id === input.id)
    if (index === -1) throw new Error(`Slack Bot ${input.id} 不存在`)
    const existing = config.bots[index]!
    const next: SlackBotConfig = normalizeBotConfig({
      ...existing,
      name,
      enabled: input.enabled,
      botToken: input.botToken.trim() ? encryptSecret(input.botToken.trim()) : existing.botToken,
      appToken: input.appToken.trim() ? encryptSecret(input.appToken.trim()) : existing.appToken,
      defaultChannelId: input.defaultChannelId,
      defaultModelId: input.defaultModelId,
      homeChannelId: input.homeChannelId,
    })
    config.bots[index] = next
    saveRawConfig(config)
    return next
  }

  const bot = normalizeBotConfig({
    id: randomUUID(),
    name,
    enabled: input.enabled,
    botToken: input.botToken.trim() ? encryptSecret(input.botToken.trim()) : '',
    appToken: input.appToken.trim() ? encryptSecret(input.appToken.trim()) : '',
    defaultChannelId: input.defaultChannelId,
    defaultModelId: input.defaultModelId,
    homeChannelId: input.homeChannelId,
  })
  config.bots.push(bot)
  saveRawConfig(config)
  return bot
}

export function removeSlackBot(botId: string): boolean {
  const config = readRawConfig()
  const index = config.bots.findIndex((bot) => bot.id === botId)
  if (index === -1) return false
  config.bots.splice(index, 1)
  saveRawConfig(config)
  return true
}

export function getDecryptedSlackBotToken(botId: string): string {
  const bot = getSlackBotById(botId)
  if (!bot) throw new Error(`Slack Bot ${botId} 不存在`)
  return decryptSecret(bot.botToken)
}

export function getDecryptedSlackAppToken(botId: string): string {
  const bot = getSlackBotById(botId)
  if (!bot) throw new Error(`Slack Bot ${botId} 不存在`)
  return decryptSecret(bot.appToken)
}
