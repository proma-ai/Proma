/**
 * 飞书配置管理（多 Bot 版本）
 *
 * 支持多个飞书 Bot 的 CRUD 操作、App Secret 加密/解密。
 * 使用 Electron safeStorage 进行加密。
 * 数据持久化到 ~/.proma/feishu.json（v2 格式：{ version: 2, bots: [...] }）。
 *
 * 向后兼容：自动检测并迁移旧格式（v1 单 Bot）。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { safeStorage } from 'electron'
import { getFeishuConfigPath } from './config-paths'
import type {
  FeishuConfig,
  FeishuConfigInput,
  FeishuBotConfig,
  FeishuMultiBotConfig,
  FeishuBotConfigInput,
} from '@proma/shared'

// ===== 加密/解密 =====

function encryptSecret(plainSecret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[飞书配置] safeStorage 加密不可用，将以明文存储')
    return plainSecret
  }
  const encrypted = safeStorage.encryptString(plainSecret)
  return encrypted.toString('base64')
}

function decryptSecret(encryptedSecret: string): string {
  if (!encryptedSecret) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    return encryptedSecret
  }
  try {
    const buffer = Buffer.from(encryptedSecret, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('[飞书配置] 解密 App Secret 失败:', error)
    throw new Error('解密 App Secret 失败')
  }
}

// ===== 内部：读写多 Bot 配置 =====

/** 默认空多 Bot 配置 */
const EMPTY_MULTI_CONFIG: FeishuMultiBotConfig = { version: 2, bots: [] }

/** 从旧单 Bot 格式迁移到多 Bot 格式 */
function migrateV1ToV2(v1: FeishuConfig): FeishuMultiBotConfig {
  if (!v1.appId) {
    return { ...EMPTY_MULTI_CONFIG }
  }
  const bot: FeishuBotConfig = {
    id: randomUUID(),
    name: '飞书助手',
    enabled: v1.enabled,
    appId: v1.appId,
    appSecret: v1.appSecret,
    defaultWorkspaceId: v1.defaultWorkspaceId,
  }
  return { version: 2, bots: [bot] }
}

function readRawConfig(): FeishuMultiBotConfig {
  const configPath = getFeishuConfigPath()
  if (!existsSync(configPath)) {
    return { ...EMPTY_MULTI_CONFIG }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>

    // v2 格式
    if (data.version === 2 && Array.isArray(data.bots)) {
      return data as unknown as FeishuMultiBotConfig
    }

    // v1 格式 → 迁移
    const v1 = data as unknown as FeishuConfig
    const v2 = migrateV1ToV2(v1)
    // 写回迁移后的新格式
    writeFileSync(configPath, JSON.stringify(v2, null, 2), 'utf-8')
    console.log('[飞书配置] 已从 v1 迁移到 v2 多 Bot 格式')
    return v2
  } catch (error) {
    console.error('[飞书配置] 读取配置文件失败:', error)
    return { ...EMPTY_MULTI_CONFIG }
  }
}

