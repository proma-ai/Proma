/**
 * 钉钉配置管理（多 Bot 版本）
 *
 * 支持多个钉钉 Bot 的 CRUD 操作、Client Secret 加密/解密。
 * 使用 Electron safeStorage 进行加密。
 * 数据持久化到 ~/.proma/dingtalk.json（v2 格式：{ version: 2, bots: [...] }）。
 *
 * 向后兼容：自动检测并迁移旧格式（v1 单 Bot）。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { safeStorage } from 'electron'
import { getDingTalkConfigPath, getDingTalkBotBindingsPath } from './config-paths'
import { writeJsonFileAtomic } from './safe-file'
import { createStableDingTalkBotId } from './dingtalk-bot-identity'
import type {
  DingTalkConfig,
  DingTalkConfigInput,
  DingTalkBotConfig,
  DingTalkMultiBotConfig,
  DingTalkBotConfigInput,
} from '@proma/shared'

// ===== 加密/解密 =====

function encryptSecret(plainSecret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[钉钉配置] safeStorage 加密不可用，将以明文存储')
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
    console.error('[钉钉配置] 解密 Client Secret 失败:', error)
    throw new Error('解密 Client Secret 失败')
  }
}

// ===== 内部：读写多 Bot 配置 =====

/** 默认空多 Bot 配置 */
const EMPTY_MULTI_CONFIG: DingTalkMultiBotConfig = { version: 2, bots: [] }

function resolveBotId(clientId: string, fallbackId?: string): string {
  return createStableDingTalkBotId(clientId) ?? fallbackId ?? randomUUID()
}

