/**
 * 钉钉配置管理
 *
 * 负责钉钉 Bot 配置的 CRUD 操作、Client Secret 加密/解密。
 * 使用 Electron safeStorage 进行加密（与飞书相同模式）。
 * 数据持久化到 ~/.proma/dingtalk.json。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { safeStorage } from 'electron'
import { getDingTalkConfigPath } from './config-paths'
import type { DingTalkConfig, DingTalkConfigInput } from '@proma/shared'

/** 默认配置 */
const DEFAULT_CONFIG: DingTalkConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
}

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

// ===== 配置 CRUD =====

/** 读取钉钉配置（clientSecret 是加密后的） */
export function getDingTalkConfig(): DingTalkConfig {
  const configPath = getDingTalkConfigPath()
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(raw) as Partial<DingTalkConfig>
    return { ...DEFAULT_CONFIG, ...data }
  } catch (error) {
    console.error('[钉钉配置] 读取配置文件失败:', error)
    return { ...DEFAULT_CONFIG }
  }
}

/** 保存钉钉配置（接收明文 Client Secret，自动加密后存储） */
export function saveDingTalkConfig(input: DingTalkConfigInput): DingTalkConfig {
  const configPath = getDingTalkConfigPath()
  const current = getDingTalkConfig()

  const config: DingTalkConfig = {
    enabled: input.enabled,
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret ? encryptSecret(input.clientSecret) : current.clientSecret,
    defaultWorkspaceId: input.defaultWorkspaceId,
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  console.log('[钉钉配置] 配置已保存')
  return config
}

/** 获取解密后的 Client Secret */
export function getDecryptedClientSecret(): string {
  const config = getDingTalkConfig()
  return decryptSecret(config.clientSecret)
}
