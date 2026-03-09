/**
 * 飞书配置管理
 *
 * 负责飞书 Bot 配置的 CRUD 操作、App Secret 加密/解密。
 * 使用 Electron safeStorage 进行加密（与渠道 API Key 相同模式）。
 * 数据持久化到 ~/.proma/feishu.json。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { safeStorage } from 'electron'
import { getFeishuConfigPath } from './config-paths'
import type { FeishuConfig, FeishuConfigInput } from '@proma/shared'

/** 默认配置 */
const DEFAULT_CONFIG: FeishuConfig = {
  enabled: false,
  appId: '',
  appSecret: '',
}

// ===== 加密/解密 =====

/**
 * 加密 App Secret
 *
 * 使用 Electron safeStorage 加密，底层使用 OS 级加密。
 *
 * @returns base64 编码的加密字符串
 */
function encryptSecret(plainSecret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[飞书配置] safeStorage 加密不可用，将以明文存储')
    return plainSecret
  }

  const encrypted = safeStorage.encryptString(plainSecret)
  return encrypted.toString('base64')
}

/**
 * 解密 App Secret
 *
 * @returns 明文 App Secret
 */
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

// ===== 配置 CRUD =====

/**
 * 读取飞书配置
 *
 * 返回的 appSecret 是加密后的，不要直接使用。
 * 需要明文 Secret 请调用 getDecryptedAppSecret()。
 */
export function getFeishuConfig(): FeishuConfig {
  const configPath = getFeishuConfigPath()

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(raw) as Partial<FeishuConfig>
    return {
      ...DEFAULT_CONFIG,
      ...data,
    }
  } catch (error) {
    console.error('[飞书配置] 读取配置文件失败:', error)
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 保存飞书配置
 *
 * 接收明文 App Secret，自动加密后存储。
 */
export function saveFeishuConfig(input: FeishuConfigInput): FeishuConfig {
  const configPath = getFeishuConfigPath()
  const current = getFeishuConfig()

  const config: FeishuConfig = {
    enabled: input.enabled,
    appId: input.appId.trim(),
    // 空字符串时保留原值（UI 端留空表示不修改）
    appSecret: input.appSecret ? encryptSecret(input.appSecret) : current.appSecret,
    defaultWorkspaceId: input.defaultWorkspaceId,
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  console.log('[飞书配置] 配置已保存')

  return config
}

/**
 * 获取解密后的 App Secret
 *
 * 用于实际连接飞书 API 时使用。
 */
export function getDecryptedAppSecret(): string {
  const config = getFeishuConfig()
  return decryptSecret(config.appSecret)
}

/**
 * 更新飞书配置的部分字段
 *
 * 不会修改 appId 和 appSecret，仅更新其他字段。
 */
export function updateFeishuConfigPartial(updates: Partial<Omit<FeishuConfig, 'appId' | 'appSecret'>>): FeishuConfig {
  const current = getFeishuConfig()
  const updated: FeishuConfig = { ...current, ...updates }
  const configPath = getFeishuConfigPath()
  writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8')
  return updated
}