function readJsonArrayFile(filePath: string): unknown[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeJsonArrayFiles(sourcePath: string, targetPath: string): void {
  const source = readJsonArrayFile(sourcePath)
  const target = existsSync(targetPath) ? readJsonArrayFile(targetPath) : []

  const byChatId = new Map<string, unknown>()
  for (const item of [...source, ...target]) {
    if (!item || typeof item !== 'object') continue
    const chatId = (item as Record<string, unknown>).chatId
    if (typeof chatId !== 'string') continue
    byChatId.set(chatId, item)
  }

  writeJsonFileAtomic(targetPath, Array.from(byChatId.values()))
}

function migrateDingTalkBindingFile(oldBotId: string, nextBotId: string): void {
  if (oldBotId === nextBotId) return

  const oldPath = getDingTalkBotBindingsPath(oldBotId)
  if (!existsSync(oldPath)) return

  const nextPath = getDingTalkBotBindingsPath(nextBotId)
  try {
    if (existsSync(nextPath)) {
      mergeJsonArrayFiles(oldPath, nextPath)
      unlinkSync(oldPath)
    } else {
      renameSync(oldPath, nextPath)
    }
    console.log(`[钉钉配置] 已迁移 Bot 绑定文件: ${oldBotId} → ${nextBotId}`)
  } catch (error) {
    console.warn('[钉钉配置] 迁移 Bot 绑定文件失败:', error)
  }
}

function normalizeBotIds(config: DingTalkMultiBotConfig): boolean {
  let changed = false
  const usedIds = new Set<string>()

  for (const bot of config.bots) {
    const nextId = resolveBotId(bot.clientId, bot.id)
    if (usedIds.has(nextId)) {
      usedIds.add(bot.id)
      continue
    }

    usedIds.add(nextId)
    if (bot.id !== nextId) {
      migrateDingTalkBindingFile(bot.id, nextId)
      bot.id = nextId
      changed = true
    }
  }

  return changed
}

/** 从旧单 Bot 格式迁移到多 Bot 格式 */
function migrateV1ToV2(v1: DingTalkConfig): DingTalkMultiBotConfig {
  if (!v1.clientId) {
    return { ...EMPTY_MULTI_CONFIG }
  }
  const bot: DingTalkBotConfig = {
    id: resolveBotId(v1.clientId),
    name: '钉钉助手',
    enabled: v1.enabled,
    clientId: v1.clientId,
    clientSecret: v1.clientSecret,
    defaultWorkspaceId: v1.defaultWorkspaceId,
  }
  return { version: 2, bots: [bot] }
}

function readRawConfig(): DingTalkMultiBotConfig {
  const configPath = getDingTalkConfigPath()
  if (!existsSync(configPath)) {
    return { ...EMPTY_MULTI_CONFIG }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>

    // v2 格式
    if (data.version === 2 && Array.isArray(data.bots)) {
      const config = data as unknown as DingTalkMultiBotConfig
      if (normalizeBotIds(config)) {
        writeJsonFileAtomic(configPath, config)
        console.log('[钉钉配置] 已稳定 Bot ID 并迁移绑定文件')
      }
      return config
    }

    // v1 格式 → 迁移
    const v1 = data as unknown as DingTalkConfig
    const v2 = migrateV1ToV2(v1)
    writeJsonFileAtomic(configPath, v2)
    console.log('[钉钉配置] 已从 v1 迁移到 v2 多 Bot 格式')
    return v2
  } catch (error) {
    console.error('[钉钉配置] 读取配置文件失败:', error)
    return { ...EMPTY_MULTI_CONFIG }
  }
}

function writeMultiConfig(config: DingTalkMultiBotConfig): void {
  const configPath = getDingTalkConfigPath()
  writeJsonFileAtomic(configPath, config)
}

// ===== 多 Bot API =====

/** 读取多 Bot 配置 */
export function getDingTalkMultiBotConfig(): DingTalkMultiBotConfig {
  return readRawConfig()
}

/** 根据 ID 获取单个 Bot 配置 */
export function getDingTalkBotById(botId: string): DingTalkBotConfig | undefined {
  const config = readRawConfig()
  return config.bots.find((b) => b.id === botId)
}

/** 保存单个 Bot 配置（新建或更新），返回保存后的 Bot 配置 */
export function saveDingTalkBotConfig(input: DingTalkBotConfigInput): DingTalkBotConfig {
  const config = readRawConfig()

  if (input.id) {
    // 更新现有 Bot
    const idx = config.bots.findIndex((b) => b.id === input.id)
    if (idx === -1) {
      throw new Error(`Bot ${input.id} 不存在`)
    }
    const existing = config.bots[idx]!
    const clientId = input.clientId.trim()
    const resolvedId = resolveBotId(clientId, input.id)
    const nextId = config.bots.some((b, i) => i !== idx && b.id === resolvedId)
      ? input.id
      : resolvedId
    if (nextId !== input.id) {
      migrateDingTalkBindingFile(input.id, nextId)
    }
    const updated: DingTalkBotConfig = {
      id: nextId,
      name: input.name,
      enabled: input.enabled,
      clientId,
      clientSecret: input.clientSecret ? encryptSecret(input.clientSecret) : existing.clientSecret,
      defaultWorkspaceId: input.defaultWorkspaceId,
      defaultChannelId: input.defaultChannelId,
      defaultModelId: input.defaultModelId,
    }
    config.bots[idx] = updated
    writeMultiConfig(config)
    console.log(`[钉钉配置] Bot "${updated.name}" 已更新`)
    return updated
  }

  // 新建 Bot
  const bot: DingTalkBotConfig = {
    id: resolveBotId(input.clientId),
    name: input.name,
    enabled: input.enabled,
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret ? encryptSecret(input.clientSecret) : '',
    defaultWorkspaceId: input.defaultWorkspaceId,
    defaultChannelId: input.defaultChannelId,
    defaultModelId: input.defaultModelId,
  }
  config.bots.push(bot)
  writeMultiConfig(config)
  console.log(`[钉钉配置] 新 Bot "${bot.name}" 已创建 (${bot.id})`)
  return bot
}

/** 删除 Bot */
export function removeDingTalkBot(botId: string): boolean {
  const config = readRawConfig()
  const idx = config.bots.findIndex((b) => b.id === botId)
  if (idx === -1) return false
  const removed = config.bots.splice(idx, 1)[0]
  writeMultiConfig(config)
  console.log(`[钉钉配置] Bot "${removed?.name}" 已删除`)
  return true
}

/** 获取某个 Bot 解密后的 Client Secret */
export function getDecryptedBotClientSecret(botId: string): string {
  const bot = getDingTalkBotById(botId)
  if (!bot) throw new Error(`Bot ${botId} 不存在`)
  return decryptSecret(bot.clientSecret)
}

// ===== 向后兼容 API（委托到多 Bot API，操作 bots[0]） =====

/** @deprecated 使用 getDingTalkMultiBotConfig() */
export function getDingTalkConfig(): DingTalkConfig {
  const multi = readRawConfig()
  const first = multi.bots[0]
  if (!first) {
    return { enabled: false, clientId: '', clientSecret: '' }
  }
  return {
    enabled: first.enabled,
    clientId: first.clientId,
    clientSecret: first.clientSecret,
    defaultWorkspaceId: first.defaultWorkspaceId,
  }
}

/** @deprecated 使用 saveDingTalkBotConfig() */
export function saveDingTalkConfig(input: DingTalkConfigInput): DingTalkConfig {
  const multi = readRawConfig()
  const first = multi.bots[0]
  const botInput: DingTalkBotConfigInput = {
    id: first?.id,
    name: first?.name ?? '钉钉助手',
    enabled: input.enabled,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    defaultWorkspaceId: input.defaultWorkspaceId,
  }
  const saved = saveDingTalkBotConfig(botInput)
  return {
    enabled: saved.enabled,
    clientId: saved.clientId,
    clientSecret: saved.clientSecret,
    defaultWorkspaceId: saved.defaultWorkspaceId,
  }
}

/** @deprecated 使用 getDecryptedBotClientSecret(botId) */
export function getDecryptedClientSecret(): string {
  const multi = readRawConfig()
  const first = multi.bots[0]
  if (!first) return ''
  return decryptSecret(first.clientSecret)
}
