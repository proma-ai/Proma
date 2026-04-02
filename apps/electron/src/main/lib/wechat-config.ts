/**
 * 微信配置管理
 *
 * 负责微信 iLink 凭证的持久化存储。
 * Bot Token 使用 Electron safeStorage 加密。
 * 数据持久化到 ~/.proma/wechat.json。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { safeStorage } from 'electron'
import { getWeChatConfigPath } from './config-paths'
import type { WeChatConfig, WeChatCredentials } from '@proma/shared'

/** 默认配置 */
const DEFAULT_CONFIG: WeChatConfig = {
  enabled: false,
  credentials: null,
}

// ===== 加密/解密 =====

function encryptToken(plainToken: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[微信配置] safeStorage 加密不可用，将以明文存储')
    return plainToken
  }
  return safeStorage.encryptString(plainToken).toString('base64')
}

function decryptToken(encryptedToken: string): string {
  if (!encryptedToken) return ''
  if (!safeStorage.isEncryptionAvailable()) return encryptedToken
  try {
    return safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'))
  } catch (error) {
    console.error('[微信配置] 解密 Bot Token 失败:', error)
    throw new Error('解密 Bot Token 失败')
  }
}

// ===== 配置 CRUD =====

/** 读取微信配置（botToken 是加密后的） */
export function getWeChatConfig(): WeChatConfig {
  const configPath = getWeChatConfigPath()
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG }
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const data = JSON.parse(raw) as Partial<WeChatConfig>
    return { ...DEFAULT_CONFIG, ...data }
  } catch (error) {
    console.error('[微信配置] 读取配置失败:', error)
    return { ...DEFAULT_CONFIG }
  }
}

/** 保存微信凭证（接收明文 botToken，自动加密） */
export function saveWeChatCredentials(creds: WeChatCredentials, defaultWorkspaceId?: string): WeChatConfig {
  const configPath = getWeChatConfigPath()
  const config: WeChatConfig = {
    enabled: true,
    credentials: {
      botToken: encryptToken(creds.botToken),
      ilinkBotId: creds.ilinkBotId,
      baseUrl: creds.baseUrl,
      ilinkUserId: creds.ilinkUserId,
    },
    defaultWorkspaceId,
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  console.log('[微信配置] 凭证已保存')
  return config
}

/** 获取解密后的凭证 */
export function getDecryptedCredentials(): WeChatCredentials | null {
  const config = getWeChatConfig()
  if (!config.credentials) return null
  return {
    ...config.credentials,
    botToken: decryptToken(config.credentials.botToken),
  }
}

/** 清除微信凭证（登出） */
export function clearWeChatCredentials(): void {
  const configPath = getWeChatConfigPath()
  const config: WeChatConfig = { enabled: false, credentials: null }
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  console.log('[微信配置] 凭证已清除')
}