function writeMultiConfig(config: FeishuMultiBotConfig): void {
  const configPath = getFeishuConfigPath()
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

// ===== 多 Bot API =====

/** 读取多 Bot 配置 */
export function getFeishuMultiBotConfig(): FeishuMultiBotConfig {
  return readRawConfig()
}

/** 根据 ID 获取单个 Bot 配置 */
export function getFeishuBotById(botId: string): FeishuBotConfig | undefined {
  const config = readRawConfig()
  return config.bots.find((b) => b.id === botId)
}

/** 保存单个 Bot 配置（新建或更新），返回保存后的 Bot 配置 */
export function saveFeishuBotConfig(input: FeishuBotConfigInput): FeishuBotConfig {
  const config = readRawConfig()

  if (input.id) {
    // 更新现有 Bot
    const idx = config.bots.findIndex((b) => b.id === input.id)
    if (idx === -1) {
      throw new Error(`Bot ${input.id} 不存在`)
    }
    const existing = config.bots[idx]!
    const updated: FeishuBotConfig = {
      id: input.id,
      name: input.name,
      enabled: input.enabled,
      appId: input.appId.trim(),
      appSecret: input.appSecret ? encryptSecret(input.appSecret) : existing.appSecret,
      defaultWorkspaceId: input.defaultWorkspaceId ?? existing.defaultWorkspaceId,
      defaultChannelId: input.defaultChannelId ?? existing.defaultChannelId,
      defaultModelId: input.defaultModelId ?? existing.defaultModelId,
    }
    config.bots[idx] = updated
    writeMultiConfig(config)
    console.log(`[飞书配置] Bot "${updated.name}" 已更新`)
    return updated
  }

  // 新建 Bot
  const bot: FeishuBotConfig = {
    id: randomUUID(),
    name: input.name,
    enabled: input.enabled,
    appId: input.appId.trim(),
    appSecret: input.appSecret ? encryptSecret(input.appSecret) : '',
    defaultWorkspaceId: input.defaultWorkspaceId,
    defaultChannelId: input.defaultChannelId,
    defaultModelId: input.defaultModelId,
  }
  config.bots.push(bot)
  writeMultiConfig(config)
  console.log(`[飞书配置] 新 Bot "${bot.name}" 已创建 (${bot.id})`)
  return bot
}

/** 删除 Bot */
export function removeFeishuBot(botId: string): boolean {
  const config = readRawConfig()
  const idx = config.bots.findIndex((b) => b.id === botId)
  if (idx === -1) return false
  const removed = config.bots.splice(idx, 1)[0]
  writeMultiConfig(config)
  console.log(`[飞书配置] Bot "${removed?.name}" 已删除`)
  return true
}

/** 获取某个 Bot 解密后的 App Secret */
export function getDecryptedBotAppSecret(botId: string): string {
  const bot = getFeishuBotById(botId)
  if (!bot) throw new Error(`Bot ${botId} 不存在`)
  return decryptSecret(bot.appSecret)
}

// ===== 向后兼容 API（委托到多 Bot API，操作 bots[0]） =====

/** @deprecated 使用 getFeishuMultiBotConfig() */
export function getFeishuConfig(): FeishuConfig {
  const multi = readRawConfig()
  const first = multi.bots[0]
  if (!first) {
    return { enabled: false, appId: '', appSecret: '' }
  }
  return {
    enabled: first.enabled,
    appId: first.appId,
    appSecret: first.appSecret,
    defaultWorkspaceId: first.defaultWorkspaceId,
  }
}

/** @deprecated 使用 saveFeishuBotConfig() */
export function saveFeishuConfig(input: FeishuConfigInput): FeishuConfig {
  const multi = readRawConfig()
  const first = multi.bots[0]
  const botInput: FeishuBotConfigInput = {
    id: first?.id,
    name: first?.name ?? '飞书助手',
    enabled: input.enabled,
    appId: input.appId,
    appSecret: input.appSecret,
    defaultWorkspaceId: input.defaultWorkspaceId,
    defaultChannelId: first?.defaultChannelId,
    defaultModelId: first?.defaultModelId,
  }
  const saved = saveFeishuBotConfig(botInput)
  return {
    enabled: saved.enabled,
    appId: saved.appId,
    appSecret: saved.appSecret,
    defaultWorkspaceId: saved.defaultWorkspaceId,
  }
}

/** @deprecated 使用 getDecryptedBotAppSecret(botId) */
export function getDecryptedAppSecret(): string {
  const multi = readRawConfig()
  const first = multi.bots[0]
  if (!first) return ''
  return decryptSecret(first.appSecret)
}

/** @deprecated */
export function updateFeishuConfigPartial(updates: Partial<Omit<FeishuConfig, 'appId' | 'appSecret'>>): FeishuConfig {
  const multi = readRawConfig()
  const first = multi.bots[0]
  if (first) {
    if (updates.enabled !== undefined) first.enabled = updates.enabled
    if (updates.defaultWorkspaceId !== undefined) first.defaultWorkspaceId = updates.defaultWorkspaceId
    writeMultiConfig(multi)
  }
  return getFeishuConfig()
}
