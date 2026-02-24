/**
 * 全局代理配置服务
 *
 * 管理应用的全局代理配置，支持系统代理自动检测和手动配置。
 * 配置文件存储在 ~/.proma/proxy-settings.json。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ProxyConfig } from '@proma/shared'
import { getProxySettingsPath } from './config-paths'
import { detectSystemProxy } from './system-proxy-detector'

/**
 * 默认代理配置
 */
const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  mode: 'system',
  manualUrl: '',
}

/**
 * 读取代理配置
 *
 * 如果配置文件不存在，返回默认配置。
 */
export async function getProxySettings(): Promise<ProxyConfig> {
  const configPath = getProxySettingsPath()

  if (!existsSync(configPath)) {
    console.log('[代理配置] 配置文件不存在，使用默认配置')
    return DEFAULT_PROXY_CONFIG
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as ProxyConfig
  } catch (error) {
    console.error('[代理配置] 读取配置失败:', error)
    return DEFAULT_PROXY_CONFIG
  }
}

/**
 * 保存代理配置
 *
 * @param config 代理配置
 */
export async function saveProxySettings(config: ProxyConfig): Promise<void> {
  const configPath = getProxySettingsPath()

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    console.log('[代理配置] 配置已保存:', config)
  } catch (error) {
    console.error('[代理配置] 保存配置失败:', error)
    throw new Error('保存代理配置失败')
  }
}

/**
 * 获取当前生效的代理 URL
 *
 * 根据配置返回实际使用的代理地址：
 * - 如果代理未启用，返回 undefined
 * - 如果是系统代理模式，自动检测系统代理
 * - 如果是手动模式，返回手动配置的地址
 *
 * @returns 代理 URL（如果有）
 */
export async function getEffectiveProxyUrl(): Promise<string | undefined> {
  const config = await getProxySettings()

  if (!config.enabled) {
    return undefined
  }

  if (config.mode === 'system') {
    const result = await detectSystemProxy()
    if (result.success && result.proxyUrl) {
      console.log('[代理配置] 使用系统代理:', result.proxyUrl)
      return result.proxyUrl
    }
    console.log('[代理配置] 系统代理检测失败:', result.message)
    return undefined
  }

  // 手动模式
  if (config.manualUrl.trim()) {
    console.log('[代理配置] 使用手动配置代理:', config.manualUrl)
    return config.manualUrl.trim()
  }

  return undefined
}
